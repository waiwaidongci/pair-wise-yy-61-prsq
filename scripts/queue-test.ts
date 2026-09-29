import './storage-shim';
import { store, replayQueue, enqueueItem, toggleOffline, resolveMerge, resolveAbandon, evaluateGate, releasePackage, signStage } from '../src/store';
import { maintenanceApi } from '../src/api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const goOffline = () => store.dispatch(toggleOffline());
const goOnline = async () => { store.dispatch(toggleOffline()); await store.dispatch(replayQueue()); };
const remoteSubmit = (payload: { cardId: string; measurement: string; finding: string; status: '执行中' | '已完成' | '未开始' | '待授权' }) =>
  store.dispatch(maintenanceApi.endpoints.simulateRemoteChange.initiate({ ...payload, actor: '检验员终端' }));

let failures = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

// —— 场景 1：离线连续提交 2 张工卡，联网后按序重放；自己的版本推进不能造成假冲突 ——
goOffline();
store.dispatch(enqueueItem({ cardId: 'CARD-02', kind: 'complete', actor: '宋杰', patch: { measurement: '凹坑 0.18 mm', finding: '在限内', status: '已完成' } }));
store.dispatch(enqueueItem({ cardId: 'CARD-05', kind: 'complete', actor: '宋杰', patch: { measurement: 'AD 已执行', finding: '签署完成', status: '已完成' } }));
let s = store.getState().maintenance;
check('离线提交进入队列且有序号', s.queue.length === 2 && s.queue[0].seq === 1 && s.queue[1].seq === 2);
check('离线时本地工卡已乐观更新', s.cards.find((c) => c.id === 'CARD-02')?.status === '已完成');
check('离线期间门禁阻断（有待同步）', evaluateGate(s).pending === 2 && !evaluateGate(s).canRelease);

await goOnline();
s = store.getState().maintenance;
check('两项均按序提交成功', s.queue.every((i) => i.status === 'applied'), s.queue.map((i) => i.status).join(','));
check('服务器版本推进 2 个版本（自己的提交自动变基，无假冲突）', s.serverVersion === 9, `R${s.serverVersion}`);
check('队列空闲', s.replayState === 'idle');
check('队列闭合后待同步归零', evaluateGate(s).pending === 0);

// —— 场景 2：离线提交后他端先提交 → 重放撞 409 → 暂停并保留双方内容 ——
goOffline();
store.dispatch(enqueueItem({ cardId: 'CARD-06', kind: 'complete', actor: '宋杰', patch: { measurement: '全部在有效期内（本地）', finding: '本地客舱复核完成', status: '已完成' } }));
const remote = await remoteSubmit({ cardId: 'CARD-06', measurement: '他端：2 个气瓶待更换', finding: '他端发现 2 个氧气瓶即将到期', status: '执行中' });
check('他端提交使服务器升版', remote.data?.revision === 10, `R${remote.data?.revision}`);

await goOnline();
s = store.getState().maintenance;
const conflictItem = s.queue.find((i) => i.status === 'conflict');
check('重放在冲突处暂停', conflictItem !== undefined && s.replayState === 'paused');
check('服务器版本内容已保留', conflictItem?.conflict?.serverCard?.measurement === '他端：2 个气瓶待更换');
check('本地版本内容已保留', conflictItem?.patch.measurement === '全部在有效期内（本地）');
check('共同基线已留存（三方合并）', conflictItem?.baseCard?.measurement !== undefined);
check('未决冲突自动打开待裁决', s.activeConflictSeq === conflictItem?.seq);
check('冲突期间后续重放不继续', s.replayState === 'paused');
check('有冲突时门禁阻断', evaluateGate(s).conflicts === 1 && !evaluateGate(s).canRelease);

// 执行人员选择合并
store.dispatch(resolveMerge({
  seq: conflictItem!.seq,
  merged: { measurement: '全部在有效期内；他端 2 个气瓶已登记更换', finding: '本地：本地客舱复核完成\n服务器：他端发现 2 个氧气瓶即将到期', status: '已完成' }
}));
await store.dispatch(replayQueue());
s = store.getState().maintenance;
const mergedItem = s.queue.find((i) => i.seq === conflictItem!.seq);
check('合并后重新提交成功', mergedItem?.status === 'applied', mergedItem?.status);
check('合并提交后版本推进到 R11', s.serverVersion === 11, `R${s.serverVersion}`);
check('冲突清零且队列恢复空闲', !s.queue.some((i) => i.status === 'conflict') && s.replayState === 'idle');
check('合并审计留痕', s.audit.some((a) => a.action === '冲突合并'));

// —— 场景 3：再次冲突，选择放弃本地 → 采用服务器，原值留存 ——
goOffline();
store.dispatch(enqueueItem({ cardId: 'CARD-08', kind: 'complete', actor: '宋杰', patch: { measurement: '本地趋势结论', finding: '本地填写', status: '已完成' } }));
await remoteSubmit({ cardId: 'CARD-08', measurement: '他端趋势结论', finding: '他端填写', status: '已完成' });
await goOnline();
s = store.getState().maintenance;
const c2 = s.queue.find((i) => i.status === 'conflict');
check('第二次冲突被检测', c2 !== undefined);
store.dispatch(resolveAbandon(c2!.seq));
await store.dispatch(replayQueue());
s = store.getState().maintenance;
check('放弃后队列项标记为 abandoned', s.queue.find((i) => i.seq === c2!.seq)?.status === 'abandoned');
check('工卡采用服务器值（非悄悄覆盖：审计记录本地原值）', s.cards.find((c) => c.id === 'CARD-08')?.measurement === '他端趋势结论');
check('放弃后重放器恢复空闲', s.replayState === 'idle');
const abandonAudit = s.audit.find((a) => a.action === '放弃本地版本');
check('放弃动作留痕且保留原值', !!abandonAudit && abandonAudit.detail.includes('本地趋势结论'));

// —— 场景 4：持久化与重新打开页面恢复 ——
goOffline();
store.dispatch(enqueueItem({ cardId: 'CARD-07', kind: 'complete', actor: '宋杰', patch: { measurement: '参数正常', finding: '试车合格', status: '已完成' } }));
const persisted = JSON.parse(localStorage.getItem('yy61-work-package')!);
check('队列持久化到 localStorage', Array.isArray(persisted.queue) && persisted.queue.some((i: any) => i.cardId === 'CARD-07' && i.status === 'queued'));
const queued = persisted.queue.find((i: any) => i.cardId === 'CARD-07');
check('持久化项含顺序号/乐观锁版本/双方快照', typeof queued.seq === 'number' && typeof queued.expectedRevision === 'number' && !!queued.baseCard && !!queued.patch);

await remoteSubmit({ cardId: 'CARD-07', measurement: '他端试车值', finding: '他端试车', status: '执行中' });
await goOnline();
s = store.getState().maintenance;
const c3 = s.queue.find((i) => i.cardId === 'CARD-07');
check('CARD-07 冲突挂起等待页面刷新后续处理', c3?.status === 'conflict' && s.activeConflictSeq === c3.seq);
const persisted2 = JSON.parse(localStorage.getItem('yy61-work-package')!);
check('刷新前冲突态已落盘', persisted2.activeConflictSeq === c3.seq);

// —— 场景 5：全部处理完、阶段签署后门禁联动放行 ——
store.dispatch(resolveAbandon(c3.seq));
await store.dispatch(replayQueue());
store.dispatch(enqueueItem({ cardId: 'CARD-03', kind: 'authorize', actor: '放行授权人', patch: { measurement: '2762 psi', finding: '超差已授权', status: '执行中' } }));
await store.dispatch(replayQueue());
for (const stage of ['系统', '动力', '放行']) store.dispatch(signStage(stage));
s = store.getState().maintenance;
const gate = evaluateGate(s);
check('门禁全部满足', gate.canRelease, JSON.stringify(gate));
store.dispatch(releasePackage());
check('工作包锁定放行', store.getState().maintenance.released);
check('放行审计记录含服务器版本', store.getState().maintenance.audit[0].detail.includes(`R${store.getState().maintenance.serverVersion}`));

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
