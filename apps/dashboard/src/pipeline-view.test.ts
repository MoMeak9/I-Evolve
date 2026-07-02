import { describe, it, expect } from 'vitest';
import { splitBeltParcels, sessionColor, applyFilter } from './pipeline-view.js';

describe('splitBeltParcels', () => {
  it('不超过 4 个时全部可见,无料箱', () => {
    const parcels = [1, 2, 3].map((n) => ({ id: n }));
    const { visible, overflow } = splitBeltParcels(parcels, 4);
    expect(visible).toHaveLength(3);
    expect(overflow).toHaveLength(0);
  });

  it('超过 4 个时前 4 可见,其余进料箱', () => {
    const parcels = [1, 2, 3, 4, 5, 6].map((n) => ({ id: n }));
    const { visible, overflow } = splitBeltParcels(parcels, 4);
    expect(visible.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    expect(overflow.map((p) => p.id)).toEqual([5, 6]);
  });
});

describe('sessionColor', () => {
  it('相同 session 稳定映射到同一颜色索引', () => {
    expect(sessionColor('a1b2')).toBe(sessionColor('a1b2'));
  });
  it('不同 session 尽量分散(前 N 个不同)', () => {
    const c1 = sessionColor('aaaa');
    const c2 = sessionColor('bbbb');
    expect(typeof c1).toBe('number');
    expect(typeof c2).toBe('number');
  });
});

describe('applyFilter', () => {
  const parcels = [
    { id: 1, sessionId: 'a1b2' },
    { id: 2, sessionId: 'c3d4' },
  ];
  it('filter=all 时全部 active', () => {
    expect(applyFilter(parcels, 'all').every((p) => p.dimmed === false)).toBe(true);
  });
  it('filter=某 session 时其余 dimmed', () => {
    const out = applyFilter(parcels, 'a1b2');
    expect(out.find((p) => p.id === 1)!.dimmed).toBe(false);
    expect(out.find((p) => p.id === 2)!.dimmed).toBe(true);
  });
});
