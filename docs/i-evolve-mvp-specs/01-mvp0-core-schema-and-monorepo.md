<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 01. MVP0：Core Schema 与 Monorepo 骨架

> 目标：建立工程基础，固化 Memory / Observation / Audit / Repository 的数据契约。  
> 非目标：不实现真实 Daemon、不实现 AI、不接 Claude Code、不接 Git remote。

## 1. 交付目标

```text
- pnpm monorepo 可 build / test / typecheck。
- Memory Markdown frontmatter schema 可校验。
- Observation schema 可校验。
- AuditAction schema 可校验。
- Memory / Instinct 状态统一。
- snake_case frontmatter 与 camelCase TS model 有明确 mapping。
- Repository 接口定义完成，但可先不实现真实存储。
```

## 2. Monorepo 目录

```text
i-evolve/
  apps/
    cli/
      src/index.ts
  packages/
    shared/
      src/types.ts
      src/errors.ts
      src/constants.ts
    schema/
      schemas/
        memory.schema.json
        instinct.schema.json
        observation.schema.json
        session-summary.schema.json
        audit-action.schema.json
        project-profile.schema.json
        memory-pack.schema.json
      src/validate.ts
      src/mapping.ts
    core/
      src/model/
        memory.ts
        instinct.ts
        observation.ts
        audit.ts
        session.ts
        project.ts
      src/policy/
        status.ts
        scope.ts
    repository/
      src/interfaces/
        MemoryRepository.ts
        ObservationRepository.ts
        IndexRepository.ts
        AuditRepository.ts
        TransactionManager.ts
  tests/
    fixtures/
```

## 3. 核心类型

### 3.1 MemoryStatus

```ts
export type MemoryStatus =
  | 'candidate'
  | 'active'
  | 'rejected'
  | 'deprecated'
  | 'superseded';
```

### 3.2 MemoryItem

```ts
export interface MemoryItem {
  id: string;
  type:
    | 'user_preference'
    | 'project_fact'
    | 'repo_fact'
    | 'task_constraint'
    | 'decision'
    | 'pitfall'
    | 'workflow_rule';

  scope: 'global' | 'domain' | 'project' | 'repo' | 'task' | 'user';

  repoId?: string;
  projectId?: string;
  domain?: string;

  title: string;
  content: string;
  status: MemoryStatus;
  visibility: 'private' | 'team' | 'public';

  confidence: number;
  ttlDays?: number | null;
  expiresAt?: string | null;

  appliesTo?: {
    repoPatterns?: string[];
    packageNames?: string[];
    pathPatterns?: string[];
  };

  tags: string[];
  sourceRefs: string[];

  revision: number;
  contentHash: string;
  sourceGitCommit?: string;

  supersedes?: string[];
  deprecatedBy?: string | null;

  createdAt: string;
  updatedAt: string;
}
```

### 3.3 Markdown frontmatter

Markdown 主存储使用 snake_case：

```yaml
---
id: project.bilibili-column.old-editor-return-button
type: project_fact
scope: project
project_id: bilibili-column
repo_id: bilibili/column-web
status: active
visibility: team
confidence: 0.91
ttl_days: 180
expires_at: 2026-12-09T00:00:00+08:00
revision: 3
content_hash: sha256:xxxx
source_git_commit: abc123
source_refs:
  - session.20260612.xxx
tags:
  - web
  - editor
applies_to:
  repo_patterns:
    - "bilibili/column-*"
  package_names:
    - "@bilibili/column-web"
  path_patterns:
    - "packages/editor/**"
created_at: 2026-06-12T10:00:00+08:00
updated_at: 2026-06-12T10:00:00+08:00
---
```

## 4. Observation

```ts
export interface Observation {
  id: string;
  timestamp: string;
  sessionId: string;
  repoId?: string;
  projectId?: string;
  cwdHash?: string;
  source: 'claude-code' | 'codex' | 'cursor' | 'cli' | 'mcp';
  phase: 'session_start' | 'pre_tool_use' | 'post_tool_use' | 'stop' | 'manual';
  tool?: string;
  summary: string;
  filesTouched?: string[];
  commands?: string[];
  riskFlags?: string[];
  status: 'success' | 'failure' | 'blocked' | 'unknown';
  sensitivity: 'public' | 'internal' | 'sensitive';
  rawRef?: {
    type: 'local_encrypted_file' | 'none';
    pathHash?: string;
    expiresAt?: string;
  };
}
```

## 5. AuditAction

```ts
export interface AuditAction {
  id: string;
  memoryId: string;
  action:
    | 'propose'
    | 'ai_approve'
    | 'ai_reject'
    | 'activate'
    | 'deprecate'
    | 'supersede'
    | 'forget'
    | 'rollback'
    | 'scope_downgrade'
    | 'confidence_update';
  actorType: 'ai' | 'user' | 'system';
  actorId: string;
  reason: string;
  confidence: number;
  beforeHash?: string;
  afterHash?: string;
  sourceRefs: string[];
  policyChecks: PolicyCheckResult[];
  createdAt: string;
}
```

## 6. Repository 接口

### MemoryRepository

```ts
export interface MemoryRepository {
  get(id: string): Promise<MemoryItem | null>;
  list(filter?: MemoryFilter): Promise<MemoryItem[]>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;

  create(input: CreateMemoryInput, tx?: Transaction): Promise<MemoryItem>;

  update(
    id: string,
    patch: UpdateMemoryPatch,
    options: {
      expectedRevision: number;
      expectedContentHash: string;
    },
    tx?: Transaction
  ): Promise<MemoryItem>;

  changeStatus(
    id: string,
    status: MemoryStatus,
    action: AuditActionInput,
    options: { expectedRevision: number },
    tx?: Transaction
  ): Promise<MemoryItem>;

  forget(
    id: string,
    mode: 'soft' | 'tombstone',
    action: AuditActionInput,
    tx?: Transaction
  ): Promise<void>;

  rebuildIndex(options?: RebuildIndexOptions): Promise<void>;
}
```

### ObservationRepository

```ts
export interface ObservationRepository {
  append(event: Observation): Promise<void>;
  listBySession(sessionId: string): Promise<Observation[]>;
  listByProject(projectId: string, limit?: number): Promise<Observation[]>;
  archiveBefore(date: string): Promise<void>;
  purgeExpired(): Promise<void>;
}
```

### IndexRepository

```ts
export interface IndexRepository {
  upsertMemory(memory: MemoryItem): Promise<void>;
  removeMemory(memoryId: string): Promise<void>;
  search(query: IndexQuery): Promise<IndexSearchResult[]>;
  rebuildFromMarkdown(source: MarkdownMemorySource): Promise<void>;
  healthCheck(): Promise<IndexHealthReport>;
}
```

## 7. CLI 骨架

```bash
i-evolve --version
i-evolve schema validate <file>
i-evolve schema print memory
i-evolve doctor --bootstrap
```

## 8. 测试

```text
[ ] valid memory markdown 可通过校验。
[ ] missing scope 报错。
[ ] invalid status 报错。
[ ] active memory 缺少 confidence 报错。
[ ] global memory 缺少 ttl_days 或 expires_at 报 warning / fail。
[ ] frontmatter camelCase 字段报错，提示应使用 snake_case。
```

## 9. 验收清单

```text
[ ] pnpm install/build/test/typecheck 成功。
[ ] memory.schema.json 完成。
[ ] observation.schema.json 完成。
[ ] audit-action.schema.json 完成。
[ ] Repository interfaces 完成。
[ ] CLI schema validate 可运行。
```
