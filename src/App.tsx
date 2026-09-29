import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Tab,
  TabList,
  Tag,
  Textarea,
  webLightTheme
} from '@fluentui/react-components';
import {
  AlertRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  BookOpenRegular,
  CheckmarkCircleRegular,
  ClipboardTaskListLtrRegular,
  CloudArrowUpRegular,
  CloudOffRegular,
  DocumentBulletListRegular,
  GaugeRegular,
  HistoryRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  WarningRegular
} from '@fluentui/react-icons';
import { useGetWorkPackageQuery, useSimulateRemoteChangeMutation } from './api';
import {
  closeConflict,
  enqueueItem,
  evaluateGate,
  openConflict,
  releasePackage,
  replayQueue,
  resolveAbandon,
  resolveMerge,
  selectCard,
  serverAck,
  signStage,
  toggleOffline,
  useAppDispatch,
  type CardValues,
  type ItemStatus,
  type QueueItem,
  type RootState
} from './store';

type NavItem = { path: string; label: string; icon: ReactNode };

const ITEM_STATUS_META: Record<ItemStatus, { label: string; intent: 'success' | 'danger' | 'warning' | 'brand' | 'informative' }> = {
  queued: { label: '待重放', intent: 'warning' },
  replaying: { label: '重放中', intent: 'brand' },
  applied: { label: '已提交', intent: 'success' },
  conflict: { label: '冲突待裁决', intent: 'danger' },
  abandoned: { label: '已放弃', intent: 'informative' },
  error: { label: '中断待重试', intent: 'danger' }
};

const STATUS_OPTIONS: CardValues['status'][] = ['未开始', '执行中', '待授权', '已完成'];

// 演示用：按工卡构造一条“另一终端已在服务器提交”的内容，制造真实版本冲突
const REMOTE_CHANGES: Record<string, CardValues> = {
  'CARD-02': { measurement: '凹坑 0.22 mm（他端录入）', finding: '检验员已在另一终端录入孔探复测数据，判定在限内', status: '执行中' },
  'CARD-03': { measurement: '2855 psi（他端复测）', finding: '质量复检压力合格，关闭超差', status: '已完成' },
  'CARD-05': { measurement: 'AD 已执行并签署', finding: '另一终端完成 AD 签署', status: '已完成' },
  'CARD-06': { measurement: '全部在有效期内', finding: '客舱检验已在平板端完成', status: '已完成' },
  'CARD-07': { measurement: '参数正常', finding: '试车参数在 AMM 范围', status: '已完成' },
  'CARD-08': { measurement: '发现 2 次压力偏低', finding: '他端已填写可靠性结论：监控使用', status: '已完成' }
};

function simulateChangeFor(cardId: string): CardValues {
  return REMOTE_CHANGES[cardId] ?? { measurement: '他端已更新测量值', finding: '另一终端在服务器端更新了该工卡', status: '执行中' };
}

// —— 全局冲突解决对话框：共同基线 / 服务器版本 / 本地版本三向对照，不自动覆盖 ——
function ConflictDialog() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const item = state.queue.find((entry) => entry.seq === state.activeConflictSeq) ?? null;
  const server = item?.conflict?.serverCard ?? null;
  const [measurement, setMeasurement] = useState('');
  const [finding, setFinding] = useState('');
  const [status, setStatus] = useState<CardValues['status']>('执行中');

  useEffect(() => {
    if (!item || item.status !== 'conflict') return;
    const local = item.patch;
    // 默认合并建议：双方都改过测量值时并列保留；发现与处置合并两边描述；状态默认取服务器
    const bothChanged = server && server.measurement !== item.baseCard.measurement && local.measurement !== item.baseCard.measurement;
    setMeasurement(bothChanged ? `${local.measurement}（本地） / ${server!.measurement}（服务器）` : local.measurement || server?.measurement || '');
    const findings = [local.finding ? `本地：${local.finding}` : '', server?.finding && server.finding !== item.baseCard.finding ? `服务器：${server.finding}` : ''].filter(Boolean);
    setFinding(findings.join('\n'));
    setStatus(server?.status ?? local.status);
  }, [item?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item || item.status !== 'conflict' || !item.conflict) return null;
  const base = item.baseCard;

  const merge = () => {
    dispatch(resolveMerge({ seq: item.seq, merged: { measurement, finding, status } }));
  };
  const abandon = () => {
    dispatch(resolveAbandon(item.seq));
  };

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) dispatch(closeConflict()); }}>
      <DialogSurface className="conflict-surface">
        <DialogBody>
          <DialogTitle>版本冲突：{item.cardId} · {item.cardTitle}</DialogTitle>
          <DialogContent>
            <MessageBar intent="warning" className="dialog-message"><MessageBarBody>服务器版本已由 R{item.baseRevision} 变为 R{item.conflict.serverRevision}。本地与服务器双方内容均已保留，<strong>系统不会自动覆盖任何一方</strong>，请核对后选择合并或放弃本地版本。</MessageBarBody></MessageBar>
            <div className="conflict-grid">
              <div className="conflict-col base">
                <h4>共同基线 · R{item.baseRevision}</h4>
                <label>状态</label><strong>{base.status}</strong>
                <label>测量值</label><p>{base.measurement || '—'}</p>
                <label>发现与处置</label><p className="pre-wrap">{base.finding || '—'}</p>
              </div>
              <div className="conflict-col server">
                <h4>服务器版本 · R{item.conflict.serverRevision}</h4>
                <label>状态</label><strong>{server?.status ?? '工卡不存在'}</strong>
                <label>测量值</label><p>{server?.measurement || '—'}</p>
                <label>发现与处置</label><p className="pre-wrap">{server?.finding || '—'}</p>
              </div>
              <div className="conflict-col local">
                <h4>本地版本 · 队列 #{item.seq}</h4>
                <label>状态</label><strong>{item.patch.status}</strong>
                <label>测量值</label><p>{item.patch.measurement || '—'}</p>
                <label>发现与处置</label><p className="pre-wrap">{item.patch.finding || '—'}</p>
              </div>
            </div>
            <Divider className="dialog-divider" />
            <h4 className="merge-title">合并结果（执行人员确认后才会提交）</h4>
            <div className="merge-form">
              <Field label="合并后的状态">
                <select className="native-select" value={status} onChange={(event) => setStatus(event.target.value as CardValues['status'])}>
                  {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <Field label="合并后的测量值"><Input value={measurement} onChange={(_, data) => setMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
              <Field label="合并后的发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, data) => setFinding(data.value)} resize="vertical" rows={4} /></Field>
            </div>
          </DialogContent>
          <DialogActions position="end" className="conflict-actions">
            <Button appearance="subtle" onClick={() => dispatch(closeConflict())}>暂不处理（冲突保留，稍后可继续）</Button>
            <Button appearance="secondary" onClick={abandon}>放弃本地版本，采用服务器</Button>
            <Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={merge}>采用合并结果并重试提交</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function QueueList({ items, compact }: { items: QueueItem[]; compact?: boolean }) {
  const dispatch = useAppDispatch();
  if (items.length === 0) return <p className="queue-empty">暂无提交记录。离线执行时，每次提交都会在这里按顺序留痕。</p>;
  return (
    <div className={compact ? 'queue-list compact' : 'queue-list'}>
      {items.map((item) => {
        const meta = ITEM_STATUS_META[item.status];
        return (
          <div className={`queue-item ${item.status}`} key={item.seq}>
            <span className="queue-seq">#{item.seq}</span>
            <div className="queue-body">
              <strong>{item.cardId} · {item.cardTitle}</strong>
              <small>
                {item.kind === 'authorize' ? '超差授权' : '完成提交'} · {item.actor} · {item.createdAt}
                {item.appliedAt ? ` → 已提交 ${item.appliedAt}（R${item.baseRevision} → R${item.appliedRevision}）` : ` · 基于 R${item.baseRevision}`}
              </small>
              {item.status === 'conflict' && <small className="queue-conflict">服务器已到 R{item.conflict?.serverRevision}，双方内容保留中</small>}
              {item.status === 'error' && <small className="queue-conflict">{item.lastError}</small>}
              {item.status === 'abandoned' && <small className="queue-abandoned">本地版本未采用，原值已留存审计</small>}
            </div>
            {item.status === 'conflict' ? <Button size="small" appearance="primary" onClick={() => dispatch(openConflict(item.seq))}>解决冲突</Button> : <Badge appearance="tint" color={meta.intent === 'warning' ? 'warning' : meta.intent === 'informative' ? 'informative' : meta.intent}>{meta.label}</Badge>}
          </div>
        );
      })}
    </div>
  );
}

// —— 全局提交队列横幅：离线暂存、顺序重放、未决冲突在任何页面都可见 ——
function QueueBanner() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const [simulateRemote] = useSimulateRemoteChangeMutation();
  const pending = state.queue.filter((item) => ['queued', 'replaying', 'error'].includes(item.status));
  const conflicts = state.queue.filter((item) => item.status === 'conflict');
  const nextItem = pending[0] ?? conflicts[0];

  if (conflicts.length > 0) {
    const item = conflicts[0];
    return (
      <MessageBar intent="error" className="queue-banner">
        <MessageBarBody><strong>有未决版本冲突（队列 #{item.seq} · {item.cardId}）：</strong>服务器版本已变化，本地与服务器内容均已保留，须合并或放弃本地版本后队列才能继续。</MessageBarBody>
        <Button appearance="primary" size="small" onClick={() => dispatch(openConflict(item.seq))}>立即解决</Button>
      </MessageBar>
    );
  }
  if (state.offline && pending.length > 0) {
    return (
      <MessageBar intent="warning" className="queue-banner">
        <MessageBarBody><CloudOffRegular /> <strong>离线中 · {pending.length} 项提交已按顺序保存在本地队列。</strong>页面关闭或刷新都不会丢失，恢复联网后将从 #{pending[0].seq} 开始自动重放。</MessageBarBody>
        <Button appearance="primary" size="small" onClick={() => dispatch(toggleOffline())}>恢复在线并重放</Button>
        {nextItem && <Button appearance="subtle" size="small" onClick={() => simulateRemote({ cardId: nextItem.cardId, actor: '检验员终端', ...simulateChangeFor(nextItem.cardId) })}>模拟他端已提交</Button>}
      </MessageBar>
    );
  }
  if (pending.length > 0) {
    return (
      <MessageBar intent="info" className="queue-banner">
        <MessageBarBody><ArrowSyncRegular className={state.replayState === 'running' ? 'spin' : ''} /> <strong>{state.replayState === 'running' ? `正在按序重放提交队列（${pending.length} 项）…` : `${pending.length} 项提交等待同步`}</strong>，每笔成功后工作包版本、工卡状态、审计与放行门禁一起更新。</MessageBarBody>
        <Button appearance="primary" size="small" disabled={state.replayState === 'running'} onClick={() => dispatch(replayQueue())}>{state.replayState === 'running' ? '重放中' : '立即同步'}</Button>
        {nextItem && <Button appearance="subtle" size="small" onClick={() => simulateRemote({ cardId: nextItem.cardId, actor: '检验员终端', ...simulateChangeFor(nextItem.cardId) })}>模拟他端已提交</Button>}
      </MessageBar>
    );
  }
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const { data } = useGetWorkPackageQuery();
  const queueStatusKey = state.queue.map((item) => item.status).join(',');

  // 拉到服务器快照后对齐版本号（在途工卡保留本地版本，绝不悄悄覆盖）
  useEffect(() => {
    if (data) dispatch(serverAck({ revision: data.serverRevision, tasks: data.tasks }));
  }, [data, dispatch]);

  // 联网时自动按序重放：恢复在线、手动重试、服务器版本变化、重新打开页面都会走到这里
  useEffect(() => {
    if (!state.offline && state.replayState !== 'running') dispatch(replayQueue());
  }, [state.offline, state.replayState, state.serverVersion, queueStatusKey, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // 浏览器网络事件：真实网络恢复后立即尝试续跑队列
  useEffect(() => {
    const onOnline = () => dispatch(replayQueue());
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [dispatch]);

  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
  ];
  const conflictCount = state.queue.filter((item) => item.status === 'conflict').length;
  const pendingCount = state.queue.filter((item) => ['queued', 'replaying', 'error'].includes(item.status)).length;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Work Package</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <button className={`sync-status ${state.offline ? 'offline' : ''}`} onClick={() => dispatch(toggleOffline())}>
          {state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}
          <span>{state.offline ? `离线暂存 · ${pendingCount} 待同步` : `已同步 R${state.serverVersion}`}</span>
        </button>
        <div className="user-chip"><span>执行人员</span><strong>宋杰 · 机械</strong></div>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库</small>
            <div><ProgressBar value={0.58} /><span>58% 工卡完成 · 服务器 R{state.serverVersion}</span></div>
          </div>
          <nav>{nav.map((item) => (
            <NavLink end={item.path === '/'} key={item.path} to={item.path}>
              {item.icon}<span>{item.label}</span>
              {item.path === '/execution' && pendingCount > 0 && <Badge appearance="tint" color="warning">{pendingCount}</Badge>}
              {item.path === '/audit' && conflictCount > 0 && <Badge appearance="tint" color="danger">{conflictCount}</Badge>}
            </NavLink>
          ))}</nav>
          <div className="side-status"><WarningRegular /><div><strong>{state.cards.filter((card) => card.status === '待授权').length} 项待授权{pendingCount > 0 ? ` · ${pendingCount} 项待同步` : ''}</strong><span>放行前必须全部处理</span></div></div>
        </aside>
        <main className="shell-main">
          <QueueBanner />
          {children}
        </main>
      </div>
      <ConflictDialog />
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockers = state.cards.filter((card) => card.status === '待授权');
  const pendingByCard = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of state.queue) {
      if (['queued', 'replaying', 'conflict', 'error'].includes(item.status)) map.set(item.cardId, (map.get(item.cardId) ?? 0) + 1);
    }
    return map;
  }, [state.queue]);
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="监控工卡依赖、阶段签署、超差项目和放行门禁。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>} />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}`).join('、')} 等待授权人员处理。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%`, 'green'],
          ['已记录工时', '18.6 h', '计划 20.5 h', 'blue'],
          ['队列待同步', String(state.queue.filter((item) => ['queued', 'replaying', 'error'].includes(item.status)).length), '恢复联网后按序重放', 'amber'],
          ['待签署阶段', String(state.signatures.filter((item) => item.status === '待签署').length), '放行前完成', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序</span></div><Badge appearance="tint">WP R7 · 服务器 R{state.serverVersion}</Badge></div>
          {state.cards.map((card, index) => {
            const queuedCount = pendingByCard.get(card.id);
            return (
              <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate('/execution'); }}>
                <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
                <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'} · 计划 {card.estimated}h{queuedCount ? ' · 本地有未同步提交' : ''}</small></span>
                <span className="task-tags">{queuedCount ? <Badge appearance="tint" color="warning">待同步 ×{queuedCount}</Badge> : <Tag appearance="outline" size="small">{card.stage}</Tag>}</span>
                <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
              </button>
            );
          })}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel"><div className="panel-head"><h2>阶段签字</h2><PeopleRegular /></div>{state.signatures.map((item) => <div className="signature-row" key={item.stage}><span className={item.status === '已签署' ? 'signed' : ''}>{item.status === '已签署' ? <CheckmarkCircleRegular /> : item.stage.slice(0, 1)}</span><div><strong>{item.stage}签署</strong><small>{item.actor} · {item.time}</small></div></div>)}</section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-01</span><i /><span>CARD-02</span><i /><span className="critical">CARD-03</span><i /><span>CARD-07</span><i /><span>CARD-08</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const card = state.cards.find((item) => item.id === state.activeCardId) ?? state.cards[0];
  const [measurement, setMeasurement] = useState(card.measurement);
  const [finding, setFinding] = useState(card.finding);
  const [consumable, setConsumable] = useState('');
  const [witness, setWitness] = useState(false);
  const [notice, setNotice] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [eoNumber, setEoNumber] = useState('EO-2026-1147');
  const [eoReason, setEoReason] = useState('按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。');
  useEffect(() => { setMeasurement(card.measurement); setFinding(card.finding); setNotice(''); }, [card.id, card.measurement, card.finding]);
  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.cards.find((item) => item.id === dependency)?.status === '已完成');
  const cardQueue = state.queue.filter((item) => item.cardId === card.id);

  const complete = () => {
    if (!dependenciesMet) return setNotice(`前置工卡 ${card.dependencies.join('、')} 尚未完成。`);
    if (toleranceIssue) return setNotice('测量值超出容差，必须由授权人员处理，不能直接完成。');
    if (!witness) return setNotice('关键步骤必须完成见证确认。');
    setNotice('');
    // 无论在线离线都先进持久化队列，再由重放器按序提交；在线时会立即自动重放
    dispatch(enqueueItem({ cardId: card.id, kind: 'complete', actor: '宋杰 · 机械', patch: { measurement, finding, status: '已完成' } }));
  };

  const authorize = () => {
    dispatch(enqueueItem({
      cardId: card.id,
      kind: 'authorize',
      actor: '放行授权人',
      patch: {
        measurement: card.measurement,
        finding: `超差已由授权人员批准（${eoNumber}）：${eoReason}`,
        status: '执行中'
      }
    }));
    setOverrideOpen(false);
  };

  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工卡版本 ${card.revision} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button><Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={complete}>完成并入队提交</Button></>} />
      {notice && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{notice}</MessageBarBody></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>提交先进入可恢复队列，按先后顺序重放</span></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field label="测量值" hint={card.tolerance} validationState={toleranceIssue ? 'error' : 'none'} validationMessage={toleranceIssue ? '低于最低接受值 2850 psi' : undefined}><Input value={measurement} onChange={(_, data) => setMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, data) => setConsumable(data.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, data) => setFinding(data.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" /></Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 3 个证据 · 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check"><Checkbox checked={witness} onChange={(_, data) => setWitness(Boolean(data.checked))} /><span><strong>见证人已现场确认</strong><small>要求：{card.witness}</small></span></label>
        </section>
        <aside className="execution-side">
          <section className="panel queue-panel">
            <div className="panel-head"><div><h2>提交队列</h2><span>按序号先后重放，全程留痕</span></div><Badge appearance="tint">{cardQueue.length} 项</Badge></div>
            <QueueList items={cardQueue} compact />
          </section>
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>阶段签署</dt><dd>{card.stage}</dd></div></dl></section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权操作同样进入提交队列，冲突时需双方确认后才能覆盖。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
          <section className="panel evidence-panel"><div className="panel-head"><h2>证据附件</h2><Badge appearance="tint">3 项</Badge></div>{['IMG_20260929_0904.jpg', '液压测试原始记录.pdf', '见证签字单_宋杰.pdf'].map((file, index) => <div className="evidence-row" key={file}><DocumentBulletListRegular /><div><strong>{file}</strong><small>{index + 1}.8 MB · 09:1{index}</small></div><Button size="small" appearance="subtle">预览</Button></div>)}</section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准将作为一条授权提交进入队列按序重放，并记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input value={eoNumber} onChange={(_, data) => setEoNumber(data.value)} /></Field><Field label="授权依据" required className="dialog-field"><Textarea value={eoReason} onChange={(_, data) => setEoReason(data.value)} /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={authorize}>确认授权并入队</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState('open');
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const gate = evaluateGate(state);
  const pendingConflict = state.queue.find((item) => item.status === 'conflict');
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="未决冲突、未同步提交与未关闭项目全部清零后才能锁定放行。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={!gate.canRelease} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已按服务器版本 R{state.serverVersion} 锁定，形成只读放行基线并纳入审计记录。</MessageBarBody></MessageBar>}
      {!state.released && !gate.canRelease && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行门禁未满足：</strong>{gate.conflicts > 0 ? `有 ${gate.conflicts} 项版本冲突未裁决；` : ''}{gate.pending > 0 ? `有 ${gate.pending} 项提交尚未同步；` : ''}{gate.blockers > 0 ? `${gate.blockers} 项超差待授权；` : ''}{!gate.completionOk ? '关键工卡完成率不足 75%；' : ''}{!gate.allSigned ? '阶段签署未完成。' : ''}</MessageBarBody>{pendingConflict && <Button appearance="primary" size="small" onClick={() => dispatch(openConflict(pendingConflict.seq))}>去解决冲突</Button>}</MessageBar>}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab><Tab value="repeat">重复缺陷 <Badge>2</Badge></Tab><Tab value="evidence">关键证据 <Badge>12</Badge></Tab></TabList>
          <div className="tab-body">
            {tab === 'open' && blockers.map((card) => <div className="review-item" key={card.id}><span className={`risk-icon ${card.status === '待授权' ? 'danger' : ''}`}><AlertRegular /></span><div><strong>{card.id} · {card.title}</strong><p>{card.finding || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 负责人 宋杰 · 要求证据 {card.evidence}</small></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'warning'}>{card.status}</Badge></div>)}
            {tab === 'repeat' && <><div className="review-item"><span className="risk-icon danger"><HistoryRegular /></span><div><strong>液压系统压力偏低 · 第 3 次记录</strong><p>2026-08-16、09-02、09-29 均在系统 A 出现压力低于目标值。</p><small>建议移交可靠性分析，并关联历史排故记录。</small></div><Badge appearance="tint" color="danger">关键</Badge></div><div className="review-item"><span className="risk-icon"><HistoryRegular /></span><div><strong>APU 启动时间延长</strong><p>最近两次航线记录均略高于机队均值。</p><small>非放行阻塞项，建议后续监控。</small></div><Badge appearance="tint" color="warning">观察</Badge></div></>}
            {tab === 'evidence' && <div className="evidence-grid">{['液压系统测试记录.pdf', '发动机孔探照片_01.jpg', 'AD 执行签署页.pdf', '时寿件履历截图.png', '超差工程指令.pdf', '见证人签字单.pdf'].map((file) => <div className="evidence-tile" key={file}><DocumentBulletListRegular /><strong>{file}</strong><span>已绑定工卡 · 已核验</span></div>)}</div>}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel signoff-card"><div className="panel-head"><h2>分阶段签字</h2><span>{gate.signedStages} / {gate.totalStages}</span></div>{state.signatures.map((item) => <div className="signoff-row" key={item.stage}><div><span>{item.stage}</span><strong>{item.actor}</strong><small>{item.time}</small></div>{item.status === '已签署' ? <Badge appearance="tint" color="success">已签署</Badge> : <Button size="small" appearance="primary" onClick={() => dispatch(signStage(item.stage))}>签署</Button>}</div>)}</section>
          <section className="panel release-gate-card"><LockClosedRegular /><h3>放行门禁（随队列实时联动）</h3>
            <label><Checkbox checked={gate.conflicts === 0} readOnly /> 无未决版本冲突{gate.conflicts > 0 ? `（${gate.conflicts} 项待裁决）` : ''}</label>
            <label><Checkbox checked={gate.pending === 0} readOnly /> 提交队列全部同步{gate.pending > 0 ? `（${gate.pending} 项待重放）` : ''}</label>
            <label><Checkbox checked={gate.blockers === 0} readOnly /> 无待授权超差项目{gate.blockers > 0 ? `（${gate.blockers} 项）` : ''}</label>
            <label><Checkbox checked={gate.completionOk} readOnly /> 关键工卡完成率 ≥ 75%（{gate.completed}/{gate.totalCards}）</label>
            <label><Checkbox checked={gate.allSigned} readOnly /> 四个阶段均完成电子签署</label>
            <label><Checkbox checked readOnly /> 审计记录和证据附件完整</label>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'B7891-48A-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const diffs = useMemo(() => [
    { card: 'CARD-03', field: '容差', from: '≥ 2800 psi / 10 min', to: '≥ 2850 psi / 10 min', reason: 'AMM 临时修订 TR-114' },
    { card: 'CARD-07', field: '依赖', from: 'CARD-02', to: 'CARD-03', reason: '试车前置条件调整' },
    { card: 'CARD-08', field: '证据', from: '近 2 次记录', to: '近 3 次记录', reason: '可靠性复核要求' }
  ], []);
  const orderedQueue = [...state.queue].sort((a, b) => a.seq - b.seq);
  return (
    <div className="page">
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="提交队列顺序、冲突裁决、工卡版本差异与完整操作历史。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 3 处变更</span></div><select className="native-select" defaultValue="R7"><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录 · 服务器 R{state.serverVersion}</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
      <section className="panel queue-history-panel">
        <div className="panel-head"><div><h2>提交队列顺序记录</h2><span>含离线暂存、重放结果与冲突裁决，关闭页面后仍可恢复</span></div><Badge appearance="tint">{orderedQueue.length} 项</Badge></div>
        <QueueList items={orderedQueue} />
      </section>
    </div>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <BrowserRouter>
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/execution" element={<Execution />} /><Route path="/release" element={<Release />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}
