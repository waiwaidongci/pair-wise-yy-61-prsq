import './storage-shim';
import type { MaintenanceState } from '../src/store';

// 预置一个“页面关闭前”的持久化状态：队列头冲突、对话框打开、还有后续排队项
const saved: MaintenanceState = {
  cards: [
    { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revision: 'R7', estimated: 4.2, dependencies: [], tolerance: '凹坑 ≤ 0.3 mm', evidence: '', witness: '', status: '已完成', measurement: '凹坑 0.18 mm（本地）', finding: '本地判定在限内', stage: '发动机签署' }
  ],
  activeCardId: 'CARD-02',
  serverVersion: 10,
  offline: false,
  lastSaved: '10:01:02',
  signatures: [],
  released: false,
  audit: [],
  queueSeq: 2,
  replayState: 'running', // 刷新前恰好“重放中”，重开后必须回退为暂停而不是卡死
  activeConflictSeq: 1,
  queue: [
    {
      seq: 1, cardId: 'CARD-02', cardTitle: '发动机 2 风扇叶片孔探', kind: 'complete', actor: '宋杰',
      baseRevision: 9, expectedRevision: 9,
      patch: { measurement: '凹坑 0.18 mm（本地）', finding: '本地判定在限内', status: '已完成' },
      baseCard: { measurement: '', finding: '', status: '执行中' },
      createdAt: '09:58:00', status: 'conflict', attempts: 1, sentAt: '09:59:00',
      conflict: { detectedAt: '09:59:01', serverRevision: 10, serverCard: { measurement: '凹坑 0.31 mm（他端）', finding: '他端判定超差待复核', status: '待授权' } }
    },
    {
      seq: 2, cardId: 'CARD-02', cardTitle: '发动机 2 风扇叶片孔探', kind: 'complete', actor: '宋杰',
      baseRevision: 9, expectedRevision: 9,
      patch: { measurement: '补充拍照已上传', finding: '追加证据', status: '已完成' },
      baseCard: { measurement: '', finding: '', status: '执行中' },
      createdAt: '10:00:00', status: 'queued', attempts: 0
    }
  ]
};
localStorage.setItem('yy61-work-package', JSON.stringify(saved));

const { store, replayQueue, evaluateGate } = await import('../src/store');

let failures = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

let s = store.getState().maintenance;
check('冲突对话框在重新打开页面后自动恢复', s.activeConflictSeq === 1);
check('重放中状态回退为暂停，不会卡死', s.replayState === 'paused');
check('冲突项与双方内容完整恢复', s.queue[0].conflict?.serverCard.measurement === '凹坑 0.31 mm（他端）' && s.queue[0].patch.measurement === '凹坑 0.18 mm（本地）');
check('后续排队项仍保留顺序', s.queue[1].seq === 2 && s.queue[1].status === 'queued');
check('门禁感知到 1 项冲突 1 项待同步', evaluateGate(s).conflicts === 1 && evaluateGate(s).pending === 1);

// 即使自动重放被触发，也必须被未决冲突挡住
await store.dispatch(replayQueue());
s = store.getState().maintenance;
check('未裁决前重放不会越过冲突项', s.queue[1].status === 'queued' && s.queue[0].status === 'conflict');

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
