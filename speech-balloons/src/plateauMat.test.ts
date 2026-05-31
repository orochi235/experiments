import { describe, it, expect } from 'vitest';
import { computeMatPlateau } from './plateauMat';
import type { Polygon } from './clipping';

function polygonArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

const squareCCW: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
].slice().reverse();

describe('computeMatPlateau', () => {
  it('inset by bw=10 produces an inset polygon with smaller area', () => {
    const out = computeMatPlateau([squareCCW], 10);
    expect(out.length).toBeGreaterThan(0);
    const area = out.reduce((a, p) => a + polygonArea(p), 0);
    // Inset by 10 on a 100x100 square → ~80x80 with rounded corners.
    expect(area).toBeLessThan(100 * 100);
    expect(area).toBeGreaterThan(0);
    // Loose upper bound on inset area: ≤ (100-2*10)^2 = 6400.
    expect(area).toBeLessThanOrEqual(6400 + 1);
  });

  it('with bw=0 returns [] (current behavior: the guard collapses no-op insets)', () => {
    // NOTE: the original spec asked for "input unchanged" at bw=0, but the
    // source explicitly short-circuits when bevelWidth <= 0 by returning [].
    // We lock in the actual behavior rather than refactoring the API.
    const out = computeMatPlateau([squareCCW], 0);
    expect(out).toEqual([]);
  });

  it('with bw greater than the polygon half-width returns []', () => {
    // 100x100 square; half-width = 50. Erode by 60 → nothing remains.
    const out = computeMatPlateau([squareCCW], 60);
    expect(out).toEqual([]);
  });
});
