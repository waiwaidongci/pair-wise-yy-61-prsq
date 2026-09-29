// 模拟服务器：内存 + localStorage 持久化，带工作包级版本号与工卡级版本号。
// 现场其他终端对工卡的修改会推进该卡 rev；离线提交重放时按工卡 rev 检测冲突。

export type CardStatus = '未开始' | '执行中' | '待授权' | '已完成';

export type WorkCard = {
  id: string;
  title: string;
  zone: string;
  revision: string;
  estimated: number;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: CardStatus;
  measurement: string;
  finding: string;
  stage: string;
};

export type WorkPackage = {
  id: string;
  aircraft: string;
  type: string;
  check: string;
  station: string;
  plannedStart: string;
  plannedEnd: string;
  revision: string;
  serverRevision: number;
  tasks: PublicServerCard[];
};

export type ServerCard = WorkCard & { rev: number };
export type PublicServerCard = WorkCard & { rev: number };

export class HttpError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(typeof data === 'object' && data !== null && 'message' in data ? String((data as { message: unknown }).message) : '请求失败');
    this.status = status;
    this.data = data;
  }
}

const STORAGE_KEY = 'yy61-mock-server';

const packageMeta = {
  id: 'WP-B7891-04',
  aircraft: 'B-7891',
  type: 'B737-800',
  check: '48A 定检',
  station: '上海浦东 · H3 机库',
  plannedStart: '2026-09-28 06:00',
  plannedEnd: '2026-09-30 18:00',
  revision: 'WP R7'
};

const seedCards: ServerCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revision: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署', rev: 7 },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revision: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署', rev: 7 },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revision: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署', rev: 7 },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revision: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署', rev: 7 },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revision: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署', rev: 7 },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revision: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署', rev: 7 },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revision: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署', rev: 7 },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revision: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署', rev: 7 }
];

function loadState(): { revision: number; cards: ServerCard[] } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { revision?: number; cards?: ServerCard[] };
      if (parsed && typeof parsed.revision === 'number' && Array.isArray(parsed.cards) && parsed.cards.length) {
        return { revision: parsed.revision, cards: parsed.cards };
      }
    }
  } catch {
    // 存储损坏时回退种子数据
  }
  return { revision: 7, cards: seedCards.map((card) => ({ ...card })) };
}

let serverState = loadState();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverState));
  } catch {
    // 隐私模式等场景下仅保留内存态
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function toPublicCard(card: ServerCard): PublicServerCard {
  return { ...card };
}

export async function fetchPackage(): Promise<WorkPackage> {
  await wait(180);
  return {
    ...packageMeta,
    serverRevision: serverState.revision,
    tasks: serverState.cards.map((card) => toPublicCard(card))
  };
}

export type SubmitCardInput = {
  cardId: string;
  baseCardRevision: number;
  measurement: string;
  finding: string;
};

export async function submitCard(input: SubmitCardInput): Promise<{ accepted: true; revision: number; cardRevision: number }> {
  await wait(260);
  const card = serverState.cards.find((item) => item.id === input.cardId);
  if (!card) {
    throw new HttpError(404, { message: `工卡 ${input.cardId} 不存在。` });
  }
  // 工卡级版本检测：仅当该卡在本地基线之后被其他人修改时才判定冲突
  if (input.baseCardRevision !== card.rev) {
    throw new HttpError(409, {
      message: '版本冲突：该工卡在服务器端已被其他终端修改，请先合并或放弃本地版本。',
      revision: serverState.revision,
      cardRevision: card.rev,
      serverCard: toPublicCard(card)
    });
  }
  card.measurement = input.measurement;
  card.finding = input.finding;
  card.status = '已完成';
  serverState.revision += 1;
  card.rev = serverState.revision;
  persist();
  return { accepted: true, revision: serverState.revision, cardRevision: card.rev };
}

// 模拟“现场网络中断期间，值班工程师在另一台终端上更新了同一工卡”
export async function simulateExternalChange(cardId: string): Promise<{ revision: number; cardRevision: number; card: PublicServerCard }> {
  await wait(160);
  const card = serverState.cards.find((item) => item.id === cardId);
  if (!card) {
    throw new HttpError(404, { message: `工卡 ${cardId} 不存在。` });
  }
  if (card.id === 'CARD-03') {
    card.measurement = '2855 psi';
  }
  card.finding = `服务器端更新：值班工程师 ${clock()} 已复检并签署，请与现场记录核对。`;
  serverState.revision += 1;
  card.rev = serverState.revision;
  persist();
  return { revision: serverState.revision, cardRevision: card.rev, card: toPublicCard(card) };
}
