import { maintenanceApi, type SubmitCardError } from './api';
import {
  acceptCommit,
  beginReconcile,
  isCommitActive,
  markConflict,
  markFlushIdle,
  markSending,
  reconcilePackage,
  requeueCommit,
  setConnectivity,
  store
} from './store';

// 找队首未闭环提交：FIFO，任何一个未决冲突都会阻断后续提交
function headCommit() {
  const { maintenance } = store.getState();
  const active = maintenance.queue.filter(isCommitActive);
  if (!active.length) return null;
  return active.reduce((earliest, item) => (item.seq < earliest.seq ? item : earliest));
}

// 恢复在线后先协调：拉取服务器最新工作包，校正每个排队提交的工卡版本基线。
// 是否需要协调由 needsReconcile 决定；协调中通过 reducer 的 reconciling 状态去重。
async function reconcile() {
  store.dispatch(beginReconcile());
  const request = store.dispatch(maintenanceApi.endpoints.getWorkPackage.initiate(undefined, { forceRefetch: true }));
  try {
    const pkg = await request.unwrap();
    // 请求往返期间可能又断开网络：陈旧快照不得落地，等下次恢复在线再协调
    if (store.getState().maintenance.offline) {
      needsReconcile = true;
      store.dispatch(markFlushIdle());
      return;
    }
    store.dispatch(
      reconcilePackage({
        revision: pkg.serverRevision,
        tasks: pkg.tasks.map((task) => ({ ...task }))
      })
    );
    needsReconcile = false;
    // 协调过程中可能把队首直接标成冲突；evaluate() 会按最新状态决定下一步
    evaluate();
  } catch {
    // 暂时连不上服务器：保持待协调标记，状态机稍后重试
    needsReconcile = true;
    store.dispatch(markFlushIdle());
  } finally {
    request.unsubscribe();
  }
}

async function flushQueue() {
  for (;;) {
    const { maintenance } = store.getState();
    if (maintenance.offline) break;
    const head = headCommit();
    if (!head) break;
    if (head.status === 'conflict') break; // 等待执行人员选择合并或放弃
    if (head.status === 'sending') break; // 已有在途提交（页面刷新恢复后正常不会出现）

    store.dispatch(markSending(head.seq));
    const request = store.dispatch(
      maintenanceApi.endpoints.submitCard.initiate({
        cardId: head.cardId,
        baseCardRevision: head.baseCardRevision,
        measurement: head.patch.measurement,
        finding: head.patch.finding
      })
    );
    try {
      const result = await request.unwrap();
      store.dispatch(acceptCommit({ seq: head.seq, revision: result.revision, cardRevision: result.cardRevision }));
      // 继续重放后续提交，保持先后顺序
    } catch (error) {
      const failure = error as { status?: number; data?: SubmitCardError['data'] };
      if (failure.status === 409 && failure.data) {
        store.dispatch(
          markConflict({
            seq: head.seq,
            message: failure.data.message,
            serverRevision: failure.data.revision,
            serverCardRevision: failure.data.cardRevision,
            serverCard: failure.data.serverCard
          })
        );
        break; // 冲突未处理前，后续提交一律等待
      }
      store.dispatch(requeueCommit({ seq: head.seq, reason: failure.data?.message ?? '网络或服务器暂不可用' }));
      break;
    }
  }
  store.dispatch(markFlushIdle());
}

// 是否需要先与服务器协调：进入离线、或从持久化恢复出待重放提交时置真；一次成功协调后置假
let needsReconcile = store.getState().maintenance.queue.some(isCommitActive);

// 状态机评估：离线只登记；在线时按 协调 -> 重放 推进，冲突则挂起等待人工
function evaluate() {
  const maintenance = store.getState().maintenance;
  if (maintenance.offline) {
    needsReconcile = true;
    return;
  }
  if (maintenance.flushing || maintenance.reconciling) return;
  const head = headCommit();
  if (!head || head.status !== 'queued') return;
  if (needsReconcile) {
    void reconcile();
    return;
  }
  void flushQueue();
}

store.subscribe(() => evaluate());

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => store.dispatch(setConnectivity(false)));
  window.addEventListener('offline', () => store.dispatch(setConnectivity(true)));
}

// 首次加载：恢复上次会话的待重放提交（在线时同样先协调再重放）
const initial = store.getState().maintenance;
if (!initial.offline && initial.queue.some(isCommitActive)) needsReconcile = true;
evaluate();

export { flushQueue, reconcile };
