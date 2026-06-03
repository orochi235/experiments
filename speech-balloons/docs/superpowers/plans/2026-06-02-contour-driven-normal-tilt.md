# Contour-Driven Normal Tilt (v2 Dome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the v1 multi-light dome from a 2D rim-normal terminator to a 3D shading model driven by an implicit body-of-revolution surface. Adds two new controls (`rimTilt`, `crownHeight`), repurposes the dead `bevelWidth` slider as the radial transition-band width, and removes the vestigial `autoOuterRoundness` coupling.

**Architecture:** All changes are inline in `src/SpeechBalloon.tsx` plus a `controls.ts` schema bump. The lit-arc helpers (`computeLitArcs`) gain a `rimTiltRad` parameter; a new pure helper `domeSurfaceTilt` lives next to them and is unit-tested in `src/dome.test.ts`. The per-light gradient sampler replaces the global `contourStops` memo so each light gets physically-correct stops based on its own `N3·L`.

**Tech Stack:** TypeScript, React, SVG, Vitest.

---

## File Structure

- `src/dome.test.ts` (MODIFY) — new tests for `domeSurfaceTilt` and tilted `computeLitArcs`.
- `src/SpeechBalloon.tsx` (MODIFY) — add `domeSurfaceTilt`, extend `computeLitArcs`, replace `contourStops` with per-light sampler, delete `autoOuterRoundness` + `effectiveBaseParams`, update dome JSX.
- `src/controls.ts` (MODIFY) — append `rimTilt` and `crownHeight` controls; `bevelWidth` stays in place.

The spec for this work is at `docs/superpowers/specs/2026-06-02-contour-driven-normal-tilt-design.md`. Re-read it before each task if context drops.

---

### Task 1: `domeSurfaceTilt` helper + tests

**Files:**
- Modify: `src/dome.test.ts`
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/dome.test.ts`:

```ts
import { domeSurfaceTilt } from './SpeechBalloon';

describe('domeSurfaceTilt', () => {
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const rad = (d: number) => (d * Math.PI) / 180;

  it('returns rimTilt at the rim regardless of crown/bw', () => {
    expect(deg(domeSurfaceTilt(1, rad(30), 0.5, 0.2))).toBeCloseTo(30, 5);
    expect(deg(domeSurfaceTilt(1, rad(0), 1, 1))).toBeCloseTo(0, 5);
    expect(deg(domeSurfaceTilt(1, rad(45), 0, 0.1))).toBeCloseTo(45, 5);
  });

  it('is uniform at rimTilt when crownHeight is 0', () => {
    expect(deg(domeSurfaceTilt(0.5, rad(20), 0, 0.3))).toBeCloseTo(20, 5);
    expect(deg(domeSurfaceTilt(0, rad(20), 0, 0.3))).toBeCloseTo(20, 5);
  });

  it('reaches 90° at the centroid for full crown + no bevel band', () => {
    // crownHeight=1, bwNorm=1 → pure ramp from rimTilt at r=1 to 90° at r=0.
    expect(deg(domeSurfaceTilt(0, rad(0), 1, 1))).toBeCloseTo(90, 5);
    expect(deg(domeSurfaceTilt(0.5, rad(0), 1, 1))).toBeCloseTo(45, 5);
  });

  it('holds rimTilt across the bevel band', () => {
    // bwNorm=0.1 → rBevel=0.9. r in [0.9, 1] is bevel face at rimTilt.
    expect(deg(domeSurfaceTilt(0.95, rad(0), 1, 0.1))).toBeCloseTo(0, 5);
    expect(deg(domeSurfaceTilt(0.9, rad(0), 1, 0.1))).toBeCloseTo(0, 5);
  });

  it('ramps inside the interior band', () => {
    // rimTilt=0, crown=1, bwNorm=0.1 → crownTilt=90°, rBevel=0.9.
    // Interior: θ = lerp(crownTilt, rimTilt, r/rBevel).
    // r=0.5 → θ = lerp(90°, 0°, 0.5/0.9) = 90° · 4/9 = 40°.
    expect(deg(domeSurfaceTilt(0.5, rad(0), 1, 0.1))).toBeCloseTo(40, 1);
    // r=0 → 90°.
    expect(deg(domeSurfaceTilt(0, rad(0), 1, 0.1))).toBeCloseTo(90, 5);
  });

  it('clamps bwNorm to [0,1]', () => {
    expect(deg(domeSurfaceTilt(0.5, rad(0), 1, 5))).toBeCloseTo(45, 5); // same as bwNorm=1
    expect(deg(domeSurfaceTilt(0.5, rad(20), 1, -1))).toBeCloseTo(20, 5); // same as bwNorm=0
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run src/dome.test.ts`
Expected: FAIL — `domeSurfaceTilt` not exported.

- [ ] **Step 3: Add `domeSurfaceTilt` to `src/SpeechBalloon.tsx`**

Insert directly above the `computeLitArcs` definition (around line 100):

```ts
// Surface tilt θ(r) for the implicit body of revolution. r ∈ [0,1] where
// r=0 is the centroid and r=1 is the rim. θ is the angle the outward
// normal lifts above the SVG plane. See spec
// docs/superpowers/specs/2026-06-02-contour-driven-normal-tilt-design.md
export function domeSurfaceTilt(
  r: number,
  rimTiltRad: number,
  crownHeight: number,
  bwNorm: number,
): number {
  const bw = Math.min(1, Math.max(0, bwNorm));
  const crownTilt = rimTiltRad + (Math.PI / 2 - rimTiltRad) * crownHeight;
  const rBevel = 1 - bw;
  if (r >= rBevel) return rimTiltRad;        // bevel face
  if (rBevel <= 0) return crownTilt;          // band covers everything
  const t = r / rBevel;                       // 0 at centroid, 1 at inner edge
  return crownTilt + (rimTiltRad - crownTilt) * t;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/dome.test.ts`
Expected: PASS — all `domeSurfaceTilt` tests green; existing `computeLitArcs` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): domeSurfaceTilt helper for body-of-revolution tilt"
```

---

### Task 2: Extend `computeLitArcs` to take `rimTiltRad`

**Files:**
- Modify: `src/dome.test.ts`
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/dome.test.ts`:

```ts
describe('computeLitArcs with rimTilt', () => {
  const rad = (d: number) => (d * Math.PI) / 180;

  it('matches v1 behavior when rimTilt is 0 (backwards compat)', () => {
    const sampler = unitCircleAt(0, 0, 50);
    const v1 = computeLitArcs(sampler, 0, 0, 240);                    // implicit rimTilt=0
    const tilted = computeLitArcs(sampler, 0, 0, 240, 0);              // explicit 0
    expect(tilted).toEqual(v1);
  });

  it('rimTilt = 90° + any positive elevation lights the whole rim', () => {
    const sampler = unitCircleAt(0, 0, 50);
    const arcs = computeLitArcs(sampler, 0, 30, 240, rad(90));
    const total = arcs.reduce(
      (sum, a) => sum + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI),
      0,
    );
    expect(total).toBeCloseTo(2 * Math.PI, 1);
  });

  it('rimTilt = 45° widens the lit arc beyond half for elevated light', () => {
    // Light from +x, elevation 30°. With rimTilt=0 the lit arc is ~π.
    // With rimTilt=45° the upward component of N catches more rim.
    const sampler = unitCircleAt(0, 0, 50);
    const flat = computeLitArcs(sampler, 0, 30, 240, 0);
    const tilted = computeLitArcs(sampler, 0, 30, 240, rad(45));
    const sumOf = (arcs: { start: number; end: number }[]) =>
      arcs.reduce(
        (s, a) => s + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI),
        0,
      );
    expect(sumOf(tilted)).toBeGreaterThan(sumOf(flat));
  });

  it('rimTilt = 90° + elevation 0 leaves the rim dark', () => {
    // Normal points straight up; light is horizontal → N·L = 0.
    const sampler = unitCircleAt(0, 0, 50);
    const arcs = computeLitArcs(sampler, 0, 0, 240, rad(90));
    expect(arcs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run src/dome.test.ts -t "computeLitArcs with rimTilt"`
Expected: FAIL — the new 5th argument is ignored, so tilted/flat are identical and the high-tilt cases break.

- [ ] **Step 3: Update `computeLitArcs` to accept `rimTiltRad`**

In `src/SpeechBalloon.tsx`, replace the existing function and comment block:

```ts
// Sample the perimeter at `samples` angles and return the contiguous arcs
// where the lifted 3D normal N3 = (nx·cos θ, ny·cos θ, sin θ) has a
// positive dot product with the light direction L. θ here is the rim
// tilt (the tilt at r=1); interior tilts only matter for the gradient
// sampler downstream.
export function computeLitArcs(
  sampler: PerimeterSampler,
  azimuthDeg: number,
  elevationDeg: number,
  samples: number = 240,
  rimTiltRad: number = 0,
): LitArc[] {
  const L = lightDirection(azimuthDeg, elevationDeg);
  const cosT = Math.cos(rimTiltRad);
  const sinT = Math.sin(rimTiltRad);
  const lit: boolean[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    const p = sampler(a);
    const Lxy = p.nx * L[0] + p.ny * L[1];
    const NdotL = cosT * Lxy + sinT * L[2];
    lit[i] = NdotL > 1e-9;
  }
  if (lit.every((x) => x)) return [{ start: 0, end: 2 * Math.PI }];
  if (lit.every((x) => !x)) return [];
  const firstFalse = lit.indexOf(false);
  const rot = [...lit.slice(firstFalse), ...lit.slice(0, firstFalse)];
  const arcs: LitArc[] = [];
  let i = 0;
  while (i < samples) {
    while (i < samples && !rot[i]) i++;
    if (i >= samples) break;
    const runStart = i;
    while (i < samples && rot[i]) i++;
    const runEnd = i;
    arcs.push({
      start: (((runStart + firstFalse) % samples) / samples) * 2 * Math.PI,
      end: (((runEnd + firstFalse) % samples) / samples) * 2 * Math.PI,
    });
  }
  return arcs;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/dome.test.ts`
Expected: PASS — all dome tests green.

- [ ] **Step 5: Commit**

```bash
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): computeLitArcs respects rim tilt"
```

---

### Task 3: Add `rimTilt` + `crownHeight` to controls + `fillRender`

**Files:**
- Modify: `src/controls.ts`
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Add controls to `src/controls.ts`**

In the dome param block (right after the existing `lightElevation` line, around line 49), add:

```ts
    { key: 'rimTilt', label: 'Rim tilt', kind: 'range', min: 0, max: 90, step: 1, default: 0, hideWhen: (p) => p.mode !== 'dome', unit: '°' },
    { key: 'crownHeight', label: 'Crown height', kind: 'range', min: 0, max: 1, step: 0.02, default: 0, hideWhen: (p) => p.mode !== 'dome' },
```

- [ ] **Step 2: Surface them in `fillRender`**

In `src/SpeechBalloon.tsx`, inside the `fillRender` useMemo (around line 656), add two lines next to the other dome params (between `lightElevation` and `bevelWidth`):

```ts
      lightAzimuth: (p.lightAzimuth as number) ?? 270,
      lightElevation: (p.lightElevation as number) ?? 55,
      rimTilt: (p.rimTilt as number) ?? 0,
      crownHeight: (p.crownHeight as number) ?? 0,
      bevelWidth: (p.bevelWidth as number) ?? 22,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/(SpeechBalloon|controls)\." | head -5`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/controls.ts src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): add rimTilt + crownHeight dome controls"
```

---

### Task 4: Extract `sampleLightStops` helper + tests

**Files:**
- Modify: `src/dome.test.ts`
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/dome.test.ts`:

```ts
import { sampleLightStops, type ContourFn } from './SpeechBalloon';

describe('sampleLightStops', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const unitContour: ContourFn = () => 1;     // no painterly modulation

  it('peaks at lit rim for a horizontal light, flat surface', () => {
    const stops = sampleLightStops({
      azimuthDeg: 0,
      elevationDeg: 0,
      rimTiltRad: 0,
      crownHeight: 0,
      bwNorm: 0,
      contour: unitContour,
      samples: 16,
    });
    const max = stops.reduce((m, s) => (s.opacity > m.opacity ? s : m));
    expect(max.offset).toBeCloseTo(0, 5);    // s=0 == lit rim
    expect(stops[stops.length - 1]!.opacity).toBeCloseTo(0, 5); // far rim dark
  });

  it('shifts the bright spot toward centroid for an overhead light + dome crown', () => {
    const stops = sampleLightStops({
      azimuthDeg: 0,
      elevationDeg: 90,                       // straight down
      rimTiltRad: 0,
      crownHeight: 1,
      bwNorm: 1,                              // full ramp, no bevel face
      contour: unitContour,
      samples: 16,
    });
    const max = stops.reduce((m, s) => (s.opacity > m.opacity ? s : m));
    // Surface at r=0 has tilt=90° (N3 = +z). Light is straight down (L=+z).
    // Peak should be at the centroid (offset = 0.5).
    expect(max.offset).toBeGreaterThan(0.4);
    expect(max.offset).toBeLessThan(0.6);
  });

  it('emits SAMPLES+1 stops with strictly increasing offsets', () => {
    const stops = sampleLightStops({
      azimuthDeg: 45,
      elevationDeg: 30,
      rimTiltRad: rad(20),
      crownHeight: 0.4,
      bwNorm: 0.2,
      contour: unitContour,
      samples: 16,
    });
    expect(stops).toHaveLength(17);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.offset).toBeGreaterThan(stops[i - 1]!.offset);
    }
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `npx vitest run src/dome.test.ts -t sampleLightStops`
Expected: FAIL — `sampleLightStops` not exported.

- [ ] **Step 3: Locate and read the current `contourStops` + `domeLayers` memos**

In `src/SpeechBalloon.tsx`, the relevant block runs from `const contourStops = useMemo(...)` through the end of `const domeLayers = useMemo(...)`. Read it once before editing — Task 5 also touches this region.

- [ ] **Step 4: Add `sampleLightStops` (module scope)**

Insert directly below `buildLightWedgePath` (around line 159):

```ts
export type ContourFn = (x: number) => number;

export interface LightStopInput {
  azimuthDeg: number;
  elevationDeg: number;
  rimTiltRad: number;
  crownHeight: number;
  bwNorm: number;          // bevelWidth / R, already clamped if caller wants
  contour: ContourFn;      // x=0 (rim) → x=1 (center); y is brightness multiplier
  samples?: number;        // default 16
}

export interface GradientStop {
  offset: number;
  opacity: number;
}

// Sample the per-light brightness along the gradient axis (s ∈ [0,1] going
// lit-rim → centroid → far-rim). For each sample, recover the radial
// position on the body of revolution, compute the 3D normal via
// domeSurfaceTilt, and multiply max(0, N3·L) by the painterly contour.
export function sampleLightStops(input: LightStopInput): GradientStop[] {
  const SAMPLES = input.samples ?? 16;
  const azRad = (input.azimuthDeg * Math.PI) / 180;
  const elRad = (input.elevationDeg * Math.PI) / 180;
  const cosAz = Math.cos(azRad);
  const sinAz = Math.sin(azRad);
  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);
  const Lx = cosAz * cosEl;
  const Ly = sinAz * cosEl;
  const Lz = sinEl;

  const out: GradientStop[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES;
    const dNorm = 0.5 - s;                              // +1/2 at lit rim, −1/2 at far rim
    const r = Math.min(1, Math.abs(dNorm) * 2);
    const tilt = domeSurfaceTilt(r, input.rimTiltRad, input.crownHeight, input.bwNorm);
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const sgn = dNorm >= 0 ? 1 : -1;
    const N3x = sgn * cosAz * cosTilt;
    const N3y = sgn * sinAz * cosTilt;
    const N3z = sinTilt;
    const phys = Math.max(0, N3x * Lx + N3y * Ly + N3z * Lz);
    // Gradient s 0→0.5→1 maps to radial t 0→1→0. Contour's x=0 is rim,
    // x=1 is centroid, so we feed (1 - t) ... wait: at s=0 (lit rim) r=1,
    // we want contour at x=0 (rim). So contour_x = 1 - r.
    const paint = Math.max(0, input.contour(1 - r));
    out.push({ offset: s, opacity: phys * paint });
  }
  return out;
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/dome.test.ts`
Expected: PASS — all dome tests green (existing + new).

- [ ] **Step 6: Delete `contourStops`**

Remove the entire `const contourStops = useMemo(() => { ... }, [fillRender.contour]);` block from `SpeechBalloon.tsx`.

- [ ] **Step 7: Rewrite `domeLayers` to use `sampleLightStops`**

Replace the `const domeLayers = useMemo(...)` block with:

```ts
const domeLayers = useMemo(() => {
  if (fillRender.mode !== 'dome') return [];
  const bb = polysBBox(bodyAndBubblesPolys);
  if (bb.w <= 0 || bb.h <= 0) return [];
  const centroid: [number, number] = [bb.x + bb.w / 2, bb.y + bb.h / 2];
  const R = Math.max(bb.w, bb.h) / 2;
  const rimTiltRad = (fillRender.rimTilt * Math.PI) / 180;
  const bwNorm = R > 0 ? Math.min(1, fillRender.bevelWidth / R) : 0;

  // Build a linear-interp contour function once per render.
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

  return domeLights.map((light) => {
    const arcs = computeLitArcs(angleSampler, light.az, light.el, 240, rimTiltRad);
    const clipD = buildLightWedgePath(angleSampler, arcs, centroid);
    const azRad = (light.az * Math.PI) / 180;
    const cosAz = Math.cos(azRad);
    const sinAz = Math.sin(azRad);
    const stops = sampleLightStops({
      azimuthDeg: light.az,
      elevationDeg: light.el,
      rimTiltRad,
      crownHeight: fillRender.crownHeight,
      bwNorm,
      contour,
    });
    return {
      clipD,
      x1: centroid[0] + cosAz * R,
      y1: centroid[1] + sinAz * R,
      x2: centroid[0] - cosAz * R,
      y2: centroid[1] - sinAz * R,
      intensity: light.intensity,
      stops,
    };
  });
}, [
  fillRender.mode,
  fillRender.rimTilt,
  fillRender.crownHeight,
  fillRender.bevelWidth,
  fillRender.contour,
  bodyAndBubblesPolys,
  angleSampler,
  domeLights,
]);
```

- [ ] **Step 8: Update the dome JSX to consume `layer.stops`**

In the dome JSX branch (around line 884–920), replace the inner `<stop>` loop that referenced `contourStops` with `layer.stops`:

```tsx
{domeLayers.length > 0 && (
  <>
    <defs>
      {domeLayers.map((layer, i) => (
        <Fragment key={i}>
          <clipPath id={`${idPrefix}-dome-clip-${i}`}>
            <path d={layer.clipD} />
          </clipPath>
          <linearGradient
            id={`${idPrefix}-dome-grad-${i}`}
            gradientUnits="userSpaceOnUse"
            x1={layer.x1} y1={layer.y1}
            x2={layer.x2} y2={layer.y2}
          >
            {layer.stops.map((s, j) => (
              <stop
                key={j}
                offset={s.offset}
                stopColor={fillRender.highlightColor}
                stopOpacity={fillRender.amount * layer.intensity * s.opacity}
              />
            ))}
          </linearGradient>
        </Fragment>
      ))}
    </defs>
    <path d={bodyPath} fill={fillRender.base} />
    <g style={{ mixBlendMode: 'screen', isolation: 'isolate' }}>
      {domeLayers.map((_, i) => (
        <path
          key={i}
          d={bodyPath}
          fill={`url(#${idPrefix}-dome-grad-${i})`}
          clipPath={`url(#${idPrefix}-dome-clip-${i})`}
        />
      ))}
    </g>
  </>
)}
```

- [ ] **Step 9: Typecheck + tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/SpeechBalloon" | head -5`
Expected: no output.

Run: `npm test`
Expected: all dome tests still pass (no regressions from the existing v1 set).

- [ ] **Step 10: Commit**

```bash
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): per-light gradient stops driven by surface tilt"
```

---

### Task 5: Delete `autoOuterRoundness` + `effectiveBaseParams`

**Files:**
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Delete `autoOuterRoundness`**

Remove the entire `function autoOuterRoundness(W, H, baseR, bw): number { ... }` definition and its preceding multi-line comment block (lines ~187–239 of the pre-change file).

- [ ] **Step 2: Delete `effectiveBaseParams`**

Remove the `const effectiveBaseParams = useMemo<ParamBag>(() => { ... }, [...]);` block and its preceding comment (lines ~273–288 pre-change).

- [ ] **Step 3: Point `sampler` at `design.baseParams` directly**

Find the `sampler` useMemo just below where `effectiveBaseParams` used to live. Change:

```ts
const sampler: BaseSampler = useMemo(
  () => buildBaseSampler(design.base, effectiveBaseParams, W, H),
  [design.base, effectiveBaseParams, W, H],
);
```

to:

```ts
const sampler: BaseSampler = useMemo(
  () => buildBaseSampler(design.base, design.baseParams, W, H),
  [design.base, design.baseParams, W, H],
);
```

- [ ] **Step 4: Verify no stale references**

Run: `grep -n "autoOuterRoundness\|effectiveBaseParams" src/`
Expected: no output.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/SpeechBalloon" | head -5`
Expected: no output.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "refactor(speech-balloons): drop autoOuterRoundness — vestigial lit-bevel coupling"
```

---

### Task 6: Visual verification

**Files:**
- None modified — verification only.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open http://localhost:5180/ (or whatever port Vite chose — check terminal output).

- [ ] **Step 2: Confirm v1 parity at defaults**

Load a dome snapshot, or set a new balloon to dome mode with default contour. With `rimTilt = 0, crownHeight = 0` the rendered dome must look visually identical to before this change. Take a screenshot, compare against `multi-light-dome-initial.png` if it's still around.

- [ ] **Step 3: Confirm rim tilt widens the lit arc**

Set `rimTilt = 45°`, leave `crownHeight = 0`. Both light wedges should visibly extend further around the rim.

- [ ] **Step 4: Confirm full dome look**

Set `rimTilt = 0°, crownHeight = 1, bevelWidth = max`. With elevation ≈ 70° the bright spot should land near the centroid, not the rim. This is the "real dome" outcome the spec calls out.

- [ ] **Step 5: Confirm bevel band**

On a rectangle body: set `rimTilt = 30°, crownHeight = 0.4, bevelWidth = 22px`. The body should read as a flat-topped beveled plate. Dragging `bevelWidth` between 5px and the slider max should visibly widen/narrow the lit ring along the rim.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: pre-existing tests + 3 v1 dome tests + 5 new `domeSurfaceTilt` tests + 4 new tilted `computeLitArcs` tests all green.

- [ ] **Step 7: If everything looks right, no commit needed for verification.**

If a visual issue surfaces — most likely the linear `θ(r)` looking too flat between rim and crown — implement the eased variant from the spec's "Open questions" section: replace the interior-ramp line with `t = Math.pow(r / rBevel, 2)` (or pick another monotone ease). Update the `domeSurfaceTilt` tests in lock-step, then commit:

```bash
git add src/SpeechBalloon.tsx src/dome.test.ts
git commit -m "feat(speech-balloons): ease the rim-to-crown tilt ramp"
```
