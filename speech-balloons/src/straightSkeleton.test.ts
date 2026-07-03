import { describe, it, expect } from 'vitest';
import { computeStraightSkeleton, type Skeleton } from './straightSkeleton';
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

function facesArea(skel: Skeleton): number {
  return skel.faces.reduce(
    (s, f) => s + polygonArea(f.outline.map((fp) => fp.p)),
    0,
  );
}

function hasPoint(skel: Skeleton, edgeIndex: number, x: number, y: number): boolean {
  const f = skel.faces.find((f) => f.edgeIndex === edgeIndex)!;
  return f.outline.some((fp) => Math.hypot(fp.p.x - x, fp.p.y - y) < 1e-3);
}

// Shared invariants: rim edge first (two t=0 points), t bounded by tDeath ≤ tMax.
function assertFaceInvariants(skel: Skeleton): void {
  for (const f of skel.faces) {
    expect(f.outline.length).toBeGreaterThanOrEqual(3);
    expect(f.outline[0]!.t).toBeCloseTo(0, 9);
    expect(f.outline[1]!.t).toBeCloseTo(0, 9);
    for (const fp of f.outline) {
      expect(Number.isFinite(fp.t)).toBe(true);
      expect(Number.isFinite(fp.p.x)).toBe(true);
      expect(Number.isFinite(fp.p.y)).toBe(true);
      expect(fp.t).toBeLessThanOrEqual(f.tDeath + 1e-6);
    }
    expect(f.tDeath).toBeLessThanOrEqual(skel.tMax + 1e-6);
  }
}

describe('computeStraightSkeleton — convex', () => {
  it('square: every face peaks at t=50 at the center', () => {
    const skel = computeStraightSkeleton(square);
    expect(skel.faces).toHaveLength(4);
    expect(skel.tMax).toBeCloseTo(50, 4);
    for (const f of skel.faces) {
      expect(f.tDeath).toBeCloseTo(50, 4);
      expect(f.outline.some((fp) => Math.hypot(fp.p.x - 50, fp.p.y - 50) < 1e-3)).toBe(true);
    }
    assertFaceInvariants(skel);
  });

  it('rectangle: short edges collapse at the ridge endpoints', () => {
    const skel = computeStraightSkeleton(rect);
    expect(skel.tMax).toBeCloseTo(50, 4);
    // edges are [top, right, bottom, left]
    expect(hasPoint(skel, 1, 150, 50)).toBe(true);
    expect(hasPoint(skel, 3, 50, 50)).toBe(true);
    assertFaceInvariants(skel);
  });

  it('face areas partition the polygon (regular hexagon)', () => {
    const hex: Polygon = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * 2 * Math.PI;
      return { x: 100 + 50 * Math.cos(a), y: 100 + 50 * Math.sin(a) };
    });
    const skel = computeStraightSkeleton(hex);
    expect(facesArea(skel)).toBeCloseTo(polygonArea(hex), 0);
    assertFaceInvariants(skel);
  });

  it('collinear-run regression: polygon area is fully partitioned', () => {
    const poly: Polygon = [
      { x: 0, y: 0 }, { x: 33, y: 0 }, { x: 66, y: 0 },
      { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const skel = computeStraightSkeleton(poly);
    expect(facesArea(skel)).toBeCloseTo(10000, 0);
    assertFaceInvariants(skel);
  });

  it('irregular convex polygon: area partitioned and invariants hold', () => {
    const poly: Polygon = [
      { x: 0, y: 0 }, { x: 180, y: 10 }, { x: 220, y: 80 },
      { x: 150, y: 140 }, { x: 40, y: 110 },
    ];
    const skel = computeStraightSkeleton(poly);
    expect(facesArea(skel)).toBeCloseTo(polygonArea(poly), 0);
    assertFaceInvariants(skel);
  });
});
