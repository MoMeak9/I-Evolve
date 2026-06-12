<!--
I-Evolve MVP Implementation Specs
Version: v0.3.1
Date: 2026-06-12
Language: zh-CN
-->

# 04. MVP3：AI 自动提炼、自动审核与审计日志

> 目标：实现从 Observation / Session Summary 中自动提炼 Candidate Memory / Instinct，并由 AI Policy Judge 自动激活或拒绝。  
> 非目标：不接 Claude Code Hook、不做远程 Git push、不做 MCP。

## 1. 交付目标

```text
Observation
→ Session Summary
→ Candidate Memory / Instinct
→ AI Policy Judge
→ active / rejected / scope_downgrade
→ Audit Action
→ Markdown Memory
→ SQLite/FTS 更新
```

AI 自动审核不是无审核。AI 判断必须有 policy checks、reason、confidence、source_refs、audit log。

## 2. 新增模块

```text
packages/ai-evolution/
  src/extractor/
    SessionSummarizer.ts
    MemoryCandidateExtractor.ts
    InstinctCandidateExtractor.ts
  src/judge/
    PolicyJudge.ts
    ScopeJudge.ts
    TtlJudge.ts
    SensitivityJudge.ts
  src/prompts/
    session-summary.prompt.md
    memory-extractor.prompt.md
    policy-judge.prompt.md
  src/provider/
    AiProvider.ts
    mock-provider.ts
    openai-compatible-provider.ts
```

## 3. Session Summary

```ts
export interface SessionSummary {
  id: string;
  sessionId: string;
  repoId?: string;
  projectId?: string;
  startedAt?: string;
  endedAt: string;
  summary: string;
  decisions: string[];
  constraints: string[];
  mistakes: string[];
  userCorrections: string[];
  filesTouched: string[];
  candidateMemoryHints: string[];
  candidateInstinctHints: string[];
  sensitivity: 'public' | 'internal' | 'sensitive';
  expiresAt: string;
}
```

存储：

```text
~/.i-evolve/sessions/{yyyy-mm}/{session_id}.json
```

规则：

```text
1. Session Summary 默认不进 Git。
2. 默认 TTL 30 天。
3. 不直接长期注入。
4. 只作为 Memory Extractor 输入。
```

## 4. Candidate Memory

```ts
export interface CandidateMemory {
  title: string;
  type: MemoryItem['type'];
  proposedScope: MemoryItem['scope'];
  content: string;
  evidence: string[];
  sourceRefs: string[];
  confidence: number;
  riskFlags: string[];
}
```

Extractor 必须避免：

```text
- 单次任务的临时约束被提升为 global。
- 没有明确证据的用户偏好。
- 含 secret / PII / 原始代码片段的 memory。
- 与已 rejected tombstone 相似的 memory。
```

## 5. Policy Judge

```ts
export interface PolicyDecision {
  decision: 'activate' | 'reject' | 'downgrade_scope' | 'needs_more_evidence';
  finalScope?: MemoryItem['scope'];
  finalType?: MemoryItem['type'];
  confidence: number;
  ttlDays?: number | null;
  expiresAt?: string | null;
  reason: string;
  policyChecks: PolicyCheckResult[];
}
```

规则：

```text
1. confidence < 0.7 默认 rejected 或 needs_more_evidence。
2. task_constraint 默认 ttl_days <= 30。
3. global memory 必须 confidence >= 0.9，且必须有 ttl。
4. user_preference 不允许 visibility=team，除非显式配置。
5. sensitive memory 不允许进入 shared remote。
6. 与 tombstone 相似的 memory 默认 rejected。
```

## 6. Scope 决策表

| 情况 | 推荐 scope | TTL |
|---|---|---:|
| 当前任务明确约束 | task | 7-30 天 |
| 某仓库特有规则 | repo | 90-180 天 |
| 某项目多仓共享规则 | project | 90-365 天 |
| 某技术领域通用规则 | domain | 180 天 |
| 用户稳定输出偏好 | user | 365 天或 null |
| Agent 行为规则 | global / domain instinct | 90-180 天 |

## 7. Policy Checks

```text
1. schema_validation
2. secret_detection
3. pii_detection
4. scope_leakage
5. sensitivity_check
6. duplicate_check
7. tombstone_similarity_check
```

## 8. 审计日志

存储：

```text
~/.i-evolve/audit/{yyyy-mm}.jsonl
```

Audit 示例：

```json
{
  "id": "audit.20260612.xxx",
  "memoryId": "project.bilibili-column.old-editor-return-button",
  "action": "ai_approve",
  "actorType": "ai",
  "actorId": "i-evolve-policy-v1",
  "reason": "规则仅适用于 bilibili-column 项目，不应提升为 global。",
  "confidence": 0.91,
  "sourceRefs": ["session.20260612.xxx"],
  "policyChecks": [
    { "name": "schema_validation", "status": "pass" },
    { "name": "scope_leakage", "status": "pass" },
    { "name": "secret_detection", "status": "pass" }
  ],
  "createdAt": "2026-06-12T10:00:00+08:00"
}
```

## 9. CLI 命令

```bash
i-evolve session finalize --auto-evolve
i-evolve evolve run --session <session_id>
i-evolve evolve dry-run --session <session_id>
i-evolve audit list
i-evolve audit show <memory_id>
i-evolve audit explain <memory_id>
i-evolve memory reject <id>
i-evolve memory deprecate <id>
```

## 10. AI Provider 策略

```ts
export interface AiProvider {
  complete(input: AiCompleteInput): Promise<AiCompleteOutput>;
}
```

默认：

```text
- test 使用 mock provider。
- dev 可配置 openai-compatible provider。
- 不接 embedding。
```

隐私规则：

```text
- sensitive observation 不发送外部 provider。
- rawRef 不发送外部 provider。
- 发送前做 redaction。
```

## 11. 测试

```text
[ ] session finalize 可生成 summary。
[ ] extractor 可生成 candidate memory。
[ ] policy judge 可 activate 高置信 project_fact。
[ ] policy judge 可 reject 低置信 memory。
[ ] task constraint 不会被提升为 global。
[ ] 包含 secret 的 candidate 被 reject。
[ ] 与 tombstone 相似的 candidate 被 reject。
[ ] AI approve 后 Markdown memory 被写入。
[ ] AI reject 后 rejected memory / audit 可查询。
[ ] dry-run 不写入文件。
```

## 12. 验收清单

```text
[ ] Session Summary 可生成并本地保存。
[ ] Candidate Memory / Instinct 可生成。
[ ] AI Policy Judge 可输出结构化 decision。
[ ] active memory 自动写入 Markdown。
[ ] rejected memory 有记录，不进入注入。
[ ] 每次 AI 判断都有 audit action。
[ ] Policy checks 覆盖安全和 scope。
[ ] 所有写入仍经过 daemon transaction。
```
