import type { EventBus } from './event-bus.js';
import type { AsyncFinalizerDeps } from './async-finalizer.js';
import { MONITOR_EVENT } from './monitor-types.js';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** 把 finalizer 回调包一层 emit;原回调行为不变。 */
export function instrumentFinalizerDeps(
  base: AsyncFinalizerDeps,
  bus: EventBus,
  sessionId: string,
): AsyncFinalizerDeps {
  return {
    ...base,

    extract: async (observations, sid, repoId) => {
      bus.emit({
        stage: 'think', type: MONITOR_EVENT.extractStart, sessionId,
        summary: `开始抽取 · 输入 ${observations.length} 条观测`,
        detail: { observationCount: observations.length },
      });
      const result = await base.extract(observations, sid, repoId);
      for (const c of result.candidates) {
        bus.emit({
          stage: 'think', type: MONITOR_EVENT.extractCandidate, sessionId,
          summary: `抽出候选:"${c.title}"`,
          detail: { title: c.title, slug: slugify(c.title), type: c.type, confidence: c.confidence, proposedScope: c.proposedScope },
        });
      }
      return result;
    },

    judgeCandidate: (candidate) => {
      bus.emit({
        stage: 'judge', type: MONITOR_EVENT.judgeStart, sessionId,
        summary: `判定候选:"${candidate.title}"`,
        detail: { title: candidate.title, slug: slugify(candidate.title) },
      });
      const decision = base.judgeCandidate(candidate);
      bus.emit({
        stage: 'judge', type: MONITOR_EVENT.judgeResult, sessionId,
        summary: decision.decision === 'reject'
          ? `✕ 拒绝:${decision.reason}`
          : `✓ ${decision.decision}:${decision.reason}`,
        level: decision.decision === 'reject' ? 'warn' : 'info',
        detail: {
          title: candidate.title,
          slug: slugify(candidate.title),
          decision: decision.decision,
          reason: decision.reason,
          confidence: decision.confidence,
          finalScope: decision.finalScope,
          failedCheck: decision.policyChecks?.find((c) => !c.passed)?.policy,
        },
      });
      return decision;
    },

    createMemory: (input) => {
      const out = base.createMemory(input);
      bus.emit({
        stage: 'store', type: MONITOR_EVENT.memoryCreated, sessionId,
        summary: `暂存候选记忆:"${input.title}"`,
        detail: { id: input.id, title: input.title, status: input.status, scope: input.scope },
      });
      return out;
    },

    promoteCandidatesBySlug: (slug, content, newId) => {
      const out = base.promoteCandidatesBySlug(slug, content, newId);
      bus.emit({
        stage: 'store', type: MONITOR_EVENT.candidatePromoted, sessionId,
        summary: `候选 "${slug}" 晋升为正式记忆`,
        detail: { slug, memoryId: newId },
      });
      return out;
    },

    onPromoted: base.onPromoted
      ? async (memory) => {
          await base.onPromoted!(memory);
          bus.emit({
            stage: 'sync', type: MONITOR_EVENT.autopushQueued, sessionId,
            summary: `记忆 ${memory.id} 进入待推送队列`,
            detail: { id: memory.id, visibility: memory.visibility },
          });
        }
      : undefined,
  };
}
