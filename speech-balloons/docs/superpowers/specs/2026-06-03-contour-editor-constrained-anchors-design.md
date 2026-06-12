# Contour editor — three constrained anchors with partition pushing points

## Purpose

Tighten the rim contour editor so the user can never accidentally cross the
bevel/spline seam, the partition handle (now at `x=b` AND a real seam y)
behaves like a first-class anchor, and the three constrained anchors are
visually distinct.

## Surface

Visual changes inside `RimContourBlock`:

- **Three goldenrod constrained anchors** at `x=0`, `x=b`, and `x=1`.
  - `x=0` and `x=1`: goldenrod diamonds.
  - `x=b`: goldenrod circle (the partition handle).
- **Partition handle is now y-draggable** in addition to x-draggable.
  Dragging it vertically updates the seam y of the contour curve.
- **Partition drag remaps anchors proportionally.** When the user slides the
  partition from `b_old` to `b_new`, bevel-side anchors compress/stretch to
  fit `[0, b_new]`; spline-side anchors compress/stretch to fit `[b_new, 1]`.
  No anchor ever crosses the seam.
- Intermediate (user-added) anchors continue to render as the default
  circles in the existing per-layer colors.

No new controls. No new sidebar UI. Internal behavior only.

## Data model

The seam at `x=b` becomes a **real anchor** in the stored flat values array.
Today it's synthesized via `interpFlat` when no anchor sits at `x=b`; that
fork goes away. After this change the array always contains a triplet at
`x=0`, `x=b`, `x=1` in addition to any intermediate anchors.

`splitFlatAtPartition` simplifies: it splits anchors by side around an
already-present seam, no synthesis. `mergeLayerPoints` simplifies the same
way.

A one-time migration on read: when the editor mounts (or `b` changes), if
the values array has no anchor within `SEAM_X_EPS` of the current `b`,
insert one with `y = interpFlat(values, b)` and emit `onContourChange`.

## Partition behavior

### Horizontal drag (`b_old → b_new`)

Piecewise-affine remap of every anchor:

- `x_old = 0` → `x_new = 0`
- `x_old ∈ (0, b_old)` → `x_new = x_old * (b_new / b_old)`
- `x_old = b_old` → `x_new = b_new`
- `x_old ∈ (b_old, 1)` → `x_new = b_new + (x_old − b_old) * (1 − b_new) / (1 − b_old)`
- `x_old = 1` → `x_new = 1`

All `y` values pass through unchanged.

When `b_old → 0` or `b_old → 1`, the formula would divide by zero. The
existing UI clamps `b` to `[0.05, 0.95]`, so the divisor is always
≥ 0.05 in practice — no special-case branch needed.

### Vertical drag

The partition handle has its own `y` value. Dragging it vertically sets the
seam anchor's `y` directly. No remap of other anchors.

### Combined

A single drag may move the handle in both axes. The handler computes the
new `b` and the new seam-y, then emits one combined update: the values
array is remapped (using `b_old → b_new`) with the seam anchor's y set to
the new dragged y.

## Pure helper

`src/contourEditor.ts` exports:

```ts
export function remapAcrossPartition(
  values: readonly number[],
  bOld: number,
  bNew: number,
  seamY: number,
): number[];
```

Pre/postconditions:

- Output is a flat number array of even length.
- Anchors are sorted by `x` ascending.
- Exactly one anchor sits within `SEAM_X_EPS` of `bNew` (the seam).
- Anchors at `x=0` and `x=1` are preserved (their `y` passes through; their
  `x` stays at 0 / 1 exactly).
- The relative ordering of intermediate anchors within each side is
  preserved.

Unit-testable in isolation; the React layer is a thin call site.

## React wire-up

`createPartitionLayer` updates:

- `PartitionState` becomes `{ x: number; y: number }`.
- `render` draws a goldenrod circle of radius ~5 at `(x, y)` instead of a
  vertical rect, plus the existing vertical dashed guide line.
- `hitTest` accepts a hit within ~10 px of the circle.
- `onPointerDown.onMove` returns `{ x, y }` (with the same `[0.05, 0.95]`
  x-clamp, and a `[0, 1]` y-clamp).

`RimContourBlock` updates:

- `onLayerChange('partition', next)` reads both `next.x` and `next.y`:
  - `bNew = next.x`, `bOld = bevelWidth / dMax` (the partition's previous x).
  - `remapped = remapAcrossPartition(values, bOld, bNew, next.y)`.
  - Emit `onContourChange(remapped)` AND `onBevelWidthChange(bNew * dMax)`.
- `splitFlatAtPartition` simplifies (no synthesis).
- `mergeLayerPoints` simplifies (no two-seam dedup).

`createFunctionLayer` calls for both bevel and spline gain a `renderAnchor`
prop:

```tsx
renderAnchor: ({ index, cx, cy, isPinnedEndpoint, isEndpoint, point }) => {
  if (!isPinnedEndpoint) return undefined; // default circle
  // Endpoint at x === 0 or x === 1: goldenrod diamond.
  // Endpoint at x === b (seam): invisible — the partition layer's circle
  // is the only visible anchor at that x.
  if (Math.abs(point.x - 0) < SEAM_X_EPS || Math.abs(point.x - 1) < SEAM_X_EPS) {
    return <Diamond cx={cx} cy={cy} size={8} fill="goldenrod" />;
  }
  return null; // hide the seam endpoint
}
```

A tiny `Diamond` SVG component lives next to `RimContourBlock` in
`Lab.tsx` (same file — the existing pattern of inlining small helpers).

## Visual details

- Diamond: a rotated square, ~8 px diagonal, goldenrod fill, no stroke.
- Partition circle: r=5, goldenrod fill, a 1.5 px goldenrod stroke matches
  the dashed guide line.
- Both render *above* the curve fills so they stay visible.

## Out of scope

- Unifying the two-layer view into a single layer (deferred; not needed for
  this fix).
- Per-anchor labels or readouts.
- Snapping (no x-snap, no y-snap).
- Undo coalescing beyond what already exists.

## Non-goals

- The bevel/spline color identity stays (goldenrod fill on bevel, purple
  stroke on spline). Only the constrained anchors switch to goldenrod.
- The "shading layers" panel work (parallel task) does not touch this
  area; the two changes are file-disjoint except both modify `Lab.tsx`.
