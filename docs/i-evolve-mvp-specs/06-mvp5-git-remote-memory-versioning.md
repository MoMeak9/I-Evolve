<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 06. MVP5：Git Remote Memory、版本管理与回滚

> 目标：将本地 Memory Repo 与唯一远程 Git Memory Repo 打通，实现 pull、commit、push、版本追踪、回滚和 migration。  
> 非目标：不做多 remote source，不做无 Git 平台 fallback。

## 1. 交付目标

```text
远程 Memory 只有一份。
版本由 Git 管理。
本地 clone 是当前工作副本。
Memory 变更最终都体现为 Git commit。
```

完成后可以：

```text
- 添加唯一 remote memory repo。
- clone / pull / status。
- 自动 commit memory 变更。
- push 到远程。
- checkout tag / commit。
- rollback 到指定 commit。
- Git 变化后重建 SQLite/FTS。
```

## 2. 远程仓库结构

```text
i-evolve-memory/
  README.md
  CHANGELOG.md
  memory-pack.yaml
  global/
  domains/
  projects/
  repos/
  users/
  instincts/
  audit/
    2026-06/
      memory-audit.jsonl
  tombstones/
  migrations/
```

## 3. memory-pack.yaml

```yaml
id: team.default
name: Team Default Memory
schema_version: 2
visibility: team
remote:
  type: git
  default_branch: main
versioning:
  strategy: git
  allow_checkout_commit: true
  allow_checkout_tag: true
sync:
  auto_pull: true
  auto_push: false
ai_review:
  enabled: true
  reviewer: i-evolve-policy-v1
```

## 4. CLI 命令

```bash
i-evolve memory remote init <git-url>
i-evolve memory remote status
i-evolve memory remote pull
i-evolve memory remote push
i-evolve memory remote commit --message "memory(auto): add xxx"
i-evolve memory remote checkout <commit-or-tag>
i-evolve memory remote rollback --to-commit <commit>
i-evolve memory remote log
```

## 5. Git 工作区锁

所有 Git 操作必须获取：

```text
~/.i-evolve/shared/memory/.git/i-evolve.lock
```

保护：

```text
- pull
- push
- commit
- checkout
- rollback
- migration
- index rebuild after commit change
```

## 6. Commit 策略

Commit message：

```text
memory(auto): add project rule for bilibili-column old editor behavior

AI-Reviewer: i-evolve-policy-v1
Decision: activate
Confidence: 0.91
Scope: project
Source-Session: session.20260612.xxx
```

变更类型：

```text
memory(auto): add ...
memory(auto): update ...
memory(auto): deprecate ...
memory(user): forget ...
memory(system): migrate schema ...
```

## 7. Pull 策略

```text
1. 获取 git workspace lock。
2. 检查工作区是否干净。
3. 如果有未提交变更，拒绝 pull。
4. git fetch。
5. git pull --ff-only。
6. 如果失败，生成 conflict report。
7. current_commit 更新。
8. index rebuild。
9. 写 audit action。
```

MVP5 不自动解决 merge conflict。

## 8. Push 策略

```text
1. 获取 git workspace lock。
2. validate memory repo。
3. secret / pii / schema check。
4. 检查是否有 commit 可 push。
5. git push。
6. 写 audit action。
```

如果 validate 失败，禁止 push。

## 9. Rollback 策略

```bash
i-evolve memory remote rollback --to-commit <commit>
```

流程：

```text
1. 获取 git workspace lock。
2. 记录当前 commit。
3. git checkout 或 git revert。
4. 更新 current_commit。
5. rebuild SQLite/FTS。
6. 写 rollback audit action。
```

两种模式：

```text
checkout mode：本地切到指定 commit，适合临时排查。
revert mode：创建反向 commit，适合长期回滚。
```

## 10. Schema Migration

```bash
i-evolve migrate status
i-evolve migrate run
i-evolve migrate run --to 002
```

要求：

```text
1. 必须操作 Markdown 文件。
2. 必须 bump schema_version。
3. 必须写 audit action。
4. 必须生成 Git commit。
5. 必须可 dry-run。
```

## 11. Validate 策略

```text
[ ] memory-pack.yaml 存在。
[ ] schema_version 可识别。
[ ] 所有 Markdown frontmatter 合法。
[ ] id 唯一。
[ ] content_hash 正确。
[ ] active memory 未过期。
[ ] tombstone 不被 active memory 复用。
[ ] secret / pii check 通过。
```

## 12. 测试

```text
[ ] remote init 可 clone repo。
[ ] remote status 显示 current_commit。
[ ] memory 变更可生成 commit。
[ ] validate 失败时禁止 push。
[ ] pull 后自动 rebuild index。
[ ] checkout old commit 后 index 与 old memory 一致。
[ ] rollback 生成 audit action。
[ ] migration dry-run 不写文件。
```

## 13. 验收清单

```text
[ ] 唯一 remote memory repo 可配置。
[ ] pull / push / commit / checkout / rollback 可用。
[ ] Git 版本变化会触发 index rebuild。
[ ] validate 可以阻断错误 memory。
[ ] rollback 后上下文注入使用回滚版本。
[ ] migration 机制可运行。
```
