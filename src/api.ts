import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

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

type ServerSnapshot = WorkCard[];

const seedTasks: WorkCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revision: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revision: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revision: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revision: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revision: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revision: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revision: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revision: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
];

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

// —— 模拟服务器：版本号与工卡内容持久化，页面重开后“别人的提交”仍然存在 ——
const SERVER_KEY = 'yy61-mock-server';

type ServerState = { revision: number; tasks: ServerSnapshot };

function loadServer(): ServerState {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(SERVER_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ServerState;
        if (typeof parsed.revision === 'number' && Array.isArray(parsed.tasks)) return parsed;
      } catch {
        // 存储损坏时回退到初始快照
      }
    }
  }
  return { revision: 7, tasks: seedTasks.map((task) => ({ ...task })) };
}

let server = loadServer();

function persistServer() {
  if (typeof localStorage !== 'undefined') localStorage.setItem(SERVER_KEY, JSON.stringify(server));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await delay(180);
  if (typeof arg === 'string' && arg === 'package') return { data: { ...packageMeta, serverRevision: server.revision, tasks: server.tasks.map((task) => ({ ...task })) } };
  if (typeof arg === 'object' && arg !== null && 'url' in arg) {
    const request = arg as { url: string };
    if (request.url === 'package') return { data: { ...packageMeta, serverRevision: server.revision, tasks: server.tasks.map((task) => ({ ...task })) } };
  }
  return { error: { status: 404, data: 'Not found' } };
};

type SubmitPayload = {
  cardId: string;
  expectedRevision: number;
  measurement: string;
  finding: string;
  status: CardStatus;
  actor: string;
};

type SimulateRemotePayload = {
  cardId: string;
  measurement: string;
  finding: string;
  status: CardStatus;
  actor: string;
};

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package'],
  endpoints: (builder) => ({
    getWorkPackage: builder.query<typeof packageMeta & { serverRevision: number; tasks: WorkCard[] }, void>({
      query: () => 'package',
      providesTags: ['Package']
    }),
    submitCard: builder.mutation<{ accepted: boolean; revision: number }, SubmitPayload>({
      // 乐观锁：expectedRevision 必须等于服务器当前版本，否则返回 409 与服务器当前快照
      queryFn: async (payload) => {
        await delay(260);
        if (payload.expectedRevision !== server.revision) {
          const card = server.tasks.find((task) => task.id === payload.cardId);
          return {
            error: {
              status: 409,
              data: {
                message: '版本冲突：服务器工卡已被其他终端更新，双方内容均已保留，请选择合并或放弃本地版本。',
                serverRevision: server.revision,
                serverCard: card ? { ...card } : null
              }
            }
          };
        }
        const card = server.tasks.find((task) => task.id === payload.cardId);
        if (card) {
          card.measurement = payload.measurement;
          card.finding = payload.finding;
          card.status = payload.status;
        }
        server.revision += 1;
        persistServer();
        return { data: { accepted: true, revision: server.revision } };
      },
      invalidatesTags: ['Package']
    }),
    // 演示用：模拟另一终端（如检验员）在服务器端提交了同一工卡，产生新版本
    simulateRemoteChange: builder.mutation<{ revision: number; serverCard: WorkCard | null }, SimulateRemotePayload>({
      queryFn: async (payload) => {
        await delay(200);
        const card = server.tasks.find((task) => task.id === payload.cardId);
        if (card) {
          card.measurement = payload.measurement;
          card.finding = payload.finding;
          card.status = payload.status;
        }
        server.revision += 1;
        persistServer();
        return { data: { revision: server.revision, serverCard: card ? { ...card } : null } };
      },
      invalidatesTags: ['Package']
    })
  })
});

export const { useGetWorkPackageQuery, useSubmitCardMutation, useSimulateRemoteChangeMutation } = maintenanceApi;
