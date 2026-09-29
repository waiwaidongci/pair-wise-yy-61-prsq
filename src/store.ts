import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { maintenanceApi } from './api';
import type { CardStatus, PublicServerCard } from './mockServer';

export type StageSignature = { stage: string; status: '待签署' | '已签署'; actor: string; time: string };

export type OfflineCard = {
  id: string;
  title: string;
  estimated: number;
  zone: string;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: CardStatus;
  measurement: string;
  finding: string;
  stage: string;
};

// 提交队列：每个动作都是不可悄悄丢弃的记录，按 seq 先入先出重放
export type CommitStatus = 'queued' | 'sending' | 'conflict' | 'applied' | 'discarded';

export type CardPatch = {
  measurement: string;
  finding: string;
  status: CardStatus;
};

export type QueuedCommit = {
  seq: number;
  cardId: string;
  cardTitle: string;
  createdAt: string;
  actor: string;
  // 入队时的版本基线：工作包版本 + 该工卡的服务器版本
  basePackageRevision: number;
  baseCardRevision: number;
  patch: CardPatch;
  status: CommitStatus;
  attempts: number;
  resolvedAt?: string;
  // 冲突时保留双方内容：本地 patch 不动，服务器快照完整留存
  serverRevision?: number;
  serverCardRevision?: number;
  serverCard?: PublicServerCard;
  conflictMessage?: string;
};

export type AuditEntry = { time: string; actor: string; action: string; detail: string };

type MaintenanceState = {
  cards: OfflineCard[];
  activeCardId: string;
  serverVersion: number;
  // 每张工卡当前已知的服务器版本，用于后续提交的基线与自动 rebase
  cardRevisions: Record<string, number>;
  queueSeq: number;
  queue: QueuedCommit[];
  offline: boolean;
  flushing: boolean;
  reconciling: boolean;
  lastSaved: string;
  notice: string;
  noticeIntent: 'info' | 'error' | 'warning' | 'success';
  conflictOpen: boolean;
  signatures: StageSignature[];
  released: boolean;
  audit: AuditEntry[];
};

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
];

const defaultSignatures: StageSignature[] = [
  { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18' },
  { stage: '系统', status: '待签署', actor: '待指定', time: '-' },
  { stage: '动力', status: '待签署', actor: '待指定', time: '-' },
  { stage: '放行', status: '待签署', actor: '质量经理', time: '-' }
];

const defaultAudit: AuditEntry[] = [
  { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
  { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
  { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
];

const STORAGE_KEY = 'yy61-work-package';
const ACTIVE_STATUSES: CommitStatus[] = ['queued', 'sending', 'conflict'];
export const isCommitActive = (commit: QueuedCommit) => ACTIVE_STATUSES.includes(commit.status);

function buildInitialState(): MaintenanceState {
  let saved: Partial<MaintenanceState> & { syncVersion?: number } | null = null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { cards?: unknown }).cards)) {
      saved = parsed as Partial<MaintenanceState> & { syncVersion?: number };
    }
  } catch {
    saved = null;
  }
  if (saved && Array.isArray(saved.cards)) {
    // 上次会话中正在发送的提交，本次恢复为待重放（重发是安全的：服务器按工卡版本做乐观锁校验）
    const queue: QueuedCommit[] = (saved.queue ?? []).map((commit) =>
      commit.status === 'sending' ? { ...commit, status: 'queued' } : commit
    );
    return {
      cards: saved.cards,
      activeCardId: saved.activeCardId ?? 'CARD-03',
      serverVersion: saved.serverVersion ?? saved.syncVersion ?? 7,
      cardRevisions: saved.cardRevisions ?? {},
      queueSeq: saved.queueSeq ?? 0,
      queue,
      offline: saved.offline ?? false,
      flushing: false,
      reconciling: false,
      lastSaved: saved.lastSaved ?? '',
      notice: '',
      noticeIntent: 'info',
      // 重新打开页面后，未决冲突自动弹出继续处理
      conflictOpen: queue.some((commit) => commit.status === 'conflict'),
      signatures: saved.signatures ?? defaultSignatures,
      released: saved.released ?? false,
      audit: saved.audit ?? defaultAudit
    };
  }
  return {
    cards: initialCards,
    activeCardId: 'CARD-03',
    serverVersion: 7,
    cardRevisions: {},
    queueSeq: 0,
    queue: [],
    offline: false,
    flushing: false,
    reconciling: false,
    lastSaved: '09:46',
    notice: '',
    noticeIntent: 'info',
    conflictOpen: false,
    signatures: defaultSignatures,
    released: false,
    audit: defaultAudit
  };
}

const slice = createSlice({
  name: 'maintenance',
  initialState: buildInitialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
      state.notice = '';
    },
    setNotice(state, action: PayloadAction<{ message: string; intent?: MaintenanceState['noticeIntent'] }>) {
      state.notice = action.payload.message;
      state.noticeIntent = action.payload.intent ?? 'info';
    },
    clearNotice(state) {
      state.notice = '';
    },
    setConnectivity(state, action: PayloadAction<boolean>) {
      state.offline = action.payload;
    },
    toggleOffline(state) {
      state.offline = !state.offline;
      state.notice = '';
    },
    // 入队：先写本地（明确标记为待同步），网络恢复后严格按 seq 重放
    enqueueCommit(state, action: PayloadAction<{ cardId: string; patch: CardPatch }>) {
      const card = state.cards.find((item) => item.id === action.payload.cardId);
      if (!card) return;
      const time = now();
      state.queueSeq += 1;
      const commit: QueuedCommit = {
        seq: state.queueSeq,
        cardId: card.id,
        cardTitle: card.title,
        createdAt: time,
        actor: '宋杰',
        basePackageRevision: state.serverVersion,
        baseCardRevision: state.cardRevisions[card.id] ?? 7,
        patch: action.payload.patch,
        status: 'queued',
        attempts: 0
      };
      state.queue.push(commit);
      Object.assign(card, action.payload.patch);
      state.lastSaved = time;
      state.noticeIntent = state.offline ? 'warning' : 'success';
      state.notice = state.offline
        ? `提交 #${commit.seq} 已进入离线队列，恢复联网后将按顺序重放。`
        : `提交 #${commit.seq} 已进入队列，正在按顺序提交服务器…`;
      state.audit.unshift({ time, actor: commit.actor, action: '加入提交队列', detail: `${card.id} 基线 R${commit.basePackageRevision}，测量值「${commit.patch.measurement || '—'}」` });
    },
    markSending(state, action: PayloadAction<number>) {
      const commit = state.queue.find((item) => item.seq === action.payload);
      if (!commit || !isCommitActive(commit)) return;
      commit.status = 'sending';
      state.flushing = true;
    },
    // 服务器接收后的原子后处理：工卡内容、工作包版本、审计记录在同一事务内落库
    acceptCommit(state, action: PayloadAction<{ seq: number; revision: number; cardRevision: number }>) {
      const commit = state.queue.find((item) => item.seq === action.payload.seq);
      if (!commit) return;
      const time = now();
      commit.status = 'applied';
      commit.resolvedAt = time;
      commit.attempts += 1;
      commit.serverRevision = action.payload.revision;
      commit.serverCardRevision = action.payload.cardRevision;
      const card = state.cards.find((item) => item.id === commit.cardId);
      if (card) Object.assign(card, commit.patch);
      state.cardRevisions[commit.cardId] = action.payload.cardRevision;
      // 同一工卡后续的排队提交自动 rebase 到新版本，保证它们按顺序重放时基线正确
      state.queue.forEach((item) => {
        if (item.cardId === commit.cardId && item.status === 'queued' && item.baseCardRevision < action.payload.cardRevision) {
          item.baseCardRevision = action.payload.cardRevision;
        }
      });
      state.serverVersion = action.payload.revision;
      state.lastSaved = time;
      state.noticeIntent = 'success';
      state.notice = `提交 #${commit.seq}（${commit.cardId}）已被服务器接收，工作包版本 R${action.payload.revision}。`;
      state.audit.unshift({ time, actor: '服务器', action: '提交已接收', detail: `#${commit.seq} ${commit.cardId} 已写入，工卡 R${action.payload.cardRevision} / 工作包 R${action.payload.revision}` });
      state.flushing = false;
    },
    markConflict(
      state,
      action: PayloadAction<{
        seq: number;
        message: string;
        serverRevision: number;
        serverCardRevision: number;
        serverCard: PublicServerCard;
      }>
    ) {
      const commit = state.queue.find((item) => item.seq === action.payload.seq);
      if (!commit) return;
      const time = now();
      commit.status = 'conflict';
      commit.attempts += 1;
      commit.conflictMessage = action.payload.message;
      commit.serverRevision = action.payload.serverRevision;
      commit.serverCardRevision = action.payload.serverCardRevision;
      commit.serverCard = action.payload.serverCard;
      state.serverVersion = Math.max(state.serverVersion, action.payload.serverRevision);
      state.flushing = false;
      state.conflictOpen = true;
      state.noticeIntent = 'error';
      state.notice = `提交 #${commit.seq} 冲突：服务器上的 ${commit.cardId} 已有新版本，双方内容均已保留，等待执行人员选择合并或放弃。`;
      state.audit.unshift({ time, actor: '系统', action: '冲突待决', detail: `#${commit.seq} ${commit.cardId} 本地基线 R${commit.baseCardRevision}，服务器 R${action.payload.serverCardRevision}，未覆盖任何一方` });
    },
    requeueCommit(state, action: PayloadAction<{ seq: number; reason: string }>) {
      const commit = state.queue.find((item) => item.seq === action.payload.seq);
      if (!commit) return;
      commit.status = 'queued';
      commit.attempts += 1;
      state.flushing = false;
      state.noticeIntent = 'warning';
      state.notice = `提交 #${commit.seq} 暂未送达（${action.payload.reason}），保留在队列首位，恢复后自动重试。`;
      state.audit.unshift({ time: now(), actor: '系统', action: '重放暂缓', detail: `#${commit.seq} ${commit.cardId}：${action.payload.reason}` });
    },
    markFlushIdle(state) {
      state.flushing = false;
      state.reconciling = false;
    },
    beginReconcile(state) {
      state.reconciling = true;
    },
    // 恢复在线后的协调：先拿到服务器最新工卡版本，与排队提交的入队基线比对。
    // 服务器版本领先于本地基线 = 离线期间被其他人改过：直接挂起冲突（快照随包已拉到），
    // 绝不替本地提交 rebase 到新版本，否则等同于悄悄覆盖。无本地待提交的工卡则接收服务器内容。
    reconcilePackage(state, action: PayloadAction<{ revision: number; tasks: PublicServerCard[] }>) {
      const time = now();
      state.serverVersion = Math.max(state.serverVersion, action.payload.revision);
      const activeCardIds = new Set(
        state.queue.filter((item) => item.status !== 'applied' && item.status !== 'discarded').map((item) => item.cardId)
      );
      action.payload.tasks.forEach((task) => {
        // 记录服务器上每张工卡的最新 rev（仅作版本信息）；本地有待提交的卡不覆盖显示内容
        state.cardRevisions[task.id] = task.rev;
        if (!activeCardIds.has(task.id)) {
          const card = state.cards.find((item) => item.id === task.id);
          if (card) {
            card.measurement = task.measurement;
            card.finding = task.finding;
            card.status = task.status;
          }
        }
      });
      // 对每个待重放提交做版本检测：服务器 rev 领先入队基线即冲突，双方内容都保留
      state.queue.forEach((item) => {
        if (item.status !== 'queued') return;
        const serverTask = action.payload.tasks.find((task) => task.id === item.cardId);
        if (!serverTask || serverTask.rev <= item.baseCardRevision) return;
        item.status = 'conflict';
        item.attempts += 1;
        item.serverRevision = action.payload.revision;
        item.serverCardRevision = serverTask.rev;
        item.serverCard = { ...serverTask };
        item.conflictMessage = `恢复联网后校验发现：${item.cardId} 在离线期间已被其他终端修改（R${item.baseCardRevision} → R${serverTask.rev}），请选择合并或放弃本地版本。`;
        state.conflictOpen = true;
        state.noticeIntent = 'error';
        state.notice = `提交 #${item.seq} 冲突：服务器上的 ${item.cardId} 已有新版本，双方内容均已保留，等待执行人员选择合并或放弃。`;
        state.audit.unshift({ time, actor: '系统', action: '冲突待决', detail: `#${item.seq} ${item.cardId} 本地基线 R${item.baseCardRevision}，服务器 R${serverTask.rev}，未覆盖任何一方` });
      });
      state.reconciling = false;
    },
    // 选择合并：执行人员逐字段挑拣后的内容作为新本地版本，回到队首继续重放
    mergeCommit(state, action: PayloadAction<{ seq: number; patch: CardPatch }>) {
      const commit = state.queue.find((item) => item.seq === action.payload.seq);
      if (!commit || commit.status !== 'conflict') return;
      const time = now();
      commit.patch = action.payload.patch;
      commit.status = 'queued';
      commit.resolvedAt = time;
      // 合并基线推进到冲突时的服务器版本，重放时若再被修改会再次弹出冲突
      if (typeof commit.serverCardRevision === 'number') commit.baseCardRevision = commit.serverCardRevision;
      const card = state.cards.find((item) => item.id === commit.cardId);
      if (card) Object.assign(card, commit.patch);
      state.conflictOpen = state.queue.some((item) => item.status === 'conflict' && item.seq !== commit.seq);
      state.noticeIntent = 'success';
      state.notice = `提交 #${commit.seq} 已按选择合并双方内容，重新进入队列重放。`;
      state.audit.unshift({ time, actor: commit.actor, action: '选择合并', detail: `#${commit.seq} ${commit.cardId} 合并后测量值「${commit.patch.measurement || '—'}」，服务器内容未被覆盖` });
    },
    // 放弃本地版本：采用服务器快照还原本地，本地版本留档，绝不悄悄覆盖
    discardCommit(state, action: PayloadAction<number>) {
      const commit = state.queue.find((item) => item.seq === action.payload);
      if (!commit || commit.status !== 'conflict' || !commit.serverCard) return;
      const time = now();
      const serverCard = commit.serverCard;
      commit.status = 'discarded';
      commit.resolvedAt = time;
      const card = state.cards.find((item) => item.id === commit.cardId);
      if (card) {
        card.measurement = serverCard.measurement;
        card.finding = serverCard.finding;
        card.status = serverCard.status;
      }
      if (typeof commit.serverCardRevision === 'number') {
        state.cardRevisions[commit.cardId] = commit.serverCardRevision;
        state.queue.forEach((item) => {
          if (item.cardId === commit.cardId && item.status === 'queued' && item.baseCardRevision < (commit.serverCardRevision as number)) {
            item.baseCardRevision = commit.serverCardRevision as number;
          }
        });
      }
      if (typeof commit.serverRevision === 'number') state.serverVersion = Math.max(state.serverVersion, commit.serverRevision);
      state.conflictOpen = state.queue.some((item) => item.status === 'conflict' && item.seq !== commit.seq);
      state.noticeIntent = 'warning';
      state.notice = `提交 #${commit.seq} 已放弃本地版本，${commit.cardId} 采用服务器 R${commit.serverCardRevision} 内容。`;
      state.audit.unshift({ time, actor: commit.actor, action: '放弃本地版本', detail: `#${commit.seq} ${commit.cardId} 本地测量值「${commit.patch.measurement || '—'}」未写入服务器，已采用服务器版本` });
    },
    openConflict(state) {
      state.conflictOpen = true;
    },
    closeConflict(state) {
      state.conflictOpen = false;
    },
    // 在线时从 refetch 静默感知工作包版本推进（无未决队列时）
    serverAdvanced(state, action: PayloadAction<number>) {
      if (action.payload > state.serverVersion) state.serverVersion = action.payload;
    },
    // 现场其他终端更新了工卡：本地有待重放提交则保留本地不动、重放时再冲突；否则接收服务器快照
    externalServerChange(state, action: PayloadAction<{ revision: number; cardRevision: number; card: PublicServerCard }>) {
      const { revision, cardRevision, card } = action.payload;
      const time = now();
      const hasLocalCommit = state.queue.some((item) => item.cardId === card.id && item.status !== 'applied' && item.status !== 'discarded');
      state.serverVersion = Math.max(state.serverVersion, revision);
      if (!hasLocalCommit) {
        state.cardRevisions[card.id] = cardRevision;
        const local = state.cards.find((item) => item.id === card.id);
        if (local) {
          local.measurement = card.measurement;
          local.finding = card.finding;
          local.status = card.status;
        }
      }
      state.audit.unshift({
        time,
        actor: '值班工程师（服务器端）',
        action: '服务器端更新',
        detail: `${card.id} 在其他终端被修改，工卡版本推进至 R${cardRevision}${hasLocalCommit ? '，与本地待提交内容将在重放时冲突，双方内容均保留' : ''}`
      });
    },
    authorizeOverride(state) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      card.status = '执行中';
      card.finding = '超差已由授权人员批准，按工程指令继续';
      state.audit.unshift({ time: now(), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },
    signStage(state, action: PayloadAction<string>) {
      const signature = state.signatures.find((item) => item.stage === action.payload);
      if (!signature) return;
      signature.status = '已签署';
      signature.actor = `${action.payload}负责人`;
      signature.time = now();
      state.audit.unshift({ time: signature.time, actor: signature.actor, action: '阶段签署', detail: `${action.payload}阶段确认完成` });
    },
    releasePackage(state) {
      const hasBlockers = state.cards.some((card) => card.status === '待授权');
      const allSigned = state.signatures.every((item) => item.status === '已签署');
      const queuePending = state.queue.some(isCommitActive);
      const time = now();
      if (queuePending) {
        state.noticeIntent = 'error';
        state.notice = '提交队列中仍有未重放或未决冲突的提交，不能锁定放行。';
        state.audit.unshift({ time, actor: '系统', action: '放行阻断', detail: `队列中 ${state.queue.filter(isCommitActive).length} 个提交尚未闭环` });
        return;
      }
      if (!hasBlockers && allSigned) {
        state.released = true;
        state.audit.unshift({ time, actor: '质量经理', action: '锁定放行', detail: `工作包 R${state.serverVersion} 已锁定并形成放行基线` });
      }
    }
  }
});

export const {
  selectCard,
  setNotice,
  clearNotice,
  setConnectivity,
  toggleOffline,
  enqueueCommit,
  markSending,
  acceptCommit,
  markConflict,
  requeueCommit,
  markFlushIdle,
  beginReconcile,
  reconcilePackage,
  mergeCommit,
  discardCommit,
  openConflict,
  closeConflict,
  externalServerChange,
  serverAdvanced,
  authorizeOverride,
  signStage,
  releasePackage
} = slice.actions;

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().maintenance));
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
