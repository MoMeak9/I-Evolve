/** 流水线阶段 */
export type MonitorStage = 'observe' | 'think' | 'judge' | 'store' | 'sync' | 'system';

/** 事件 type 常量 —— 与埋点位置一一对应 */
export const MONITOR_EVENT = {
  observationReceived: 'observation.received',
  sessionStart: 'session.start',
  sessionFinalize: 'session.finalize',
  extractStart: 'extract.start',
  extractCandidate: 'extract.candidate',
  judgeStart: 'judge.start',
  judgeResult: 'judge.result',
  memoryCreated: 'memory.created',
  candidatePromoted: 'candidate.promoted',
  memoryForgotten: 'memory.forgotten',
  memoryRolledback: 'memory.rolledback',
  autopushQueued: 'autopush.queued',
  autopushPushed: 'autopush.pushed',
  pipelineError: 'pipeline.error',
  warning: 'warning',
} as const;

export type MonitorEventType = (typeof MONITOR_EVENT)[keyof typeof MONITOR_EVENT];

/** SSE 推送的统一事件对象 */
export interface MonitorEvent {
  id: number; // 单调递增,断线续传用
  ts: string; // ISO 时间戳
  stage: MonitorStage;
  type: MonitorEventType;
  sessionId?: string;
  summary: string;
  detail?: Record<string, unknown>;
  level?: 'info' | 'warn' | 'error';
}

/** 累计统计(供 /snapshot 与顶部状态栏) */
export interface MonitorStats {
  observations: number;
  candidates: number;
  accepted: number; // 非 reject
  rejected: number;
  memories: number; // created + promoted
  wasted: number; // rejected 别名,语义=废料箱
}

export interface MonitorSnapshot {
  events: MonitorEvent[];
  stats: MonitorStats;
}
