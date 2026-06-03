# Dome Shading Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five coupled improvements to the multi-light dome:
1. Eliminate wedge seams by sub-slicing each light's wedge into N angular pie wedges, each painted by its own radial gradient.
2. Add a yellow vertical band on the contour editor marking the bevel ridge x-range.
3. Add a "Flip vertically" button to the contour editor.
4. Cap the `bevelWidth` slider at the body's geometric medial-axis distance (so the user cannot push past where the inset would self-intersect).
5. Fix the debug overlay's bevel ring to use a geometrically correct inward offset (sharp corners stay sharp; concavity overshoot disappears).

**Architecture:** In `speech-balloons`, the renderer keeps using SVG `<linearGradient>` but emits many short radial-aligned gradients (one per sub-slice) instead of one axis-aligned gradient per light. The bevel cap and the corrected inset overlay both use the existing `clipper2-ts` dependency via `src/clipping.ts` — `offsetClosedPolygon(body, -bw, 'miter')` gives the geometrically correct inset, and a binary search over `bw` finds the largest value at which clipper still returns at least one closed polygon. In `labkit`, `CurveField` gains an optional `marks` prop and a "Flip vertically" button; `Lab.tsx` computes both the bevel-ridge band x-range and the slider's `maxFn` cap from a single hoisted `BaseSampler` instance.

**Tech Stack:** React + TypeScript (Vite), Vitest, weasel-ui CurveEditor (via labkit passthrough), SVG-native rendering, `clipper2-ts` for polygon offset.

**Spec:** `docs/superpowers/specs/2026-06-02-wedge-seam-fix-design.md`

---

## File Structure

**`speech-balloons` (`/Users/mike/src/experiments/speech-balloons`):**

- `src/SpeechBalloon.tsx` — module-scope: add `subdivideArc`, `buildSliceWedgePath`, `sampleSliceStops`, `bareBaseRadiusRange`; export `bareBaseBBox` and `bareBaseRadiusRange`; rewrite `domeLayers` memo to emit one entry per sub-slice; rewrite `domeDebug` memo to use clipper inset; JSX loop unchanged in shape (polyline → path swap for the bevel ring).
- `src/geometry.ts` — add `bareBaseMaxBevel(sampler)` using binary search over `offsetClosedPolygon`.
- `src/controls.ts` — widen `maxFn` signature to accept `sampler?: BaseSampler`; update `bevelWidth` `maxFn` to use `bareBaseMaxBevel`.
- `src/dome.test.ts` — append `describe` blocks for the new helpers.
- `src/Lab.tsx` — thread `bodyShape`/`bodyParams` through `EffectLayerStackProps`, `ControlListProps`, `renderRow`; hoist a single `BaseSampler` instance per `renderRow` call and use it for both the bevel-ridge `marks` band (D2) and the `maxFn({ W, H, sampler })` cap (F2). `CurveBlock` forwards `marks` to `KitCurveField`.

**`labkit` (`/Users/mike/src/labkit`):**

- `src/ui/properties/CurveField.tsx` — add `marks?` prop on `CurveFieldProps`; render absolutely-positioned overlay SVG inside `.lk-curve-field__plot` showing marks; add "Flip vertically" button + `handleFlipVertical`.
- `src/ui/properties/CurveField.less` — add `.lk-curve-field__plot` `position: relative` (if not already), `.lk-curve-field__marks` overlay positioning.
- `src/ui/properties/CurveField.test.tsx` — extend with marks rendering test + vertical-flip test.

---

## Phase Ordering

Phases B and C land in `labkit` first (small, isolated). Phase A's seam fix lands in `speech-balloons`. Phase D wires `Lab.tsx` to consume the new labkit `marks` prop. Visual verification is the last phase.

---

## Phase C — Vertical flip button (labkit)

### Task C1: `CurveField` "Flip vertically" button

**Files:**
- Modify: `/Users/mike/src/labkit/src/ui/properties/CurveField.tsx`
- Test: `/Users/mike/src/labkit/src/ui/properties/CurveField.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `CurveField.test.tsx` inside the existing `describe('CurveField', () => { ... })`:

```tsx
  it('flip vertically mirrors y through (min+max)/2 and keeps x order', () => {
    const onChange = vi.fn();
    render(
      <CurveField
        values={[0, -1, 0.3, 0.4, 1, 0.7]}
        min={-1}
        max={1}
        step={0.02}
        width={200}
        height={110}
        onChange={onChange}
      />,
    );
    screen.getByRole('button', { name: /flip vertically/i }).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    // (min+max)/2 = 0. -1 → 1, 0.4 → -0.4, 0.7 → -0.7. x order preserved.
    expect(onChange.mock.calls[0][0]).toEqual([0, 1, 0.3, -0.4, 1, -0.7]);
  });

  it('flip vertically with [0,1] range mirrors through 0.5', () => {
    const onChange = vi.fn();
    render(
      <CurveField
        values={[0, 0, 0.5, 0.25, 1, 1]}
        min={0}
        max={1}
        step={0.01}
        width={200}
        height={110}
        onChange={onChange}
      />,
    );
    screen.getByRole('button', { name: /flip vertically/i }).click();
    expect(onChange.mock.calls[0][0]).toEqual([0, 1, 0.5, 0.75, 1, 0]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/labkit && npx vitest run src/ui/properties/CurveField.test.tsx`
Expected: FAIL — `getByRole('button', { name: /flip vertically/i })` throws (no such button).

- [ ] **Step 3: Implement the button + handler**

In `/Users/mike/src/labkit/src/ui/properties/CurveField.tsx`, immediately after `handleFlip` (the horizontal flip), add:

```tsx
  const handleFlipVertical = useCallback(() => {
    const mid = (min + max) / 2;
    const flipped: number[] = new Array(values.length);
    for (let i = 0; i + 1 < values.length; i += 2) {
      flipped[i] = values[i]!;
      flipped[i + 1] = 2 * mid - values[i + 1]!;
    }
    onChange(flipped);
  }, [values, min, max, onChange]);
```

Then in the actions block, add a second button after "Flip horizontally":

```tsx
        <button type="button" className="lk-curve-field__action" onClick={handleFlipVertical}>
          Flip vertically
        </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/labkit && npx vitest run src/ui/properties/CurveField.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/labkit
git add src/ui/properties/CurveField.tsx src/ui/properties/CurveField.test.tsx
git commit -m "feat(properties): CurveField gains a 'Flip vertically' button

Mirrors each y through (min+max)/2, preserving x order."
```

---

## Phase B — Marks overlay on `CurveField` (labkit)

### Task B1: `marks` prop and overlay SVG

**Files:**
- Modify: `/Users/mike/src/labkit/src/ui/properties/CurveField.tsx`
- Modify: `/Users/mike/src/labkit/src/ui/properties/CurveField.less`
- Test: `/Users/mike/src/labkit/src/ui/properties/CurveField.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `CurveField.test.tsx`:

```tsx
  it('renders a band mark as a positioned overlay rect', () => {
    const { container } = render(
      <CurveField
        values={[0, 0, 1, 1]}
        min={0}
        max={1}
        step={0.01}
        width={200}
        height={110}
        marks={[{ kind: 'band', x: [0.2, 0.4], color: '#ffcc00' }]}
        onChange={() => {}}
      />,
    );
    const overlay = container.querySelector('.lk-curve-field__marks');
    expect(overlay).not.toBeNull();
    const rect = overlay!.querySelector('rect');
    expect(rect).not.toBeNull();
    // x = 0.2 * 200 = 40; width = (0.4 - 0.2) * 200 = 40.
    expect(rect!.getAttribute('x')).toBe('40');
    expect(rect!.getAttribute('width')).toBe('40');
    expect(rect!.getAttribute('fill')).toBe('#ffcc00');
  });

  it('renders a line mark as a positioned line', () => {
    const { container } = render(
      <CurveField
        values={[0, 0, 1, 1]}
        min={0}
        max={1}
        step={0.01}
        width={200}
        height={110}
        marks={[{ kind: 'line', x: 0.7, color: '#ffcc00' }]}
        onChange={() => {}}
      />,
    );
    const line = container.querySelector('.lk-curve-field__marks line');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('x1')).toBe('140');
    expect(line!.getAttribute('x2')).toBe('140');
    expect(line!.getAttribute('stroke')).toBe('#ffcc00');
  });

  it('omits the marks overlay when marks is undefined', () => {
    const { container } = render(
      <CurveField
        values={[0, 0, 1, 1]}
        min={0}
        max={1}
        step={0.01}
        width={200}
        height={110}
        onChange={() => {}}
      />,
    );
    expect(container.querySelector('.lk-curve-field__marks')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/labkit && npx vitest run src/ui/properties/CurveField.test.tsx`
Expected: FAIL — `marks` is not on the type and the overlay isn't rendered.

- [ ] **Step 3: Add `CurveMark` type and `marks` prop**

In `/Users/mike/src/labkit/src/ui/properties/CurveField.tsx`, above `CurveFieldProps`, add:

```tsx
export type CurveMark =
  | { kind: 'band'; x: [number, number]; color?: string }
  | { kind: 'line'; x: number; color?: string };
```

Append to `CurveFieldProps`:

```tsx
  /** Optional vertical marks overlaid on the plot (e.g. landmarks). */
  marks?: readonly CurveMark[];
```

Destructure `marks` in the function signature alongside the other props.

- [ ] **Step 4: Render the overlay SVG**

Inside `.lk-curve-field__plot`, immediately after the `<CurveEditor … />`, render the overlay:

```tsx
        {marks && marks.length > 0 && (
          <svg
            className="lk-curve-field__marks"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
          >
            {marks.map((m, i) => {
              const color = m.color ?? '#ffcc00';
              if (m.kind === 'band') {
                const x0 = Math.max(0, Math.min(1, m.x[0])) * width;
                const x1 = Math.max(0, Math.min(1, m.x[1])) * width;
                const left = Math.min(x0, x1);
                const w = Math.abs(x1 - x0);
                return (
                  <rect
                    key={i}
                    x={left}
                    y={0}
                    width={w}
                    height={height}
                    fill={color}
                    fillOpacity={0.18}
                  />
                );
              }
              const x = Math.max(0, Math.min(1, m.x)) * width;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={height}
                  stroke={color}
                  strokeWidth={1}
                />
              );
            })}
          </svg>
        )}
```

- [ ] **Step 5: Add overlay positioning CSS**

In `/Users/mike/src/labkit/src/ui/properties/CurveField.less`, add (or extend an existing `.lk-curve-field__plot` block):

```less
.lk-curve-field__plot {
  position: relative;
}
.lk-curve-field__marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
```

If `.lk-curve-field__plot` already has a `position: relative` rule, do not duplicate it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/mike/src/labkit && npx vitest run src/ui/properties/CurveField.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 7: Update `CurveField` index export**

Check `/Users/mike/src/labkit/src/ui/properties/index.ts`:

Run: `grep CurveField /Users/mike/src/labkit/src/ui/properties/index.ts`

If `CurveMark` is not exported, add it to the existing export from `CurveField`:

```ts
export { CurveField, type CurveFieldProps, type CurveMark } from './CurveField';
```

Otherwise leave alone.

- [ ] **Step 8: Build labkit so the consumer can pick up the change**

Run: `cd /Users/mike/src/labkit && npm run build`
Expected: clean build, no TS errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/mike/src/labkit
git add src/ui/properties/CurveField.tsx src/ui/properties/CurveField.less src/ui/properties/CurveField.test.tsx src/ui/properties/index.ts
git commit -m "feat(properties): CurveField supports optional vertical marks overlay

Renders <rect> for band marks and <line> for line marks at data-space x,
positioned over the editor plot."
```

---

## Phase A — Seam fix via angular sub-slicing (speech-balloons)

All Phase A tasks edit files in `/Users/mike/src/experiments/speech-balloons`.

### Task A1: `subdivideArc` helper

**Files:**
- Modify: `src/SpeechBalloon.tsx` (append module-scope helper near `buildLightWedgePath`)
- Test: `src/dome.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new describe block to `src/dome.test.ts`:

```ts
import {
  computeLitArcs,
  domeSurfaceTilt,
  subdivideArc,
  type PerimeterSampler,
} from './SpeechBalloon';

// ...existing imports/tests remain unchanged.

describe('subdivideArc', () => {
  // Circle of radius 50 centered at origin; angleSampler returns the rim
  // point in the centroid-radial direction `a`.
  const circle: PerimeterSampler = (a) => ({
    x: 50 * Math.cos(a),
    y: 50 * Math.sin(a),
    nx: Math.cos(a),
    ny: Math.sin(a),
  });

  it('returns N+1 angles spanning [a0, a1] with N >= min', () => {
    const out = subdivideArc(circle, 0, Math.PI / 4, [0, 0], 8, 4, 32);
    // Arc length on a circle of r=50 over a quarter-eighth radians:
    // s = 50 * (π/4) ≈ 39.27 → N = ceil(39.27 / 8) = 5; clamp to >=4 → 5.
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[out.length - 1]).toBeCloseTo(Math.PI / 4, 9);
    for (let i = 1; i < out.length; i++) {
      expect(out[i] - out[i - 1]).toBeCloseTo((Math.PI / 4) / 5, 9);
    }
  });

  it('clamps to min when the arc is very short', () => {
    const out = subdivideArc(circle, 0, 0.01, [0, 0], 8, 4, 32);
    expect(out.length).toBe(5); // N = 4 → 5 angles
  });

  it('clamps to max when the arc is very long', () => {
    const out = subdivideArc(circle, 0, 2 * Math.PI, [0, 0], 1, 4, 32);
    expect(out.length).toBe(33);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: FAIL — `subdivideArc` is not exported.

- [ ] **Step 3: Implement `subdivideArc`**

In `src/SpeechBalloon.tsx`, immediately after `buildLightWedgePath`, add:

```tsx
// Estimate the perimeter arc-length spanned by `angleSampler` between
// centroid-radial angles a0 and a1, by summing chord distances across
// 8 intermediate samples. Returns `N+1` evenly-spaced α boundaries with
// `N = clamp(ceil(arcLen / targetPxPerSlice), min, max)`.
export function subdivideArc(
  angleSampler: PerimeterSampler,
  a0: number,
  a1: number,
  _centroid: readonly [number, number],
  targetPxPerSlice = 8,
  min = 4,
  max = 32,
): number[] {
  const PROBE = 8;
  let prev = angleSampler(a0);
  let arcLen = 0;
  for (let i = 1; i <= PROBE; i++) {
    const a = a0 + ((a1 - a0) * i) / PROBE;
    const p = angleSampler(a);
    arcLen += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const N = Math.min(max, Math.max(min, Math.ceil(arcLen / Math.max(1e-6, targetPxPerSlice))));
  const out: number[] = new Array(N + 1);
  for (let i = 0; i <= N; i++) out[i] = a0 + ((a1 - a0) * i) / N;
  return out;
}
```

The `_centroid` parameter is accepted for symmetry with `buildLightWedgePath` (and future callers that might need to estimate radius from centroid) but is unused here since the sampler already returns world-space points.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: PASS — all previous tests plus the 3 new `subdivideArc` tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): subdivideArc helper for sub-slicing wedges"
```

### Task A2: `buildSliceWedgePath` helper

**Files:**
- Modify: `src/SpeechBalloon.tsx`
- Test: `src/dome.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/dome.test.ts`:

```ts
import {
  // ...existing imports
  buildSliceWedgePath,
} from './SpeechBalloon';

describe('buildSliceWedgePath', () => {
  const circle: PerimeterSampler = (a) => ({
    x: 100 + 50 * Math.cos(a),
    y: 100 + 50 * Math.sin(a),
    nx: Math.cos(a),
    ny: Math.sin(a),
  });

  it('starts at centroid, samples along the arc, closes the path', () => {
    const d = buildSliceWedgePath(circle, 0, Math.PI / 6, [100, 100], Math.PI / 60);
    expect(d.startsWith('M 100 100')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // π/6 / (π/60) = 10 → at least 10 L segments to perimeter, plus
    // closing L back to centroid.
    const lCount = (d.match(/ L /g) ?? []).length;
    expect(lCount).toBeGreaterThanOrEqual(10);
  });

  it('first perimeter sample is at angle a0', () => {
    const d = buildSliceWedgePath(circle, 0, Math.PI / 6, [100, 100], Math.PI / 60);
    // After "M 100 100", the next "L x y" should be the rim point at a=0:
    // (100 + 50, 100 + 0) = (150, 100).
    expect(d).toMatch(/M 100 100 L 150 100/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: FAIL — `buildSliceWedgePath` is not exported.

- [ ] **Step 3: Implement `buildSliceWedgePath`**

In `src/SpeechBalloon.tsx`, immediately after `subdivideArc`, add:

```tsx
// Pie-wedge SVG-d for a single angular slice on the body silhouette:
// centroid → arc(a0, a1) → centroid. Step density determined by
// `arcResolutionRad` so curved silhouettes don't visibly polygonize.
export function buildSliceWedgePath(
  angleSampler: PerimeterSampler,
  a0: number,
  a1: number,
  centroid: readonly [number, number],
  arcResolutionRad: number = Math.PI / 60,
): string {
  const span = a1 - a0;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / arcResolutionRad));
  let d = `M ${centroid[0]} ${centroid[1]}`;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (span * i) / steps;
    const p = angleSampler(a);
    d += ` L ${p.x} ${p.y}`;
  }
  d += ' Z';
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): buildSliceWedgePath for per-slice clipPaths"
```

### Task A3: `sampleSliceStops` helper

**Files:**
- Modify: `src/SpeechBalloon.tsx`
- Test: `src/dome.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/dome.test.ts`:

```ts
import {
  // ...existing imports
  sampleLightStops,
  sampleSliceStops,
} from './SpeechBalloon';

describe('sampleSliceStops', () => {
  const flatContour = () => 1;

  it('matches the lit half of sampleLightStops on a circular body', () => {
    // Unit-radius circular case: rLit = rFar = 1, sCentroid = 0.5.
    // axisAngleRad = light.az (rim direction = light direction).
    const sliceStops = sampleSliceStops({
      axisAngleRad: 0,
      rLocal: 1,
      rimTiltRad: 0,
      crownHeight: 0,
      bevelWidthPx: 0.1,
      lightAzimuthDeg: 0,
      lightElevationDeg: 30,
      lightIntensity: 1,
      contour: flatContour,
      samples: 16,
    });
    const lightStops = sampleLightStops({
      azimuthDeg: 0,
      elevationDeg: 30,
      rimTiltRad: 0,
      crownHeight: 0,
      rLit: 1,
      rFar: 1,
      bevelWidthPx: 0.1,
      contour: flatContour,
      samples: 16,
    });
    // sliceStops at offset s_new=r matches lightStops at s_old=(1-r)/2.
    // Iterate over the 0..0.5 (lit half) of lightStops, sample by sample,
    // and compare with the corresponding slice offsets.
    for (let i = 0; i <= 8; i++) {
      const r = i / 8;
      const sNew = r;
      const sOld = (1 - r) / 2;
      const slice = sliceStops.find((s) => Math.abs(s.offset - sNew) < 1e-9);
      const light = lightStops.find((s) => Math.abs(s.offset - sOld) < 1e-9);
      expect(slice).toBeDefined();
      expect(light).toBeDefined();
      expect(slice!.opacity).toBeCloseTo(light!.opacity, 6);
    }
  });

  it('emits samples+1 stops with strictly increasing offsets from 0 to 1', () => {
    const stops = sampleSliceStops({
      axisAngleRad: 0,
      rLocal: 50,
      rimTiltRad: 0,
      crownHeight: 0.4,
      bevelWidthPx: 10,
      lightAzimuthDeg: 30,
      lightElevationDeg: 45,
      lightIntensity: 1,
      contour: flatContour,
      samples: 16,
    });
    expect(stops).toHaveLength(17);
    expect(stops[0]!.offset).toBe(0);
    expect(stops[stops.length - 1]!.offset).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.offset).toBeGreaterThan(stops[i - 1]!.offset);
    }
  });

  it('contour multiplier is applied: zero contour produces zero opacity', () => {
    const zero = () => 0;
    const stops = sampleSliceStops({
      axisAngleRad: 0,
      rLocal: 50,
      rimTiltRad: 0,
      crownHeight: 0.5,
      bevelWidthPx: 10,
      lightAzimuthDeg: 0,
      lightElevationDeg: 30,
      lightIntensity: 1,
      contour: zero,
      samples: 8,
    });
    for (const s of stops) expect(s.opacity).toBe(0);
  });

  it('applies lightIntensity multiplicatively', () => {
    const a = sampleSliceStops({
      axisAngleRad: 0, rLocal: 50, rimTiltRad: 0, crownHeight: 0,
      bevelWidthPx: 10, lightAzimuthDeg: 0, lightElevationDeg: 30,
      lightIntensity: 1, contour: flatContour, samples: 8,
    });
    const b = sampleSliceStops({
      axisAngleRad: 0, rLocal: 50, rimTiltRad: 0, crownHeight: 0,
      bevelWidthPx: 10, lightAzimuthDeg: 0, lightElevationDeg: 30,
      lightIntensity: 0.5, contour: flatContour, samples: 8,
    });
    for (let i = 0; i < a.length; i++) {
      expect(b[i]!.opacity).toBeCloseTo(a[i]!.opacity * 0.5, 9);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: FAIL — `sampleSliceStops` is not exported.

- [ ] **Step 3: Implement `sampleSliceStops`**

In `src/SpeechBalloon.tsx`, immediately after `sampleLightStops`, add:

```tsx
export interface SliceStopInput {
  /** In-plane radial direction (centroid → rim) of this slice. */
  axisAngleRad: number;
  /** Body radius from centroid to perimeter at axisAngleRad, in px. */
  rLocal: number;
  rimTiltRad: number;
  crownHeight: number;
  bevelWidthPx: number;
  lightAzimuthDeg: number;
  lightElevationDeg: number;
  lightIntensity: number;
  contour: ContourFn;
  samples?: number;
}

// Per-slice brightness stops along a half-axis (s=0 centroid, s=1 rim) for a
// single sub-wedge. The in-plane normal points radially outward along
// `axisAngleRad`, so the gradient is correct for the slice's own direction
// rather than the light's azimuth — this is what kills the wedge seams.
export function sampleSliceStops(input: SliceStopInput): GradientStop[] {
  const SAMPLES = input.samples ?? 16;
  const azRad = (input.lightAzimuthDeg * Math.PI) / 180;
  const elRad = (input.lightElevationDeg * Math.PI) / 180;
  const Lx = Math.cos(azRad) * Math.cos(elRad);
  const Ly = Math.sin(azRad) * Math.cos(elRad);
  const Lz = Math.sin(elRad);

  const cosA = Math.cos(input.axisAngleRad);
  const sinA = Math.sin(input.axisAngleRad);
  const rLocal = Math.max(1e-6, input.rLocal);
  const bwNorm = Math.min(1, Math.max(0, input.bevelWidthPx / rLocal));

  const out: GradientStop[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES;
    const r = s;                                           // 0 = centroid, 1 = rim
    const tilt = domeSurfaceTilt(r, input.rimTiltRad, input.crownHeight, bwNorm);
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const N3x = cosA * cosTilt;
    const N3y = sinA * cosTilt;
    const N3z = sinTilt;
    const phys = Math.max(0, N3x * Lx + N3y * Ly + N3z * Lz);
    const paint = Math.max(0, input.contour(1 - r));
    out.push({ offset: s, opacity: input.lightIntensity * phys * paint });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: PASS — all previous tests plus the 4 new `sampleSliceStops` tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): sampleSliceStops for per-slice radial shading"
```

### Task A4: Export `bareBaseBBox` and add `bareBaseRadiusRange`

**Files:**
- Modify: `src/SpeechBalloon.tsx`
- Test: `src/dome.test.ts`

> Naming check — `buildBaseSampler` lives in `./geometry` (not `./baseSamplers`); the base-kind type is `BalloonBase` (not `BaseKind`); the params bag type is `ParamBag` (not `BaseParams`); to project an angle to a sampler s-coord at an arbitrary centroid use `angleToS(angleDeg, sampler, cx, cy)` (not `attachmentS`, whose `(boxW, boxH)` arguments are halved internally).

- [ ] **Step 1: Write the failing test**

Append to `src/dome.test.ts`:

```ts
import {
  // ...existing imports
  bareBaseRadiusRange,
} from './SpeechBalloon';
import { buildBaseSampler } from './geometry';

describe('bareBaseRadiusRange', () => {
  it('returns equal Rmin and Rmax (within 1%) for a circle base', () => {
    const sampler = buildBaseSampler('oval', {}, 100, 100);
    const { Rmin, Rmax } = bareBaseRadiusRange(sampler);
    expect(Rmax).toBeGreaterThan(40);
    expect(Rmax).toBeLessThan(60);
    expect(Math.abs(Rmax - Rmin) / Rmax).toBeLessThan(0.01);
  });

  it('Rmax/Rmin ≈ 2 for a 200×100 oval', () => {
    const sampler = buildBaseSampler('oval', {}, 200, 100);
    const { Rmin, Rmax } = bareBaseRadiusRange(sampler);
    expect(Rmax / Rmin).toBeGreaterThan(1.9);
    expect(Rmax / Rmin).toBeLessThan(2.1);
  });
});
```

(Confirm `'oval'` is a valid `BalloonBase` member by running `grep "BalloonBase" src/types.ts` — it should be one of `'rectangle' | 'oval' | 'polygon' | 'cloud'`. Use whichever name maps to "ellipse" in this codebase.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: FAIL — `bareBaseRadiusRange` not exported.

- [ ] **Step 3: Export `bareBaseBBox` and add `bareBaseRadiusRange`**

In `src/SpeechBalloon.tsx`, add `angleToS` to the existing import from `./geometry`:

```tsx
import {
  attachmentS,
  angleToS,
  // ...existing named imports
} from './geometry';
```

Change `function bareBaseBBox` to `export function bareBaseBBox`. Then immediately after it, add:

```tsx
// Min/max distance from the bare-base bbox centroid to the perimeter,
// sampled across 36 angles. Used by the contour-editor bevel-ridge band:
// on non-circular bodies the bevel ridge sits at different x = bw/R for
// different directions, so the band spans [bw/Rmax, bw/Rmin].
export function bareBaseRadiusRange(sampler: BaseSampler): { Rmin: number; Rmax: number } {
  const bb = bareBaseBBox(sampler);
  const cx = bb.x + bb.w / 2;
  const cy = bb.y + bb.h / 2;
  const N = 36;
  let Rmin = Infinity;
  let Rmax = 0;
  for (let i = 0; i < N; i++) {
    const angleDeg = (i / N) * 360;
    const sc = angleToS(angleDeg, sampler, cx, cy);
    const p = sampler.perimeterAt(sc);
    const r = Math.hypot(p.x - cx, p.y - cy);
    if (r < Rmin) Rmin = r;
    if (r > Rmax) Rmax = r;
  }
  if (!isFinite(Rmin)) return { Rmin: 0, Rmax: 0 };
  return { Rmin, Rmax };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): export bareBaseBBox + add bareBaseRadiusRange"
```

### Task A5: Restructure `domeLayers` memo to emit sub-slices

**Files:**
- Modify: `src/SpeechBalloon.tsx` (the `domeLayers` memo around line 756, and possibly the JSX loop that consumes it around line 960)

- [ ] **Step 1: Read the current `domeLayers` and consuming JSX**

Run: `cd /Users/mike/src/experiments/speech-balloons && sed -n '756,830p' src/SpeechBalloon.tsx`

Then: `cd /Users/mike/src/experiments/speech-balloons && sed -n '955,995p' src/SpeechBalloon.tsx`

Note the existing per-layer shape `{ clipD, x1, y1, x2, y2, intensity, stops }` and the JSX loop's `domeLayers.map((layer, i) => …)`. The new structure keeps that exact shape — we just emit more entries.

- [ ] **Step 2: Rewrite `domeLayers` memo**

Replace the `domeLayers = useMemo(...)` block (currently containing the per-light `arcs / clipD / sampleLightStops` logic) with the version below. Adjust the JSX loop later if and only if it references properties not in the new entries.

```tsx
  const domeLayers = useMemo(() => {
    if (fillRender.mode !== 'dome') return [];
    const bb = bareBaseBBox(sampler);
    if (bb.w <= 0 || bb.h <= 0) return [];
    const centroid: [number, number] = [bb.x + bb.w / 2, bb.y + bb.h / 2];
    const rimTiltRad = (fillRender.rimTilt * Math.PI) / 180;
    const bevelWidthPx = fillRender.bevelWidth;

    const flatContour = fillRender.contour;
    const cpts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < flatContour.length; i += 2) {
      cpts.push({ x: flatContour[i]!, y: flatContour[i + 1]! });
    }
    cpts.sort((a, b) => a.x - b.x);
    const contour = (x: number): number => {
      if (cpts.length === 0) return 0;
      if (x <= cpts[0]!.x) return cpts[0]!.y;
      if (x >= cpts[cpts.length - 1]!.x) return cpts[cpts.length - 1]!.y;
      let i = 0;
      while (i < cpts.length - 1 && cpts[i + 1]!.x < x) i++;
      const a = cpts[i]!;
      const b = cpts[i + 1]!;
      const u = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * u;
    };

    const out: Array<{
      clipD: string;
      x1: number; y1: number; x2: number; y2: number;
      intensity: number;
      stops: GradientStop[];
    }> = [];

    for (const light of domeLights) {
      const arcs = computeLitArcs(angleSampler, light.az, light.el, 240, rimTiltRad);
      for (const arc of arcs) {
        // computeLitArcs may return arcs where end < start (wrapped). Normalize
        // to a monotonically increasing range for subdivision math.
        let a0 = arc.start;
        let a1 = arc.end;
        if (a1 <= a0) a1 += 2 * Math.PI;
        const boundaries = subdivideArc(angleSampler, a0, a1, centroid, 8, 4, 32);
        for (let k = 0; k + 1 < boundaries.length; k++) {
          const aStart = boundaries[k]!;
          const aEnd = boundaries[k + 1]!;
          const aMid = (aStart + aEnd) / 2;
          const rimPoint = angleSampler(aMid);
          const rLocal = Math.hypot(rimPoint.x - centroid[0], rimPoint.y - centroid[1]);
          if (rLocal < 1e-6) continue;
          const clipD = buildSliceWedgePath(angleSampler, aStart, aEnd, centroid);
          const stops = sampleSliceStops({
            axisAngleRad: aMid,
            rLocal,
            rimTiltRad,
            crownHeight: fillRender.crownHeight,
            bevelWidthPx,
            lightAzimuthDeg: light.az,
            lightElevationDeg: light.el,
            lightIntensity: light.intensity,
            contour,
          });
          out.push({
            clipD,
            x1: centroid[0],
            y1: centroid[1],
            x2: centroid[0] + Math.cos(aMid) * rLocal,
            y2: centroid[1] + Math.sin(aMid) * rLocal,
            intensity: 1, // intensity already folded into stop opacity
            stops,
          });
        }
      }
    }

    return out;
  }, [
    fillRender.mode,
    fillRender.rimTilt,
    fillRender.crownHeight,
    fillRender.bevelWidth,
    fillRender.contour,
    sampler,
    angleSampler,
    domeLights,
  ]);
```

Note: `intensity` is folded into the per-stop opacity in `sampleSliceStops` (via the `lightIntensity` field), so we pass `intensity: 1` to the consumer to keep the existing JSX wrapper (`<g opacity={…}>`) inert. If the existing JSX hard-codes a `<g opacity={layer.intensity}>` wrapper, this still works correctly — the wrapper opacity becomes 1.

- [ ] **Step 3: Verify the JSX loop still type-checks**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx tsc --noEmit`
Expected: clean.

If the JSX references a layer field this version doesn't emit (e.g., `layer.someOldField`), update the JSX to use only the fields above.

- [ ] **Step 4: Run all tests to verify nothing else broke**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run`
Expected: all tests pass (50 existing + new ones from A1–A4).

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): dome renders per-slice sub-wedges to kill seams

Each light's lit arc is subdivided angularly (adaptive to perimeter length).
Each sub-wedge gets its own clipPath and a half-axis linearGradient with
stops sampled at the slice's own radial direction. Off-axis projection
error inside a wedge — the source of visible spoke seams on non-circular
bodies — is gone."
```

---

## Phase D — Wire bevel-ridge band into the contour control (Lab.tsx)

### Task D1: Thread `bodyShape`/`bodyParams` through the props chain

**Files:**
- Modify: `src/Lab.tsx`

- [ ] **Step 1: Identify the prop chain**

Read the existing `EffectLayerStackProps`, `ControlListProps`, and `renderRow` signature:

Run: `cd /Users/mike/src/experiments/speech-balloons && sed -n '70,82p;727,770p' src/Lab.tsx`

- [ ] **Step 2: Extend the interfaces**

In `src/Lab.tsx`, modify `EffectLayerStackProps`:

```tsx
interface EffectLayerStackProps {
  // ...existing fields
  bodyW?: number;
  bodyH?: number;
  bodyShape?: BaseKind;
  bodyParams?: BaseParams;
  // ...rest
}
```

(Confirm the existing `BaseKind`/`BaseParams` import names — adjust to whatever the file already imports for `design.base` and `design.baseParams` types.)

In `EffectLayerStack`, destructure `bodyShape, bodyParams` and forward to `ControlList`:

```tsx
            <ControlList
              controls={bodyControls}
              params={eff.params}
              onChange={(k, v) => onUpdateParam(eff.id, k, v)}
              bodyW={bodyW}
              bodyH={bodyH}
              bodyShape={bodyShape}
              bodyParams={bodyParams}
            />
```

Modify `ControlListProps` to include `bodyShape?: BaseKind; bodyParams?: BaseParams;` and forward to `renderRow`:

```tsx
function ControlList({ controls, params, onChange, bodyW, bodyH, bodyShape, bodyParams }: ControlListProps) {
  // ...
  const rows = visible.map((c) => renderRow(c, params, onChange, bodyW, bodyH, bodyShape, bodyParams));
```

Modify `renderRow` signature to accept the two new params:

```tsx
function renderRow(
  c: LabControl,
  params: ParamBag,
  onChange: (key: string, value: ParamValue) => void,
  bodyW?: number,
  bodyH?: number,
  bodyShape?: BaseKind,
  bodyParams?: BaseParams,
): React.ReactNode {
```

At every `<EffectLayerStack …/>` call site (3 of them — Morph + 2× Fill panels around lines 599, 612, plus any other), add:

```tsx
              bodyShape={design.base}
              bodyParams={design.baseParams}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/Lab.tsx
git commit -m "refactor(speech-balloons): thread bodyShape/bodyParams through control rendering"
```

### Task D2: Compute and pass the bevel-ridge band to the contour control

**Files:**
- Modify: `src/Lab.tsx`
- Modify: `src/SpeechBalloon.tsx` (only if `bareBaseRadiusRange` needs `BaseSampler` type re-export — verify)

- [ ] **Step 1: Verify imports**

Lab.tsx needs `buildBaseSampler` and `bareBaseRadiusRange`. Run:

Run: `cd /Users/mike/src/experiments/speech-balloons && grep -n "buildBaseSampler\|bareBaseRadiusRange\|bareBaseBBox" src/Lab.tsx`

If absent, add to the top of `src/Lab.tsx`:

```tsx
import { buildBaseSampler } from './baseSamplers';
import { bareBaseRadiusRange } from './SpeechBalloon';
```

(Adjust path/name to whatever `buildBaseSampler` is actually exported as — confirm with `grep -n "export.*buildBaseSampler\|export.*BaseSampler" /Users/mike/src/experiments/speech-balloons/src/baseSamplers.ts`.)

Also add the `CurveMark` type import:

```tsx
import { type CurveMark } from '@labkit/react';
```

(If the import path is `@labkit/react/properties` or different, match the existing `CurveField` import path.)

- [ ] **Step 2: Extend `CurveBlockProps` and forward `marks`**

In `src/Lab.tsx`, modify the `CurveBlockProps` interface:

```tsx
interface CurveBlockProps {
  // ...existing fields
  marks?: readonly CurveMark[];
}
```

In `CurveBlock`, destructure `marks` and forward:

```tsx
function CurveBlock({ label, values, min, max, step, defaults, marks, onChange }: CurveBlockProps) {
  // ...
        <KitCurveField values={values} min={min} max={max} step={step} width={width} defaults={defaults} marks={marks} onChange={onChange} />
```

- [ ] **Step 3: Compute marks in `renderRow` for the contour control**

In `renderRow`, replace the existing `kind === 'curve'` branch with:

```tsx
  if (c.kind === 'curve') {
    const arr = Array.isArray(value) ? (value as number[]) : c.defaults;
    let marks: readonly CurveMark[] | undefined;
    if (
      c.key === 'contour' &&
      typeof params.bevelWidth === 'number' &&
      bodyW !== undefined &&
      bodyH !== undefined &&
      bodyShape !== undefined &&
      bodyParams !== undefined
    ) {
      const sampler = buildBaseSampler(bodyShape, bodyParams, bodyW, bodyH);
      const { Rmin, Rmax } = bareBaseRadiusRange(sampler);
      if (Rmin > 1e-3 && Rmax > 1e-3) {
        const xMax = Math.min(1, params.bevelWidth / Rmin);
        const xMin = Math.min(1, params.bevelWidth / Rmax);
        marks = [{ kind: 'band', x: [xMin, xMax], color: '#ffcc00' }];
      }
    }
    return (
      <CurveBlock
        key={c.key}
        label={c.label}
        values={arr}
        min={c.min}
        max={c.max}
        step={c.step}
        defaults={c.defaults}
        marks={marks}
        onChange={(vals) => onChange(c.key, vals)}
      />
    );
  }
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/Lab.tsx
git commit -m "feat(speech-balloons): contour editor shows bevel-ridge band

The yellow band marks x = bevelWidth/R on the contour editor's rim→center
axis. Because R varies per direction on non-circular bodies the mark is a
band [bw/Rmax, bw/Rmin], collapsing to a thin line on circles."
```

---

## Phase E — Visual verification

### Task E1: Manual verification in the dev server

**Files:** none modified.

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/mike/src/experiments/speech-balloons && npm run dev`
Expected: server listening on the default port (typically 5180).

- [ ] **Step 2: Verify v1 parity**

In the app, set `rimTilt = 0`, `crownHeight = 0`, flat contour `[0, 1, 1, 1]`. On both a circle (W = H = 100) and a long rectangle (e.g. 200 × 80), confirm the dome looks indistinguishable from the previous build at the same params. (No visible spoke seams, no banding.)

- [ ] **Step 3: Verify seam fix on non-circular bodies**

Set a long rectangle (200 × 60), `rimTilt = 30°`, `crownHeight = 0.4`, one key light from the side, second light dim. Visually confirm: previously visible radial spoke seams along where wedges met (especially near rounded corners) are now gone or significantly attenuated.

- [ ] **Step 4: Verify debug overlay still draws correctly**

Toggle the "Dome debug overlay" runtime checkbox. Confirm:
- Red silhouette ring still matches the body outline.
- Yellow bevel band ring (perimeter inset by `bevelWidth`) still draws.
- Light azimuth rays still point from centroid to the actual rim per light.
- Sub-slice clipPaths do not visibly bleed past the body silhouette.

- [ ] **Step 5: Verify bevel-ridge band on contour editor**

With the dome fill effect selected, watch the contour editor: a translucent yellow vertical band should be visible at the bevel-ridge x. Drag `bevelWidth` from 0 to a large value — the band widens to the right (toward x = 1 = center). On a circle, the band collapses to a thin strip. On a long rectangle, the band visibly spans an x-range.

- [ ] **Step 6: Verify Flip vertically button**

Click "Flip vertically" in the contour editor. The curve should mirror through the y-midline (0 for `[-1, 1]`, 0.5 for `[0, 1]`). The dome rendering should update accordingly (lit/dark inversion in the shading).

- [ ] **Step 7: Verify bevel-cap clamps the slider**

On a sharp 200×60 rectangle, the `Bevel width` slider's max should be approximately `29 px` (medial axis distance × 0.98). On a cloud body with deep lobes, the max should drop well below `min(W,H)/3`. Dragging the slider to the max should never cause the debug-overlay inset polygon to disappear or invert.

- [ ] **Step 8: Verify corrected inset overlay**

Toggle the debug overlay on a sharp 200×60 rectangle, `bw = 20`. The yellow inset polygon should be a smaller centered sharp rectangle (160×20), not a diagonally-chamfered shape. On a rounded rectangle with `r = 30, bw = 20`, the inset's corner radius should visibly equal `r − bw = 10`. On a cloud, the inset should not show inverted/self-crossing geometry at the slider's new max.

- [ ] **Step 9: If any check fails**

File the visual regression with a screenshot in the conversation and pause for direction. Do not start fixes without confirmation.

- [ ] **Step 10: Update the handoff doc**

Edit `docs/superpowers/handoffs/2026-06-02-multi-light-dome-v2.md` to note that wedge-seam fix shipped (commit refs), and that the open issues list now drops the wedge-seam item.

Run: `cd /Users/mike/src/experiments/speech-balloons && git add docs/superpowers/handoffs/2026-06-02-multi-light-dome-v2.md && git commit -m "docs(speech-balloons): handoff — wedge seams fixed via angular sub-slicing"`

---

## Phase F — Bevel cap & corrected inset overlay (speech-balloons)

All Phase F tasks edit files in `/Users/mike/src/experiments/speech-balloons`. Uses the existing `clipper2-ts` dependency via `src/clipping.ts`.

### Task F1: `bareBaseMaxBevel` helper

**Files:**
- Modify: `src/geometry.ts` (append helper)
- Test: `src/dome.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/dome.test.ts`:

```ts
import { bareBaseMaxBevel, buildBaseSampler } from './geometry';

describe('bareBaseMaxBevel', () => {
  it('sharp 100×100 rectangle ≈ 49 px', () => {
    const sampler = buildBaseSampler('rectangle', { roundness: 0 }, 100, 100);
    const cap = bareBaseMaxBevel(sampler);
    expect(cap).toBeGreaterThan(47);
    expect(cap).toBeLessThan(50);
  });

  it('200×60 sharp rectangle ≈ 29 px', () => {
    const sampler = buildBaseSampler('rectangle', { roundness: 0 }, 200, 60);
    const cap = bareBaseMaxBevel(sampler);
    expect(cap).toBeGreaterThan(27);
    expect(cap).toBeLessThan(30);
  });

  it('100×100 oval ≈ 49 px', () => {
    const sampler = buildBaseSampler('oval', {}, 100, 100);
    const cap = bareBaseMaxBevel(sampler);
    expect(cap).toBeGreaterThan(47);
    expect(cap).toBeLessThan(50);
  });

  it('cloud with deep lobes caps below min(W,H)/3', () => {
    // A cloud at 200×100 with deep lobes has narrow waists between lobes;
    // the medial-axis distance there is much less than 33 px.
    const sampler = buildBaseSampler(
      'cloud',
      { lobes: 8, lobeDepth: 0.6 },
      200,
      100,
    );
    const cap = bareBaseMaxBevel(sampler);
    expect(cap).toBeLessThan(33); // min(200,100)/3
  });
});
```

Confirm `'rectangle'` accepts `{ roundness: 0 }` and `'cloud'` accepts `{ lobes, lobeDepth }` by checking `controls.ts` defaults. Adjust the params bag names if these don't match (the test only needs the shape to actually instantiate).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: FAIL — `bareBaseMaxBevel` not exported.

- [ ] **Step 3: Implement `bareBaseMaxBevel`**

In `src/geometry.ts`, near the bottom, add:

```ts
import { offsetClosedPolygon, type Polygon } from './clipping';

// Largest inward offset distance (in px) at which clipper's miter-join
// inset still returns at least one closed polygon. Used to cap the
// bevelWidth slider so the user cannot push past the body's geometric
// medial-axis distance. Returns the lower bound of a binary search with
// a small safety margin so the rendered inset never disappears at the
// slider's max.
export function bareBaseMaxBevel(sampler: BaseSampler): number {
  const N = 192;
  const body: Polygon = [];
  for (let i = 0; i < N; i++) {
    const p = sampler.perimeterAt((i / N) * sampler.totalLen);
    body.push({ x: p.x, y: p.y });
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of body) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return 0;
  let lo = 0;
  let hi = Math.max(1, Math.max(maxX - minX, maxY - minY) / 2);
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) / 2;
    const result = offsetClosedPolygon(body, -mid, 'miter');
    if (result.length === 0) hi = mid;
    else lo = mid;
    if (hi - lo < 0.25) break;
  }
  return Math.max(0, lo * 0.98);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx vitest run src/dome.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/geometry.ts src/dome.test.ts
git commit -m "feat(speech-balloons): bareBaseMaxBevel via clipper inset binary search"
```

### Task F2: Widen `maxFn` to accept a sampler

**Files:**
- Modify: `src/controls.ts` (`LabControl` `kind: 'range'` `maxFn` type)
- Modify: `src/Lab.tsx` (call site in `renderRow`)

- [ ] **Step 1: Widen the `maxFn` signature in `controls.ts`**

In `src/controls.ts`, find the `LabControl` `kind: 'range'` line (currently line 4):

```ts
| { key: string; label?: string; kind: 'range'; min: number; max: number; step: number; default: number; hideWhen?: (params: ParamBag) => boolean; maxFn?: (ctx: { W: number; H: number }) => number; unit?: string; format?: (v: number) => string }
```

Change `maxFn`'s signature to:

```ts
maxFn?: (ctx: { W: number; H: number; sampler?: BaseSampler }) => number;
```

Add `BaseSampler` to the imports at the top of `controls.ts`:

```ts
import type { BaseSampler } from './geometry';
```

- [ ] **Step 2: Pass the sampler through `renderRow`**

In `src/Lab.tsx`, find the `kind === 'range'` branch in `renderRow` (around line 772–774):

```tsx
    const dynMax = c.maxFn && bodyW !== undefined && bodyH !== undefined
      ? c.maxFn({ W: bodyW, H: bodyH })
      : c.max;
```

Replace with:

```tsx
    let sampler: BaseSampler | undefined;
    if (bodyShape && bodyParams && bodyW !== undefined && bodyH !== undefined) {
      sampler = buildBaseSampler(bodyShape, bodyParams, bodyW, bodyH);
    }
    const dynMax = c.maxFn && bodyW !== undefined && bodyH !== undefined
      ? c.maxFn({ W: bodyW, H: bodyH, sampler })
      : c.max;
```

Hoist the sampler so the `kind === 'curve'` branch (added in D2) reuses the same instance instead of building a second one. Move the sampler construction above the if/else cascade:

```tsx
function renderRow(
  c: LabControl,
  params: ParamBag,
  onChange: (key: string, value: ParamValue) => void,
  bodyW?: number,
  bodyH?: number,
  bodyShape?: BalloonBase,
  bodyParams?: ParamBag,
): React.ReactNode {
  if (c.kind === 'header') return null;
  const label = c.label ?? c.key;
  const value = params[c.key];

  const sampler: BaseSampler | undefined =
    bodyShape && bodyParams && bodyW !== undefined && bodyH !== undefined
      ? buildBaseSampler(bodyShape, bodyParams, bodyW, bodyH)
      : undefined;

  if (c.kind === 'range') {
    const dynMax = c.maxFn && bodyW !== undefined && bodyH !== undefined
      ? c.maxFn({ W: bodyW, H: bodyH, sampler })
      : c.max;
    // ...rest unchanged
  }
  // ...rest of the cascade; replace the D2 sampler creation with this hoisted one
```

In the D2 `kind === 'curve'` branch, replace the local `const sampler = buildBaseSampler(...)` with a use of the hoisted `sampler`:

```tsx
    if (
      c.key === 'contour' &&
      typeof params.bevelWidth === 'number' &&
      sampler !== undefined
    ) {
      const { Rmin, Rmax } = bareBaseRadiusRange(sampler);
      // ...rest unchanged
    }
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/controls.ts src/Lab.tsx
git commit -m "refactor(speech-balloons): maxFn receives the live BaseSampler"
```

### Task F3: Wire `bevelWidth` `maxFn` to `bareBaseMaxBevel`

**Files:**
- Modify: `src/controls.ts` (the `bevelWidth` control entry around line 47)

- [ ] **Step 1: Update the import**

In `src/controls.ts`, add `bareBaseMaxBevel` to the existing geometry import:

```ts
import { bareBaseMaxBevel, type BaseSampler } from './geometry';
```

- [ ] **Step 2: Update the `bevelWidth` control's `maxFn`**

Find line 47 (approximate):

```ts
{ key: 'bevelWidth', label: 'Bevel width', kind: 'range', min: 0, max: 100, step: 0.5, default: 22, hideWhen: (p) => p.mode !== 'dome', maxFn: ({ W, H }) => Math.floor(Math.min(W, H) / 3), unit: 'px' },
```

Replace `maxFn` with:

```ts
maxFn: ({ W, H, sampler }) => sampler
  ? Math.max(1, Math.floor(bareBaseMaxBevel(sampler)))
  : Math.floor(Math.min(W, H) / 3),
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx tsc --noEmit && npx vitest run`
Expected: clean type-check and all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/controls.ts
git commit -m "feat(speech-balloons): bevelWidth slider caps at geometric medial-axis distance"
```

### Task F4: Debug overlay uses clipper inset

**Files:**
- Modify: `src/SpeechBalloon.tsx` (the `domeDebug` memo around line 831, and the JSX that consumes it around the rendering block)

- [ ] **Step 1: Read the current `domeDebug` consumer JSX**

Run: `cd /Users/mike/src/experiments/speech-balloons && grep -n "bevelRingPoints\|bodyRingPoints\|domeDebug\." src/SpeechBalloon.tsx | head`

Note: the consumer expects `bodyRingPoints` and `bevelRingPoints` as polyline strings.

- [ ] **Step 2: Rewrite `domeDebug` to emit clipper inset polygons**

In `src/SpeechBalloon.tsx`, add a `clipping` import near the top:

```tsx
import { offsetClosedPolygon, polygonsToSvgPath, type Polygon } from './clipping';
```

Replace the `domeDebug = useMemo(...)` block:

```tsx
  const domeDebug = useMemo(() => {
    if (!runtime.domeDebug || fillRender.mode !== 'dome') return null;
    const bb = bareBaseBBox(sampler);
    if (bb.w <= 0 || bb.h <= 0) return null;
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const bw = fillRender.bevelWidth;

    const N = 192;
    const body: Polygon = [];
    const bodyPts: string[] = [];
    for (let i = 0; i < N; i++) {
      const p = sampler.perimeterAt((i / N) * sampler.totalLen);
      body.push({ x: p.x, y: p.y });
      bodyPts.push(`${p.x},${p.y}`);
    }

    // Geometrically correct inward offset (sharp corners stay sharp,
    // rounded corners stay round, concavity overshoot disappears).
    const insetPolys = bw > 0 ? offsetClosedPolygon(body, -bw, 'miter') : [body];
    const bevelPath = polygonsToSvgPath(insetPolys);

    const lights = domeLights.map((l) => {
      const sc = angleToS(l.az, sampler, cx, cy);
      const rim = sampler.perimeterAt(sc);
      return { x2: rim.x, y2: rim.y, intensity: l.intensity };
    });
    return {
      cx,
      cy,
      bodyRingPoints: bodyPts.join(' '),
      bevelPath,
      lights,
    };
  }, [runtime.domeDebug, fillRender.mode, fillRender.bevelWidth, sampler, domeLights]);
```

Note the rename: `bevelRingPoints` (a polyline string) → `bevelPath` (an SVG-d compound path). The body silhouette stays as a polyline (it's the un-inset original).

`angleToS` replaces the previous `attachmentS` call here too — `attachmentS` halves its `boxW/boxH` args internally so passing `centroid[x], centroid[y]` was wrong; the new version targets the correct centroid directly.

- [ ] **Step 3: Update the JSX consumer**

Find where the debug overlay JSX is rendered (the place using `domeDebug.bevelRingPoints`). It is currently a `<polyline>` or `<polygon>` element. Replace with a `<path>`:

Run: `cd /Users/mike/src/experiments/speech-balloons && grep -n "bevelRingPoints" src/SpeechBalloon.tsx`

Replace the matching JSX. Example shape:

```tsx
                  <path
                    d={domeDebug.bevelPath}
                    fill="none"
                    stroke="#ffcc00"
                    strokeWidth={1}
                    strokeOpacity={0.9}
                  />
```

If the existing JSX used `points={domeDebug.bevelRingPoints}` as a polygon, swap the element to `<path d=…>` with the same stroke styling.

- [ ] **Step 4: Type-check and run tests**

Run: `cd /Users/mike/src/experiments/speech-balloons && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/experiments/speech-balloons
git add src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): debug overlay uses clipper miter inset for bevel ring

Sharp corners stay sharp, rounded corners stay round, concavity overshoot
no longer renders an inverted polygon."
```

---

## Cross-repo notes

The `labkit` changes (Phases B and C) must land and be picked up by the `speech-balloons` consumer before Phase D can be exercised. Local development typically uses `npm link` or a workspace; if `speech-balloons` consumes `labkit` from a published version, bump and publish before Phase D, or temporarily point at a local build. Verify by running:

`cd /Users/mike/src/experiments/speech-balloons && grep '"@labkit/react"' package.json`

If the dependency is a `file:` or `link:` reference, no publish step is needed.
