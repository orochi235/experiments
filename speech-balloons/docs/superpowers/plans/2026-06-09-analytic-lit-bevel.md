# Analytic Lit-Bevel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SVG-filter `lit-bevel` fill mode with an analytic vector renderer: light-independent surface regions (band strips, straight-skeleton roof panels, blob/flat interiors) rendered as exact gradient paths with merged linear-light stops.

**Architecture:** Three new pure modules — `straightSkeleton.ts` (wavefront skeleton with parameterized cell boundaries), `bevelRegions.ts` (rim simplification + region construction), `litBevelShading.ts` (linear-light stop computation with an exclude set) — consumed by a slim memo in `SpeechBalloon.tsx` that replaces the filter-chain block. Spec: `docs/superpowers/specs/2026-06-09-analytic-lit-bevel-design.md`.

**Tech Stack:** TypeScript, React (existing lab), vitest. No new dependencies.

**Conventions for this codebase:**
- `Point`/`Polygon` types come from `src/clipping.ts` (`{x, y}` objects, closed rings without repeated last point).
- Screen coordinates are y-down. Polygon winding varies — always derive orientation from the signed area, never assume.
- Run tests with `npx vitest run` (all) or `npx vitest run src/<file>.test.ts` (one file). Type-check with `npx tsc --noEmit` — there is one pre-existing baseline error at `src/Lab.tsx:173`; anything else is yours.
- Commit after every green step. Do not pass `-c commit.gpgsign=true` or any signing flags.

---

### Task 1: `src/straightSkeleton.ts` — wavefront skeleton

The skeleton drives everything: each rim edge's cell (bounded by its endpoints' bisector trajectories) is later cut at the bevel seam into a strip and a roof panel.

**Files:**
- Create: `src/straightSkeleton.ts`
- Test: `src/straightSkeleton.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/straightSkeleton.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/straightSkeleton.test.ts`
Expected: FAIL — cannot resolve `./straightSkeleton`.

- [ ] **Step 3: Implement the skeleton**

```ts
// src/straightSkeleton.ts
//
// Straight skeleton of a simple polygon via wavefront simulation, edge-collapse
// events only. Under uniform inset, each wavefront vertex travels along its
// angle bisector — a linear trajectory p(t) = p0 + t·d obtained by intersecting
// the two adjacent edges' offset lines. An edge dies when its two endpoint
// trajectories meet; its neighbors then become adjacent and spawn a new vertex.
//
// Reflex (concave) vertices are NOT split-event-correct: their bisectors are
// traced naively, matching the project's miter-offset behavior. Per the
// 2026-06-09 spec, concave rims render degraded-but-stable in v1.
import type { Point, Polygon } from './clipping';

export interface TrajPoint { t: number; p: Point }

export interface SkeletonCell {
  edgeIndex: number;   // edge from input vertex i to i+1
  n: Point;            // unit inward normal of the edge
  left: TrajPoint[];   // trajectory of the edge's START vertex, t ascending
  right: TrajPoint[];  // trajectory of the edge's END vertex, t ascending
  tDeath: number;      // inset at which the edge vanished (== tMax if it survived)
}

export interface Skeleton {
  cells: SkeletonCell[];           // one per input edge, input order
  ridges: Array<[Point, Point]>;   // bisector segments, for debug overlays
  tMax: number;                    // inset at which the wavefront fully collapsed
}

interface Traj { p0: Point; d: Point }

// Vertex trajectory between edges e and f: the point at inset t on both
// offset lines, (p − a)·n = t for each. Linear in t.
function vertexTrajectory(
  e: { a: Point; n: Point }, f: { a: Point; n: Point },
): Traj | null {
  const det = e.n.x * f.n.y - e.n.y * f.n.x;
  if (Math.abs(det) < 1e-12) return null; // parallel edges
  const ce = e.a.x * e.n.x + e.a.y * e.n.y;
  const cf = f.a.x * f.n.x + f.a.y * f.n.y;
  return {
    p0: { x: (ce * f.n.y - cf * e.n.y) / det, y: (e.n.x * cf - f.n.x * ce) / det },
    d: { x: (f.n.y - e.n.y) / det, y: (e.n.x - f.n.x) / det },
  };
}

const at = (tr: Traj, t: number): Point => ({ x: tr.p0.x + tr.d.x * t, y: tr.p0.y + tr.d.y * t });

export function computeStraightSkeleton(poly: Polygon): Skeleton {
  // Drop zero-length edges.
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  const n = pts.length;
  const empty: Skeleton = { cells: [], ridges: [], tMax: 0 };
  if (n < 3) return empty;

  // Inward normal from winding (screen coords, y-down).
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!;
    area2 += p.x * q.y - q.x * p.y;
  }
  const sign = area2 > 0 ? 1 : -1;

  interface Wf {
    orig: number;
    a: Point;            // anchor on the original edge line
    n: Point;            // unit inward normal
    u: Point;            // unit edge direction
    cell: SkeletonCell;
    vert: Traj | null;   // trajectory of this edge's START vertex
    vertBirth: Point;    // where that vertex started (for ridges)
  }

  const act: Wf[] = [];
  const cells: SkeletonCell[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nin = { x: -u.y * sign, y: u.x * sign };
    const cell: SkeletonCell = {
      edgeIndex: i, n: nin,
      left: [{ t: 0, p: a }], right: [{ t: 0, p: b }], tDeath: 0,
    };
    cells.push(cell);
    act.push({ orig: i, a, n: nin, u, cell, vert: null, vertBirth: a });
  }
  for (let i = 0; i < n; i++) {
    act[i]!.vert = vertexTrajectory(act[(i - 1 + n) % n]!, act[i]!);
    act[i]!.vertBirth = pts[i]!;
  }

  const ridges: Array<[Point, Point]> = [];
  let tNow = 0;
  const MAX_EVENTS = 4 * n; // runaway guard for degenerate input
  for (let ev = 0; act.length > 2 && ev < MAX_EVENTS; ev++) {
    // Find the earliest edge collapse: signed length along u hits zero.
    let bestI = -1;
    let bestT = Infinity;
    const m = act.length;
    for (let i = 0; i < m; i++) {
      const e = act[i]!;
      const vl = e.vert, vr = act[(i + 1) % m]!.vert;
      if (!vl || !vr) continue;
      const c0 = (vr.p0.x - vl.p0.x) * e.u.x + (vr.p0.y - vl.p0.y) * e.u.y;
      const c1 = (vr.d.x - vl.d.x) * e.u.x + (vr.d.y - vl.d.y) * e.u.y;
      if (c1 >= -1e-12) continue; // not shrinking
      const tc = -c0 / c1;
      if (tc >= tNow - 1e-9 && tc < bestT) { bestT = tc; bestI = i; }
    }
    if (bestI < 0 || !isFinite(bestT)) break; // wavefront escaped (concave/naive)

    const i = bestI;
    const e = act[i]!;
    const prev = act[(i - 1 + act.length) % act.length]!;
    const next = act[(i + 1) % act.length]!;
    const vl = e.vert!, vr = next.vert!;
    const pl = at(vl, bestT), pr = at(vr, bestT);
    const meet = { x: (pl.x + pr.x) / 2, y: (pl.y + pr.y) / 2 };

    // Close the dying edge's cell.
    e.cell.left.push({ t: bestT, p: pl });
    e.cell.right.push({ t: bestT, p: pr });
    e.cell.tDeath = bestT;
    // Record breakpoints on the neighbors that shared the dead vertices.
    prev.cell.right.push({ t: bestT, p: pl });
    next.cell.left.push({ t: bestT, p: pr });
    ridges.push([e.vertBirth, meet], [next.vertBirth, meet]);

    // Remove e; next's start vertex is now the prev↔next bisector from `meet`.
    act.splice(i, 1);
    next.vert = vertexTrajectory(prev, next);
    next.vertBirth = meet;
    tNow = bestT;
  }

  // Terminate: survivors die together at tNow; their boundaries already end
  // at the last recorded breakpoints. Append final positions + ridge stubs.
  for (let i = 0; i < act.length; i++) {
    const e = act[i]!;
    const vl = e.vert, vr = act[(i + 1) % act.length]!.vert;
    if (vl) {
      const p = at(vl, tNow);
      e.cell.left.push({ t: tNow, p });
      ridges.push([e.vertBirth, p]);
    }
    if (vr) e.cell.right.push({ t: tNow, p: at(vr, tNow) });
    e.cell.tDeath = tNow;
  }

  // De-duplicate consecutive boundary points (events can land on existing ones).
  for (const cell of cells) {
    for (const key of ['left', 'right'] as const) {
      cell[key] = cell[key].filter((tp, idx, arr) => {
        if (idx === 0) return true;
        const prev = arr[idx - 1]!;
        return Math.abs(tp.t - prev.t) > 1e-9
          || Math.hypot(tp.p.x - prev.p.x, tp.p.y - prev.p.y) > 1e-6;
      });
    }
  }

  return { cells, ridges, tMax: tNow };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/straightSkeleton.test.ts`
Expected: 4 passing. If the rectangle test fails on which cells died, check winding assumptions first (the test polygon is CW in screen coords).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` (only the Lab.tsx:173 baseline error allowed).

```bash
git add src/straightSkeleton.ts src/straightSkeleton.test.ts
git commit -m "feat(speech-balloons): straight skeleton via wavefront edge-collapse"
```

---

### Task 2: `src/bevelRegions.ts` — rim simplification

**Files:**
- Create: `src/bevelRegions.ts`
- Test: `src/bevelRegions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/bevelRegions.test.ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: FAIL — cannot resolve `./bevelRegions`.

- [ ] **Step 3: Implement `simplifyRim`**

```ts
// src/bevelRegions.ts
//
// Region construction for the analytic lit-bevel renderer. The rim polyline is
// first simplified by turning-angle tolerance (dense sampler output → a
// moderate vertex count; "corner fans" emerge as runs of short edges whose
// azimuths step by ≤ cornerStep). The straight skeleton of the simplified rim
// then yields one cell per edge, which is cut at the bevel seam into a band
// strip and (optionally) a roof panel.
import type { Point, Polygon } from './clipping';
import { computeStraightSkeleton, type TrajPoint } from './straightSkeleton';

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Merge runs of edges whose cumulative turning stays under cornerStepDeg.
// Anchored at the sharpest corner so hard corners are never smoothed away.
export function simplifyRim(poly: Polygon, cornerStepDeg: number): Polygon {
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  const n = pts.length;
  if (n <= 4) return pts;
  const tol = (Math.max(1, cornerStepDeg) * Math.PI) / 180;
  const heading = (i: number) => {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const turnAt = (i: number) => Math.abs(angleDiff(heading(i), heading((i - 1 + n) % n)));

  let start = 0, sharpest = -1;
  for (let i = 0; i < n; i++) {
    const t = turnAt(i);
    if (t > sharpest) { sharpest = t; start = i; }
  }
  const kept: Point[] = [pts[start]!];
  let acc = 0;
  for (let k = 1; k < n; k++) {
    const i = (start + k) % n;
    acc += turnAt(i);
    if (acc >= tol) { kept.push(pts[i]!); acc = 0; }
  }
  return kept.length >= 3 ? kept : pts;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/bevelRegions.ts src/bevelRegions.test.ts
git commit -m "feat(speech-balloons): simplifyRim turning-angle rim reduction"
```

---

### Task 3: `src/bevelRegions.ts` — `buildRegions`

**Files:**
- Modify: `src/bevelRegions.ts`
- Test: `src/bevelRegions.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/bevelRegions.test.ts`:

```ts
import { buildRegions } from './bevelRegions';

const rect200x100: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
];

function area(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

describe('buildRegions', () => {
  const opts = { rim: rect200x100, bevelWidthPx: 20, interior: 'roof-panels' as const, cornerStepDeg: 12 };

  it('rectangle, roof-panels: 4 strips + 4 panels that tile the body', () => {
    const { regions, tMax } = buildRegions(opts);
    expect(tMax).toBeCloseTo(50, 3);
    const strips = regions.filter((r) => r.kind === 'strip');
    const panels = regions.filter((r) => r.kind === 'panel');
    expect(strips).toHaveLength(4);
    expect(panels).toHaveLength(4);
    const total = regions.reduce((s, r) => s + area(r.outline), 0);
    expect(total).toBeCloseTo(200 * 100, -1); // within ~5 px²
  });

  it('x-ranges: strips span [0, x_b], panels start at x_b and end ≤ 1', () => {
    const { regions, tMax } = buildRegions(opts);
    const xb = 20 / tMax;
    for (const r of regions) {
      if (r.kind === 'strip') {
        expect(r.x0).toBe(0);
        expect(r.x1).toBeCloseTo(xb, 6);
      } else if (r.kind === 'panel') {
        expect(r.x0).toBeCloseTo(xb, 6);
        expect(r.x1).toBeGreaterThan(r.x0);
        expect(r.x1).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('dome-blob: strips + one radial blob region', () => {
    const { regions } = buildRegions({ ...opts, interior: 'dome-blob' });
    const blobs = regions.filter((r) => r.kind === 'blob');
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.frame.kind).toBe('radial');
  });

  it('flat: strips + one solid region', () => {
    const { regions } = buildRegions({ ...opts, interior: 'flat' });
    const flats = regions.filter((r) => r.kind === 'flat');
    expect(flats).toHaveLength(1);
    expect(flats[0]!.frame.kind).toBe('solid');
    expect(flats[0]!.x0).toBe(1);
  });

  it('bevelWidth past total collapse: strips only, capped at the ridge', () => {
    const { regions } = buildRegions({ ...opts, bevelWidthPx: 500 });
    expect(regions.every((r) => r.kind === 'strip')).toBe(true);
  });

  it('strip gradient frame runs inward from the rim edge midpoint', () => {
    const { regions } = buildRegions(opts);
    const top = regions.find((r) => r.kind === 'strip' && r.outline[0]!.y === 0)!;
    expect(top.frame.kind).toBe('linear');
    if (top.frame.kind === 'linear') {
      expect(top.frame.to.y).toBeGreaterThan(top.frame.from.y); // inward = +y for the top edge
    }
  });
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: FAIL — `buildRegions` is not exported.

- [ ] **Step 3: Implement `buildRegions`**

Append to `src/bevelRegions.ts`:

```ts
export type InteriorTreatment = 'roof-panels' | 'dome-blob' | 'flat';

export type GradientFrame =
  | { kind: 'linear'; from: Point; to: Point }   // from = x0 end, to = x1 end
  | { kind: 'radial'; center: Point; radius: number }
  | { kind: 'solid' };

export interface Region {
  kind: 'strip' | 'panel' | 'blob' | 'flat';
  outline: Polygon;
  azimuthDeg: number;  // outward-normal azimuth of the owning rim edge
  x0: number;          // contour-x at gradient offset 0
  x1: number;          // contour-x at gradient offset 1
  frame: GradientFrame;
}

export interface BuildRegionsResult {
  regions: Region[];
  tMax: number;                    // skeleton collapse inset == the dMax for x-normalization
  ridges: Array<[Point, Point]>;   // for debug overlays
}

// Boundary points with t ≤ tCut, plus an interpolated point exactly at tCut.
function cutTraj(traj: TrajPoint[], tCut: number): TrajPoint[] {
  const out: TrajPoint[] = [];
  for (let i = 0; i < traj.length; i++) {
    const tp = traj[i]!;
    if (tp.t <= tCut + 1e-9) { out.push(tp); continue; }
    const prev = traj[i - 1]!;
    const u = (tCut - prev.t) / (tp.t - prev.t);
    out.push({
      t: tCut,
      p: { x: prev.p.x + (tp.p.x - prev.p.x) * u, y: prev.p.y + (tp.p.y - prev.p.y) * u },
    });
    break;
  }
  return out;
}

function rangeTraj(traj: TrajPoint[], t0: number, t1: number): TrajPoint[] {
  const upper = cutTraj(traj, t1);
  const head = cutTraj(traj, t0);
  const start = head[head.length - 1]!;
  return [start, ...upper.filter((tp) => tp.t > t0 + 1e-9)];
}

// left ascending then right descending: closes along the rim edge (or seam).
const ring = (left: TrajPoint[], right: TrajPoint[]): Polygon =>
  [...left.map((tp) => tp.p), ...right.map((tp) => tp.p).reverse()];

export function buildRegions(opts: {
  rim: Polygon;
  bevelWidthPx: number;
  interior: InteriorTreatment;
  cornerStepDeg: number;
}): BuildRegionsResult {
  const rim = simplifyRim(opts.rim, opts.cornerStepDeg);
  const skel = computeStraightSkeleton(rim);
  const tMax = Math.max(skel.tMax, 1e-6);
  const b = Math.min(Math.max(opts.bevelWidthPx, 0.5), tMax * 0.999);
  const xb = b / tMax;
  const regions: Region[] = [];
  const innerRing: Point[] = [];

  for (const cell of skel.cells) {
    if (cell.left.length < 2 || cell.right.length < 2) continue; // degenerate
    const stripEnd = Math.min(b, cell.tDeath);
    const leftCut = cutTraj(cell.left, stripEnd);
    const rightCut = cutTraj(cell.right, stripEnd);
    const outline = ring(leftCut, rightCut);
    if (outline.length < 3) continue;
    const a = leftCut[0]!.p, c = rightCut[0]!.p;
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const azimuthDeg = (Math.atan2(-cell.n.y, -cell.n.x) * 180) / Math.PI;
    regions.push({
      kind: 'strip', outline, azimuthDeg,
      x0: 0, x1: stripEnd / tMax,
      frame: {
        kind: 'linear', from: mid,
        to: { x: mid.x + cell.n.x * stripEnd, y: mid.y + cell.n.y * stripEnd },
      },
    });
    innerRing.push(leftCut[leftCut.length - 1]!.p);

    // Sliver guard: a panel shallower than half a pixel is the capped-b case
    // (bevelWidth ≥ total collapse) — render it as strip-only.
    if (opts.interior === 'roof-panels' && cell.tDeath > b + 0.5) {
      const leftHi = rangeTraj(cell.left, b, cell.tDeath);
      const rightHi = rangeTraj(cell.right, b, cell.tDeath);
      const panelOutline = ring(leftHi, rightHi);
      if (panelOutline.length >= 3) {
        const seamMid = {
          x: (leftHi[0]!.p.x + rightHi[0]!.p.x) / 2,
          y: (leftHi[0]!.p.y + rightHi[0]!.p.y) / 2,
        };
        const depth = cell.tDeath - b;
        regions.push({
          kind: 'panel', outline: panelOutline, azimuthDeg,
          x0: xb, x1: cell.tDeath / tMax,
          frame: {
            kind: 'linear', from: seamMid,
            to: { x: seamMid.x + cell.n.x * depth, y: seamMid.y + cell.n.y * depth },
          },
        });
      }
    }
  }

  if (innerRing.length >= 3 && opts.interior !== 'roof-panels' && b < tMax * 0.99) {
    const cx = innerRing.reduce((s, p) => s + p.x, 0) / innerRing.length;
    const cy = innerRing.reduce((s, p) => s + p.y, 0) / innerRing.length;
    if (opts.interior === 'dome-blob') {
      regions.push({
        kind: 'blob', outline: innerRing, azimuthDeg: 0,
        x0: 1, x1: xb, // radial: offset 0 at center (x=1) → offset 1 at seam (x_b)
        frame: { kind: 'radial', center: { x: cx, y: cy }, radius: tMax - b },
      });
    } else {
      regions.push({
        kind: 'flat', outline: innerRing, azimuthDeg: 0,
        x0: 1, x1: 1, frame: { kind: 'solid' },
      });
    }
  }

  return { regions, tMax, ridges: skel.ridges };
}
```

Note the blob's x-range runs `x0: 1 → x1: xb` — a radial gradient's offset 0 is the *center* (the contour top, x=1) and offset 1 is the seam.

- [ ] **Step 4: Run the full file, verify green**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/bevelRegions.ts src/bevelRegions.test.ts
git commit -m "feat(speech-balloons): buildRegions strips/panels/blob/flat from skeleton cells"
```

---

### Task 4: `src/litBevelShading.ts` — merged-stop computation

**Files:**
- Create: `src/litBevelShading.ts`
- Test: `src/litBevelShading.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/litBevelShading.test.ts
import { describe, it, expect } from 'vitest';
import { computeStops, hexToLinear, linearToHex } from './litBevelShading';
import type { Region } from './bevelRegions';
import type { LitBevelLight, LitBevelMaterial } from './litBevelShading';

const stripAt = (azimuthDeg: number, x0 = 0, x1 = 0.4): Region => ({
  kind: 'strip',
  outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  azimuthDeg, x0, x1,
  frame: { kind: 'linear', from: { x: 5, y: 0 }, to: { x: 5, y: 10 } },
});

const panelAt = (azimuthDeg: number, x0 = 0.4, x1 = 1): Region =>
  ({ ...stripAt(azimuthDeg, x0, x1), kind: 'panel' });

// default contour [0,0, 0.5,0.8, 1,1] as a ContourFn (piecewise linear)
const rampContour = (x: number) => (x <= 0.5 ? (x / 0.5) * 0.8 : 0.8 + ((x - 0.5) / 0.5) * 0.2);
const flatContour = (_x: number) => 1;

const white = (az: number, el: number, intensity = 1): LitBevelLight =>
  ({ az, el, intensity, color: '#ffffff' });

const mat = (over: Partial<LitBevelMaterial> = {}): LitBevelMaterial => ({
  base: '#ffffff', heightPx: 20, dMaxPx: 50,
  diffuse: 1, specular: 0, shininess: 30,
  specularColor: '#ffffff', ambient: 0,
  ...over,
});

function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('hex/linear round trip', () => {
  it('round-trips primaries', () => {
    for (const h of ['#000000', '#ffffff', '#4a90d9', '#808080']) {
      expect(linearToHex(hexToLinear(h))).toBe(h);
    }
  });
});

describe('computeStops', () => {
  it('flat contour: intensity is exactly sin(elevation), azimuth-independent', () => {
    const lights = [white(270, 30)];
    const a = computeStops(stripAt(0), lights, flatContour, mat());
    const b = computeStops(stripAt(137), lights, flatContour, mat());
    const expected = linearToHex([0.5, 0.5, 0.5]); // sin 30° = 0.5 on white albedo
    for (const stops of [a, b]) {
      for (const s of stops) expect(s.color).toBe(expected);
    }
  });

  it('excluding all lights and specular leaves exactly ambient × albedo', () => {
    const lights = [white(270, 55), white(90, 25, 0.35)];
    const m = mat({ base: '#4a90d9', ambient: 0.25, specular: 0.6 });
    const stops = computeStops(stripAt(0), lights, rampContour, m,
      new Set(['light-0', 'light-1', 'specular']));
    const albedo = hexToLinear('#4a90d9');
    const expected = linearToHex([albedo[0] * 0.25, albedo[1] * 0.25, albedo[2] * 0.25]);
    for (const s of stops) expect(s.color).toBe(expected);
  });

  it('strip↔panel continuity: shared-boundary colors are identical', () => {
    const lights = [white(270, 55), white(90, 25, 0.35)];
    const m = mat({ base: '#4a90d9', ambient: 0.2, specular: 0.6 });
    const strip = computeStops(stripAt(200, 0, 0.4), lights, rampContour, m);
    const panel = computeStops(panelAt(200, 0.4, 1), lights, rampContour, m);
    expect(strip[strip.length - 1]!.color).toBe(panel[0]!.color);
  });

  it('adding a light never darkens any stop', () => {
    const one = computeStops(stripAt(45), [white(270, 55)], rampContour, mat());
    const two = computeStops(stripAt(45), [white(270, 55), white(90, 25, 0.35)], rampContour, mat());
    for (let i = 0; i < one.length; i++) {
      expect(luminance(two[i]!.color)).toBeGreaterThanOrEqual(luminance(one[i]!.color) - 1e-9);
    }
  });

  it('excluding specular never brightens any stop', () => {
    const m = mat({ specular: 1, base: '#4a90d9', ambient: 0.2 });
    const withSpec = computeStops(stripAt(270), [white(270, 55)], rampContour, m);
    const noSpec = computeStops(stripAt(270), [white(270, 55)], rampContour, m, new Set(['specular']));
    for (let i = 0; i < withSpec.length; i++) {
      expect(luminance(noSpec[i]!.color)).toBeLessThanOrEqual(luminance(withSpec[i]!.color) + 1e-9);
    }
  });

  it('solid frame yields two identical stops', () => {
    const flat: Region = {
      kind: 'flat', outline: [], azimuthDeg: 0, x0: 1, x1: 1, frame: { kind: 'solid' },
    };
    const stops = computeStops(flat, [white(270, 55)], rampContour, mat());
    expect(stops).toHaveLength(2);
    expect(stops[0]!.color).toBe(stops[1]!.color);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/litBevelShading.test.ts`
Expected: FAIL — cannot resolve `./litBevelShading`.

- [ ] **Step 3: Implement the shading module**

```ts
// src/litBevelShading.ts
//
// Merged-stop shading for the analytic lit-bevel renderer. Each region's
// gradient stops carry the FINAL color: albedo ⊗ (ambient + Σ diffuse) + Σ
// specular, accumulated in linear RGB and emitted as sRGB hex. Lights are
// summed here rather than layered as translucent SVG paths because browser
// compositing happens in sRGB — summing in linear is the physically correct
// path (spec: 2026-06-09-analytic-lit-bevel-design.md).
import type { Region } from './bevelRegions';

export type ContourFn = (x: number) => number;

export interface LitBevelLight {
  az: number;        // degrees
  el: number;        // degrees
  intensity: number;
  color: string;     // hex
}

export interface LitBevelMaterial {
  base: string;          // albedo hex
  heightPx: number;      // contour height amplitude ("Bevel height")
  dMaxPx: number;        // lateral scale: x=1 spans dMaxPx pixels
  diffuse: number;       // diffuse gain
  specular: number;      // specular strength
  shininess: number;     // specular exponent
  specularColor: string;
  ambient: number;       // floor, 0..1
}

// Terms the shading panel can exclude. light-N indexes the lights array.
export type LitBevelTerm = 'ambient' | 'specular' | `light-${number}`;

export interface Stop { offset: number; color: string }

const srgbToLin = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [srgbToLin(v(0)), srgbToLin(v(2)), srgbToLin(v(4))];
}

export function linearToHex(rgb: readonly [number, number, number]): string {
  const ch = (c: number) =>
    Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255)
      .toString(16).padStart(2, '0');
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`;
}

function lightDir(azDeg: number, elDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el)];
}

// Contour slope dh/dx, clamped ≥ 0 to mirror contourTilt's plateau treatment.
function contourSlope(contour: ContourFn, x: number, eps = 0.01): number {
  const hi = Math.min(1, x + eps);
  const lo = Math.max(0, x - eps);
  if (hi <= lo) return 0;
  return Math.max(0, (contour(hi) - contour(lo)) / (hi - lo));
}

function shadeAt(
  x: number,
  region: Region,
  lights: LitBevelLight[],
  contour: ContourFn,
  m: LitBevelMaterial,
  exclude: ReadonlySet<LitBevelTerm>,
): [number, number, number] {
  const s = (contourSlope(contour, x) * m.heightPx) / m.dMaxPx;
  const albedo = hexToLinear(m.base);
  const specTint = hexToLinear(m.specularColor);
  const inv = 1 / Math.hypot(s, 1);
  let dr = 0, dg = 0, db = 0;
  let sr = 0, sg = 0, sb = 0;

  for (let i = 0; i < lights.length; i++) {
    if (exclude.has(`light-${i}`)) continue;
    const light = lights[i]!;
    const L = lightDir(light.az, light.el);
    // Surface normal tilts toward the outward direction m̂ by slope s. For
    // strips/panels m̂ is the region azimuth; the blob is the symmetric fake
    // mode — each light sees the max angular response (m̂ aligned with L_xy).
    const mDotL = region.kind === 'blob'
      ? Math.hypot(L[0], L[1])
      : L[0] * Math.cos((region.azimuthDeg * Math.PI) / 180)
        + L[1] * Math.sin((region.azimuthDeg * Math.PI) / 180);
    const ndl = Math.max(0, (s * mDotL + L[2]) * inv);
    const lc = hexToLinear(light.color);
    const k = light.intensity * m.diffuse * ndl;
    dr += lc[0] * k; dg += lc[1] * k; db += lc[2] * k;

    if (!exclude.has('specular') && m.specular > 0) {
      // Half vector with the viewer straight overhead.
      const hLen = Math.hypot(L[0], L[1], L[2] + 1);
      const ndh = Math.max(0, (s * mDotL + L[2] + 1) / hLen * inv);
      const ks = light.intensity * m.specular * Math.pow(ndh, m.shininess);
      sr += lc[0] * specTint[0] * ks;
      sg += lc[1] * specTint[1] * ks;
      sb += lc[2] * specTint[2] * ks;
    }
  }

  const amb = exclude.has('ambient') ? 0 : m.ambient;
  return [
    Math.min(1, albedo[0] * (amb + dr) + sr),
    Math.min(1, albedo[1] * (amb + dg) + sg),
    Math.min(1, albedo[2] * (amb + db) + sb),
  ];
}

export function computeStops(
  region: Region,
  lights: LitBevelLight[],
  contour: ContourFn,
  material: LitBevelMaterial,
  exclude: ReadonlySet<LitBevelTerm> = new Set(),
  samples = 17,
): Stop[] {
  if (region.frame.kind === 'solid') {
    const color = linearToHex(shadeAt(region.x1, region, lights, contour, material, exclude));
    return [{ offset: 0, color }, { offset: 1, color }];
  }
  const stops: Stop[] = [];
  for (let k = 0; k < samples; k++) {
    const u = k / (samples - 1);
    const x = region.x0 + (region.x1 - region.x0) * u;
    stops.push({
      offset: u,
      color: linearToHex(shadeAt(x, region, lights, contour, material, exclude)),
    });
  }
  return stops;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/litBevelShading.test.ts`
Expected: 7 passing. The flat-contour test is the canary: if it fails, check `contourSlope` (a flat contour must give slope 0 → N = ẑ → N·L = sin el exactly).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/litBevelShading.ts src/litBevelShading.test.ts
git commit -m "feat(speech-balloons): litBevelShading merged linear-light stops with exclude set"
```

---

### Task 5: types + controls

**Files:**
- Modify: `src/types.ts` (remove `HeightmapSource`, extend `ShadingGroup`)
- Modify: `src/controls.ts` (swap the lit-bevel control block)

- [ ] **Step 1: Update `src/types.ts`**

Remove the line:

```ts
export type HeightmapSource = 'bevel-blur' | 'bevel-rings' | 'bevel-dt';
```

Extend `ShadingGroup` with a group for lit-bevel light terms (NOT added to `NON_LIGHT_GROUPS` in `shadingLayers.ts` — these rows ARE light contributors):

```ts
export type ShadingGroup =
  | 'body'       // base body fill
  | 'dome'       // per-light dome wedges (dome mode)
  | 'brdf'       // Lambertian / specular / rim/Fresnel (BRDF mode)
  | 'aqua'       // aqua-mode body gradient + gloss
  | 'bevel'      // bevel inset path / lit-bevel surface regions
  | 'lit-bevel'; // lit-bevel light terms (ambient / per-light / specular)
```

- [ ] **Step 2: Update `src/controls.ts`**

Delete the heightmap block (the `'Lit bevel — heightmap'` header and the `heightmapSource`, `blur`, `rings`, `smoothing`, `dtResolution` entries, currently lines 65–72) and the stale comment above it referencing the SVG-filter implementation. Replace the `'Lit bevel — material'` block so the whole lit-bevel section reads:

```ts
    // lit-bevel: analytic region renderer. The rim polyline is decomposed
    // into band strips / corner fans / interior panels (straight skeleton);
    // each region is one gradient path whose stops carry the final summed
    // linear-light color. Shares bevelWidth / lightAzimuth / lightElevation /
    // contour with the other modes.
    { kind: 'header', label: 'Lit bevel — material', hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'surfaceScale', label: 'Bevel height', kind: 'range', min: 0, max: 100, step: 0.5, default: 20, hideWhen: (p) => p.mode !== 'lit-bevel', unit: 'px' },
    { key: 'ambient', label: 'Ambient', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.25, hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'diffuse', label: 'Diffuse', kind: 'range', min: 0, max: 2, step: 0.02, default: 1.0, hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'specular', label: 'Specular', kind: 'range', min: 0, max: 2, step: 0.02, default: 0.6, hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'shininess', label: 'Shininess', kind: 'range', min: 1, max: 128, step: 1, default: 30, hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'lightColor', label: 'Key light color', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'specularColor', label: 'Specular color', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode !== 'lit-bevel' },

    { kind: 'header', label: 'Lit bevel — interior', hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'interiorTreatment', label: 'Interior', kind: 'select',
      options: ['roof-panels', 'dome-blob', 'flat'],
      default: 'roof-panels', hideWhen: (p) => p.mode !== 'lit-bevel' },
    { key: 'cornerStep', label: 'Corner step', kind: 'range', min: 4, max: 30, step: 1, default: 12, hideWhen: (p) => p.mode !== 'lit-bevel', unit: '°' },
```

Match the existing descriptor shape exactly — if the file's entries carry other required fields, mirror a neighboring entry. `surfaceScale` keeps its key (saved workspaces keep working; old value 8 just reads as a low bevel) but is relabeled with px units and a new default of 20.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `SpeechBalloon.tsx` where `HeightmapSource` and the removed `fillRender` keys are still referenced (fixed in Task 6), plus the Lab.tsx baseline. If `controls.ts` itself errors, fix the descriptor shape before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/controls.ts src/shadingLayers.ts
git commit -m "feat(speech-balloons): lit-bevel analytic controls; drop heightmap controls"
```

(`shadingLayers.ts` only if the `ShadingGroup` change required touching it.)

---

### Task 6: `SpeechBalloon.tsx` integration

**Files:**
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Update imports and `fillRender`**

Add imports:

```ts
import { buildRegions, type InteriorTreatment, type Region } from './bevelRegions';
import { computeStops, type LitBevelTerm } from './litBevelShading';
```

Remove `HeightmapSource` from the `./types` import. In the `fillRender` memo, delete the `rawHm`/`heightmapSource` resolution and the `heightmapSource`, `blur`, `rings`, `smoothing`, `dtResolution` keys; add:

```ts
      interiorTreatment: ((p.interiorTreatment as string) === 'dome-blob' ? 'dome-blob'
        : (p.interiorTreatment as string) === 'flat' ? 'flat'
        : 'roof-panels') as InteriorTreatment,
      ambient: (p.ambient as number) ?? 0.25,
      cornerStep: (p.cornerStep as number) ?? 12,
```

and change the `surfaceScale` default from `8` to `20`.

- [ ] **Step 2: Delete the filter-era code**

- Delete the `litBevelRingPaths` memo (the block starting with the comment `// Nested inset polygons for the lit-bevel \`bevel-rings\` heightmap.`).
- Delete the entire render block starting `{fillRender.mode === 'lit-bevel' && (() => {` (the one whose comment says "Lit-bevel: SVG filter chain") through its closing `})()}` — it ends just before the `{/* Outline last so it sits on top of the lit fill. */}` comment.

- [ ] **Step 3: Add the analytic memo**

Place after the `domeLights` memo (both `domeLights` and `contour` must already be defined):

```tsx
  // Analytic lit-bevel: light-independent regions, merged linear-light stops.
  // Terms hidden in the shading panel are excluded by recomputing stops (the
  // CSS display:none mechanism can't subtract a term from a summed gradient).
  const litBevel = useMemo(() => {
    if (fillRender.mode !== 'lit-bevel') return null;
    const hidden = new Set(runtime.hiddenShadingIds ?? []);
    const exclude = new Set<LitBevelTerm>();
    if (hidden.has('lit-bevel.ambient')) exclude.add('ambient');
    if (hidden.has('lit-bevel.specular')) exclude.add('specular');
    domeLights.forEach((_, i) => {
      if (hidden.has(`lit-bevel.light-${i}`)) exclude.add(`light-${i}`);
    });
    const lights = domeLights.map((l, i) => ({
      az: l.az, el: l.el, intensity: l.intensity,
      color: i === 0 ? fillRender.lightColor : '#ffffff',
    }));
    const entries: Array<{ gradientId: string; region: Region; stops: { offset: number; color: string }[] }> = [];
    bodyAndBubblesPolys.forEach((poly, pi) => {
      const { regions, tMax } = buildRegions({
        rim: poly,
        bevelWidthPx: fillRender.bevelWidth,
        interior: fillRender.interiorTreatment,
        cornerStepDeg: fillRender.cornerStep,
      });
      const material = {
        base: fillRender.base,
        heightPx: fillRender.surfaceScale,
        dMaxPx: tMax,
        diffuse: fillRender.diffuse,
        specular: fillRender.specular,
        shininess: fillRender.shininess,
        specularColor: fillRender.specularColor,
        ambient: fillRender.ambient,
      };
      regions.forEach((region, ri) => {
        entries.push({
          gradientId: `${idPrefix}-lb-${pi}-${ri}`,
          region,
          stops: computeStops(region, lights, contour, material, exclude),
        });
      });
    });
    return { entries, lightCount: domeLights.length };
  }, [fillRender, bodyAndBubblesPolys, domeLights, contour, runtime.hiddenShadingIds, idPrefix]);
```

- [ ] **Step 4: Add the render block**

Where the old filter block was:

```tsx
        {fillRender.mode === 'lit-bevel' && litBevel && (
          <>
            <defs>
              <clipPath id={`${idPrefix}-lb-clip`}>
                <path d={bodyPath} />
              </clipPath>
              {litBevel.entries.map(({ gradientId, region, stops }) =>
                region.frame.kind === 'linear' ? (
                  <linearGradient
                    key={gradientId} id={gradientId} gradientUnits="userSpaceOnUse"
                    x1={region.frame.from.x} y1={region.frame.from.y}
                    x2={region.frame.to.x} y2={region.frame.to.y}
                  >
                    {stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
                  </linearGradient>
                ) : region.frame.kind === 'radial' ? (
                  <radialGradient
                    key={gradientId} id={gradientId} gradientUnits="userSpaceOnUse"
                    cx={region.frame.center.x} cy={region.frame.center.y}
                    r={Math.max(1, region.frame.radius)}
                  >
                    {stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
                  </radialGradient>
                ) : null
              )}
            </defs>
            {/* Term rows for the shading panel. Empty groups: hiding one adds
                its id to hiddenShadingIds, which the litBevel memo turns into
                an exclude term — the gradients recompute rather than vanish. */}
            <g data-shading-id={pushShading({ id: 'lit-bevel.ambient', label: 'Ambient', group: 'lit-bevel' })} />
            {Array.from({ length: litBevel.lightCount }, (_, i) => (
              <g
                key={i}
                data-shading-id={pushShading({
                  id: `lit-bevel.light-${i}`,
                  label: i === 0 ? 'Key light' : 'Fill light',
                  group: 'lit-bevel',
                })}
              />
            ))}
            <g data-shading-id={pushShading({ id: 'lit-bevel.specular', label: 'Specular', group: 'lit-bevel' })} />
            <g clipPath={`url(#${idPrefix}-lb-clip)`}>
              {(['strip', 'interior'] as const).map((bucket) => (
                <g
                  key={bucket}
                  data-shading-id={pushShading({
                    id: bucket === 'strip' ? 'lit-bevel.band' : 'lit-bevel.interior',
                    label: bucket === 'strip' ? 'Bevel band' : 'Interior',
                    group: 'bevel',
                  })}
                  className={pulseIf(bucket === 'strip' ? 'lit-bevel.band' : 'lit-bevel.interior')}
                >
                  {litBevel.entries
                    .filter(({ region }) =>
                      bucket === 'strip' ? region.kind === 'strip' : region.kind !== 'strip')
                    .map(({ gradientId, region, stops }) => {
                      const fill = region.frame.kind === 'solid'
                        ? stops[0]!.color
                        : `url(#${gradientId})`;
                      return (
                        <path
                          key={gradientId}
                          d={polygonsToSvgPath([region.outline])}
                          fill={fill}
                          /* 1px same-paint stroke kills antialiasing hairlines
                             where regions abut; boundary stops match exactly
                             (litBevelShading continuity test) so the overlap
                             is invisible. */
                          stroke={fill}
                          strokeWidth={1}
                          strokeLinejoin="round"
                        />
                      );
                    })}
                </g>
              ))}
            </g>
          </>
        )}
```

- [ ] **Step 5: Type-check and full test run**

Run: `npx tsc --noEmit` — only the Lab.tsx:173 baseline error.
Run: `npx vitest run` — everything green (71 pre-existing + the new suites).

- [ ] **Step 6: Commit**

```bash
git add src/SpeechBalloon.tsx src/types.ts
git commit -m "feat(speech-balloons): analytic lit-bevel renderer replaces SVG filter chain"
```

---

### Task 7: Browser verification

**Files:** none (verification only; fixes get their own commits)

Dev server: reuse the running one (`npm run dev`, http://localhost:5180) or start it with `run_in_background`. Use headless Playwright — do not steal focus.

- [ ] **Step 1: Smoke** — open the lab, switch mode to `lit-bevel` on a rounded rectangle. Expect: lit band + interior visible, no console errors, no filter elements in the DOM (`document.querySelector('feDiffuseLighting')` is null).
- [ ] **Step 2: Azimuth sweep** — set azimuth to 0/90/180/270, screenshot each. The bright rim band must rotate continuously; check a 45° setting for popping at fan boundaries.
- [ ] **Step 3: Elevation** — at 85° the surface flattens toward uniform; at 15° the band contrast is strong.
- [ ] **Step 4: Contour + partition** — drag the contour and the partition handle; band profile and seam crease must track live.
- [ ] **Step 5: Interior treatments** — cycle `roof-panels` / `dome-blob` / `flat`. Ridges visible only for roof-panels. Set a flat interior contour (drag the spline-side anchors level): `flat` and `roof-panels` should then look near-identical.
- [ ] **Step 6: Other bodies** — spiky burst and lightning: alternating lit/dark facets, nothing exploding (degraded-but-stable is the bar for concave joins).
- [ ] **Step 7: DOM sanity** — `document.querySelectorAll('[data-shading-id="lit-bevel.band"] path, [data-shading-id="lit-bevel.interior"] path').length` ≈ 30–50 for a rounded rect.
- [ ] **Step 8: Shading panel** — rows appear (Ambient, Key light, Fill light, Specular, Bevel band, Interior); hiding Key light visibly darkens the lit side (recompute, not CSS); hiding Bevel band hides the band paths (CSS); "Hide non-light surfaces" hides the band/interior rows but keeps the term rows.
- [ ] **Step 9: A/B** — screenshot `dome` vs `lit-bevel` same settings; save comparison screenshots into `screenshots-clean/`.
- [ ] **Step 10: Update `HANDOFF.md`** — replace the lit-bevel filter description with a pointer to the new spec/plan and the verification status, then commit:

```bash
git add HANDOFF.md screenshots-clean/
git commit -m "docs(speech-balloons): handoff + screenshots for analytic lit-bevel"
```

---

## Self-review notes

- Spec coverage: geometry/regions (Tasks 1–3), shading/compositing incl. exclude set (Task 4), controls/params incl. removals and relabel (Task 5), renderer swap + shading-panel rows + seam-hiding stroke (Task 6), browser checklist incl. A/B and DOM sanity (Task 7). The spec's "ridges in the dome debug overlay" is not required (overlay integration listed under debug, `buildRegions` already returns `ridges` for a later pass).
- The blob's light-direction center offset from the spec is intentionally simplified to a centered radial gradient in v1 (the blob is the fake mode; asymmetry still comes from stop colors via the max-response m̂). Flagged here so it's a decision, not an accident.
- Type consistency: `Region`/`GradientFrame`/`BuildRegionsResult` (Task 3) match usage in Task 6; `LitBevelTerm`/`computeStops` signature (Task 4) match the memo; `ShadingGroup` gains `'lit-bevel'` (Task 5) before Task 6 uses it.
