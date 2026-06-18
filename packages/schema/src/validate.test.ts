import { describe, it, expect } from 'vitest';
import { validateMemory, validateObservation, validateAuditAction, detectCamelCaseKeys } from './validate.js';

describe('validateMemory', () => {
  const validMemory = {
    id: 'test.memory.1',
    type: 'repo_fact',
    scope: 'repo',
    repo_id: 'test-project',
    title: 'Test Memory',
    status: 'active',
    visibility: 'team',
    confidence: 0.85,
    revision: 1,
    content_hash: 'sha256:abcdef123456',
    created_at: '2026-06-12T10:00:00+08:00',
    updated_at: '2026-06-12T10:00:00+08:00',
  };

  it('should pass for a valid memory', () => {
    const result = validateMemory(validMemory);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when scope is missing', () => {
    const { scope, ...noScope } = validMemory;
    const result = validateMemory(noScope);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('scope'))).toBe(true);
  });

  it('should fail for invalid status', () => {
    const result = validateMemory({ ...validMemory, status: 'invalid' });
    expect(result.valid).toBe(false);
  });

  it('should fail when active memory lacks confidence', () => {
    const { confidence, ...noConfidence } = validMemory;
    const result = validateMemory(noConfidence);
    expect(result.valid).toBe(false);
  });

  it('should fail when repo scope lacks repo_id', () => {
    const { repo_id, ...noProjectId } = validMemory;
    const result = validateMemory(noProjectId);
    expect(result.valid).toBe(false);
  });

  it('should fail when repo scope lacks repo_id', () => {
    const result = validateMemory({
      ...validMemory,
      scope: 'repo',
      repo_id: undefined,
    });
    expect(result.valid).toBe(false);
  });
});

describe('validateObservation', () => {
  const validObservation = {
    id: 'obs.001',
    timestamp: '2026-06-12T10:00:00+08:00',
    session_id: 'session.123',
    source: 'claude-code',
    phase: 'post_tool_use',
    summary: 'Edited file src/index.ts',
    status: 'success',
    sensitivity: 'internal',
  };

  it('should pass for a valid observation', () => {
    const result = validateObservation(validObservation);
    expect(result.valid).toBe(true);
  });

  it('should fail when session_id is missing', () => {
    const { session_id, ...noSession } = validObservation;
    const result = validateObservation(noSession);
    expect(result.valid).toBe(false);
  });
});

describe('validateAuditAction', () => {
  const validAudit = {
    id: 'audit.001',
    memory_id: 'test.memory.1',
    action: 'activate',
    actor_type: 'ai',
    actor_id: 'policy-judge-v1',
    reason: 'High confidence, meets all policy checks',
    confidence: 0.92,
    source_refs: ['session.123'],
    policy_checks: [{ policy: 'min_confidence', passed: true }],
    created_at: '2026-06-12T10:00:00+08:00',
  };

  it('should pass for a valid audit action', () => {
    const result = validateAuditAction(validAudit);
    expect(result.valid).toBe(true);
  });

  it('should fail when action is invalid', () => {
    const result = validateAuditAction({ ...validAudit, action: 'invalid' });
    expect(result.valid).toBe(false);
  });
});

describe('detectCamelCaseKeys', () => {
  it('should detect camelCase keys', () => {
    const data = { repoId: 'r', domainName: 'web', scope: 'repo' };
    const result = detectCamelCaseKeys(data);
    expect(result).toContain('repoId');
    expect(result).toContain('domainName');
    expect(result).not.toContain('scope');
  });

  it('should return empty for snake_case keys', () => {
    const data = { repo_id: 'r', domain_name: 'web', scope: 'repo' };
    const result = detectCamelCaseKeys(data);
    expect(result).toHaveLength(0);
  });
});
