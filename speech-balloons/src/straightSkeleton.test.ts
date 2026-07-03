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
// When `poly` is provided, also pin each face's rim points to the actual input
// edge endpoints (skip for inputs that cleanPolygon alters, e.g. collinear runs).
function assertFaceInvariants(skel: Skeleton, poly?: Polygon): void {
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
    // The outline's max t must BE tDeath (not merely bounded by it).
    const maxT = Math.max(...f.outline.map((fp) => fp.t));
    expect(maxT).toBeCloseTo(f.tDeath, 6);
    expect(f.tDeath).toBeLessThanOrEqual(skel.tMax + 1e-6);
    if (poly) {
      const A = poly[f.edgeIndex]!;
      const B = poly[(f.edgeIndex + 1) % poly.length]!;
      expect(Math.hypot(f.outline[0]!.p.x - A.x, f.outline[0]!.p.y - A.y)).toBeLessThan(1e-6);
      expect(Math.hypot(f.outline[1]!.p.x - B.x, f.outline[1]!.p.y - B.y)).toBeLessThan(1e-6);
    }
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
    assertFaceInvariants(skel, square);
  });

  it('rectangle: short edges collapse at the ridge endpoints', () => {
    const skel = computeStraightSkeleton(rect);
    expect(skel.tMax).toBeCloseTo(50, 4);
    // edges are [top, right, bottom, left]
    expect(hasPoint(skel, 1, 150, 50)).toBe(true);
    expect(hasPoint(skel, 3, 50, 50)).toBe(true);
    assertFaceInvariants(skel, rect);
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

// ---- concave fixtures ----

// L: 200×100 top bar + 100×100 lower-left block. One reflex vertex at (100,100).
const lShape: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
  { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 },
];

// 200×100 rectangle with a triangular tail hanging off the bottom edge.
// Reflex vertices at (120,100) and (90,100).
const tailRect: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
  { x: 120, y: 100 }, { x: 100, y: 140 }, { x: 90, y: 100 },
  { x: 0, y: 100 },
];

// Two 100×100 squares joined by a 20-px-tall neck. Four reflex vertices.
const dumbbell: Polygon = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 180, y: 40 },
  { x: 180, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 100 }, { x: 180, y: 100 },
  { x: 180, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

// T: 300×100 top bar with a 100×100 stem below center. Two reflex vertices.
const tShape: Polygon = [
  { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, { x: 200, y: 100 },
  { x: 200, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

// U: two 100×200 prongs joined by a 50-tall bridge. Two reflex vertices.
const uShape: Polygon = [
  { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 200, y: 200 },
  { x: 200, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 200 }, { x: 0, y: 200 },
];

// Five-point star: 10 vertices alternating radius 100 / 40.
const star: Polygon = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * 2 * Math.PI - Math.PI / 2;
  const r = i % 2 === 0 ? 100 : 40;
  return { x: 150 + r * Math.cos(a), y: 150 + r * Math.sin(a) };
});

// Rectangle with a 2-px-deep, nearly-flat notch: near-180° reflex vertices.
const shallowNotch: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
  { x: 104, y: 100 }, { x: 100, y: 98 }, { x: 96, y: 100 },
  { x: 0, y: 100 },
];

describe('computeStraightSkeleton — concave (split events)', () => {
  const cases: Array<[string, Polygon]> = [
    ['L-shape', lShape],
    ['T-shape', tShape],
    ['U-shape', uShape],
    ['tail-on-rect', tailRect],
    ['dumbbell', dumbbell],
    ['star', star],
    ['shallow notch', shallowNotch],
  ];

  for (const [name, poly] of cases) {
    it(`${name}: SLAV succeeds and faces partition the polygon`, () => {
      const skel = computeStraightSkeleton(poly);
      expect(skel.method).toBe('slav');
      expect(skel.faces).toHaveLength(poly.length);
      expect(facesArea(skel)).toBeCloseTo(polygonArea(poly), 0);
      assertFaceInvariants(skel, poly);
    });
  }

  it('convex inputs also run on the SLAV engine', () => {
    expect(computeStraightSkeleton(square).method).toBe('slav');
    expect(computeStraightSkeleton(rect).method).toBe('slav');
  });

  it('L-shape: the reflex vertex splits the wavefront (tMax = 50)', () => {
    const skel = computeStraightSkeleton(lShape);
    // Both prongs are 100 wide → deepest inset is 50 in each.
    expect(skel.tMax).toBeCloseTo(50, 3);
  });

  it('tail-on-rect: tail faces die early, body governs tMax', () => {
    const skel = computeStraightSkeleton(tailRect);
    expect(skel.tMax).toBeCloseTo(50, 3);
    // Tail edges are 3 and 4 ((120,100)→(100,140) and (100,140)→(90,100)).
    // The tail pinches off where its two reflex spokes meet: both ride
    // y = 100 − t with x = 120 − t(√5−1)/2 and x = 90 + t(√17−1)/4, meeting
    // at t ≈ 21.4468 — the instant the apex vertex also arrives there, so
    // both tail faces die at the pinch, well before the body's t = 50.
    const tPinch = 30 / ((Math.sqrt(5) - 1) / 2 + (Math.sqrt(17) - 1) / 4);
    const tail3 = skel.faces.find((f) => f.edgeIndex === 3)!;
    const tail4 = skel.faces.find((f) => f.edgeIndex === 4)!;
    expect(tail3.tDeath).toBeCloseTo(tPinch, 3);
    expect(tail4.tDeath).toBeCloseTo(tPinch, 3);
    // After the pinch, faces 2 and 5 (the two collinear bottom-edge fronts)
    // meet along a ridge running straight down the inward normal from the
    // pinch point (pinchX, 100 − tPinch) until both die against the top
    // front at t = 50 — pinning the phantom vertex's re-anchored trajectory.
    const pinchX = 100 + tPinch * (Math.sqrt(17) - Math.sqrt(5)) / 6;
    expect(hasPoint(skel, 2, pinchX, 50)).toBe(true);
  });

  it('two tails on one edge: multi-phantom null-ring pairing partitions exactly', () => {
    const twoTails: Polygon = [
      { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 },
      { x: 320, y: 100 }, { x: 300, y: 140 }, { x: 290, y: 100 },
      { x: 120, y: 100 }, { x: 100, y: 140 }, { x: 90, y: 100 },
      { x: 0, y: 100 },
    ];
    const skel = computeStraightSkeleton(twoTails);
    expect(skel.method).toBe('slav');
    expect(facesArea(skel)).toBeCloseTo(polygonArea(twoTails), 0);
    assertFaceInvariants(skel, twoTails);
  });

  it('symmetric opposing notches: vertex event where two reflex fronts meet', () => {
    // 200×100 rect with matching 20-deep notches centered on top and bottom.
    const opposing: Polygon = [
      { x: 0, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 20 }, { x: 110, y: 0 },
      { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 110, y: 100 },
      { x: 100, y: 80 }, { x: 90, y: 100 }, { x: 0, y: 100 },
    ];
    const skel = computeStraightSkeleton(opposing);
    expect(skel.method).toBe('slav');
    expect(facesArea(skel)).toBeCloseTo(polygonArea(opposing), 0);
    assertFaceInvariants(skel, opposing);
  });

  it('self-intersecting input falls back to naive without crashing', () => {
    const bowtie: Polygon = [
      { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 },
    ];
    const skel = computeStraightSkeleton(bowtie);
    expect(skel.method).toBe('naive');
    for (const f of skel.faces) {
      for (const fp of f.outline) {
        expect(Number.isFinite(fp.t)).toBe(true);
      }
    }
  });
});
