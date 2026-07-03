# Concave-rim correctness for the analytic lit-bevel renderer

Date: 2026-07-03
Status: approved (brainstormed 2026-07-01 → 2026-07-03)

## Problem

The 2026-06-09 analytic lit-bevel renderer explicitly deferred concave-rim
correctness. `computeStraightSkeleton` handles edge-collapse events only;
reflex (concave) vertices trace naive miter bisectors. When the wavefront
"escapes" at a reflex vertex the event loop bails
(`straightSkeleton.ts:139`), leaving wrong `tDeath`/`tMax` values.

Visible symptoms today:

- Pointed tails render flat and unshaded — the bevel band stops dead at the
  tail join instead of flowing around it.
- Spurious interior creases radiate from the tail join in `roof-panels`
  mode (see `screenshots-clean/lit-bevel-02-azimuth-45-corner-fan.png`).
- Lightning notches, wobble/jitter morphs, and cloud silhouettes degrade
  the same way, more severely.

## Goal

Mathematically correct straight-skeleton shading for **any simple
polygon** — tails, lightning notches, deep concavities, multiple reflex
runs — not just the pointed-tail case. Every current and future silhouette
inherits correctness from one fix. (Decision: the physically-faithful
option over a visual shortcut, per project ethos.)

## Approach

Chosen from three candidates (2026-07-02):

- **A. Full split-event straight skeleton (chosen)** — extend our
  wavefront implementation to the classic SLAV algorithm.
- B. Adopt an npm straight-skeleton library — rejected: the JS ecosystem's
  offerings are poorly maintained and unproven exactly on the degenerate
  cases we care about; we'd still write the face→region generalization.
- C. Clipper-inset banding without a skeleton fix — rejected: approximate
  band attribution near reflex features, and `roof-panels` stays broken
  (panels *are* skeleton faces). A visual shortcut.

## Design

### 1. Skeleton: SLAV with split events (`src/straightSkeleton.ts`)

Rewrite `computeStraightSkeleton` as the Felkel–Obdržálek wavefront:

- **Data structure:** a Set of Lists of Active Vertices (SLAV). Each LAV is
  a circular list of wavefront vertices; splits partition one LAV into two.
- **Events**, processed from a priority queue in ascending `t`:
  - **Edge event** — two adjacent vertex trajectories meet; the edge
    between them dies; neighbors become adjacent and spawn a new vertex.
  - **Split event** — a reflex vertex's bisector hits the interior of an
    opposite wavefront edge; the LAV splits into two independent
    wavefronts, each continuing to shrink.
- **Trajectories** stay linear, `p(t) = p0 + t·d`, from the existing
  offset-line intersection (`vertexTrajectory`) — the formula is already
  valid for reflex vertices.
- **Simultaneous events** are ε-clustered (multiple splits at one point,
  vertex events) and processed as a group before the wavefront advances.

**Interface change.** After a split, one input edge's skeleton face can be
bounded by many arcs — the two-chain `SkeletonCell { left, right }` model
cannot represent it. It generalizes to:

```ts
export interface SkeletonFace {
  edgeIndex: number;                    // input edge that sweeps this face
  n: Point;                             // unit inward normal of that edge
  outline: Array<{ t: number; p: Point }>; // closed boundary, per-vertex inset
  tDeath: number;                       // max t on the face
}
export interface Skeleton {
  faces: SkeletonFace[];
  ridges: Array<[Point, Point]>;        // includes split-event arcs
  tMax: number;                         // global wavefront collapse inset
}
```

Within a face, `t` at any boundary point equals the perpendicular distance
to the face's supporting edge line, so `t` interpolates linearly along
boundary segments.

### 2. Regions: iso-t cuts and interior islands (`src/bevelRegions.ts`)

`buildRegions` keeps its input/output contract (`Region[]`, `tMax`,
`ridges`) and cuts each face at `t = bevelWidth` (`b`):

- **Cut primitive:** walk the face outline, keep vertices on the requested
  side of `b`, insert linearly interpolated crossings. Implemented
  generically — tolerant of a cut producing multiple pieces per face —
  rather than assuming face monotonicity.
- **strip** = face ∩ { t ≤ b }, one per piece; gradient frame unchanged
  (linear along the edge normal from the rim midpoint).
- **panel** (`roof-panels`) = face ∩ { t ≥ b }, one per piece; existing
  sliver guard (≥ 0.5 px depth) retained.
- **Interior islands.** At `t = b` the interior can be several disjoint
  islands (a split event pinches a tail's interior off from the body's).
  For `dome-blob` / `flat`, chain the iso-t crossings into closed offset
  loops; each island becomes its own region:
  - center = the island's wavefront-collapse point (its deepest ridge
    vertex), not a vertex-average centroid;
  - radius = `t_island_max − b`.
  This replaces the single `innerRing` accumulation.

### 3. Height normalization stays global

Contour-x remains `x = t / tMax` with the **polygon-global** `tMax`.
Height stays a single function of physical inset distance across the whole
surface: a shallow tail island gets a shorter, flatter dome than the body,
as on a real chamfered solid. Per-island normalization (tail doming to
full height) is rejected as less physical.

`x0`/`x1` on strips and panels keep their current formulas
(`stripEnd / tMax`, `tDeath / tMax`); islands' radial stops sample the
contour up to `t_island_max / tMax`, not 1.

### 4. Integration (`src/SpeechBalloon.tsx`)

- The `litBevel` memo is nearly untouched: same `Region[]` contract, same
  `data-shading-id` groups, `computeStops` unchanged. Multiple interior
  regions per polygon simply emit more entries.
- Debug overlay: `ridges` keeps its `[Point, Point][]` type and now
  includes split-event arcs — goldenrod ridges visibly re-route around the
  tail, which doubles as visual verification.

### 5. Failure handling

If the event loop detects inconsistency — non-converging queue, negative
event times, event-budget overrun — the affected polygon **falls back to
the current naive skeleton** and renders degraded-but-stable, as v1 does
today. No crash paths.

## Testing

- **Unit (vitest):**
  - Canonical concave cases: L, T, and U shapes, star, dumbbell pinch,
    tail-on-rect at several angles and base widths, near-180° reflex
    vertices.
  - Invariants: face areas sum to polygon area; `t` is continuous across
    shared arcs; all outputs finite (no NaN/Infinity).
  - Existing convex cases must pass unchanged (rounded rect, hexagon).
- **Cross-validation oracle:** iso-t offset loops extracted from the
  skeleton must match `clipper2-ts` insets of the same polygon at the same
  distance (already a dependency; independent implementation).
- **Region tests:** strip + panel pieces partition each face; seam
  continuity across the `t = b` boundary (existing continuity-test
  pattern); multi-island interior counts on a dumbbell.
- **Browser verify:** tail shaded with the band flowing around the join;
  azimuth sweep at the tail (no popping); lightning-bolt and cloud bodies;
  debug-overlay ridges re-routing around concave features.

## Out of scope

- Cel/quantized shading bands (queued next, separate spec).
- User-editable light rig (queued, separate spec).
- General visual QA sweep — seams, corner fans, extreme params — and the
  shading-panel "Light 3…Light 30+" row bug (queued, separate spec).
- Curved (arc) wavefront edges; the rim is polygonal after `simplifyRim`.
- Weighted/multi-speed skeletons.
