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

/** 记忆库条目摘要(轻量,不含正文),对应 daemon /memories。 */
export interface MemorySummary {
  id: string;
  title: string;
  scope: string;
  type: string;
  status: string;
  domain?: string;
  repoId?: string;
  confidence: number;
  tags: string[];
  updatedAt: string;
}

/** 单条记忆完整内容,对应 daemon /memory?id=。 */
export interface MemoryDetail extends MemorySummary {
  content: string;
  revision: number;
  createdAt: string;
  sourceRefs: string[];
}

export interface MemoryListResponse {
  total: number;
  items: MemorySummary[];
}
