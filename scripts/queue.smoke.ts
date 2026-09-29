// 端到端冒烟：提交队列 FIFO 重放 / 冲突双方保留 / 合并 / 放弃 / 持久化恢复 / 门禁
globalThis.localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
  clear() { this._data.clear(); }
} as unknown as Storage;

await import('../src/queue'); // 注册自动重放处理器
const { store } = await import('../src/store');
const { simulateExternalChange } = await import('../src/mockServer');
const { discardCommit, enqueueCommit, mergeCommit, releasePackage, setConnectivity, isCommitActive } = await import('../src/store');
const goOffline = () => store.dispatch(setConnectivity(true));  // offline=true
const goOnline = () => store.dispatch(setConnectivity(false)); // offline=false

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const assert = (cond: boolean, label: string) => {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { failures++; console.error(`  FAIL  ${label}`); }
};
const waitUntil = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 80; i++) {
    if (pred()) break;
    await wait(50);
  }
  assert(pred(), label);
};
const q = () => store.getState().maintenance.queue;
const card = (id: string) => store.getState().maintenance.cards.find((c) => c.id === id)!;
const commit = (cardId: string) => q().find((c) => c.cardId === cardId)!;

async function scenario1_onlineFifo() {
  console.log('\n[1] 在线提交按 seq 顺序重放（两张不同工卡）');
  store.dispatch(enqueueCommit({ cardId: 'CARD-02', patch: { measurement: '0.12 mm', finding: '孔探正常', status: '已完成' } }));
  store.dispatch(enqueueCommit({ cardId: 'CARD-05', patch: { measurement: 'AD 已执行', finding: '签署完成', status: '已完成' } }));
  assert(q().filter(isCommitActive).length === 2, '两个提交进入队列');
  await waitUntil(() => q().every((c) => c.status === 'applied'), '两个提交均按序落库');
  const [a, b] = q();
  assert(a.seq < b.seq, '落库顺序与入队顺序一致（FIFO）');
  assert(store.getState().maintenance.serverVersion === 9, `工作包版本推进至 R9（实际 R${store.getState().maintenance.serverVersion}）`);
  assert(card('CARD-02').measurement === '0.12 mm' && card('CARD-02').status === '已完成', '工卡内容随提交更新');
}

async function scenario2_offlineConflict() {
  console.log('\n[2] 离线编辑 + 服务器版本变化 -> 冲突保留双方，后续提交被阻断');
  goOffline();
  store.dispatch(enqueueCommit({ cardId: 'CARD-06', patch: { measurement: '12 项均在有效期', finding: '本地检查完成', status: '已完成' } }));
  store.dispatch(enqueueCommit({ cardId: 'CARD-07', patch: { measurement: '试车参数正常', finding: '', status: '已完成' } }));
  await wait(50);
  assert(commit('CARD-06').status === 'queued', '离线提交停留在队列，不发往服务器');
  await simulateExternalChange('CARD-06');
  goOnline();
  await waitUntil(() => q().some((c) => c.status === 'conflict'), '重放检测到 409 冲突');
  const conflict = commit('CARD-06');
  assert(conflict.cardId === 'CARD-06', '队首提交（CARD-06）为冲突提交');
  assert(conflict.patch.measurement === '12 项均在有效期', '本地版本保留');
  assert(Boolean(conflict.serverCard) && conflict.serverCard!.finding.includes('服务器端更新'), '服务器版本快照保留');
  assert(commit('CARD-07').status === 'queued', '冲突未决时，后续提交保持等待');
  assert(card('CARD-06').measurement === '12 项均在有效期', '本地显示未被服务器悄悄覆盖');
}

async function scenario3_merge() {
  console.log('\n[3] 执行人员选择合并 -> 回队首重放 -> 落库并放行后续提交');
  const conflict = commit('CARD-06');
  store.dispatch(mergeCommit({
    seq: conflict.seq,
    patch: { measurement: '12 项均在有效期（与值班工程师复核一致）', finding: `${conflict.patch.finding}；${conflict.serverCard!.finding}`, status: '已完成' }
  }));
  assert(['queued', 'sending', 'applied'].includes(commit('CARD-06').status) && commit('CARD-06').status !== 'conflict', '合并后离开冲突态，重新进入队列重放');
  // CARD-06 先于 CARD-07 落库，全部完成后两个工卡均为已接收
  await waitUntil(() => q().filter((c) => c.seq >= conflict.seq).every((c) => c.status === 'applied'), '合并提交与后续提交依次落库');
  assert(commit('CARD-06').resolvedAt! <= commit('CARD-07').resolvedAt!, '合并提交先于后续提交落库');
  assert(card('CARD-06').finding.includes('本地检查完成') && card('CARD-06').finding.includes('服务器端更新'), '合并后双方内容均保留');
  assert(card('CARD-07').status === '已完成', '后续提交（CARD-07）在冲突解除后完成重放');
}

async function scenario4_discard() {
  console.log('\n[4] 第二个冲突 -> 放弃本地版本 -> 采用服务器内容，本地版本留档');
  goOffline();
  store.dispatch(enqueueCommit({ cardId: 'CARD-08', patch: { measurement: '本地复测 2901 psi', finding: '本地：无新增重复缺陷', status: '已完成' } }));
  await wait(50);
  await simulateExternalChange('CARD-08');
  goOnline();
  await waitUntil(() => q().some((c) => c.status === 'conflict'), '检测到冲突');
  const conflict = q().find((c) => c.cardId === 'CARD-08' && c.status === 'conflict')!;
  const localBackup = conflict.patch.measurement;
  const serverMeasurement = conflict.serverCard!.measurement;
  const serverFinding = conflict.serverCard!.finding;
  store.dispatch(discardCommit(conflict.seq));
  const discarded = q().find((c) => c.seq === conflict.seq)!;
  assert(discarded.status === 'discarded', '提交状态为已放弃（记录保留）');
  assert(discarded.patch.measurement === localBackup, '本地版本在队列记录中留档');
  assert(card('CARD-08').measurement === serverMeasurement && card('CARD-08').finding === serverFinding, '本地工卡还原为服务器内容');
}

async function scenario5_gate() {
  console.log('\n[5] 队列未闭环时放行门禁阻断，闭环后恢复可放行');
  goOffline();
  const before = store.getState().maintenance.released;
  store.dispatch(enqueueCommit({ cardId: 'CARD-01', patch: { measurement: '1.63 mm', finding: '复测', status: '已完成' } }));
  store.dispatch(releasePackage());
  assert(store.getState().maintenance.released === before, '离线有待提交时不能放行');
  goOnline();
  await waitUntil(() => q().every((c) => c.status === 'applied' || c.status === 'discarded'), '恢复联网后队列闭环');
}

async function scenario6_persistence() {
  console.log('\n[6] 模拟刷新页面：持久化状态恢复，冲突自动弹窗');
  goOffline();
  store.dispatch(enqueueCommit({ cardId: 'CARD-02', patch: { measurement: '离线值 0.20 mm', finding: '离线期间修改', status: '已完成' } }));
  await wait(50);
  await simulateExternalChange('CARD-02');
  goOnline();
  await waitUntil(() => store.getState().maintenance.queue.some((c) => c.status === 'conflict'), '制造冲突状态');
  const raw = JSON.stringify(store.getState().maintenance);
  const restored = JSON.parse(raw) as ReturnType<typeof store.getState>['maintenance'];
  assert(restored.queue.some((c) => c.status === 'conflict' && c.serverCard && c.patch.measurement === '离线值 0.20 mm'), '未决冲突与双方内容已持久化');
  assert(restored.conflictOpen === true, '重新打开页面自动弹出未决冲突');
  const auditHasMerge = store.getState().maintenance.audit.some((e) => e.action === '选择合并');
  const auditHasDiscard = store.getState().maintenance.audit.some((e) => e.action === '放弃本地版本');
  const auditHasReceived = store.getState().maintenance.audit.some((e) => e.action === '提交已接收');
  assert(auditHasMerge && auditHasDiscard && auditHasReceived, '审计记录覆盖接收 / 合并 / 放弃');
}

(async () => {
  await scenario1_onlineFifo();
  await scenario2_offlineConflict();
  await scenario3_merge();
  await scenario4_discard();
  await scenario5_gate();
  await scenario6_persistence();
  console.log(failures ? `\n${failures} 项断言失败` : '\n全部断言通过');
  process.exit(failures ? 1 : 0);
})();
