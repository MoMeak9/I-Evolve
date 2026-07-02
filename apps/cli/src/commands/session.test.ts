import { describe, it, expect } from 'vitest';
import { resolveSessionId } from './session.js';

describe('resolveSessionId', () => {
  it('优先用 --session flag', () => {
    expect(resolveSessionId('flag-id', 'env-id', { session_id: 'stdin-id' })).toBe('flag-id');
  });
  it('无 flag 时用环境变量', () => {
    expect(resolveSessionId(undefined, 'env-id', { session_id: 'stdin-id' })).toBe('env-id');
  });
  it('flag 与 env 皆空时用 stdin 的 session_id', () => {
    expect(resolveSessionId(undefined, undefined, { session_id: 'stdin-id' })).toBe('stdin-id');
  });
  it('全部缺失时返回 undefined', () => {
    expect(resolveSessionId(undefined, undefined, {})).toBeUndefined();
  });
  it('stdin 非对象时安全返回 undefined', () => {
    expect(resolveSessionId(undefined, undefined, null)).toBeUndefined();
  });
});
