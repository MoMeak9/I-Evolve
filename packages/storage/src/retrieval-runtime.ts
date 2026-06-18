import { createHash } from 'node:crypto';
import type { MemoryItem } from '@i-evolve/core';
import type { MarkdownMemoryRepository } from './memory-repository.js';
import { retrieveContextDebug, type RetrievalContext, type RetrievalDebugResult } from './context-retrieval.js';

export type RecallPhase = 'session_start' | 'user_prompt_submit';
export type PromptTaskType = 'code_edit' | 'code_review' | 'debug' | 'architecture_analysis' | 'prd' | 'spec' | 'workflow' | 'llm_wiki' | 'research' | 'question_answer' | 'unknown';
export type ActionLevel = 'read_only' | 'suggestion' | 'edit' | 'destructive';
export type ExpectedOutput = 'answer' | 'markdown_doc' | 'spec' | 'prd' | 'code_patch' | 'audit_report' | 'diagram' | 'checklist';

export interface PromptIntent {
  raw_prompt: string;
  task_type: PromptTaskType;
  domain?: string;
  project_id?: string;
  action_level: ActionLevel;
  expected_output: ExpectedOutput;
  risk_flags: string[];
  memory_needs: {
    need_user_preference: boolean;
    need_project_fact: boolean;
    need_task_constraint: boolean;
    need_instinct: boolean;
    need_domain_rule: boolean;
    need_history_decision: boolean;
    need_pitfall: boolean;
  };
  search_queries: string[];
}

export interface MemoryChunk {
  chunk_id: string;
  memory_id: string;
  chunk_type: 'header' | 'semantic' | 'operational' | 'evidence' | 'summary';
  text: string;
  embedding_text: string;
  inject_text: string;
  metadata: {
    type: string;
    scope: string;
    agent_id: string;
    project_id?: string;
    domain?: string;
    status: string;
    visibility: string;
    confidence: number;
    tags: string[];
    expires_at?: string | null;
    memory_version: number;
    git_commit?: string;
  };
  index: {
    embedding_model: string;
    vector_id?: string;
    bm25_doc_id?: string;
    indexed_at: string;
    content_hash: string;
  };
}

const DOMAIN_KEYWORDS: Array<[string, string[]]> = [
  ['ssr', ['ssr', 'hydration', '水合', '服务端渲染']],
  ['retrieval', ['召回', '检索', '向量', 'embedding', 'bm25', 'rag']],
  ['git', ['git', 'branch', 'commit', '分支', '提交']],
];

export function inferPromptIntent(rawPrompt: string, options: { projectId?: string } = {}): PromptIntent {
  const prompt = rawPrompt.trim();
  const lower = prompt.toLowerCase();
  const has = (words: string[]) => words.some((word) => lower.includes(word.toLowerCase()));

  let task_type: PromptTaskType = 'question_answer';
  if (has(['review', '审查', '检查', '漏洞', '水合', '架构漏洞'])) task_type = 'code_review';
  else if (has(['debug', '报错', '修复', 'bug', '排查'])) task_type = 'debug';
  else if (has(['prd', '产品需求', '用户故事'])) task_type = 'prd';
  else if (has(['spec', '技术方案', '实施方案', 'mvp', '架构设计'])) task_type = 'spec';
  else if (has(['llm wiki', '知识库', '文档维护', '代码流程'])) task_type = 'llm_wiki';
  else if (has(['实现', '修改', '新增', '重构', 'implement', 'edit'])) task_type = 'code_edit';

  const domain = DOMAIN_KEYWORDS.find(([, words]) => has(words))?.[0];
  const destructive = has(['删除', '清空', 'drop', 'remove', 'destroy']);
  const readOnly = task_type === 'code_review' || has(['只读', '不要修改', '分析', 'review']);
  const action_level: ActionLevel = destructive ? 'destructive' : readOnly ? 'read_only' : task_type === 'code_edit' ? 'edit' : 'suggestion';
  const expected_output: ExpectedOutput = task_type === 'code_edit' ? 'code_patch'
    : task_type === 'code_review' ? 'audit_report'
      : task_type === 'prd' ? 'prd'
        : task_type === 'spec' ? 'spec'
          : has(['checklist', '清单']) ? 'checklist'
            : has(['mermaid', 'diagram', '图']) ? 'diagram'
              : 'answer';
  const risk_flags = [
    ...(has(['水合', 'hydration']) ? ['hydration'] : []),
    ...(destructive ? ['destructive'] : []),
    ...(has(['隐私', 'secret', 'token', '密钥']) ? ['sensitive_data'] : []),
  ];
  const search_queries = Array.from(new Set([prompt, [task_type, domain, ...risk_flags].filter(Boolean).join(' ')].filter(Boolean)));

  return {
    raw_prompt: prompt,
    task_type,
    domain,
    project_id: options.projectId,
    action_level,
    expected_output,
    risk_flags,
    memory_needs: {
      need_user_preference: true,
      need_project_fact: ['code_edit', 'code_review', 'debug', 'architecture_analysis'].includes(task_type),
      need_task_constraint: action_level !== 'read_only',
      need_instinct: true,
      need_domain_rule: Boolean(domain),
      need_history_decision: ['code_review', 'architecture_analysis', 'spec'].includes(task_type),
      need_pitfall: ['code_review', 'debug'].includes(task_type) || risk_flags.length > 0,
    },
    search_queries,
  };
}

export function chunkMemory(memory: MemoryItem, indexedAt = new Date().toISOString(), embeddingModel = 'BAAI/bge-m3'): MemoryChunk[] {
  const base = `${memory.id}\n${memory.revision}\n${memory.contentHash}`;
  const common = {
    type: memory.type,
    scope: memory.scope,
    agent_id: '*',
    project_id: memory.projectId,
    domain: memory.domain,
    status: memory.status,
    visibility: memory.visibility,
    confidence: memory.confidence,
    tags: memory.tags,
    expires_at: memory.expiresAt,
    memory_version: memory.revision,
    git_commit: memory.sourceGitCommit,
  };
  const specs = [
    ['header', `${memory.id} ${memory.title} ${memory.type} ${memory.scope} ${memory.tags.join(' ')} ${memory.projectId ?? ''} ${memory.domain ?? ''}`],
    ['semantic', `${memory.title}\n${memory.content}`],
    ['operational', `${memory.type}: ${memory.title}\n${memory.content}`],
  ] as const;
  return specs.map(([chunk_type, text]) => {
    const content_hash = sha256(`${base}\n${chunk_type}\n${text}`);
    return {
      chunk_id: sha256(`${memory.id}${memory.revision}${chunk_type}${content_hash}`),
      memory_id: memory.id,
      chunk_type,
      text,
      embedding_text: text,
      inject_text: `[${memory.type}] ${memory.title}\n${memory.content}`,
      metadata: common,
      index: { embedding_model: embeddingModel, indexed_at: indexedAt, content_hash },
    };
  });
}

export function recallMarkdown(repo: MarkdownMemoryRepository, phase: RecallPhase, ctx: RetrievalContext, options: { prompt?: string; debug?: boolean } = {}): string {
  const intent = phase === 'user_prompt_submit' ? inferPromptIntent(options.prompt ?? ctx.query ?? '', { projectId: ctx.projectId }) : undefined;
  const query = intent?.search_queries[0] ?? ctx.query;
  const result = retrieveContextDebug(repo, { ...ctx, query, domain: intent?.domain ?? ctx.domain });
  return phase === 'session_start' ? formatSessionStart(result, options.debug) : formatPromptSpecific(result, intent, options.debug);
}

function formatSessionStart(result: RetrievalDebugResult, debug = false): string {
  const lines = ['# i-evolve Baseline Context', '', '## Current Project Memory'];
  appendItems(lines, [...result.retrieved.repo, ...result.retrieved.project, ...result.retrieved.domain]);
  lines.push('', '## User Preferences');
  appendItems(lines, result.retrieved.user);
  lines.push('', '## Guardrails');
  appendItems(lines, [...result.retrieved.global, ...result.retrieved.warnings]);
  if (debug) appendDebug(lines, result);
  return lines.join('\n');
}

function formatPromptSpecific(result: RetrievalDebugResult, intent: PromptIntent | undefined, debug = false): string {
  const lines = ['# i-evolve Prompt-Specific Context'];
  if (intent) lines.push('', '## Inferred Intent', `- task_type: ${intent.task_type}`, `- domain: ${intent.domain ?? 'unknown'}`, `- expected_output: ${intent.expected_output}`, `- action_level: ${intent.action_level}`);
  lines.push('', '## Relevant Memory');
  appendItems(lines, Object.values(result.retrieved).flat());
  lines.push('', '## Guardrails', '- 不确定项目事实时，先读取代码或文档，不要猜。');
  if (intent?.action_level === 'read_only') lines.push('- 本轮为只读/审查任务，默认不要修改代码。');
  if (debug) appendDebug(lines, result);
  return lines.join('\n');
}

function appendItems(lines: string[], memories: MemoryItem[]): void {
  if (memories.length === 0) { lines.push('- (no matching memory)'); return; }
  for (const memory of memories) lines.push(`- [${memory.type}] ${memory.title} (memory_id: ${memory.id})`);
}

function appendDebug(lines: string[], result: RetrievalDebugResult): void {
  lines.push('', '## Retrieval Debug', `- candidates: ${result.stats.candidates}`, `- fts_matches: ${result.stats.ftsMatches}`, `- injected: ${result.stats.injected}`, `- suppressed_conflicts: ${result.stats.suppressedConflicts}`);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
