import { describe, it, expect } from 'vitest';
import { computeStraightSkeleton } from './straightSkeleton';
import type { Polygon } from './clipping';

const square: Polygon = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];
// 200 wide, 100 tall
const rect: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
];

function polygonArea(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function cellOutline(cell: { left: { p: { x: number; y: number } }[]; right: { p: { x: number; y: number } }[] }) {
  return [...cell.left.map((tp) => tp.p), ...cell.right.map((tp) => tp.p).reverse()];
}

describe('computeStraightSkeleton', () => {
  it('square: every edge dies at t=50 at the center', () => {
    const skel = computeStraightSkeleton(square);
    expect(skel.cells).toHaveLength(4);
    expect(skel.tMax).toBeCloseTo(50, 4);
    for (const cell of skel.cells) {
      expect(cell.tDeath).toBeCloseTo(50, 4);
      const last = cell.left[cell.left.length - 1]!.p;
      expect(last.x).toBeCloseTo(50, 3);
      expect(last.y).toBeCloseTo(50, 3);
    }
  });

  it('rectangle: short edges die at t=50 at the ridge endpoints', () => {
    const skel = computeStraightSkeleton(rect);
    expect(skel.tMax).toBeCloseTo(50, 4);
    // edges are [top, right, bottom, left]; right (idx 1) and left (idx 3)
    // are the short ones and collapse at the ridge endpoints (150,50)/(50,50).
    const right = skel.cells[1]!;
    const left = skel.cells[3]!;
    expect(right.tDeath).toBeCloseTo(50, 4);
    expect(left.tDeath).toBeCloseTo(50, 4);
    const rEnd = right.left[right.left.length - 1]!.p;
    const lEnd = left.left[left.left.length - 1]!.p;
    expect(rEnd.x).toBeCloseTo(150, 3);
    expect(rEnd.y).toBeCloseTo(50, 3);
    expect(lEnd.x).toBeCloseTo(50, 3);
    expect(lEnd.y).toBeCloseTo(50, 3);
  });

  it('cell areas partition the polygon (regular hexagon)', () => {
    const hex: Polygon = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * 2 * Math.PI;
      return { x: 100 + 50 * Math.cos(a), y: 100 + 50 * Math.sin(a) };
    });
    const skel = computeStraightSkeleton(hex);
    const total = skel.cells.reduce((s, c) => s + polygonArea(cellOutline(c)), 0);
    expect(total).toBeCloseTo(polygonArea(hex), 0); // within 0.5 px²
  });

  it('every cell boundary is parameterized: t ascends and starts at 0', () => {
    const skel = computeStraightSkeleton(rect);
    for (const cell of skel.cells) {
      for (const side of [cell.left, cell.right]) {
        expect(side[0]!.t).toBe(0);
        for (let i = 1; i < side.length; i++) {
          expect(side[i]!.t).toBeGreaterThanOrEqual(side[i - 1]!.t - 1e-9);
        }
      }
    }
  });
});
