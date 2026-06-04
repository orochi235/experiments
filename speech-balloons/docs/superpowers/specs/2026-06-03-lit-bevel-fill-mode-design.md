# Lit-bevel fill mode (filter-based, additive to existing pipeline)

## Purpose

Land a new `lit-bevel` fill mode that uses SVG's `feDiffuseLighting` +
`feSpecularLighting` filter primitives driven by a distance-from-rim
heightmap, with the user-defined contour curve acting as the height
profile from rim (`x=0`) to medial axis (`x=1`).

This mode reads as a **lit 3D bevel** — distinct visible bevel face on
the rim band, smooth dome interior, real specular highlights that track
the light azimuth/elevation. The existing `dome` / `brdf` / `aqua`
modes stay; `lit-bevel` is a 4th option.

## Why the additive approach

The original 2026-05-25 spec called for replacing every fill mode with
the filter chain. Since then the codebase has invested heavily in the
wedge-slice dome and BRDF modes (multi-light, per-light overlays, an
entire shading-layers debug panel built around the wedge architecture).
Wholesale replacement would discard that work. Adding `lit-bevel` as a
peer mode lets the user A/B compare and avoids a destructive rewrite.

## Surface

### New mode value

`mode` control's options become `['aqua', 'dome', 'brdf', 'lit-bevel']`,
default unchanged (`dome`).

### Reused controls

When `mode === 'lit-bevel'`, these existing controls drive lit-bevel
behavior (no UI change beyond their `hideWhen` extending to cover the
new mode):

- `base` — surface color.
- `bevelWidth` — drives the heightmap's "distance from rim" scale
  (rings count proportional to `bevelWidth / dMax`; blur σ proportional
  to `bevelWidth`; DT input clamped at `bevelWidth`).
- `contour` — height profile h(x), 0..1, identical interpretation to
  dome/BRDF (already plumbed through the contour editor).
- `lightAzimuth`, `lightElevation` — feDistantLight angles.

### New lit-bevel controls

All `hideWhen: (p) => p.mode !== 'lit-bevel'`.

```
{ kind: 'header', label: 'Lit bevel — heightmap' }
{ key: 'heightmapSource', kind: 'select',
  options: ['bevel-rings', 'bevel-blur', 'bevel-dt'],
  default: 'bevel-rings' }

// bevel-rings sub-controls
{ key: 'rings',     kind: 'range', min: 4, max: 48, step: 1,   default: 20,
  hideWhen: (p) => p.mode !== 'lit-bevel' || p.heightmapSource !== 'bevel-rings' }
{ key: 'smoothing', kind: 'range', min: 0, max: 4,  step: 0.1, default: 1.2,
  hideWhen: (p) => p.mode !== 'lit-bevel' || p.heightmapSource !== 'bevel-rings' }

// bevel-blur sub-controls
{ key: 'blur', kind: 'range', min: 1, max: 60, step: 0.5, default: 14,
  hideWhen: (p) => p.mode !== 'lit-bevel' || p.heightmapSource !== 'bevel-blur' }

// bevel-dt sub-controls
{ key: 'dtResolution', kind: 'range', min: 64, max: 512, step: 16, default: 256,
  hideWhen: (p) => p.mode !== 'lit-bevel' || p.heightmapSource !== 'bevel-dt' }

{ kind: 'header', label: 'Lit bevel — material' }
{ key: 'surfaceScale',  kind: 'range', min: 0, max: 30,  step: 0.5, default: 8 }
{ key: 'diffuse',       kind: 'range', min: 0, max: 2,   step: 0.02, default: 1.0 }
{ key: 'specular',      kind: 'range', min: 0, max: 2,   step: 0.02, default: 0.6 }
{ key: 'shininess',     kind: 'range', min: 1, max: 128, step: 1,   default: 30 }
{ key: 'lightColor',    kind: 'color', default: '#ffffff' }
{ key: 'specularColor', kind: 'color', default: '#ffffff' }
```

The `Bevel contour` header and its contour curve stay above this block,
so the user sets the profile first and then dials material parameters.

## Architecture

### Filter chain (shared across all three heightmap sources)

```
<heightmap-source-graphic>             ← rings | blur | dt
  → feComponentTransfer { feFuncA tableValues=contour-samples }
                                       → height(x,y), 0..1 in alpha
  → feDiffuseLighting { lighting-color, surfaceScale, k=diffuse }
      feDistantLight { azimuth, elevation }
                                       → diffuse RGB
  → feComposite { operator=arithmetic, k1=1 } in <base>
                                       → diffuse · base
                                       │
  parallel: feSpecularLighting { lighting-color, surfaceScale,
                                  k=specular, exponent=shininess }
              feDistantLight { azimuth, elevation }
                                       → specular RGB

  feMerge { in1=diffuse·base, in2=specular }
                                       → diffuse + specular
  feComposite { operator=in, in2=SourceAlpha }
                                       → clipped to silhouette
```

### Contour → tableValues sampling

```ts
const N = 33;                          // 33 stops, cheap + smooth
const samples: number[] = [];
for (let i = 0; i < N; i++) {
  const x = i / (N - 1);               // 0 at rim, 1 at center
  const y = contour(x);                // existing contour function
  samples.push(Math.max(0, Math.min(1, y)));
}
const tableValues = samples.join(' ');
```

Written into a single `<feFuncA tableValues={tableValues} />` so the
heightmap's "distance from rim" alpha gets remapped to "height along
profile."

### Heightmap source 1 — `bevel-rings`

A `<g>` group of N nested inset polygons. For each ring i (i=0 is the
outer silhouette, i=N-1 is the deepest interior):

```ts
const d = i / N;                       // 0..(N-1)/N, distance fraction
const inset = d * dMax;                // dMax = max-bevel of bare body
const ringPolygon = offsetClosedPolygon(bodyPath, -inset, 'miter');
const opacity = 1 - d;                 // outer=full, inner=transparent
```

Painted in fill-opacity order so they stack to a smooth alpha gradient
from 1 at the rim to 0 at the deepest interior. Optional Gaussian blur
of `smoothing` px softens ring boundaries.

The group is the heightmap-source-graphic input to the filter chain.

### Heightmap source 2 — `bevel-blur`

`<feGaussianBlur in="SourceAlpha" stdDeviation={blur} />` — single
filter primitive. Cheap, but heightmap saturates past ~3σ from the rim.

### Heightmap source 3 — `bevel-dt`

```ts
// src/distanceTransform.ts (new module)
export function buildDistanceFieldImage(
  bodyPath: string,
  viewBox: { x: number; y: number; w: number; h: number },
  resolution: number,
): { dataUrl: string; vbWidth: number; vbHeight: number };
```

Rasterizes the body silhouette to an offscreen `<canvas>` at the chosen
resolution, runs a 2-pass Euclidean distance transform on alpha, encodes
the grayscale distance field as a PNG data URL. Plugged into the filter
chain via `<feImage href={dataUrl} />`.

Pixel-accurate distance everywhere. Cached by `(bodyPath, resolution)`
via `useMemo` so the DT only re-runs when those inputs change.

The DT itself: classic separable algorithm (Felzenszwalb & Huttenlocher
or the Meijster squared-distance variant). One pass each direction.
~150 LOC.

### Where the new code lives

- `src/SpeechBalloon.tsx`:
  - A new `litBevelLayers` memo that returns a JSX tree (heightmap source
    + filter chain) when `fillRender.mode === 'lit-bevel'`.
  - Added to the existing render switch alongside `domeLayers`, `aquaLayers`.
- `src/distanceTransform.ts` — new module, pure function, unit-testable.
- `src/controls.ts` — new controls block above. `EFFECT_CONTROLS.fill`
  grows by ~12 entries.
- `src/types.ts` — extend `FillParams` (or whatever the live type is)
  with the new keys.

The existing `dome` / `brdf` / `aqua` code is untouched.

## Shading-layers panel integration

Each filter primitive in the lit-bevel chain registers as a shading row
via the existing `pushShading(...)` registry:

- "Heightmap source (rings|blur|dt)" — the heightmap-source-graphic
  element. Toggling hides removes the entire lit-bevel render.
- "Diffuse term" — the feDiffuseLighting branch.
- "Specular term" — the feSpecularLighting branch.
- "Base color multiply" — the feComposite arithmetic.

These plug into the per-row visibility checkbox spec'd separately so the
user can isolate each contributor.

The "Hide non-light surfaces" panel toggle filters the heightmap source
and the base-color multiply rows (they're surface, not light).

## Data flow

```
controls.ts  →  fill effect params  →  fillRender memo  →
  litBevelLayers memo  →  JSX (<g><filter>...</filter><rect filter=.../></g>)
```

The filter is defined inline (unique id per render via React's `useId`)
and applied to a `<rect>` covering the bbox.

## Defaults — what the user sees first

With the default `contour: [0, 0, 0.5, 0.8, 1, 1]` and a rectangle body,
selecting `lit-bevel`:

- bevel-rings: a clear lit rim band, the rim near the lit azimuth bright
  and the dim azimuth dark, smooth dome interior, a single specular
  highlight where the half-vector meets the dome plateau.
- bevel-blur: similar appearance but the bevel face flattens on big
  bodies.
- bevel-dt: visually indistinguishable from bevel-rings on most shapes
  but exact at any resolution.

## Pre/post conditions

- The mode select must include `lit-bevel`; switching to it does not
  modify the contour or bevelWidth.
- Saved snapshots from before this spec render dome by default — they
  don't have a `heightmapSource` key. Default the lit-bevel sub-controls
  to their declared defaults when missing (no migration needed; the
  contour and bevelWidth keys are already populated from the existing
  dome data).
- The filter `id` must be unique per render to avoid id collisions when
  the user has multiple speech balloons on a page. Use React's `useId()`.

## Testing

- `src/distanceTransform.test.ts` — unit-test the DT against a small
  hand-computed example (circle of radius R should give a DT with
  max-distance ≈ R at center).
- Visual verification in dev server:
  - Toggle between all three heightmap sources on a rectangle and verify
    they look broadly similar with bevel-rings as reference.
  - Drag bevelWidth slider — bevel-rings ring count visibly changes,
    bevel-blur σ changes, bevel-dt clipping range changes.
  - Drag lightAzimuth — bright rim band rotates around the rim.
  - Drag lightElevation — specular highlight moves radially.
  - Edit the contour — both diffuse and specular respond (steeper
    contour → narrower lit band).

## Out of scope

- WebGL acceleration of the DT.
- Animating light direction.
- Replacing the existing dome / BRDF / aqua modes.
- Multi-light lit-bevel (uses a single `lightAzimuth` /
  `lightElevation` pair this iteration; multi-light stays a dome / BRDF
  feature for now). One `feDistantLight` per dome light merged
  additively via `feMerge` is a clean followup.
- Caching the bevel-rings ring polygons across renders that don't
  change `bodyPath` / `dMax` / `rings`.
