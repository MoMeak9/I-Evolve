<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 05. MVP4：Claude Code Plugin、Hooks 与 Skills

> 目标：接入 Claude Code，实现真实 Agent 会话中的自动观察、会话结束自动进化、会话开始上下文注入。  
> 非目标：不实现 MCP、不做复杂 Dashboard、不做远程 Git push 强依赖。

## 1. 交付目标

```text
SessionStart
→ i-evolve inject
→ Claude 获得 I-Evolve Context

PostToolUse
→ i-evolve observe
→ Daemon 写 Observation

Stop
→ i-evolve session finalize --auto-evolve
→ AI 自动生成 / 审核 / 激活 Memory
```

## 2. Plugin 目录

```text
packages/claude-plugin/
  .claude-plugin/
    plugin.json
  hooks/
    hooks.json
  skills/
    init/SKILL.md
    remember/SKILL.md
    audit/SKILL.md
    forget/SKILL.md
    explain-memory/SKILL.md
```

## 3. plugin.json

```json
{
  "name": "i-evolve",
  "description": "Cross-repo memory and self-evolution system for Coding Agents.",
  "version": "0.3.1",
  "author": {
    "name": "minntaki"
  }
}
```

## 4. hooks.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "i-evolve inject --format markdown"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write|Bash|Grep|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "i-evolve observe --phase post_tool_use --source claude-code"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "i-evolve session finalize --auto-evolve"
          }
        ]
      }
    ]
  }
}
```

## 5. Inject 命令

```bash
i-evolve inject --format markdown
i-evolve inject --query "SSR 水合审查"
i-evolve inject --max-tokens 2500
```

输出格式：

```md
# I-Evolve Context

## Current Repository
- repo_id: bilibili/column-web
- project_id: bilibili-column
- domain: web-editor

## High Priority Memories
- [project_fact | project | conf=0.91 | id=project.bilibili-column.old-editor-return-button]
  旧版编辑器发布内容进入新版详情页时，需要展示“返回旧版”入口。

## Active Instincts
- [workflow_rule | global | conf=0.88 | id=global.read-before-edit]
  修改文件前必须先读取目标文件。
```

## 6. Context Retrieval MVP4

检索源：

```text
- active memory
- active instinct
- project profile
- recent session summary，短期、低优先级
```

过滤规则：

```text
1. 只注入 active。
2. expires_at 过期不注入。
3. rejected / deprecated / superseded 不注入。
4. scope 不匹配不注入。
```

Top-K 简化策略：

```text
repo scope Top 5
project scope Top 5
domain scope Top 5
user preference Top 3
global instinct Top 5
warnings Top 3
```

## 7. Observation Hook Payload

转换为 Observation：

```ts
{
  id: "obs.xxx",
  phase: "post_tool_use",
  source: "claude-code",
  tool: "Edit",
  summary: "Edited packages/core/src/memory.ts",
  filesTouched: ["packages/core/src/memory.ts"],
  status: "success",
  sensitivity: "internal"
}
```

## 8. Skills

```text
/i-evolve:init
/i-evolve:remember
/i-evolve:audit
/i-evolve:forget
/i-evolve:explain-memory
```

Skill 只负责交互，不直接实现存储。真正实现调用 CLI。

## 9. 性能目标

| 操作 | 目标 |
|---|---:|
| SessionStart inject | < 500ms，最差 < 1s |
| PostToolUse observe | < 100ms |
| Stop finalize | 可较慢，但不能阻塞主流程太久 |
| daemon ping | < 50ms |

## 10. 失败策略

| 场景 | 策略 |
|---|---|
| daemon 未运行 | hook 输出提示，不写入 |
| inject 失败 | 返回空上下文 + warning |
| observe 失败 | 不阻断 Claude 主流程 |
| finalize 失败 | 写入 error audit |
| AI provider 失败 | session summary 保留，稍后重试 |

## 11. 测试

```text
[ ] SessionStart hook 可调用 inject。
[ ] inject 输出不包含 deprecated memory。
[ ] PostToolUse hook 可写 observation。
[ ] Stop hook 可触发 session finalize。
[ ] Claude plugin 文件结构符合要求。
[ ] Skills 文档存在且命令正确。
[ ] daemon 未运行时 Hook 不崩溃。
```

## 12. 验收清单

```text
[ ] Claude Code 启动时可以注入 I-Evolve Context。
[ ] 工具调用后可以记录 observation。
[ ] 会话结束可以自动生成 Memory。
[ ] 自动生成 Memory 可在下一次 SessionStart 中注入。
[ ] 用户可通过 Skill 查看 audit。
[ ] 用户可通过 Skill forget 某条 memory。
```
