# Multi-Light Dome Fill (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-light dome fill (linear gradient across bbox + separate plateau region) with a 2-light additive renderer that shades the body using each light's terminator arc on the perimeter. Result is shape-aware (looks correct on rectangles, clouds, polygons — not just ellipses) and expressive enough to back the eventual preset library.

**Architecture:** Inline in `SpeechBalloon.tsx`. No abstraction layers. For each of two lights (key from existing controls + hardcoded fill opposite-side), compute the lit perimeter arcs (`outward_normal · L > 0`), build a clipPath of centroid-to-arc wedges, and paint a linear gradient along the light's azimuth clipped to that region. Stack with `mix-blend-mode: plus-lighter`. Plateau is implicit (uniform contribution where lights both reach).

**Tech Stack:** TypeScript, React, SVG. Two small helpers added to `SpeechBalloon.tsx`; unit tests in a new `dome.test.ts`.

---

## File Structure

- `src/SpeechBalloon.tsx` (MODIFY) — replace `buildDomeOverlay` + dome JSX with multi-light render; helpers `lightDirection`, `computeLitArcs`, `buildLightWedgePath`
- `src/dome.test.ts` (NEW) — tests for the math helpers
- `src/plateauMat.ts` (DELETE if unused after the change)

---

### Task 1: Lit-arc math + unit tests

**Files:**
- Create: `src/dome.test.ts`
- Modify: `src/SpeechBalloon.tsx`

Add three helpers near the top of `SpeechBalloon.tsx`, export them for testing. (They could live in a separate file but for v1 inline matches the rest of the file's style.)

- [ ] **Step 1: Write failing test**

```ts
// src/dome.test.ts
import { describe, it, expect } from 'vitest';
import { computeLitArcs, type PerimeterSampler } from './SpeechBalloon';

const unitCircleAt = (cx: number, cy: number, r: number): PerimeterSampler => (angle) => ({
  x: cx + Math.cos(angle) * r,
  y: cy + Math.sin(angle) * r,
  nx: Math.cos(angle),
  ny: Math.sin(angle),
});

describe('computeLitArcs', () => {
  it('lights ~half the circle for a horizontal light', () => {
    const arcs = computeLitArcs(unitCircleAt(0, 0, 50), 0, 0, 240);
    const total = arcs.reduce((sum, a) => sum + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI)), 0);
    expect(total).toBeGreaterThan(Math.PI * 0.95);
    expect(total).toBeLessThan(Math.PI * 1.05);
  });

  it('lights the full perimeter when light is overhead (elevation 90)', () => {
    const arcs = computeLitArcs(unitCircleAt(0, 0, 50), 0, 90, 240);
    const total = arcs.reduce((sum, a) => sum + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI)), 0);
    expect(total).toBeGreaterThan(2 * Math.PI * 0.99);
  });

  it('shadow side returns no arcs', () => {
    // Sampler that always reports outward normal in -x: light from +x leaves nothing lit.
    const sampler: PerimeterSampler = () => ({ x: 0, y: 0, nx: -1, ny: 0 });
    const arcs = computeLitArcs(sampler, 0, 0, 240);
    expect(arcs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run src/dome.test.ts`
Expected: FAIL — `computeLitArcs` not exported from SpeechBalloon.

- [ ] **Step 3: Add the helpers to `src/SpeechBalloon.tsx`**

Find the existing module-scope helper section (around line 60-100, near `parseHex` / `mixCss`). Insert:

```ts
// --- Multi-light dome shading ---------------------------------------------

export type PerimeterSampler = (angle: number) => {
  x: number;
  y: number;
  nx: number;
  ny: number;
};

export interface LitArc {
  start: number; // radians
  end: number;   // radians (always end > start; wrap handled by the caller)
}

/** Direction unit vector pointing TOWARD the light source, in body-local 3D
 *  coords (x = +right, y = +down to match SVG, z = +out of screen). */
function lightDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el)];
}

/** Sample the perimeter at `samples` angles and return the contiguous arcs
 *  where the 2D outward normal has a positive dot with the light's in-plane
 *  direction. v1 approximation: treats the rim as if its outward normal lies
 *  flat in the plane (no contour-driven tilt). Refines later. */
export function computeLitArcs(
  sampler: PerimeterSampler,
  azimuthDeg: number,
  elevationDeg: number,
  samples: number = 240,
): LitArc[] {
  const L = lightDirection(azimuthDeg, elevationDeg);
  const lit: boolean[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    const p = sampler(a);
    lit[i] = p.nx * L[0] + p.ny * L[1] > 0;
  }
  if (lit.every((x) => x)) return [{ start: 0, end: 2 * Math.PI }];
  if (lit.every((x) => !x)) return [];
  // Rotate so we start at a shadowed index — then runs of true are simple.
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

/** Build a single SVG path d covering all the centroid→arc wedges for a
 *  light. Caller uses this as a clipPath. */
export function buildLightWedgePath(
  sampler: PerimeterSampler,
  arcs: readonly LitArc[],
  centroid: readonly [number, number],
  arcResolutionRad: number = Math.PI / 60, // ~3°
): string {
  const parts: string[] = [];
  for (const a of arcs) {
    const span = (a.end - a.start + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(span / arcResolutionRad));
    let d = `M ${centroid[0]} ${centroid[1]}`;
    for (let i = 0; i <= steps; i++) {
      const t = a.start + (span * i) / steps;
      const p = sampler(t);
      d += ` L ${p.x} ${p.y}`;
    }
    d += ' Z';
    parts.push(d);
  }
  return parts.join(' ');
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/dome.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/dome.test.ts src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): lit-arc + wedge-path helpers for multi-light dome"
```

---

### Task 2: Replace `buildDomeOverlay` and the dome JSX branch

**Files:**
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Locate the existing dome render**

In `SpeechBalloon.tsx`, find:
- `buildDomeOverlay` definition
- `bodyDome` useMemo that calls it
- The dome render branch in the body group: `<path d={bodyDome.basePath} fill={fillRender.base} />` etc.

- [ ] **Step 2: Replace `bodyDome` useMemo with `domeLights` + `domeLayers`**

Delete `bodyDome` (and the `buildDomeOverlay` function definition above it). In their place, add:

```tsx
// Two-light additive dome. Key light uses the existing
// lightAzimuth/lightElevation params; fill is hardcoded opposite + low.
// TODO: expose lights as a customizable list.
const domeLights = useMemo(() => {
  const keyAz = fillRender.lightAzimuth;
  const keyEl = fillRender.lightElevation;
  return [
    { az: keyAz,                 el: keyEl, intensity: 1.0  },
    { az: (keyAz + 180) % 360,   el: 25,    intensity: 0.35 },
  ];
}, [fillRender.lightAzimuth, fillRender.lightElevation]);

const angleSampler = useMemo<PerimeterSampler>(() => {
  return (angle: number) => {
    const sc = attachmentS((angle * 180) / Math.PI, sampler, W / 2, H / 2);
    const p = sampler.perimeterAt(sc);
    return { x: p.x, y: p.y, nx: p.nx, ny: p.ny };
  };
}, [sampler, W, H]);

const domeLayers = useMemo(() => {
  if (fillRender.mode !== 'dome') return [];
  const bb = polysBBox(bodyAndBubblesPolys);
  if (bb.w <= 0 || bb.h <= 0) return [];
  const centroid: [number, number] = [bb.x + bb.w / 2, bb.y + bb.h / 2];
  return domeLights.map((light) => {
    const arcs = computeLitArcs(angleSampler, light.az, light.el, 240);
    const clipD = buildLightWedgePath(angleSampler, arcs, centroid);
    // Gradient axis along the light azimuth, spanning the bbox diagonal.
    const azRad = (light.az * Math.PI) / 180;
    const dx = Math.cos(azRad);
    const dy = Math.sin(azRad);
    const r = Math.hypot(bb.w, bb.h) / 2;
    return {
      clipD,
      x1: centroid[0] + dx * r,
      y1: centroid[1] + dy * r,
      x2: centroid[0] - dx * r,
      y2: centroid[1] - dy * r,
      intensity: light.intensity,
    };
  });
}, [fillRender.mode, bodyAndBubblesPolys, angleSampler, domeLights]);
```

- [ ] **Step 3: Replace the dome JSX branch**

Find the `<g filter={hasShadow ? ... : undefined}>` block. Inside it, the dome `<>` branch currently renders `bodyDome.basePath`, `bodyDome.overlayPath`, gloss/specular gradients, and the plateau debug overlay. Replace ALL of that with:

```tsx
) : (
  // Dome: solid base color + N stacked light layers, each clipped to its
  // lit region and painted with a linear gradient along its azimuth.
  // No explicit plateau — the centroid region is naturally lit by any
  // light whose terminator arc encloses it.
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
            <stop
              offset="0"
              stopColor={fillRender.highlightColor}
              stopOpacity={fillRender.amount * layer.intensity}
            />
            <stop
              offset="0.6"
              stopColor={fillRender.highlightColor}
              stopOpacity={fillRender.amount * layer.intensity * 0.45}
            />
            <stop
              offset="1"
              stopColor={fillRender.highlightColor}
              stopOpacity="0"
            />
          </linearGradient>
        </Fragment>
      ))}
    </defs>
    <path d={bodyPath} fill={fillRender.base} />
    <g style={{ mixBlendMode: 'plus-lighter' }}>
      {domeLayers.map((layer, i) => (
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

- [ ] **Step 4: Add `Fragment` to the React import at the top**

```ts
import { Fragment, useId, useMemo } from 'react';
```

- [ ] **Step 5: Delete the now-unused dome-overlay helpers**

Delete the import of `computeMatPlateau` and the entire `buildDomeOverlay` function.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "src/(SpeechBalloon|dome)\."`
Expected: no errors. (Pre-existing Lab.tsx errors stay.)

- [ ] **Step 7: Run the dev server and verify visually**

Run: `npm run dev`
Open http://localhost:5180/. Switch fill mode to dome (or load a snapshot that has it). Confirm:
1. Body renders with the base color
2. A bright key highlight band on the side of the configured azimuth
3. A dimmer fill highlight band on the opposite side
4. No leftover plateau overlay
5. Adjusting `Azimuth` and `Elevation` sliders updates the highlights live
6. The look reads as "lit 3D body" on rectangles AND ellipses (the v0 dome looked off on rectangles)

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: 38 passing (35 prior + 3 new lit-arc tests).

- [ ] **Step 9: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): multi-light dome with terminator-clipped layers"
```

---

### Task 3: Clean up dropped plateau code

**Files:**
- Modify: `src/SpeechBalloon.tsx` (already in Task 2 — verify)
- Delete: `src/plateauMat.ts`, `src/plateauMat.test.ts` if no other users

- [ ] **Step 1: Confirm no other references**

Run: `grep -rn "computeMatPlateau\|plateauMat" src/`
Expected output: empty (if Task 2 cleanup landed) or only the `plateauMat.ts` / `.test.ts` files themselves.

- [ ] **Step 2: Delete the files if isolated**

```bash
git rm src/plateauMat.ts src/plateauMat.test.ts
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit 2>&1 | grep -E "src/" | head -5`
Expected: tests pass; no new typecheck errors.

- [ ] **Step 4: Commit**

```bash
git add -A src/
git commit -m "refactor(speech-balloons): drop plateauMat — superseded by multi-light dome"
```

---

## Future Refinements (NOT in this plan)

Out of scope, but noted so the next plan inherits them cleanly:

1. **Per-light UI.** Expose lights as a per-fill-effect list (add/remove/reorder, each with its own az/el/color/intensity sliders).
2. **Contour-driven normal tilt.** Today's terminator uses the 2D perimeter normal. Lift to true 3D normals derived from the contour curve's slope so the lit region matches a real revolved-contour surface.
3. **Per-segment radial bands.** Replace the global linear gradient with per-radial-segment piecewise shading — fully shape-aware, no azimuth-projection drift.
4. **Specular highlights.** Re-add per-light specular when the geometry math is mature enough to position them faithfully.
5. **Arbitrary mesh surfaces.** When mesh-driven balloons become a real ask, introduce a `Surface` interface and a `MeshSurface` impl behind it. The lit-arc helpers stay; only the per-arc shading changes.
6. **Preset library.** A `src/presets/` dir with starter snapshots, surfaced as a Load Preset dropdown next to Save/Load.
