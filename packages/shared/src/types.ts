export type MemoryStatus =
  | 'candidate'
  | 'active'
  | 'rejected'
  | 'deprecated'
  | 'superseded';

export type MemoryType =
  | 'repo_fact'
  | 'task_constraint'
  | 'decision'
  | 'pitfall'
  | 'workflow_rule';

export type MemoryScope =
  | 'global'
  | 'domain'
  | 'repo'
  | 'task';

export type MemoryVisibility = 'private' | 'team' | 'public';

export type ObservationSource =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'cli'
  | 'mcp';

export type ObservationPhase =
  | 'session_start'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'stop'
  | 'manual';

export type ObservationStatus = 'success' | 'failure' | 'blocked' | 'unknown';

export type ObservationSensitivity = 'public' | 'internal' | 'sensitive';

export type AuditActionType =
  | 'propose'
  | 'ai_approve'
  | 'ai_reject'
  | 'activate'
  | 'deprecate'
  | 'supersede'
  | 'forget'
  | 'rollback'
  | 'checkout'
  | 'sync_pull'
  | 'sync_push'
  | 'migrate'
  | 'scope_downgrade'
  | 'confidence_update';

export type ActorType = 'ai' | 'user' | 'system';

export interface AppliesTo {
  repoPatterns?: string[];
  packageNames?: string[];
  pathPatterns?: string[];
}

export interface RawRef {
  type: 'local_encrypted_file' | 'none';
  pathHash?: string;
  expiresAt?: string;
}

export interface PolicyCheckResult {
  policy: string;
  passed: boolean;
  reason?: string;
}
