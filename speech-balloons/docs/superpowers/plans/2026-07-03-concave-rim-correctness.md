# Concave-Rim Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the analytic lit-bevel renderer mathematically correct for any simple polygon by adding split events to the straight skeleton, so tails, lightning notches, and other concave silhouettes shade like real beveled solids.

**Architecture:** Rewrite `src/straightSkeleton.ts` as a SLAV wavefront (Felkel–Obdržálek: edge events + split events) that emits *arcs* (vertex-lifetime segments) and reconstructs one face per input edge by chaining arcs. `src/bevelRegions.ts` stops cutting two trajectory chains and instead clips each face outline against the iso-`t = bevelWidth` line; interior islands come from a clipper union of the per-face above-pieces. The old edge-collapse-only algorithm stays in the file as a degraded-but-stable fallback. `Region[]` output shape is unchanged, so `SpeechBalloon.tsx` and `litBevelShading.ts` need no code changes.

**Tech Stack:** TypeScript, vitest, clipper2-ts (already a dependency — used as the island extractor and as a cross-validation oracle in tests).

**Spec:** `docs/superpowers/specs/2026-07-03-concave-rim-correctness-design.md`

---

## File map

- Modify: `src/straightSkeleton.ts` — full rewrite (SLAV + arcs + face chaining + naive fallback)
- Modify: `src/straightSkeleton.test.ts` — migrate to the face interface; add concave suites
- Modify: `src/bevelRegions.ts` — face clipping, per-island interiors
- Modify: `src/bevelRegions.test.ts` — keep existing suites green; add island/oracle tests
- Verify only (no code change expected): `src/SpeechBalloon.tsx`, `src/litBevelShading.ts`
- Modify: `HANDOFF.md` — final status update

Conventions used throughout:

- `FacePoint = { t, p }` — a boundary point with its inset value.
- Face outline convention: `outline[0]` = rim-edge start vertex, `outline[1]` = rim-edge end vertex (both `t = 0`); the rest walks the skeleton boundary from the end vertex back to the start. The ring closes implicitly.
- Within a face, `t` at any point equals the perpendicular distance to the face's supporting edge line, so `t` is affine over the face and linear along each boundary segment — iso-`t` cuts are straight lines and linear interpolation is exact.

---

### Task 1: Face interface + naive adapter

Migrate the public skeleton interface from two-chain `SkeletonCell`s to `SkeletonFace` outlines *without* touching the algorithm yet. The old algorithm becomes `naiveCells` (private); a converter produces faces from cells. All existing behavior is preserved; only the shape of the result changes.

**Files:**
- Modify: `src/straightSkeleton.ts`
- Modify: `src/straightSkeleton.test.ts`
- Modify: `src/bevelRegions.ts` (imports + region construction)

- [ ] **Step 1: Rewrite `src/straightSkeleton.test.ts` against the face interface**

Replace the whole file with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/straightSkeleton.test.ts`
Expected: FAIL — `skel.faces` is undefined (current interface exposes `cells`).

- [ ] **Step 3: Convert `src/straightSkeleton.ts` to emit faces**

Keep the entire existing algorithm body but rename the exported entry point to a private `naiveCells`, and add the new public types + converter. The file becomes:

1. Replace the exported interfaces at the top (`TrajPoint`, `SkeletonCell`, `Skeleton`) with:

```ts
export interface FacePoint { t: number; p: Point }

/** @deprecated Task-1 bridge for bevelRegions' chain cutters; deleted in Task 2. */
export type TrajPoint = FacePoint;

export interface SkeletonFace {
  edgeIndex: number;    // input edge (vertex i → i+1) that sweeps this face
  n: Point;             // unit inward normal of that edge
  outline: FacePoint[]; // closed ring; [0] = edge start, [1] = edge end (both t=0)
  tDeath: number;       // max inset on the face
}

export interface Skeleton {
  faces: SkeletonFace[];
  ridges: Array<[Point, Point]>;   // bisector segments, for debug overlays
  tMax: number;                    // inset at which the wavefront fully collapsed
  method: 'slav' | 'naive';        // diagnostic: which engine produced this
}

// Internal to the naive engine (and its converter).
interface SkeletonCell {
  edgeIndex: number;
  n: Point;
  left: TrajPoint[];
  right: TrajPoint[];
  tDeath: number;
}
```

(`method` is `'naive'` for now; the SLAV engine lands in Task 3.)

2. Rename the current `export function computeStraightSkeleton(poly: Polygon): Skeleton` to `function naiveCells(pts: Point[]): { cells: SkeletonCell[]; ridges: Array<[Point, Point]>; tMax: number }` and delete its internal `rawPts`/`pts` pre-filtering (it moves to a shared helper next). Its body now starts at the `const n = pts.length;` line. Update its early return to `return { cells: [], ridges: [], tMax: 0 };`.

3. Extract the pre-filtering into a shared helper above it (verbatim from the old body):

```ts
// Drop zero-length edges, then drop collinear (redundant) vertices: a vertex
// whose two incident edges are nearly parallel in the same direction adds no
// geometry and its null trajectory breaks face coverage.
function cleanPolygon(poly: Polygon): Point[] {
  const rawPts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  return rawPts.filter((p, i) => {
    const m = rawPts.length;
    const prev = rawPts[(i - 1 + m) % m]!;
    const next = rawPts[(i + 1) % m]!;
    const dx0 = p.x - prev.x, dy0 = p.y - prev.y;
    const len0 = Math.hypot(dx0, dy0);
    const dx1 = next.x - p.x, dy1 = next.y - p.y;
    const len1 = Math.hypot(dx1, dy1);
    if (len0 < 1e-6 || len1 < 1e-6) return true;
    const ux0 = dx0 / len0, uy0 = dy0 / len0;
    const ux1 = dx1 / len1, uy1 = dy1 / len1;
    const cross = Math.abs(ux0 * uy1 - uy0 * ux1);
    const dot = ux0 * ux1 + uy0 * uy1;
    return !(cross < 1e-6 && dot > 0);
  });
}
```

4. Add the converter + the new public entry point at the bottom:

```ts
// Old two-chain cells → face outlines. left runs A→apex ascending, right runs
// B→apex ascending, so the ring [A, B, ...right minus B..., ...left minus A
// reversed...] walks the boundary with the rim edge first.
function facesFromCells(cells: SkeletonCell[]): SkeletonFace[] {
  const faces: SkeletonFace[] = [];
  for (const cell of cells) {
    if (cell.left.length < 1 || cell.right.length < 1) continue;
    const outline: FacePoint[] = [
      { t: cell.left[0]!.t, p: cell.left[0]!.p },
      { t: cell.right[0]!.t, p: cell.right[0]!.p },
      ...cell.right.slice(1).map((tp) => ({ t: tp.t, p: tp.p })),
      ...cell.left.slice(1).map((tp) => ({ t: tp.t, p: tp.p })).reverse(),
    ];
    // Dedupe consecutive coincident points (apexes often coincide).
    const ring = outline.filter((fp, i) => {
      if (i === 0) return true;
      const prev = outline[i - 1]!;
      return Math.hypot(fp.p.x - prev.p.x, fp.p.y - prev.p.y) > 1e-6;
    });
    if (ring.length < 3) continue;
    faces.push({
      edgeIndex: cell.edgeIndex,
      n: cell.n,
      outline: ring,
      tDeath: cell.tDeath,
    });
  }
  return faces;
}

function naiveSkeleton(pts: Point[]): Skeleton {
  const { cells, ridges, tMax } = naiveCells(pts);
  return { faces: facesFromCells(cells), ridges, tMax, method: 'naive' };
}

export function computeStraightSkeleton(poly: Polygon): Skeleton {
  const pts = cleanPolygon(poly);
  if (pts.length < 3) return { faces: [], ridges: [], tMax: 0, method: 'naive' };
  return naiveSkeleton(pts);
}
```

- [ ] **Step 4: Update `src/bevelRegions.ts` to compile against faces**

Only the import and the two consumption sites change in this task; the real region rewrite is Task 2. Change the import line (the deprecated `TrajPoint` alias keeps `cutTraj`/`rangeTraj` compiling until Task 2 deletes them):

```ts
import { computeStraightSkeleton, type FacePoint, type SkeletonFace, type TrajPoint } from './straightSkeleton';
```

and stub the body of `buildRegions` to iterate `skel.faces` — Task 2 replaces the whole function, so to keep this task green the fastest path is to do Task 2's Step 3 rewrite now if the compiler forces it. If you prefer strict sequencing: leave `buildRegions` unchanged and add a temporary adapter at the top of it:

```ts
  const skel = computeStraightSkeleton(rim);
  // TEMPORARY (removed in Task 2): rebuild two-chain cells from face outlines.
  const cells = skel.faces.map((f) => {
    // outline = [A, B, ...right ascending..., ...left descending...]; find the
    // apex (max t) index to split back into chains.
    let apex = 2;
    for (let i = 2; i < f.outline.length; i++) {
      if (f.outline[i]!.t > f.outline[apex]!.t) apex = i;
    }
    return {
      edgeIndex: f.edgeIndex,
      n: f.n,
      left: [f.outline[0]!, ...f.outline.slice(apex).reverse()],
      right: [f.outline[1]!, ...f.outline.slice(2, apex + 1)],
      tDeath: f.tDeath,
    };
  });
```

and reference `cells`/`skel.tMax`/`skel.ridges` where the old destructuring did. **Delete this adapter in Task 2.**

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS (all files, including the migrated skeleton tests and untouched `bevelRegions.test.ts`).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`SpeechBalloon.tsx` only consumes `buildRegions`/`Region`, which kept their shapes.)

- [ ] **Step 7: Commit**

```bash
git add speech-balloons/src/straightSkeleton.ts speech-balloons/src/straightSkeleton.test.ts speech-balloons/src/bevelRegions.ts
git commit -m "refactor(speech-balloons): straight skeleton emits faces, not two-chain cells"
```

---

### Task 2: bevelRegions on faces — iso-t clips and interior islands

Replace chain-cutting (`cutTraj`/`rangeTraj`/`ring`/`innerRing`) with a generic clip of each face outline against the `t = b` line, and build the interior (dome-blob / flat) as clipper-union islands of the per-face above-pieces. Convex behavior must be preserved: all existing `bevelRegions.test.ts` suites stay green unchanged.

**Files:**
- Modify: `src/bevelRegions.ts`
- Test: `src/bevelRegions.test.ts` (existing tests only — no new tests this task)

- [ ] **Step 1: Run the existing suite as the baseline**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: PASS (baseline before surgery).

- [ ] **Step 2: Rewrite the region construction**

In `src/bevelRegions.ts`: delete `cutTraj`, `rangeTraj`, and `ring`; keep `simplifyRim`, `angleDiff`, and all exported types exactly as they are (`Region.outline` remains `Polygon`). Replace `buildRegions` and add helpers:

```ts
import { unionPolygons } from './clipping';

const EPS_T = 1e-9;

// Clip a face outline against t ≤ b ('below') or t ≥ b ('above'). t is affine
// within a face, so the cut is a straight line and linear interpolation along
// boundary segments is exact. Sutherland–Hodgman: a cut that would produce
// multiple components yields zero-width bridges along the seam, which render
// identically (same paint, nonzero fill rule).
function clipFace(outline: FacePoint[], b: number, side: 'below' | 'above'): FacePoint[] {
  const keep = (t: number) => (side === 'below' ? t <= b + EPS_T : t >= b - EPS_T);
  const out: FacePoint[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % outline.length]!;
    const pin = keep(p.t);
    if (pin) out.push(p);
    if (pin !== keep(q.t)) {
      const u = (b - p.t) / (q.t - p.t);
      out.push({
        t: b,
        p: { x: p.p.x + (q.p.x - p.p.x) * u, y: p.p.y + (q.p.y - p.p.y) * u },
      });
    }
  }
  return out.filter((fp, i) => {
    if (i === 0) return true;
    const prev = out[i - 1]!;
    return Math.hypot(fp.p.x - prev.p.x, fp.p.y - prev.p.y) > 1e-6;
  });
}

function ringArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

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
  const abovePieces: Polygon[] = [];

  for (const face of skel.faces) {
    if (face.outline.length < 3) continue;
    const rimMid = {
      x: (face.outline[0]!.p.x + face.outline[1]!.p.x) / 2,
      y: (face.outline[0]!.p.y + face.outline[1]!.p.y) / 2,
    };
    const azimuthDeg = (Math.atan2(-face.n.y, -face.n.x) * 180) / Math.PI;
    const stripEnd = Math.min(b, face.tDeath);

    const strip = clipFace(face.outline, stripEnd, 'below');
    if (strip.length >= 3) {
      regions.push({
        kind: 'strip',
        outline: strip.map((fp) => fp.p),
        azimuthDeg,
        x0: 0,
        x1: stripEnd / tMax,
        frame: {
          kind: 'linear',
          from: rimMid,
          to: { x: rimMid.x + face.n.x * stripEnd, y: rimMid.y + face.n.y * stripEnd },
        },
      });
    }

    // Sliver guard: a panel shallower than half a pixel is the capped-b case
    // (bevelWidth ≥ total collapse) — render it as strip-only.
    if (face.tDeath > b + 0.5) {
      const above = clipFace(face.outline, b, 'above');
      if (above.length >= 3) {
        abovePieces.push(above.map((fp) => fp.p));
        if (opts.interior === 'roof-panels') {
          const seamMid = { x: rimMid.x + face.n.x * b, y: rimMid.y + face.n.y * b };
          const depth = face.tDeath - b;
          regions.push({
            kind: 'panel',
            outline: above.map((fp) => fp.p),
            azimuthDeg,
            x0: xb,
            x1: face.tDeath / tMax,
            frame: {
              kind: 'linear',
              from: seamMid,
              to: { x: seamMid.x + face.n.x * depth, y: seamMid.y + face.n.y * depth },
            },
          });
        }
      }
    }
  }

  // Interior islands: the region beyond the seam can be several disjoint
  // pieces (a tail pinches off from the body via a split event). Union the
  // per-face above-pieces with clipper — piece edges coincide along shared
  // skeleton arcs, so the union dissolves them into per-island loops.
  if (opts.interior !== 'roof-panels' && b < tMax * 0.99 && abovePieces.length > 0) {
    const islands = unionPolygons(abovePieces);
    for (const island of islands) {
      if (island.length < 3 || ringArea(island) < 1) continue;
      // Island plateau: centroid of the deepest skeleton points inside the
      // island (an elongated body collapses to a ridge segment, not a point).
      let tIsland = 0;
      for (const f of skel.faces) {
        for (const fp of f.outline) {
          if (fp.t > tIsland + 1e-6 && pointInPolygon(fp.p, island)) tIsland = fp.t;
        }
      }
      if (tIsland <= b) continue;
      let cx = 0, cy = 0, cn = 0;
      for (const f of skel.faces) {
        for (const fp of f.outline) {
          if (fp.t >= tIsland - 1e-6 && pointInPolygon(fp.p, island)) {
            cx += fp.p.x; cy += fp.p.y; cn++;
          }
        }
      }
      if (cn === 0) continue;
      const center = { x: cx / cn, y: cy / cn };
      if (opts.interior === 'dome-blob') {
        regions.push({
          kind: 'blob', outline: island, azimuthDeg: 0,
          x0: tIsland / tMax, x1: xb,
          frame: { kind: 'radial', center, radius: Math.max(tIsland - b, 1e-6) },
        });
      } else {
        regions.push({
          kind: 'flat', outline: island, azimuthDeg: 0,
          x0: tIsland / tMax, x1: tIsland / tMax, frame: { kind: 'solid' },
        });
      }
    }
  }

  return { regions, tMax, ridges: skel.ridges };
}
```

Also remove the Task 1 temporary adapter if it was added.

Notes for the implementer:

- The centroid-of-plateau center generalizes the spec's "deepest ridge vertex": an elongated rectangle collapses to a ridge *segment* at `tMax`; averaging its endpoints reproduces v1's visually-centered blob. A single collapse point degenerates to itself.
- `x0` for `flat` moves from literal `1` to `tIsland / tMax` — identical for a single island (where `tIsland === tMax`), and the correct "color at this island's plateau height" for a shallow tail island.
- Deduplicated per-vertex `pointInPolygon` calls are O(faces × outline × islands) — tens × tens × few; no perf concern at this scale.

- [ ] **Step 3: Run the existing suite**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: PASS unchanged. Watch specifically:
- `dome-blob: strips + one radial blob region` — one island on a rect; `frame.kind === 'radial'`.
- `flat: … x0 === 1` — single island has `tIsland === tMax` so `x0 = 1` exactly (within float noise; if `toBe(1)` fails on `0.9999…`, the skeleton's apex `t` isn't reaching `tMax` — fix the skeleton, don't loosen the test).
- `bevelWidth past total collapse: strips only`.

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add speech-balloons/src/bevelRegions.ts speech-balloons/src/straightSkeleton.ts
git commit -m "refactor(speech-balloons): bevel regions from face iso-t clips + clipper-union interior islands"
```

---

### Task 3: SLAV engine — edge events + split events

The real algorithm. Replace the naive engine as the primary path (it stays as the fallback). Strategy: recompute all candidate events after every processed event instead of maintaining a priority queue — the polygon is small after `simplifyRim` (≤ ~60 vertices), and recomputation eliminates the entire class of stale-queue bugs that make SLAV implementations notorious.

**Files:**
- Modify: `src/straightSkeleton.ts`
- Test: `src/straightSkeleton.test.ts`

- [ ] **Step 1: Write the failing concave tests**

Append to `src/straightSkeleton.test.ts`:

```ts
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
      assertFaceInvariants(skel);
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
    // Tail edges are 3 and 4 ((120,100)→(100,140) and (100,140)→(90,100));
    // the tail is ~30 px wide at the base so its faces collapse well below 20.
    const tail3 = skel.faces.find((f) => f.edgeIndex === 3)!;
    const tail4 = skel.faces.find((f) => f.edgeIndex === 4)!;
    expect(tail3.tDeath).toBeLessThan(20);
    expect(tail4.tDeath).toBeLessThan(20);
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
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/straightSkeleton.test.ts`
Expected: FAIL — `method` is `'naive'` everywhere, and concave partitions don't hold.

- [ ] **Step 3: Implement the SLAV engine**

Add to `src/straightSkeleton.ts` (above `naiveCells`; `vertexTrajectory` and `at` already exist — reuse them):

```ts
const EPS_T = 1e-9;
const EPS_MATCH = 1e-4; // px — junction identity when chaining arcs into faces

interface OrigEdge { index: number; a: Point; n: Point; u: Point }

interface WfVertex {
  traj: Traj | null;      // null = degenerate (antiparallel neighbors); can't move
  birthT: number;
  birthP: Point;
  prevEdge: OrigEdge;     // wavefront edge entering this vertex
  nextEdge: OrigEdge;     // wavefront edge leaving this vertex
  prev: WfVertex;
  next: WfVertex;
}

// A vertex-lifetime segment. Each arc bounds exactly two faces: the face of
// the edge on its left (nextEdge) and on its right (prevEdge).
interface Arc { aT: number; aP: Point; bT: number; bP: Point; left: number; right: number }

function windingSign(pts: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    area2 += p.x * q.y - q.x * p.y;
  }
  return area2 > 0 ? 1 : -1;
}

function isReflex(v: WfVertex, sign: number): boolean {
  const cross = v.prevEdge.u.x * v.nextEdge.u.y - v.prevEdge.u.y * v.nextEdge.u.x;
  return cross * sign < -1e-12;
}

function slavSkeleton(pts: Point[]): Skeleton {
  const n = pts.length;
  const sign = windingSign(pts);
  const edges: OrigEdge[] = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { index: i, a, n: { x: -u.y * sign, y: u.x * sign }, u };
  });

  const initial: WfVertex[] = pts.map((p, i) => ({
    traj: null, birthT: 0, birthP: p,
    prevEdge: edges[(i - 1 + n) % n]!, nextEdge: edges[i]!,
    prev: null as unknown as WfVertex, next: null as unknown as WfVertex,
  }));
  for (let i = 0; i < n; i++) {
    initial[i]!.prev = initial[(i - 1 + n) % n]!;
    initial[i]!.next = initial[(i + 1) % n]!;
    initial[i]!.traj = vertexTrajectory(initial[i]!.prevEdge, initial[i]!.nextEdge);
  }

  const alive = new Set<WfVertex>(initial);
  const arcs: Arc[] = [];
  const ridges: Array<[Point, Point]> = [];
  let tNow = 0;

  const posAt = (v: WfVertex, t: number): Point => (v.traj ? at(v.traj, t) : v.birthP);

  const die = (v: WfVertex, t: number, p: Point) => {
    alive.delete(v);
    if (Math.hypot(p.x - v.birthP.x, p.y - v.birthP.y) > 1e-6) {
      arcs.push({
        aT: v.birthT, aP: v.birthP, bT: t, bP: p,
        left: v.nextEdge.index, right: v.prevEdge.index,
      });
      ridges.push([v.birthP, p]);
    }
  };

  // Retire a 2-vertex LAV: the wavefront between two vertices is a zero-area
  // 2-gon that dies instantly. Both vertices die at their current positions,
  // and the coincident final wavefront segment becomes a closing arc between
  // the two remaining faces (this is the ridge segment of e.g. a rectangle).
  const retire2 = (v: WfVertex, t: number) => {
    const w = v.next;
    const pv = posAt(v, t), pw = posAt(w, t);
    die(v, t, pv);
    die(w, t, pw);
    if (Math.hypot(pv.x - pw.x, pv.y - pw.y) > 1e-6) {
      arcs.push({
        aT: t, aP: pv, bT: t, bP: pw,
        left: v.nextEdge.index, right: v.prevEdge.index,
      });
    }
  };

  // Find the alive wavefront segment carried by original edge `e` in v's own
  // LAV whose offset span at time t contains s. Returns the segment's start
  // vertex, or null (event invalidated by earlier topology changes).
  const splitTarget = (v: WfVertex, e: OrigEdge, s: Point, t: number): WfVertex | null => {
    let cur = v.next;
    while (cur !== v) {
      if (cur.nextEdge === e && cur.traj && cur.next.traj && cur.next !== v) {
        const pa = at(cur.traj, t), pb = at(cur.next.traj, t);
        const lo = (s.x - pa.x) * e.u.x + (s.y - pa.y) * e.u.y;
        const hi = (pb.x - s.x) * e.u.x + (pb.y - s.y) * e.u.y;
        if (lo > -1e-6 && hi > -1e-6) return cur;
      }
      cur = cur.next;
    }
    return null;
  };

  const MAX_EVENTS = 8 * n;
  for (let ev = 0; ; ev++) {
    if (ev >= MAX_EVENTS) throw new Error('skeleton: event budget exceeded');

    // Retire every LAV already reduced to ≤ 2 vertices.
    let retired = true;
    while (retired) {
      retired = false;
      for (const v of alive) {
        if (v.next === v) { die(v, tNow, posAt(v, tNow)); retired = true; break; }
        if (v.next.next === v) { retire2(v, tNow); retired = true; break; }
      }
    }
    if (alive.size === 0) break;

    // --- scan for the earliest event (recomputed from scratch each round) ---
    let bestT = Infinity;
    let bestEdgeV: WfVertex | null = null;
    for (const v of alive) {
      const w = v.next;
      if (!v.traj || !w.traj) continue;
      const u = v.nextEdge.u;
      const c0 = (w.traj.p0.x - v.traj.p0.x) * u.x + (w.traj.p0.y - v.traj.p0.y) * u.y;
      const c1 = (w.traj.d.x - v.traj.d.x) * u.x + (w.traj.d.y - v.traj.d.y) * u.y;
      if (c1 >= -1e-12) continue; // not shrinking
      const tc = -c0 / c1;
      if (tc < tNow - EPS_T) continue;
      if (tc < Math.max(v.birthT, w.birthT) - EPS_T) continue;
      if (tc < bestT - EPS_T) { bestT = tc; bestEdgeV = v; }
    }

    let bestSplit: { t: number; v: WfVertex; edge: OrigEdge; s: Point } | null = null;
    for (const v of alive) {
      if (!v.traj || !isReflex(v, sign)) continue;
      for (const e of edges) {
        if (e === v.prevEdge || e === v.nextEdge) continue;
        // Reflex bisector meets e's offset line when (p(t) − a)·n = t.
        const denom = 1 - (v.traj.d.x * e.n.x + v.traj.d.y * e.n.y);
        if (denom <= EPS_T) continue;
        const num = (v.traj.p0.x - e.a.x) * e.n.x + (v.traj.p0.y - e.a.y) * e.n.y;
        const tc = num / denom;
        if (tc < tNow - EPS_T || tc < v.birthT - EPS_T) continue;
        // Edge events win ties; among splits keep the earliest.
        if (tc >= bestT - EPS_T) continue;
        if (bestSplit && tc >= bestSplit.t - EPS_T) continue;
        const s = at(v.traj, tc);
        if (!splitTarget(v, e, s, tc)) continue;
        bestSplit = { t: tc, v, edge: e, s };
      }
    }

    if (bestSplit) {
      tNow = bestSplit.t;
      const { v, edge, s } = bestSplit;
      const a = splitTarget(v, edge, s, tNow);
      if (!a) throw new Error('skeleton: split target vanished');
      const b = a.next;
      const prev = v.prev, next = v.next;
      die(v, tNow, s);
      // LAV 1: … prev → x → b …   LAV 2: … a → y → next …
      const x: WfVertex = {
        traj: vertexTrajectory(v.prevEdge, edge), birthT: tNow, birthP: s,
        prevEdge: v.prevEdge, nextEdge: edge,
        prev, next: b,
      };
      const y: WfVertex = {
        traj: vertexTrajectory(edge, v.nextEdge), birthT: tNow, birthP: s,
        prevEdge: edge, nextEdge: v.nextEdge,
        prev: a, next,
      };
      prev.next = x; b.prev = x;
      a.next = y; next.prev = y;
      alive.add(x); alive.add(y);
    } else if (bestEdgeV) {
      tNow = bestT;
      const v = bestEdgeV, w = v.next;
      const pv = at(v.traj!, tNow), pw = at(w.traj!, tNow);
      const m = { x: (pv.x + pw.x) / 2, y: (pv.y + pw.y) / 2 };
      const prev = v.prev, next = w.next;
      die(v, tNow, m);
      die(w, tNow, m);
      const x: WfVertex = {
        traj: vertexTrajectory(v.prevEdge, w.nextEdge), birthT: tNow, birthP: m,
        prevEdge: v.prevEdge, nextEdge: w.nextEdge,
        prev, next,
      };
      prev.next = x; next.prev = x;
      alive.add(x);
    } else {
      throw new Error('skeleton: wavefront stalled');
    }
  }

  // ---- face reconstruction: chain each edge's arcs from rim end to rim start ----
  let tMax = 0;
  for (const arc of arcs) tMax = Math.max(tMax, arc.aT, arc.bT);

  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < EPS_MATCH;

  const faces: SkeletonFace[] = [];
  for (const e of edges) {
    const A = pts[e.index]!;
    const B = pts[(e.index + 1) % n]!;
    const mine = arcs.filter((c) => c.left === e.index || c.right === e.index);
    const used = new Set<Arc>();
    const outline: FacePoint[] = [{ t: 0, p: A }, { t: 0, p: B }];
    let cur = B;
    let closed = false;
    for (let guard = 0; guard <= mine.length; guard++) {
      let step: FacePoint | null = null;
      for (const c of mine) {
        if (used.has(c)) continue;
        if (near(c.aP, cur)) { step = { t: c.bT, p: c.bP }; used.add(c); break; }
        if (near(c.bP, cur)) { step = { t: c.aT, p: c.aP }; used.add(c); break; }
      }
      if (!step) break;
      if (near(step.p, A)) { closed = true; break; }
      outline.push(step);
      cur = step.p;
    }
    if (!closed) throw new Error(`skeleton: face ${e.index} failed to chain`);
    const tDeath = outline.reduce((m, fp) => Math.max(m, fp.t), 0);
    faces.push({ edgeIndex: e.index, n: e.n, outline, tDeath });
  }

  return { faces, ridges, tMax, method: 'slav' };
}
```

Then switch the public entry point to try SLAV first:

```ts
export function computeStraightSkeleton(poly: Polygon): Skeleton {
  const pts = cleanPolygon(poly);
  if (pts.length < 3) return { faces: [], ridges: [], tMax: 0, method: 'naive' };
  try {
    return slavSkeleton(pts);
  } catch {
    // Degraded-but-stable: v1 behavior for inputs the SLAV engine rejects
    // (self-intersections, stalled wavefronts, budget overruns).
    return naiveSkeleton(pts);
  }
}
```

Implementation notes (read before debugging):

- **Degenerate splits self-heal.** If the split lands adjacent to the reflex vertex's neighbors, the relink produces a 2-vertex LAV, which the retire loop at the top of the next iteration kills at the same `t`. Don't special-case them.
- **Antiparallel trajectories are legal.** `vertexTrajectory` returns null when a merge creates a vertex between antiparallel edges (e.g. a rectangle's ridge). Null-trajectory vertices can't produce events; their LAV retires via `retire2`, whose closing arc carries the ridge segment both faces need to chain. Zero-length arcs are skipped at emission.
- **The rectangle is the canary.** Its two edge events leave a 2-gon whose closing arc is the ridge `(50,50)–(150,50)`. If face chaining fails on `rect`, `retire2`'s closing arc is wrong.
- **Ties.** Edge events win ties against splits (`tc >= bestT - EPS_T` skips the split). Simultaneous edge events (square) are processed one per round; recomputation makes the second one fire at the same `t` next round.

- [ ] **Step 4: Run the skeleton tests**

Run: `npx vitest run src/straightSkeleton.test.ts`
Expected: PASS — all convex parity tests plus all five concave fixtures on `method: 'slav'`, bowtie on `'naive'`.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean. `bevelRegions.test.ts` must still pass — it now runs on SLAV output for its convex fixtures.

- [ ] **Step 6: Commit**

```bash
git add speech-balloons/src/straightSkeleton.ts speech-balloons/src/straightSkeleton.test.ts
git commit -m "feat(speech-balloons): split-event straight skeleton (SLAV) with naive fallback"
```

---

### Task 4: Concave region tests — islands, oracle, tail shading

Prove Tasks 2 + 3 compose: concave rims produce correct bands and per-island interiors. Pure test additions; any failure here is a bug in Task 2 or 3 code.

**Files:**
- Test: `src/bevelRegions.test.ts`

- [ ] **Step 1: Add the concave fixtures + tests**

Append to `src/bevelRegions.test.ts`:

```ts
import { inflatePathsD, JoinType, EndType } from 'clipper2-ts';

const tailRect: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
  { x: 120, y: 100 }, { x: 100, y: 140 }, { x: 90, y: 100 },
  { x: 0, y: 100 },
];

const dumbbell: Polygon = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 180, y: 40 },
  { x: 180, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 100 }, { x: 180, y: 100 },
  { x: 180, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

// Independent implementation of the inset ring, for cross-validation.
// Mirror the call shape of offsetClosedPolygon in src/clipping.ts, but force
// miter joins so corners match the skeleton's straight-line offsets.
function miterInsetArea(poly: Polygon, delta: number): number {
  const paths = inflatePathsD([poly], -delta, JoinType.Miter, EndType.Polygon, 2, 3);
  return paths.reduce((s, path) => s + area(path as { x: number; y: number }[]), 0);
}

describe('buildRegions — concave rims', () => {
  it('tail-on-rect: every rim edge gets a strip; regions tile the polygon (roof-panels)', () => {
    const { regions } = buildRegions({
      rim: tailRect, bevelWidthPx: 12, interior: 'roof-panels', cornerStepDeg: 12,
    });
    const strips = regions.filter((r) => r.kind === 'strip');
    expect(strips.length).toBe(7); // one per input edge
    const total = regions.reduce((s, r) => s + area(r.outline), 0);
    expect(total).toBeCloseTo(area(tailRect), -1);
  });

  it('tail-on-rect: interior island matches a miter-join clipper inset (oracle)', () => {
    const b = 12;
    const { regions } = buildRegions({
      rim: tailRect, bevelWidthPx: b, interior: 'dome-blob', cornerStepDeg: 12,
    });
    const got = regions
      .filter((r) => r.kind === 'blob')
      .reduce((s, r) => s + area(r.outline), 0);
    const oracle = miterInsetArea(tailRect, b);
    expect(Math.abs(got - oracle) / oracle).toBeLessThan(0.03);
  });

  it('dumbbell at b=15: the neck pinches off → two blob islands', () => {
    // Neck is 20 px tall → its local collapse is at t=10 < 15, so the seam
    // ring at t=15 splits into one loop per square.
    const { regions, tMax } = buildRegions({
      rim: dumbbell, bevelWidthPx: 15, interior: 'dome-blob', cornerStepDeg: 12,
    });
    expect(tMax).toBeCloseTo(50, 2);
    const blobs = regions.filter((r) => r.kind === 'blob');
    expect(blobs).toHaveLength(2);
    for (const blob of blobs) {
      expect(blob.frame.kind).toBe('radial');
      if (blob.frame.kind === 'radial') {
        // Each island's plateau is its square's center at t=50.
        expect(blob.frame.center.y).toBeCloseTo(50, 0);
        expect(blob.frame.radius).toBeCloseTo(50 - 15, 0);
      }
      expect(blob.x0).toBeCloseTo(1, 3); // both islands reach global tMax
    }
    const centersX = blobs
      .map((r) => (r.frame.kind === 'radial' ? r.frame.center.x : NaN))
      .sort((a, b2) => a - b2);
    expect(centersX[0]).toBeCloseTo(50, 0);
    expect(centersX[1]).toBeCloseTo(230, 0);
  });

  it('tail-on-rect at small b: the tail forms its own shallow island with x0 < 1', () => {
    const { regions, tMax } = buildRegions({
      rim: tailRect, bevelWidthPx: 8, interior: 'dome-blob', cornerStepDeg: 12,
    });
    const blobs = regions.filter((r) => r.kind === 'blob');
    // Tail base is ~30 px wide → local collapse ~t≈9–12 > b=8, so the tail
    // pinches off as its own island next to the body island.
    expect(blobs.length).toBe(2);
    const xs = blobs.map((r) => r.x0).sort((a, b2) => a - b2);
    expect(xs[1]).toBeCloseTo(1, 3);             // body island reaches tMax
    expect(xs[0]).toBeGreaterThan(8 / tMax);     // tail island above the seam…
    expect(xs[0]).toBeLessThan(0.5);             // …but far below the body plateau
  });

  it('flat interior on dumbbell: two solid islands', () => {
    const { regions } = buildRegions({
      rim: dumbbell, bevelWidthPx: 15, interior: 'flat', cornerStepDeg: 12,
    });
    const flats = regions.filter((r) => r.kind === 'flat');
    expect(flats).toHaveLength(2);
    for (const f of flats) expect(f.frame.kind).toBe('solid');
  });
});
```

Note: `inflatePathsD`'s exact signature should be mirrored from `offsetClosedPolygon` in `src/clipping.ts:94` — if the parameter order there differs from the call above, follow `clipping.ts` (it's the version this repo's clipper actually ships).

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/bevelRegions.test.ts`
Expected: PASS. Failure triage:
- Island count wrong → check `unionPolygons` input (are above-pieces degenerate/empty?) and the dumbbell's expected pinch (neck collapse at t=10 < b=15).
- Oracle mismatch > 3% → face partition is wrong somewhere; run the Task 3 partition tests first.
- `x0` assertions wrong → `tIsland` search (`pointInPolygon` of deep points against the island loop).

- [ ] **Step 3: Full suite**

Run: `npx vitest run`
Expected: PASS (all files).

- [ ] **Step 4: Commit**

```bash
git add speech-balloons/src/bevelRegions.test.ts
git commit -m "test(speech-balloons): concave region coverage — islands, clipper oracle, tail x0"
```

---

### Task 5: Integration — browser verification + handoff

No renderer code changes are expected (`buildRegions` kept its contract), but the visual result must be verified end-to-end and the handoff updated.

**Files:**
- Verify: `src/SpeechBalloon.tsx` (no edits expected)
- Modify: `HANDOFF.md`
- Screenshots: `screenshots-clean/concave-*.png`

- [ ] **Step 1: Typecheck + full suite one more time**

Run: `npm run typecheck && npx vitest run`
Expected: clean / PASS.

- [ ] **Step 2: Browser verification**

Dev server: `npm run dev` (port 5180; reuse the running instance if the session already has one). Use the playwright MCP tools to drive it. For each check, screenshot into `screenshots-clean/`:

1. **Tail integration (the headline).** Body: rectangle with a pointed tail, fill mode `lit-bevel`, interior `roof-panels`, bevel width ~12. Expected: the bevel band flows *around* the tail join and down the tail's flanks; the tail is no longer flat; no spurious wedge creases radiating from the join. Screenshot `concave-01-tail-band.png`.
2. **Debug overlay.** Enable the debug overlay. Expected: goldenrod skeleton ridges re-route around the tail (a ridge runs down the tail's spine; split-event arcs meet the body's ridge structure). Screenshot `concave-02-ridges.png`.
3. **Azimuth sweep at the tail.** Set azimuth so the key light faces the tail (~270° for a bottom tail), then sweep ±45°. Expected: the tail's two flanks light/shade like any other pair of rim faces; no popping. Screenshots `concave-03-az-225.png`, `concave-03-az-315.png`.
4. **Interior islands.** Interior `dome-blob`, bevel width large enough that the tail pinches off (increase until the tail shows its own small blob). Expected: body blob + small tail blob, tail blob dimmer/flatter (its `x0 < 1`). Screenshot `concave-04-islands.png`.
5. **Lightning + cloud.** Switch to a lightning-tail and then a cloud body in lit-bevel. Expected: no crashes, notches shade plausibly, no black/empty regions. Screenshots `concave-05-lightning.png`, `concave-06-cloud.png`.
6. **Convex regression.** Plain rounded rect + hexagon in lit-bevel. Expected: visually identical to the committed `lit-bevel-01-smoke.png` / `lit-bevel-06-polygon.png` states. Screenshot `concave-07-regression.png`.
7. **Console.** No new JS errors (favicon 404 is known noise).

If a check fails: stop, apply superpowers:systematic-debugging, fix, re-run the affected unit suites, then redo the browser check.

- [ ] **Step 3: Update `HANDOFF.md`**

Replace the "Recent work" section header block with a summary of this feature: SLAV skeleton with split events, faces + arcs model, island interiors, fallback semantics (`method: 'naive'` for pathological inputs), and the browser-verification results table. Keep the architecture notes section, adding `straightSkeleton.ts`'s new role. Update the test count.

- [ ] **Step 4: Commit**

```bash
git add speech-balloons/HANDOFF.md speech-balloons/screenshots-clean/concave-*.png
git commit -m "feat(speech-balloons): concave-rim correctness verified in browser; handoff updated"
```

---

## Self-review checklist (for the plan author — completed 2026-07-03)

- Spec coverage: SLAV+split events (Task 3), face interface (Task 1), iso-t cuts + islands (Task 2), global normalization (`x0/x1` formulas in Task 2 code), fallback (Task 3 entry point + bowtie test), clipper oracle (Task 4), browser verify + debug overlay (Task 5). Ridges keep `[Point, Point][]` (Task 3 `die()`/`ridges.push`).
- No placeholder steps; every code step carries the code.
- Type consistency: `FacePoint`/`SkeletonFace`/`Skeleton.method` defined in Task 1, consumed in Tasks 2–4 with the same names; `Region` unchanged throughout.
