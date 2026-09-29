import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
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
  Link,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Tab,
  TabList,
  Tag,
  Textarea,
  Tooltip,
  webLightTheme
} from '@fluentui/react-components';
import {
  AlertRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  BookOpenRegular,
  BranchRegular,
  CheckmarkCircleRegular,
  ClipboardTaskListLtrRegular,
  CloudArrowUpRegular,
  CloudOffRegular,
  DeleteRegular,
  DocumentBulletListRegular,
  GaugeRegular,
  HistoryRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  SaveSyncRegular,
  WarningRegular
} from '@fluentui/react-icons';
import { useGetWorkPackageQuery, useSimulateExternalChangeMutation } from './api';
import {
  authorizeOverride,
  clearNotice,
  closeConflict,
  discardCommit,
  enqueueCommit,
  externalServerChange,
  isCommitActive,
  mergeCommit,
  openConflict,
  releasePackage,
  selectCard,
  serverAdvanced,
  setConnectivity,
  setNotice,
  signStage,
  toggleOffline,
  type CardPatch,
  type CommitStatus,
  type QueuedCommit,
  type RootState
} from './store';

type NavItem = { path: string; label: string; icon: ReactNode };

const commitStatusMeta: Record<CommitStatus, { label: string; color: 'danger' | 'warning' | 'brand' | 'success' | 'informative' }> = {
  queued: { label: '待重放', color: 'warning' },
  sending: { label: '重放中', color: 'brand' },
  conflict: { label: '冲突待决', color: 'danger' },
  applied: { label: '已接收', color: 'success' },
  discarded: { label: '已放弃', color: 'informative' }
};

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const { data } = useGetWorkPackageQuery();
  const [simulateChange, simulateState] = useSimulateExternalChangeMutation();
  const activeQueue = state.queue.filter(isCommitActive);
  const conflictCommit = state.queue.find((item) => item.status === 'conflict');

  // 页面加载时感知服务器版本；离线恢复后的版本协调与重放统一由 queue 处理器负责
  useEffect(() => {
    if (data && !state.offline && !state.reconciling && data.serverRevision > state.serverVersion && activeQueue.length === 0) {
      dispatch(serverAdvanced(data.serverRevision));
    }
  }, [data, state.offline, state.reconciling, state.serverVersion, activeQueue.length, dispatch]);

  const triggerExternalChange = async () => {
    const result = await simulateChange({ cardId: state.activeCardId }).unwrap();
    dispatch(externalServerChange({ revision: result.revision, cardRevision: result.cardRevision, card: result.card }));
  };

  const chipText = conflictCommit
    ? `冲突待决 · #${conflictCommit.seq}`
    : state.reconciling
      ? '恢复联网 · 校验服务器版本…'
      : state.flushing
        ? '正在按序重放…'
        : state.offline
          ? `离线 · ${activeQueue.length} 个待提交`
          : activeQueue.some((item) => item.status === 'queued')
            ? `重放中 · ${activeQueue.length} 项`
            : `已同步 R${state.serverVersion}`;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Work Package</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <Tooltip content={state.offline ? '点击模拟恢复联网' : '点击切换为离线模式'} relationship="label">
          <button
            className={`sync-status ${state.offline ? 'offline' : ''} ${conflictCommit ? 'conflict' : ''}`}
            onClick={() => dispatch(state.offline ? setConnectivity(false) : toggleOffline())}
          >
            {conflictCommit ? <WarningRegular /> : state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}
            <span>{chipText}</span>
          </button>
        </Tooltip>
        {state.offline && (
          <Tooltip content="演练用：模拟现场网络中断期间，值班工程师在另一台终端修改了当前工卡" relationship="label">
            <Button size="small" appearance="subtle" className="external-change-btn" icon={<BranchRegular />} disabled={simulateState.isLoading} onClick={triggerExternalChange}>模拟服务器端变更</Button>
          </Tooltip>
        )}
        <div className="user-chip"><span>执行人员</span><strong>宋杰 · 机械</strong></div>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库</small>
            <div><ProgressBar value={0.58} /><span>58% 工卡完成 · R{state.serverVersion}</span></div>
          </div>
          <nav>
            {[
              { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
              { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
              { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
              { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
            ].map((item: NavItem) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}
          </nav>
          <div className="side-status"><WarningRegular /><div><strong>{state.cards.filter((card) => card.status === '待授权').length} 项待授权</strong><span>{activeQueue.length ? `提交队列 ${activeQueue.length} 项未闭环` : '放行前必须处理'}</span></div></div>
        </aside>
        <main>
          {conflictCommit && (
            <MessageBar intent="error" className="global-conflict-bar">
              <MessageBarBody>
                <strong>提交 #{conflictCommit.seq} 存在版本冲突：</strong>
                {conflictCommit.cardId} 在服务器上已被其他人修改（R{conflictCommit.baseCardRevision} → R{conflictCommit.serverCardRevision}）。
                双方内容均已保留，必须选择「合并」或「放弃本地版本」，系统不会覆盖任何一方。
                <div className="conflict-bar-action"><Button appearance="primary" size="small" icon={<WarningRegular />} onClick={() => dispatch(openConflict())}>处理冲突</Button></div>
              </MessageBarBody>
            </MessageBar>
          )}
          {children}
        </main>
      </div>
      <ConflictResolver />
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

// 全局冲突解决对话框：未决冲突持久化在队列中，刷新/重开页面仍会弹出
function ConflictResolver() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const commit = state.queue.find((item) => item.status === 'conflict');
  return (
    <Dialog open={state.conflictOpen && Boolean(commit)} onOpenChange={(_, data) => !data.open && dispatch(closeConflict())}>
      <DialogSurface className="conflict-surface">
        {commit && <ConflictBody key={commit.seq} commit={commit} />}
      </DialogSurface>
    </Dialog>
  );
}

function ConflictBody({ commit }: { commit: QueuedCommit }) {
  const dispatch = useDispatch();
  const server = commit.serverCard;
  const [measurementChoice, setMeasurementChoice] = useState<'local' | 'server' | 'custom'>('local');
  const [measurementCustom, setMeasurementCustom] = useState('');
  const [findingChoice, setFindingChoice] = useState<'local' | 'server' | 'merge'>('merge');
  const [findingText, setFindingText] = useState(server ? `[本地] ${commit.patch.finding || '—'}\n[服务器] ${server.finding || '—'}` : commit.patch.finding);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (!server) return null;

  const mergedPatch = (): CardPatch => ({
    measurement:
      measurementChoice === 'local' ? commit.patch.measurement
      : measurementChoice === 'server' ? server.measurement
      : measurementCustom,
    finding:
      findingChoice === 'local' ? commit.patch.finding
      : findingChoice === 'server' ? server.finding
      : findingText,
    status: '已完成'
  });

  return (
    <DialogBody>
      <DialogTitle>处理提交 #{commit.seq} 的版本冲突 · {commit.cardId}</DialogTitle>
      <DialogContent>
        <MessageBar intent="error" className="conflict-inline-message"><MessageBarBody>{commit.conflictMessage}</MessageBarBody></MessageBar>
        <p className="conflict-intro">
          本地提交基于工卡 <strong>R{commit.baseCardRevision}</strong>，服务器当前为 <strong>R{commit.serverCardRevision}</strong>。
          双方内容已同时保留，请逐字段选择合并结果；或放弃本地版本采用服务器内容。<strong>系统不会悄悄覆盖任何一方。</strong>
        </p>
        <div className="conflict-sides">
          <div className="conflict-side local">
            <div className="side-head"><span>本地版本 · 提交 #{commit.seq}</span><Badge appearance="tint" color="warning">待重放</Badge></div>
            <dl>
              <dt>测量值</dt><dd>{commit.patch.measurement || '—'}</dd>
              <dt>发现与处置</dt><dd className="pre-wrap">{commit.patch.finding || '—'}</dd>
              <dt>状态</dt><dd>{commit.patch.status}</dd>
              <dt>提交时间</dt><dd>{commit.createdAt} · {commit.actor}</dd>
            </dl>
          </div>
          <div className="conflict-side server">
            <div className="side-head"><span>服务器版本 · R{commit.serverCardRevision}</span><Badge appearance="tint" color="brand">现行</Badge></div>
            <dl>
              <dt>测量值</dt><dd>{server.measurement || '—'}</dd>
              <dt>发现与处置</dt><dd className="pre-wrap">{server.finding || '—'}</dd>
              <dt>状态</dt><dd>{server.status}</dd>
            </dl>
          </div>
        </div>
        <div className="merge-fields">
          <Field label="测量值取哪一版？">
            <RadioGroup value={measurementChoice} onChange={(_, data) => setMeasurementChoice(data.value as typeof measurementChoice)}>
              <Radio value="local" label={`采用本地测量值：${commit.patch.measurement || '—'}`} />
              <Radio value="server" label={`采用服务器测量值：${server.measurement || '—'}`} />
              <Radio value="custom" label="填写合并后的测量值" />
            </RadioGroup>
            {measurementChoice === 'custom' && <Input className="merge-custom-input" value={measurementCustom} onChange={(_, data) => setMeasurementCustom(data.value)} placeholder="例如：2855 psi（本地复测确认）" />}
          </Field>
          <Field label="发现与处置如何合并？">
            <RadioGroup value={findingChoice} onChange={(_, data) => setFindingChoice(data.value as typeof findingChoice)}>
              <Radio value="merge" label="合并双方描述（可编辑）" />
              <Radio value="local" label="仅保留本地描述" />
              <Radio value="server" label="仅保留服务器描述" />
            </RadioGroup>
            {findingChoice === 'merge' && <Textarea className="merge-textarea" value={findingText} onChange={(_, data) => setFindingText(data.value)} resize="vertical" rows={4} />}
          </Field>
        </div>
      </DialogContent>
      <DialogActions className="conflict-actions">
        <Button
          appearance={confirmDiscard ? 'primary' : 'subtle'}
          className={confirmDiscard ? 'discard-confirm' : ''}
          icon={<DeleteRegular />}
          onClick={() => (confirmDiscard ? dispatch(discardCommit(commit.seq)) : setConfirmDiscard(true))}
        >
          {confirmDiscard ? '再次点击确认：放弃本地版本，采用服务器内容（本地版本仅留档审计）' : '放弃本地版本'}
        </Button>
        <div className="actions-spacer" />
        <Button appearance="secondary" onClick={() => dispatch(closeConflict())}>稍后处理（冲突继续挂起）</Button>
        <Button appearance="primary" icon={<SaveSyncRegular />} onClick={() => dispatch(mergeCommit({ seq: commit.seq, patch: mergedPatch() }))}>合并并重新提交</Button>
      </DialogActions>
    </DialogBody>
  );
}

function QueuePanel() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const active = state.queue.filter(isCommitActive);
  const history = state.queue.filter((item) => !isCommitActive(item)).slice(-5).reverse();
  return (
    <section className="panel queue-panel">
      <div className="panel-head">
        <div><h2>提交队列</h2><span>{state.offline ? '离线暂存，恢复联网后按编号顺序重放' : '按编号先后提交，冲突即停'}</span></div>
        <Badge appearance="tint" color={active.some((item) => item.status === 'conflict') ? 'danger' : active.length ? 'warning' : 'success'}>{active.length} 项未闭环</Badge>
      </div>
      {state.flushing && <ProgressBar className="queue-progress" />}
      {state.queue.length === 0 && <div className="queue-empty">暂无待提交操作</div>}
      {active.map((commit) => {
        const meta = commitStatusMeta[commit.status];
        return (
          <div key={commit.seq} className={`queue-row ${commit.status}`}>
            <div className="queue-row-head">
              <strong>#{commit.seq} · {commit.cardId}</strong>
              <Badge appearance="tint" color={meta.color} size="small">{meta.label}</Badge>
            </div>
            <small>{commit.createdAt} · 基线 R{commit.baseCardRevision} · 重试 {commit.attempts} 次</small>
            <p>测量值「{commit.patch.measurement || '—'}」{commit.status === 'conflict' && commit.serverCard ? `｜服务器为「${commit.serverCard.measurement || '—'}」(R${commit.serverCardRevision})` : ''}</p>
            {commit.status === 'conflict' && <Button size="small" appearance="primary" icon={<WarningRegular />} onClick={() => dispatch(openConflict())}>选择合并或放弃</Button>}
          </div>
        );
      })}
      {history.length > 0 && <Divider />}
      {history.map((commit) => {
        const meta = commitStatusMeta[commit.status];
        return (
          <div key={commit.seq} className="queue-row history">
            <div className="queue-row-head">
              <strong>#{commit.seq} · {commit.cardId}</strong>
              <Badge appearance="outline" color={meta.color} size="small">{meta.label}</Badge>
            </div>
            <small>{commit.resolvedAt ?? commit.createdAt}{typeof commit.serverRevision === 'number' ? ` · 落库 R${commit.serverRevision}` : ''}</small>
          </div>
        );
      })}
    </section>
  );
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const { data } = useGetWorkPackageQuery();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockers = state.cards.filter((card) => card.status === '待授权');
  const pendingByCard = useMemo(() => {
    const map: Record<string, QueuedCommit[]> = {};
    state.queue.filter(isCommitActive).forEach((commit) => {
      (map[commit.cardId] ??= []).push(commit);
    });
    return map;
  }, [state.queue]);
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="监控工卡依赖、阶段签署、超差项目和放行门禁。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>} />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}`).join('、')} 等待授权人员处理。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%`, 'green'],
          ['提交队列', String(state.queue.filter(isCommitActive).length), state.offline ? '离线暂存，待联网重放' : '按序重放闭环', 'blue'],
          ['开放发现', String(state.cards.filter((card) => card.finding && card.status !== '已完成').length), '1 项重复缺陷', 'amber'],
          ['待签署阶段', String(state.signatures.filter((item) => item.status === '待签署').length), '放行前完成', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序</span></div><Badge appearance="tint">WP R{state.serverVersion}{data ? ` · 服务器 R${data.serverRevision}` : ''}</Badge></div>
          {state.cards.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate('/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'} · 计划 {card.estimated}h{pendingByCard[card.id] ? ` · 待同步 ${pendingByCard[card.id].length} 项` : ''}</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
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
  const dispatch = useDispatch();
  const card = state.cards.find((item) => item.id === state.activeCardId) ?? state.cards[0];
  const [measurement, setMeasurement] = useState(card.measurement);
  const [finding, setFinding] = useState(card.finding);
  const [consumable, setConsumable] = useState('');
  const [witness, setWitness] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  useEffect(() => { setMeasurement(card.measurement); setFinding(card.finding); }, [card.id, card.measurement, card.finding]);
  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.cards.find((item) => item.id === dependency)?.status === '已完成');
  const cardPending = state.queue.filter((item) => item.cardId === card.id && isCommitActive(item));
  const submit = () => {
    if (!dependenciesMet) {
      dispatch(setNotice({ message: `前置工卡 ${card.dependencies.join('、')} 尚未完成。`, intent: 'error' }));
      return;
    }
    if (toleranceIssue) {
      dispatch(setNotice({ message: '测量值超出容差，必须由授权人员处理。', intent: 'error' }));
      return;
    }
    if (!witness) {
      dispatch(setNotice({ message: '关键步骤必须完成见证确认。', intent: 'error' }));
      return;
    }
    dispatch(enqueueCommit({ cardId: card.id, patch: { measurement, finding, status: '已完成' } }));
  };
  const intent = state.noticeIntent;
  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工作包版本 R${state.serverVersion} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button><Button appearance="primary" icon={<SaveSyncRegular />} onClick={submit}>完成并提交</Button></>} />
      {state.notice && <MessageBar intent={intent} className="top-message"><MessageBarBody>{state.notice}{intent === 'success' && <span className="notice-dismiss"><Button appearance="transparent" size="small" onClick={() => dispatch(clearNotice())}>知道了</Button></span>}</MessageBarBody></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>执行人员必须记录关键数据及证据</span></div><div className="head-badges">{cardPending.length > 0 && <Badge appearance="tint" color="warning">待同步 {cardPending.length} 项</Badge>}<Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status}</Badge></div></div>
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
          <QueuePanel />
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>阶段签署</dt><dd>{card.stage}</dd></div></dl></section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权人员可以批准工程指令、退回复测或要求停场处理。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
          <section className="panel evidence-panel"><div className="panel-head"><h2>证据附件</h2><Badge appearance="tint">3 项</Badge></div>{['IMG_20260929_0904.jpg', '液压测试原始记录.pdf', '见证签字单_宋杰.pdf'].map((file, index) => <div className="evidence-row" key={file}><DocumentBulletListRegular /><div><strong>{file}</strong><small>{index + 1}.8 MB · 09:1{index}</small></div><Button size="small" appearance="subtle">预览</Button></div>)}</section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准后将在工卡中记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input defaultValue="EO-2026-1147" /></Field><Field label="授权依据" required className="dialog-field"><Textarea defaultValue="按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。" /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={() => { dispatch(authorizeOverride()); setOverrideOpen(false); }}>确认授权</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [tab, setTab] = useState('open');
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const allSigned = state.signatures.every((item) => item.status === '已签署');
  const queuePending = state.queue.filter(isCommitActive);
  const gateBlocked = queuePending.length > 0;
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="核对未关闭项目、重复缺陷、关键证据与阶段签字。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={!allSigned || blockers.some((card) => card.status === '待授权') || gateBlocked} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已锁定，形成只读放行基线（R{state.serverVersion}）并纳入审计记录。</MessageBarBody></MessageBar>}
      {gateBlocked && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>提交队列未闭环：</strong>{queuePending.some((item) => item.status === 'conflict') ? '存在未决版本冲突，合并或放弃后才能放行。' : `${queuePending.length} 个提交尚未重放完成，门禁保持锁定。`}<span className="notice-dismiss"><Link as="button" onClick={() => dispatch(openConflict())}>{queuePending.some((item) => item.status === 'conflict') ? '去处理冲突' : '查看队列'}</Link></span></MessageBarBody></MessageBar>}
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
          <section className="panel signoff-card"><div className="panel-head"><h2>分阶段签字</h2><span>{state.signatures.filter((item) => item.status === '已签署').length} / 4</span></div>{state.signatures.map((item) => <div className="signoff-row" key={item.stage}><div><span>{item.stage}</span><strong>{item.actor}</strong><small>{item.time}</small></div>{item.status === '已签署' ? <Badge appearance="tint" color="success">已签署</Badge> : <Button size="small" appearance="primary" onClick={() => dispatch(signStage(item.stage))}>签署</Button>}</div>)}</section>
          <section className="panel release-gate-card"><LockClosedRegular /><h3>放行门禁</h3><label><Checkbox checked={!blockers.some((card) => card.status === '待授权')} readOnly /> 无待授权超差项目</label><label><Checkbox checked={state.cards.filter((card) => card.status === '已完成').length >= 6} readOnly /> 关键工卡完成率 ≥ 75%</label><label><Checkbox checked={allSigned} readOnly /> 四个阶段均完成电子签署</label><label><Checkbox checked={queuePending.length === 0} readOnly /> 提交队列全部重放，无未决冲突（{queuePending.length} 项未闭环）</label><label><Checkbox checked /> 审计记录和证据附件完整</label></section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const [selected, setSelected] = useState('R7');
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
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
  return (
    <div className="page">
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="对比工卡版本、查看操作历史并导出闭环证据。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 3 处变更</span></div><select value={selected} onChange={(event) => setSelected(event.target.value)}><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录 · 工作包 R{state.serverVersion}</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
      <section className="panel queue-trace">
        <div className="panel-head"><div><h2>提交队列轨迹</h2><span>入队顺序、重放、冲突与合并/放弃的完整留痕</span></div><Badge appearance="tint">{state.queue.length} 条</Badge></div>
        <div className="trace-table">
          <div className="diff-head"><span>序号</span><span>工卡</span><span>状态</span><span>说明</span></div>
          {state.queue.length === 0 && <div className="trace-empty">暂无提交记录</div>}
          {[...state.queue].reverse().map((commit) => (
            <div className="diff-row trace-row-line" key={commit.seq}>
              <strong>#{commit.seq}</strong>
              <span>{commit.cardId}</span>
              <span><Badge appearance="tint" color={commitStatusMeta[commit.status].color} size="small">{commitStatusMeta[commit.status].label}</Badge></span>
              <div><ins>{commit.status === 'discarded' ? '已放弃本地版本，采用服务器内容' : commit.status === 'conflict' ? '双方内容保留，等待执行人员选择' : commit.status === 'applied' ? `服务器已接收，落库 R${commit.serverRevision}` : commit.status === 'sending' ? '正在重放…' : '等待按序重放'}</ins><small>{commit.createdAt} 入队 · 基线 R{commit.baseCardRevision}{commit.serverCardRevision ? ` · 服务器 R${commit.serverCardRevision}` : ''} · {commit.attempts} 次尝试</small></div>
            </div>
          ))}
        </div>
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
