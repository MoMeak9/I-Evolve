/** Mirror of packages/daemon/src/monitor-types.ts (kept in sync manually). */

export interface MonitorEvent {
  id: number;
  ts: string;
  stage: 'observe' | 'think' | 'judge' | 'store' | 'sync' | 'system';
  type: string;
  sessionId?: string;
  summary: string;
  detail?: Record<string, unknown>;
  level?: 'info' | 'warn' | 'error';
}

export interface MonitorStats {
  observations: number;
  candidates: number;
  accepted: number;
  rejected: number;
  memories: number;
  wasted: number;
}

export interface MonitorSnapshot {
  events: MonitorEvent[];
  stats: MonitorStats;
}
