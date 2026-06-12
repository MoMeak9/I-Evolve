<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 07. MVP6：跨仓召回、冲突优先级与 Top-K 注入

> 目标：让 Memory 可以跨仓复用，同时通过 repo_id / project_id / domain / applies_to 和优先级规则防止污染。  
> 非目标：不引入复杂 RAG 系统，不接外部 embedding。

## 1. 交付目标

```text
Memory 是跨仓的，但不能无条件注入。
```

完成后系统可以：

```text
- 自动识别当前 repo_id / project_id / domain。
- 根据 applies_to 匹配跨仓 memory。
- 使用 scope 优先级过滤冲突。
- 使用简单 Top-K 输出稳定上下文。
- 注入上下文带 provenance。
```

## 2. Repo / Project 识别

输入：

```text
- cwd
- git remote url
- package.json name
- go.mod module
- pnpm-workspace.yaml
- project-profile.md
- 用户手动绑定配置
```

输出：

```ts
export interface ProjectIdentity {
  repoId: string;
  projectId?: string;
  domain?: string;
  gitRemote?: string;
  packageNames: string[];
  rootPath: string;
  confidence: number;
}
```

## 3. Project Profile

```text
i-evolve-memory/projects/{project_id}/project-profile.md
```

示例：

```yaml
---
id: project.bilibili-column.profile
type: project_profile
project_id: bilibili-column
repo_ids:
  - bilibili/column-web
  - bilibili/column-admin
domains:
  - web-editor
  - ssr
package_names:
  - "@bilibili/column-web"
status: active
---
```

## 4. applies_to 匹配

```yaml
applies_to:
  repo_patterns:
    - "bilibili/column-*"
  package_names:
    - "@bilibili/column-web"
  path_patterns:
    - "packages/editor/**"
```

匹配规则：

```text
1. repo_id 精确匹配优先。
2. repo_patterns glob 匹配其次。
3. package_names 匹配其次。
4. project_id 匹配其次。
5. domain 匹配再次。
6. global 最后。
```

## 5. 冲突优先级

```text
P0 当前用户显式输入 / 当前任务约束
P1 repo scope memory
P2 project scope memory
P3 domain scope memory
P4 user preference
P5 global workflow rule / instinct
P6 recent session summary
```

冲突处理：

```text
1. scope 越近，优先级越高。
2. 当前任务约束永远高于长期 memory。
3. repo/project 高于 domain/global。
4. deprecated/rejected/superseded 不允许进入 active context。
5. 同一主题多条 memory 只注入最高优先级那条。
6. 同 ID 多版本以当前 Git checkout 为准。
```

## 6. Top-K 策略

默认配额：

```text
repo memory Top 5
project memory Top 5
domain memory Top 5
user preference Top 3
global instinct Top 5
warnings Top 3
recent session summary Top 2
```

评分：

```text
score =
  semantic_or_fts_score * 0.45
  + scope_priority * 0.25
  + confidence * 0.15
  + recency * 0.10
  + usage_success_score * 0.05
```

MVP6 可以只用 FTS score，不接 embedding。

## 7. Provenance 注入格式

```md
- [project_fact | project | conf=0.91 | id=project.bilibili-column.old-editor-return-button]
  旧版编辑器发布内容进入新版详情页时，需要展示“返回旧版”入口。
```

## 8. Conflict Report

```ts
export interface ConflictReport {
  id: string;
  selectedMemoryId: string;
  suppressedMemoryIds: string[];
  reason: string;
  createdAt: string;
}
```

## 9. CLI 命令

```bash
i-evolve identity detect
i-evolve identity bind --project bilibili-column
i-evolve inject --debug
i-evolve memory search "SSR" --explain
i-evolve retrieval explain --memory <id>
```

`inject --debug` 输出：

```text
Matched identity: repo=bilibili/column-web, project=bilibili-column
Candidates: 42
Filtered expired: 3
Filtered scope mismatch: 19
Filtered deprecated: 2
Injected: 18
Suppressed conflicts: 2
```

## 10. 测试

```text
[ ] repo_id 可从 git remote 识别。
[ ] project_id 可从 project-profile 匹配。
[ ] repo memory 优先于 project memory。
[ ] project memory 优先于 domain memory。
[ ] domain memory 可跨相关仓注入。
[ ] 无 applies_to 的 project memory 不跨仓注入。
[ ] deprecated memory 不注入。
[ ] 冲突规则只注入高优先级。
[ ] inject --debug 输出过滤原因。
```

## 11. 验收清单

```text
[ ] 当前仓库身份识别可用。
[ ] applies_to 匹配可用。
[ ] scope priority 可用。
[ ] Top-K 注入可用。
[ ] 注入上下文带 provenance。
[ ] 可解释为什么某条 memory 被注入或被抑制。
[ ] A 仓库规则不会错误注入 B 仓库。
```
