<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 03. MVP2：Markdown Memory 主存储与 SQLite/FTS 派生索引

> 目标：实现 Git-managed Markdown Memory 的本地写入、读取、状态变更，以及 SQLite/FTS 派生索引。  
> 非目标：不实现 AI 自动提炼、不实现 Git remote push、不接 Claude Code。

## 1. 交付目标

```text
- 创建 Memory Markdown。
- 更新 Memory。
- 变更 Memory 状态。
- soft forget / tombstone。
- 从 Markdown 重建 SQLite。
- 用 FTS 搜索 active memory。
```

## 2. 本地 Memory Repo 目录

```text
~/.i-evolve/shared/memory/
  memory-pack.yaml
  global/
  domains/
  projects/
  repos/
  users/
  instincts/
  tombstones/
```

初始化：

```bash
i-evolve memory init-local
```

## 3. Markdown 文件命名规则

```text
{scope}/{namespace}/{slug}.md
```

示例：

```text
projects/bilibili-column/old-editor-return-button.md
repos/column-web/read-before-edit.md
domains/ssr/hydration-checklist.md
global/output-style.md
users/minntaki/output-preference.md
```

## 4. Atomic Write

```text
1. 写入临时文件 `.tmp-{id}-{timestamp}`。
2. fsync 临时文件。
3. rename 到目标路径。
4. fsync 父目录。
5. 更新 SQLite。
6. 更新 FTS。
7. 写 audit action。
```

禁止：

```text
- 直接覆盖目标文件。
- 先更新 SQLite 再写 Markdown。
- schema 校验失败仍写入文件。
```

## 5. 乐观并发控制

每条 Memory 必须有：

```yaml
revision: 1
content_hash: sha256:xxx
```

更新时传入：

```ts
{
  expectedRevision: number;
  expectedContentHash: string;
}
```

规则：

```text
1. 当前 revision 不匹配 → ERR_REVISION_CONFLICT。
2. 当前 content_hash 不匹配 → ERR_CONTENT_HASH_CONFLICT。
3. 更新成功后 revision + 1。
4. 更新成功后重新计算 content_hash。
```

## 6. SQLite Schema

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  repo_id TEXT,
  project_id TEXT,
  domain TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  confidence REAL NOT NULL,
  ttl_days INTEGER,
  expires_at TEXT,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_git_commit TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY(memory_id, tag)
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  memory_id UNINDEXED,
  title,
  content,
  tags
);
```

## 7. Index Rebuild

```bash
i-evolve index rebuild
```

流程：

```text
1. daemon 获取 git workspace lock。
2. 扫描所有 Markdown。
3. 校验 schema。
4. 清空 SQLite memories / tags / FTS。
5. 重新写入 metadata。
6. 重新写入 FTS。
7. 输出 report。
```

## 8. MemoryRepository 实现

```bash
i-evolve memory add --file <md>
i-evolve memory create --type project_fact --scope project --title "..."
i-evolve memory get <id>
i-evolve memory list --status active
i-evolve memory update <id>
i-evolve memory status <id> deprecated
i-evolve memory forget <id> --mode soft
i-evolve memory forget <id> --mode tombstone
i-evolve memory search "关键词"
```

## 9. Forget 语义

### Soft forget

```text
status: deprecated
不再注入
保留原文件
写 audit action
```

### Tombstone

```text
tombstones/{memory_id}.md
```

用于防止同一错误 memory 被再次生成。

## 10. Search 规则

默认只返回：

```text
status = active
expires_at is null or expires_at > now
```

## 11. 测试

```text
[ ] create memory 后 Markdown 文件存在。
[ ] create memory 后 SQLite 有 metadata。
[ ] create memory 后 FTS 可搜到。
[ ] update revision 不匹配时报 conflict。
[ ] 删除 SQLite 后 index rebuild 可恢复。
[ ] schema 错误 Markdown 不进入 index。
[ ] deprecated memory 默认不返回。
[ ] tombstone memory 不会被重新创建同 ID。
[ ] atomic write 中途失败不会留下半文件。
```

## 12. 验收清单

```text
[ ] 本地 memory repo 初始化可用。
[ ] MemoryRepository create/get/list/update/changeStatus/forget 可用。
[ ] Markdown 是唯一主存储。
[ ] SQLite 可从 Markdown 重建。
[ ] FTS 可从 Markdown 重建。
[ ] revision/content_hash 冲突检测可用。
[ ] audit action 写入可用。
[ ] 所有写操作通过 daemon。
```
