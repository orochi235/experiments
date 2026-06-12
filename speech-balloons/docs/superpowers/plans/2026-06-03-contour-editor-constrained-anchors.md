# Contour editor — three constrained anchors — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the rim-contour editor's three constrained anchors (`x=0`, `x=b`, `x=1`) visually distinct goldenrod shapes, let the partition handle at `x=b` drag both horizontally and vertically, and ensure dragging the partition pushes intermediate anchors proportionally instead of letting them cross the seam.

**Architecture:** Promote the seam to a real anchor in the stored flat values array. A new pure helper `remapAcrossPartition(values, bOld, bNew, seamY)` does the piecewise-affine remap. `createPartitionLayer` becomes 2D (`{x, y}`); its drag handler in `RimContourBlock` writes both `bevelWidth` and the remapped contour in one round-trip. The two function layers gain a `renderAnchor` callback that draws goldenrod diamonds at the editor's outer edges and returns `null` at the seam (where the partition's circle is the only visible anchor).

**Tech Stack:** React 18, TypeScript, `@orochi235/weasel/react` (`createFunctionLayer`, `CurveLayer`, `ControlPoint`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-contour-editor-constrained-anchors-design.md`

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/contourEditor.ts` | Pure helper: `remapAcrossPartition` + the `SEAM_X_EPS` constant (relocated from `Lab.tsx`) | Create |
| `src/contourEditor.test.ts` | Unit tests for `remapAcrossPartition` | Create |
| `src/Lab.tsx` | Update `PartitionState`, `createPartitionLayer`, `splitFlatAtPartition`, `mergeLayerPoints`, `RimContourBlock`, plus a small `Diamond` SVG helper | Modify |

`Lab.tsx` is already large; the temptation to split is real, but the affected functions live close together and the file's existing pattern is to keep curve-editor helpers inline. Keep them there.

---

### Task 1: Extract `SEAM_X_EPS` + add `remapAcrossPartition` helper with tests

**Files:**
- Create: `src/contourEditor.ts`
- Create: `src/contourEditor.test.ts`
- Modify: `src/Lab.tsx` (replace its inline `SEAM_X_EPS` declaration with an import)

- [ ] **Step 1: Write the failing tests**

`src/contourEditor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { remapAcrossPartition, SEAM_X_EPS } from './contourEditor';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('remapAcrossPartition', () => {
  it('preserves the x=0 and x=1 anchors exactly', () => {
    const values = [0, 0.2, 0.3, 0.5, 1, 0.9];
    const out = remapAcrossPartition(values, 0.3, 0.6, 0.5);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.2, 9);
    expect(out[out.length - 2]).toBe(1);
    expect(out[out.length - 1]).toBeCloseTo(0.9, 9);
  });

  it('places exactly one anchor at x=bNew with y=seamY', () => {
    const values = [0, 0, 0.3, 0.5, 1, 1];
    const out = remapAcrossPartition(values, 0.3, 0.7, 0.42);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    const seamHits = cpts.filter(([x]) => Math.abs(x - 0.7) < SEAM_X_EPS);
    expect(seamHits).toHaveLength(1);
    expect(seamHits[0]![1]).toBeCloseTo(0.42, 9);
  });

  it('compresses bevel-side anchors proportionally when partition moves left', () => {
    // Old bevel range (0, 0.4) with a mid anchor at x=0.2 (halfway).
    // New bevel range (0, 0.1): mid anchor should remap to x=0.05 (still halfway).
    const values = [0, 0, 0.2, 0.7, 0.4, 0.9, 1, 1];
    const out = remapAcrossPartition(values, 0.4, 0.1, 0.9);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    cpts.sort((a, b) => a[0] - b[0]);
    expect(cpts.find(([x]) => close(x, 0.05))).toBeDefined();
    // No anchor on the new spline side (>0.1) should originate from old bevel side.
    const splineSide = cpts.filter(([x]) => x > 0.1 + SEAM_X_EPS && x < 1 - SEAM_X_EPS);
    expect(splineSide.every(([_x, y]) => y === 0.9 || y === undefined || y >= 0)).toBe(true);
  });

  it('stretches spline-side anchors proportionally when partition moves left', () => {
    // Old spline range (0.4, 1) with a mid anchor at x=0.7 (halfway).
    // New spline range (0.1, 1): mid anchor should remap to x=0.55 (still halfway).
    const values = [0, 0, 0.4, 0.5, 0.7, 0.2, 1, 1];
    const out = remapAcrossPartition(values, 0.4, 0.1, 0.5);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    cpts.sort((a, b) => a[0] - b[0]);
    expect(cpts.find(([x]) => close(x, 0.55))).toBeDefined();
  });

  it('returns a sorted, even-length, no-duplicate-seam flat array', () => {
    const values = [0, 0, 0.3, 0.5, 1, 1];
    const out = remapAcrossPartition(values, 0.3, 0.6, 0.42);
    expect(out.length % 2).toBe(0);
    const xs: number[] = [];
    for (let i = 0; i < out.length; i += 2) xs.push(out[i]!);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
    const seamHits = xs.filter((x) => Math.abs(x - 0.6) < SEAM_X_EPS);
    expect(seamHits).toHaveLength(1);
  });

  it('handles the case where the input has no existing seam anchor', () => {
    // values has no anchor at x=0.3; helper should still emit one at x=bNew.
    const values = [0, 0, 0.2, 0.4, 0.8, 0.6, 1, 1];
    const out = remapAcrossPartition(values, 0.5, 0.5, 0.55);
    // bOld == bNew here: every non-seam x is unchanged.
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    expect(cpts.find(([x, y]) => close(x, 0.5) && close(y, 0.55))).toBeDefined();
    expect(cpts.find(([x, y]) => close(x, 0.2) && close(y, 0.4))).toBeDefined();
    expect(cpts.find(([x, y]) => close(x, 0.8) && close(y, 0.6))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run src/contourEditor.test.ts
```

Expected: FAIL — `Cannot find module './contourEditor'`.

- [ ] **Step 3: Implement the helper**

`src/contourEditor.ts`:

```ts
/**
 * Anchors closer than this in x are treated as the same point (seam
 * dedup, endpoint dedup). Kept tight so legitimate sub-pixel placement
 * still works.
 */
export const SEAM_X_EPS = 1e-4;

type Anchor = { x: number; y: number };

function flatToAnchors(flat: readonly number[]): Anchor[] {
  const out: Anchor[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

function anchorsToFlat(anchors: readonly Anchor[]): number[] {
  const out: number[] = [];
  for (const a of anchors) out.push(a.x, a.y);
  return out;
}

/**
 * Piecewise-affine remap of contour anchors when the partition at x=b
 * moves from `bOld` to `bNew`, with the seam y forced to `seamY`.
 *
 * Mapping rules:
 *   x = 0         → 0
 *   x ∈ (0, bOld) → x * (bNew / bOld)
 *   x = bOld      → bNew    (this anchor becomes the seam at y=seamY)
 *   x ∈ (bOld, 1) → bNew + (x − bOld) * (1 − bNew) / (1 − bOld)
 *   x = 1         → 1
 *
 * Postconditions:
 *   - exactly one anchor at x within SEAM_X_EPS of bNew (with y = seamY)
 *   - anchors sorted by x ascending
 *   - endpoints at x=0 and x=1 preserved
 *
 * Assumes 0 < bOld < 1 and 0 < bNew < 1 (the partition is UI-clamped to
 * [0.05, 0.95], so the divisors are never near zero in practice).
 */
export function remapAcrossPartition(
  values: readonly number[],
  bOld: number,
  bNew: number,
  seamY: number,
): number[] {
  const anchors = flatToAnchors(values);
  const bevelScale = bNew / bOld;
  const splineScale = (1 - bNew) / (1 - bOld);

  const remapped: Anchor[] = [];
  for (const a of anchors) {
    // Skip the old seam — we always emit a fresh one below.
    if (Math.abs(a.x - bOld) < SEAM_X_EPS) continue;
    // Endpoints pass through with x clamped to 0/1.
    if (a.x <= 0) { remapped.push({ x: 0, y: a.y }); continue; }
    if (a.x >= 1) { remapped.push({ x: 1, y: a.y }); continue; }
    // Interior: remap by side.
    if (a.x < bOld) remapped.push({ x: a.x * bevelScale, y: a.y });
    else            remapped.push({ x: bNew + (a.x - bOld) * splineScale, y: a.y });
  }
  // Emit the fresh seam anchor.
  remapped.push({ x: bNew, y: seamY });
  // Sort by x; in case of near-duplicate (numerical) seam vs interior,
  // sort is stable enough — the SEAM_X_EPS dedup below trims any neighbor
  // that landed within epsilon of the seam.
  remapped.sort((a, b) => a.x - b.x);
  // Dedup near-duplicates by x, preferring the seam-y at x=bNew.
  const deduped: Anchor[] = [];
  for (const a of remapped) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.x - a.x) < SEAM_X_EPS) {
      // Keep whichever is the seam (x near bNew).
      if (Math.abs(a.x - bNew) < SEAM_X_EPS) deduped[deduped.length - 1] = a;
      // else: drop a; keep prev.
      continue;
    }
    deduped.push(a);
  }
  return anchorsToFlat(deduped);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run src/contourEditor.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Remove the inline `SEAM_X_EPS` constant from `Lab.tsx` and import it**

In `src/Lab.tsx`, find:

```ts
const SEAM_X_EPS = 1e-4;
```

(currently at `src/Lab.tsx:835` — verify with `grep -n "SEAM_X_EPS = 1e-4" src/Lab.tsx`)

Delete that line. Then near the top of `src/Lab.tsx`, where the other local imports live (search for `import { TailMinimap`), add:

```ts
import { remapAcrossPartition, SEAM_X_EPS } from './contourEditor';
```

- [ ] **Step 6: Verify the whole project still compiles and tests pass**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no new TS errors; all vitest suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/contourEditor.ts src/contourEditor.test.ts src/Lab.tsx
git commit -m "feat(speech-balloons): remapAcrossPartition helper for contour editor"
```

---

### Task 2: Extend `PartitionState` to `{x, y}` and make `createPartitionLayer` draw a circle

The partition handle becomes a 2D anchor: a goldenrod circle at `(b, seamY)`, draggable on both axes.

**Files:**
- Modify: `src/Lab.tsx`

- [ ] **Step 1: Update `PartitionState`**

Find:

```ts
interface PartitionState { x: number }
```

Replace with:

```ts
interface PartitionState { x: number; y: number }
```

- [ ] **Step 2: Replace `createPartitionLayer`**

Find the existing `createPartitionLayer` (currently `src/Lab.tsx:784–814`). Replace with:

```ts
function createPartitionLayer(): CurveLayer<PartitionState> {
  return {
    id: 'partition',
    render(state, ctx) {
      const plotPt = ctx.toPlot({ x: state.x, y: state.y });
      const h = ctx.plotSize.height;
      const guideStroke = ctx.isActive ? 'rgba(80,80,80,0.85)' : 'rgba(80,80,80,0.5)';
      return (
        <g>
          <line
            x1={plotPt.x}
            x2={plotPt.x}
            y1={0}
            y2={h}
            stroke={guideStroke}
            strokeDasharray="5 4"
            strokeWidth={1.5}
          />
          <circle
            cx={plotPt.x}
            cy={plotPt.y}
            r={5}
            fill="goldenrod"
            stroke="goldenrod"
            strokeWidth={1.5}
            style={{ cursor: 'move' }}
            data-anchor-index="partition"
          />
        </g>
      );
    },
    hitTest(state, plot, ctx) {
      const p = ctx.toPlot({ x: state.x, y: state.y });
      const dx = plot.x - p.x;
      const dy = plot.y - p.y;
      return dx * dx + dy * dy < 10 * 10 ? { kind: 'handle' } : null;
    },
    onPointerDown(_state, hit) {
      if (hit.kind !== 'handle') return;
      return {
        onMove(_state, model, _e, ctx) {
          const span = ctx.modelRange.xMax - ctx.modelRange.xMin;
          const pad = span * 0.05;
          const xLo = ctx.modelRange.xMin + pad;
          const xHi = ctx.modelRange.xMax - pad;
          const yLo = Math.min(ctx.modelRange.yMin, ctx.modelRange.yMax);
          const yHi = Math.max(ctx.modelRange.yMin, ctx.modelRange.yMax);
          return {
            x: Math.max(xLo, Math.min(xHi, model.x)),
            y: Math.max(yLo, Math.min(yHi, model.y)),
          };
        },
      };
    },
  };
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: errors at the `partitionLayer` state callsite in `RimContourBlock` (the state literal `{ x: b }` no longer satisfies the new `{x, y}` shape). That's expected — Task 3 fixes those.

- [ ] **Step 4: Commit**

Do NOT commit yet — Task 3's edits are required for type-check to pass. Continue to Task 3.

---

### Task 3: Update `RimContourBlock` to seed the seam, drive the partition with `{x, y}`, and call `remapAcrossPartition`

This is the integration task: migrate the values array to include a seam anchor on mount, drive the partition's `{x, y}` state from the contour, and route partition drags through `remapAcrossPartition`.

**Files:**
- Modify: `src/Lab.tsx`

- [ ] **Step 1: Add a small `seamYFromValues` helper near the other helpers**

Just above `function RimContourBlock(`, add:

```ts
// Pulls the y of the seam anchor at x≈b out of a flat values array, or
// falls back to a linear-interp estimate if the array hasn't been
// migrated to include one yet (first render).
function seamYFromValues(values: readonly number[], b: number): number {
  for (let i = 0; i + 1 < values.length; i += 2) {
    if (Math.abs(values[i]! - b) < SEAM_X_EPS) return values[i + 1]!;
  }
  return interpFlat(values, b);
}
```

- [ ] **Step 2: Add migration effect inside `RimContourBlock`**

Inside `RimContourBlock` (currently `src/Lab.tsx:898–986`), right after the `const b = Math.max(0.05, Math.min(0.95, …))` line, add:

```ts
// One-time per (b, values) migration: ensure a real anchor exists at
// x≈b so splitFlatAtPartition / mergeLayerPoints can rely on it.
useEffect(() => {
  const hasSeam = (() => {
    for (let i = 0; i + 1 < values.length; i += 2) {
      if (Math.abs(values[i]! - b) < SEAM_X_EPS) return true;
    }
    return false;
  })();
  if (hasSeam) return;
  const seamY = interpFlat(values, b);
  const next: number[] = [];
  let inserted = false;
  const cpts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) cpts.push({ x: values[i]!, y: values[i + 1]! });
  cpts.sort((a, c) => a.x - c.x);
  for (const p of cpts) {
    if (!inserted && p.x > b) {
      next.push(b, seamY);
      inserted = true;
    }
    next.push(p.x, p.y);
  }
  if (!inserted) next.push(b, seamY);
  onContourChange(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [b]);
```

Ensure `useEffect` is in the React import at the top of `Lab.tsx`. (Search for `from 'react'` and confirm `useEffect` is listed; if not, add it.)

- [ ] **Step 3: Update `partitionLayer` state literal**

Find:

```ts
{ layer: partitionLayer, state: { x: b } as PartitionState },
```

Replace with:

```ts
{ layer: partitionLayer, state: { x: b, y: seamYFromValues(values, b) } as PartitionState },
```

- [ ] **Step 4: Rewrite the `partition` branch of `onLayerChange`**

Find:

```ts
} else if (id === 'partition') {
  const next = nextUnknown as PartitionState;
  onBevelWidthChange(next.x * dMax);
}
```

Replace with:

```ts
} else if (id === 'partition') {
  const next = nextUnknown as PartitionState;
  const bOld = b;
  const bNew = next.x;
  const seamY = next.y;
  const remapped = remapAcrossPartition(values, bOld, bNew, seamY);
  onContourChange(remapped);
  onBevelWidthChange(bNew * dMax);
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run the existing test suite**

```bash
npx vitest run
```

Expected: all tests pass (66 tests — 65 previous + 6 new contourEditor tests, minus any that overlapped).

- [ ] **Step 7: Commit**

```bash
git add src/Lab.tsx
git commit -m "feat(speech-balloons): partition handle drives seam x+y; remap on horizontal drag"
```

---

### Task 4: Goldenrod diamond `renderAnchor` for the outer constrained anchors

The bevel layer's `x=0` endpoint and the spline layer's `x=1` endpoint render as goldenrod diamonds. Each layer's seam-side endpoint renders as `null` so the partition's circle is the only visible anchor at `x=b`.

**Files:**
- Modify: `src/Lab.tsx`

- [ ] **Step 1: Add a `Diamond` SVG helper**

Above `function RimContourBlock(`, add:

```tsx
function Diamond({ cx, cy, size = 8, fill = 'goldenrod' }: { cx: number; cy: number; size?: number; fill?: string }) {
  const r = size / 2;
  return (
    <polygon
      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
      fill={fill}
    />
  );
}
```

- [ ] **Step 2: Import `AnchorRenderProps` (if it isn't already)**

Confirm the existing `import { … } from '@orochi235/weasel/react'` block includes the types we need. If `AnchorRenderProps` isn't already imported, add it. Search for the existing weasel import and update it; e.g. it should look like:

```ts
import {
  LayeredCurveEditor,
  createFunctionLayer,
  type AnchorRenderProps,
  type ControlPoint,
  type CurveLayer,
  type FunctionLayerState,
} from '@orochi235/weasel/react';
```

(Verify the actual import path with `grep -n "createFunctionLayer" src/Lab.tsx`. The subagent's recent commits did not touch this import; the existing path is `'@orochi235/weasel/react'`.)

- [ ] **Step 3: Add `renderAnchor` to `bevelLayer`**

Find the existing `createFunctionLayer({ id: 'bevel', … })` call (currently `src/Lab.tsx:923–931`). Add a `renderAnchor` config option:

```ts
const bevelLayer = useMemo(() => createFunctionLayer({
  id: 'bevel',
  domain: '1d',
  endpoints: 'pinned-x',
  constrain: 'function',
  addPointMode: 'click-curve',
  fill: { side: 'below' },
  xClamp: [0, b],
  minPoints: 2,
  renderAnchor: ({ cx, cy, point, isPinnedEndpoint }: AnchorRenderProps) => {
    if (!isPinnedEndpoint) return undefined; // default circle for user anchors
    // x=0 endpoint: goldenrod diamond. Seam endpoint (x≈b): hidden — the
    // partition layer's circle is the visible anchor at the seam.
    if (Math.abs(point.x) < SEAM_X_EPS) return <Diamond cx={cx} cy={cy} />;
    return null;
  },
}), [b]);
```

- [ ] **Step 4: Add `renderAnchor` to `splineLayer`**

Find the existing `createFunctionLayer({ id: 'spline', … })` call. Add the mirror:

```ts
const splineLayer = useMemo(() => createFunctionLayer({
  id: 'spline',
  domain: '1d',
  endpoints: 'pinned-x',
  constrain: 'function',
  addPointMode: 'click-curve',
  xClamp: [b, 1],
  minPoints: 2,
  renderAnchor: ({ cx, cy, point, isPinnedEndpoint }: AnchorRenderProps) => {
    if (!isPinnedEndpoint) return undefined;
    // x=1 endpoint: goldenrod diamond. Seam endpoint (x≈b): hidden.
    if (Math.abs(point.x - 1) < SEAM_X_EPS) return <Diamond cx={cx} cy={cy} />;
    return null;
  },
}), [b]);
```

- [ ] **Step 5: Type-check and run tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no errors; all tests still pass (no test deltas — purely visual change).

- [ ] **Step 6: Commit**

```bash
git add src/Lab.tsx
git commit -m "feat(speech-balloons): goldenrod diamonds for x=0 and x=1 constrained anchors"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run the full suite**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no TS errors beyond the pre-existing baseline (Lab.tsx:171 `Record<string, unknown>` cast); all vitest tests pass.

- [ ] **Step 2: Manual browser walk-through**

`npm run dev`, open the Lab, switch fill mode to `dome`, expand "Dome shape":

1. Confirm the three constrained anchors render as goldenrod: diamonds at the left and right edges of the curve, a circle on the partition guide line.
2. Drag the partition handle horizontally — confirm intermediate anchors slide proportionally and never appear on the wrong side of the seam.
3. Drag the partition handle vertically — confirm the seam y on both layers (bevel boundary, spline boundary) updates.
4. Drag the partition diagonally — confirm both effects happen smoothly in one gesture.
5. Add intermediate anchors on each side; drag the partition past where they originally were and confirm they compress instead of jumping sides.
6. Drag a bevel-side intermediate anchor — confirm it can't be dragged past the partition.
7. Drag a left or right endpoint vertically (these now use diamond hit-targets) — confirm the curve still responds and the y updates.

- [ ] **Step 3: No further commits**

The plan's per-task commits cover the change set.

---

## Self-review

- **Spec coverage:**
  - Three constrained goldenrod anchors → Task 4 (outer diamonds) + Task 2 (middle circle). ✓
  - Partition y-draggability → Task 2 (`createPartitionLayer` returns `{x, y}`). ✓
  - Partition horizontal drag remaps anchors → Task 1 (`remapAcrossPartition`) + Task 3 (wiring). ✓
  - Seam migrated to a real anchor → Task 3 Step 2 (migration effect). ✓ `splitFlatAtPartition`/`mergeLayerPoints` retain today's synthesis fallback for the transient pre-migration render; the spec's "simplification" goal becomes nice-to-have, dropped to avoid a broken intermediate commit.
  - One round-trip on combined drag → Task 3 Step 4 (single `onLayerChange` branch emits both updates). ✓
  - Visual details (diamond size 8, circle r=5, goldenrod, stroke 1.5) → Tasks 2 + 4. ✓

- **Placeholder scan:** no TBD/TODO; each code step is complete.

- **Type consistency:**
  - `SEAM_X_EPS` defined in Task 1, imported in Tasks 3/4. ✓
  - `remapAcrossPartition(values, bOld, bNew, seamY)` defined in Task 1 with this signature; called identically in Task 3 Step 4. ✓
  - `PartitionState` field set `{x, y}` consistent across Tasks 2 and 3. ✓
  - `seamYFromValues` defined in Task 3 Step 1, used in Task 3 Step 3. ✓
  - `Diamond` defined in Task 4 Step 1, used in Task 4 Steps 3–4. ✓
  - `AnchorRenderProps` import in Task 4 Step 2 used in Task 4 Steps 3–4. ✓

- **Non-blocking note:** the migration in Task 3 Step 2 runs when `b` changes. If the user manually edits the JSON-persisted contour to remove the seam, the next mount re-inserts it. Good behavior.
