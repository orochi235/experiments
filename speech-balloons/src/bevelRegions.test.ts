import { describe, it, expect } from 'vitest';
import { simplifyRim } from './bevelRegions';
import type { Polygon } from './clipping';

function circlePoly(n: number, r = 50, cx = 100, cy = 100): Polygon {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

describe('simplifyRim', () => {
  it('dense circle: vertex count shrinks to ~360/cornerStep', () => {
    const dense = circlePoly(120); // 3° per edge
    const out = simplifyRim(dense, 12);
    expect(out.length).toBeGreaterThanOrEqual(24);
    expect(out.length).toBeLessThanOrEqual(36); // ~30 ± slack
  });

  it('rectangle survives unchanged (every turn exceeds tolerance)', () => {
    const rect: Polygon = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
    ];
    expect(simplifyRim(rect, 12)).toHaveLength(4);
  });

  it('collinear midpoints are dropped', () => {
    const withMid: Polygon = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 100 }, { x: 0, y: 100 },
    ];
    expect(simplifyRim(withMid, 12)).toHaveLength(4);
  });
});
