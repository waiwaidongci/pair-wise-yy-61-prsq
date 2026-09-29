import { configureStore, createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch } from 'react-redux';
import { maintenanceApi, type CardStatus, type WorkCard } from './api';

export type StageSignature = { stage: string; status: '待签署' | '已签署'; actor: string; time: string };
export type AuditEntry = { time: string; actor: string; action: string; detail: string };

export type OfflineCard = WorkCard;

export type ItemStatus = 'queued' | 'replaying' | 'applied' | 'conflict' | 'abandoned' | 'error';
export type ItemKind = 'complete' | 'authorize';

export type CardValues = { measurement: string; finding: string; status: CardStatus };

export type QueueItem = {
  seq: number;
  cardId: string;
  cardTitle: string;
  kind: ItemKind;
  actor: string;
  // 提交所基于的服务器版本（审计展示用）
  baseRevision: number;
  // 乐观锁版本：重放时带给服务器；自己之前的提交成功后会随之变基，他端提交则不会
  expectedRevision: number;
  // 本地版本：执行人员离线时录入的内容
  patch: CardValues;
  // 共同基线：入队前工卡内容，冲突时用于三方对照
  baseCard: CardValues;
  createdAt: string;
  sentAt?: string;
  appliedAt?: string;
  appliedRevision?: number;
  status: ItemStatus;
  attempts: number;
  lastError?: string;
  conflict?: {
    detectedAt: string;
    serverRevision: number;
    serverCard: CardValues | null;
  };
};

type ReplayState = 'idle' | 'running' | 'paused';

type MaintenanceState = {
  cards: OfflineCard[];
  activeCardId: string;
  serverVersion: number;
  offline: boolean;
  lastSaved: string;
  signatures: StageSignature[];
  released: boolean;
  audit: AuditEntry[];
  // 可恢复提交队列：按 seq 先后重放，整体持久化
  queue: QueueItem[];
  queueSeq: number;
  replayState: ReplayState;
  // 当前打开的冲突解决对话框（刷新页面后仍恢复）
  activeConflictSeq: number | null;
};

const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const seedCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revision: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revision: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revision: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revision: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revision: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revision: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revision: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revision: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
];

const defaultSignatures: StageSignature[] = [
  { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18' },
  { stage: '系统', status: '待签署', actor: '待指定', time: '-' },
  { stage: '动力', status: '待签署', actor: '待指定', time: '-' },
  { stage: '放行', status: '待签署', actor: '质量经理', time: '-' }
];

const defaultAudit: AuditEntry[] = [
  { time: '08:54:00', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
  { time: '09:05:00', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
  { time: '09:20:00', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
];

function freshState(): MaintenanceState {
  return {
    cards: seedCards.map((card) => ({ ...card })),
    activeCardId: 'CARD-03',
    serverVersion: 7,
    offline: false,
    lastSaved: '09:46',
    signatures: defaultSignatures,
    released: false,
    audit: defaultAudit,
    queue: [],
    queueSeq: 0,
    replayState: 'idle',
    activeConflictSeq: null
  };
}

const PENDING_STATUSES: ItemStatus[] = ['queued', 'replaying', 'conflict', 'error'];
const isPending = (item: QueueItem) => PENDING_STATUSES.includes(item.status);

function normalize(saved: Partial<MaintenanceState> | null): MaintenanceState {
  const base = freshState();
  if (!saved) return base;
  const queue = (Array.isArray(saved.queue) ? saved.queue : []).map((item) => ({
    ...item,
    // 旧数据兼容：缺少乐观锁版本时按入队时版本补齐
    expectedRevision: typeof item.expectedRevision === 'number' ? item.expectedRevision : item.baseRevision,
    // 页面重开时不可能仍在重放中：回到队列等待重新提交
    status: item.status === 'replaying' ? 'queued' : item.status
  }));
  const maxSeq = queue.reduce((max, item) => Math.max(max, item.seq), 0);
  return {
    ...base,
    ...saved,
    // 兼容升级前的本地数据：按工卡号补齐新增字段
    cards: Array.isArray(saved.cards) && saved.cards.length
      ? saved.cards.map((card) => ({ ...(seedCards.find((seed) => seed.id === card.id) ?? {}), ...card }))
      : base.cards,
    signatures: Array.isArray(saved.signatures) ? saved.signatures : base.signatures,
    audit: Array.isArray(saved.audit) ? saved.audit : base.audit,
    queue,
    queueSeq: typeof saved.queueSeq === 'number' && saved.queueSeq >= maxSeq ? saved.queueSeq : maxSeq,
    replayState: 'paused',
    // 仅当对应冲突项仍然存在时才恢复对话框
    activeConflictSeq: queue.some((item) => item.seq === saved.activeConflictSeq && item.status === 'conflict') ? saved.activeConflictSeq! : null
  };
}

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy61-work-package') : null;
const initialState: MaintenanceState = normalize(raw ? JSON.parse(raw) : null);

const pickValues = (card: OfflineCard): CardValues => ({ measurement: card.measurement, finding: card.finding, status: card.status });

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
    },
    toggleOffline(state) {
      state.offline = !state.offline;
      state.audit.unshift({
        time: nowTime(),
        actor: '当前用户',
        action: state.offline ? '进入离线模式' : '恢复在线',
        detail: state.offline
          ? `提交将进入本地队列（当前 ${state.queue.filter(isPending).length} 项待同步）`
          : '联网恢复，提交队列将按先后顺序自动重放'
      });
    },
    // 入队一条可恢复提交，并在本地乐观生效；离线/在线统一走队列
    enqueueItem(state, action: PayloadAction<{ cardId: string; kind: ItemKind; actor: string; patch: CardValues }>) {
      const { cardId, kind, actor, patch } = action.payload;
      const card = state.cards.find((item) => item.id === cardId);
      if (!card) return;
      state.queueSeq += 1;
      const seq = state.queueSeq;
      state.queue.push({
        seq,
        cardId,
        cardTitle: card.title,
        kind,
        actor,
        baseRevision: state.serverVersion,
        expectedRevision: state.serverVersion,
        patch: { ...patch },
        baseCard: pickValues(card),
        createdAt: nowTime(),
        status: 'queued',
        attempts: 0
      });
      Object.assign(card, patch);
      state.lastSaved = nowTime();
      state.audit.unshift({
        time: state.lastSaved,
        actor,
        action: kind === 'authorize' ? '超差授权入队' : '提交入队',
        detail: `${cardId} 队列序号 #${seq}，基于服务器版本 R${state.serverVersion}，${state.offline ? '离线暂存，联网后按序重放' : '将立即按序提交'}`
      });
    },
    replayStarted(state) {
      state.replayState = 'running';
    },
    replayFinished(state) {
      state.replayState = state.queue.some((item) => item.status === 'conflict') ? 'paused' : 'idle';
    },
    markItemReplaying(state, action: PayloadAction<number>) {
      const item = state.queue.find((entry) => entry.seq === action.payload);
      if (!item) return;
      item.status = 'replaying';
      item.attempts += 1;
      item.sentAt = nowTime();
    },
    // 提交成功：工作包版本、工卡状态、审计记录随同一笔状态更新落盘（放行门禁为派生状态，同步刷新）
    itemApplied(state, action: PayloadAction<{ seq: number; revision: number }>) {
      const item = state.queue.find((entry) => entry.seq === action.payload.seq);
      if (!item) return;
      item.status = 'applied';
      item.appliedAt = nowTime();
      item.appliedRevision = action.payload.revision;
      item.lastError = undefined;
      state.serverVersion = action.payload.revision;
      // 版本推进是我们自己的提交造成的：后续排队项基于新版本变基（他端提交不经过这里，因此不会被静默变基）
      for (const entry of state.queue) {
        if (entry.seq > item.seq && (entry.status === 'queued' || entry.status === 'error')) entry.expectedRevision = action.payload.revision;
      }
      const card = state.cards.find((entry) => entry.id === item.cardId);
      if (card) Object.assign(card, item.patch);
      const gate = evaluateGate(state);
      state.audit.unshift({
        time: item.appliedAt!,
        actor: item.actor,
        action: '队列重放成功',
        detail: `#${item.seq} ${item.cardId} 已提交，服务器版本推进至 R${action.payload.revision}；门禁：待同步 ${gate.pending} 项、待授权 ${gate.blockers} 项、阶段签署 ${gate.signedStages}/${gate.totalStages}`
      });
    },
    // 409：暂停队列，保留服务器与本地双方内容，等待执行人员决定
    itemConflict(state, action: PayloadAction<{ seq: number; serverRevision: number; serverCard: CardValues | null }>) {
      const item = state.queue.find((entry) => entry.seq === action.payload.seq);
      if (!item) return;
      item.status = 'conflict';
      item.conflict = { detectedAt: nowTime(), serverRevision: action.payload.serverRevision, serverCard: action.payload.serverCard };
      state.serverVersion = Math.max(state.serverVersion, action.payload.serverRevision);
      state.activeConflictSeq = item.seq;
      state.replayState = 'paused';
      state.audit.unshift({
        time: item.conflict.detectedAt,
        actor: '服务器',
        action: '版本冲突待裁决',
        detail: `#${item.seq} ${item.cardId} 服务器已到 R${action.payload.serverRevision}，队列已暂停；本地与服务器内容均已保留，须人工选择合并或放弃`
      });
    },
    itemError(state, action: PayloadAction<{ seq: number; message: string }>) {
      const item = state.queue.find((entry) => entry.seq === action.payload.seq);
      if (!item) return;
      item.status = 'error';
      item.lastError = action.payload.message;
      state.replayState = 'paused';
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '队列重放中断', detail: `#${item.seq} ${item.cardId}：${action.payload.message}，联网后可继续重试` });
    },
    openConflict(state, action: PayloadAction<number>) {
      const item = state.queue.find((entry) => entry.seq === action.payload);
      if (item?.status === 'conflict') state.activeConflictSeq = item.seq;
    },
    closeConflict(state) {
      state.activeConflictSeq = null;
    },
    // 合并：执行人员确认后的合并结果回填本地版本，变基到服务器最新版本后回到队首继续重放
    resolveMerge(state, action: PayloadAction<{ seq: number; merged: CardValues }>) {
      const item = state.queue.find((entry) => entry.seq === action.payload.seq);
      if (!item || item.status !== 'conflict' || !item.conflict) return;
      const { merged } = action.payload;
      const serverRevision = item.conflict.serverRevision;
      item.patch = { ...merged };
      item.baseRevision = serverRevision;
      item.expectedRevision = serverRevision;
      item.status = 'queued';
      item.conflict = undefined;
      item.lastError = undefined;
      const card = state.cards.find((entry) => entry.id === item.cardId);
      if (card) Object.assign(card, merged);
      state.activeConflictSeq = null;
      state.audit.unshift({
        time: nowTime(),
        actor: item.actor,
        action: '冲突合并',
        detail: `#${item.seq} ${item.cardId} 保留服务器与本地双方内容，合并后基于 R${serverRevision} 重新入队提交`
      });
    },
    // 放弃本地版本：明确采用服务器内容，本地原值留在队列与审计中，不做悄悄覆盖
    resolveAbandon(state, action: PayloadAction<number>) {
      const item = state.queue.find((entry) => entry.seq === action.payload);
      if (!item || item.status !== 'conflict' || !item.conflict) return;
      item.status = 'abandoned';
      const card = state.cards.find((entry) => entry.id === item.cardId);
      if (card && item.conflict.serverCard) Object.assign(card, item.conflict.serverCard);
      state.activeConflictSeq = null;
      state.audit.unshift({
        time: nowTime(),
        actor: item.actor,
        action: '放弃本地版本',
        detail: `#${item.seq} ${item.cardId} 本地测量值「${item.patch.measurement || '—'}」未采用，以服务器 R${item.conflict.serverRevision} 内容「${item.conflict.serverCard?.measurement ?? '—'}」为准；原值已留存审计`
      });
    },
    // 服务器快照：推进版本号；无在途提交时以服务器为准对齐工卡
    serverAck(state, action: PayloadAction<{ revision: number; tasks: WorkCard[] }>) {
      if (action.payload.revision < state.serverVersion) return;
      state.serverVersion = action.payload.revision;
      const inFlight = new Set(state.queue.filter(isPending).map((item) => item.cardId));
      if (inFlight.size === 0) {
        state.cards = action.payload.tasks.map((task) => ({ ...task }));
      } else {
        for (const task of action.payload.tasks) {
          if (inFlight.has(task.id)) continue;
          const card = state.cards.find((item) => item.id === task.id);
          if (card) Object.assign(card, task);
        }
      }
    },
    signStage(state, action: PayloadAction<string>) {
      const signature = state.signatures.find((item) => item.stage === action.payload);
      if (!signature) return;
      signature.status = '已签署';
      signature.actor = `${action.payload}负责人`;
      signature.time = nowTime();
      state.audit.unshift({ time: signature.time, actor: signature.actor, action: '阶段签署', detail: `${action.payload}阶段确认完成（服务器版本 R${state.serverVersion}）` });
    },
    releasePackage(state) {
      const gate = evaluateGate(state);
      if (!gate.canRelease) return;
      state.released = true;
      state.audit.unshift({ time: nowTime(), actor: '质量经理', action: '锁定放行', detail: `工作包已按服务器版本 R${state.serverVersion} 锁定并形成放行基线；队列全部闭合、门禁全部满足` });
    }
  }
});

export const {
  selectCard,
  toggleOffline,
  enqueueItem,
  replayStarted,
  replayFinished,
  markItemReplaying,
  itemApplied,
  itemConflict,
  itemError,
  openConflict,
  closeConflict,
  resolveMerge,
  resolveAbandon,
  serverAck,
  signStage,
  releasePackage
} = slice.actions;

// 放行门禁：未同步提交、未决冲突、待授权超差、完成率与阶段签署任一不满足均阻断
export function evaluateGate(state: MaintenanceState) {
  // 待重放不含冲突：冲突单列一项门禁，要求人工裁决
  const pending = state.queue.filter((item) => item.status === 'queued' || item.status === 'replaying' || item.status === 'error').length;
  const conflicts = state.queue.filter((item) => item.status === 'conflict').length;
  const blockers = state.cards.filter((card) => card.status === '待授权').length;
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const totalStages = state.signatures.length;
  const signedStages = state.signatures.filter((item) => item.status === '已签署').length;
  const completionOk = completed >= Math.ceil(state.cards.length * 0.75);
  const allSigned = signedStages === totalStages;
  return {
    pending,
    conflicts,
    blockers,
    completed,
    totalCards: state.cards.length,
    completionOk,
    signedStages,
    totalStages,
    allSigned,
    canRelease: pending === 0 && conflicts === 0 && blockers === 0 && completionOk && allSigned
  };
}

// 顺序重放：严格按队列序号逐条提交，冲突或网络中断即暂停，等待人工处理/联网后续跑
export const replayQueue = createAsyncThunk('maintenance/replayQueue', async (_arg, thunkApi) => {
  const getState = thunkApi.getState as () => RootState;
  const dispatch = thunkApi.dispatch as AppDispatch;
  {
    const state = getState().maintenance;
    if (state.offline || state.replayState === 'running') return;
    // 存在未决冲突时整个队列停住：必须先由执行人员合并或放弃，后续项按序继续
    if (state.queue.some((item) => item.status === 'conflict')) return;
    if (!state.queue.some((item) => item.status === 'queued' || item.status === 'error')) {
      dispatch(replayFinished());
      return;
    }
    dispatch(replayStarted());
  }
  // 串行循环：一次只提交最早的未决项，保证先后顺序
  for (;;) {
    const state = getState().maintenance;
    const item = state.queue.find((entry) => entry.status === 'queued' || entry.status === 'error');
    if (!item) break;
    dispatch(markItemReplaying(item.seq));
    const request = dispatch(
      maintenanceApi.endpoints.submitCard.initiate({
        cardId: item.cardId,
        expectedRevision: item.expectedRevision,
        measurement: item.patch.measurement,
        finding: item.patch.finding,
        status: item.patch.status,
        actor: item.actor
      })
    );
    try {
      const result = await request.unwrap();
      dispatch(itemApplied({ seq: item.seq, revision: result.revision }));
    } catch (error) {
      const failure = error as { status?: number; data?: { message?: string; serverRevision?: number; serverCard?: CardValues | null } };
      if (failure?.status === 409) {
        dispatch(itemConflict({ seq: item.seq, serverRevision: failure.data?.serverRevision ?? getState().maintenance.serverVersion, serverCard: failure.data?.serverCard ?? null }));
        return; // 暂停：必须先由执行人员合并或放弃，后续项才能继续
      }
      dispatch(itemError({ seq: item.seq, message: failure?.data?.message ?? '网络不可用，服务器未确认' }));
      return; // 保留在队列中，恢复网络后从该项继续
    }
  }
  dispatch(replayFinished());
});

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy61-work-package', JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
