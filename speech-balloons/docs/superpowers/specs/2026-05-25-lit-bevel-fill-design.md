# Lit-bevel fill for speech balloons

## Problem

The current `SpeechBalloon` fill pipeline has accumulated seven distinct
fill modes (`solid`, `radial`, `puffy`, `raised`, `sculpted`, `aqua`,
`beveled`) that each take a different approach to faking volume. None of
them treat the user-defined contour as a real cross-section profile lit
by a defined light source, so the results either look flat (radial,
sculpted, aqua) or only work at one specific shape size (puffy, beveled
— both rely on Gaussian blur of `SourceAlpha` and saturate on large
silhouettes). The dome's "center" is anchored to the gradient anchor or
to bbox center, not to any property of the shape itself, so for
irregular silhouettes (balloon + tail + bubbles) the highlight sits in
the wrong place.

## Goals

Replace the entire fill subsystem with a single lighting pipeline that:

- Treats the user-defined contour curve as a **height profile** —
  cross-section from rim (distance 0 from silhouette edge) to deepest
  interior (distance 1).
- Lights that surface with `feDiffuseLighting` + `feSpecularLighting`
  driven by an explicit light azimuth / elevation. Brightness emerges
  from surface normal · light direction, not from sampling the curve
  directly.
- Lets the curve shape decide inset vs outset behavior with no explicit
  toggle: bulge-up curves produce outset surfaces (highlight in the
  middle); dip-down curves produce inset surfaces (highlight on the rim,
  shadow in the middle).
- Anchors the dome peak to the silhouette's medial axis automatically,
  because the heightmap is distance-from-rim. For a circle this lands
  at the center; for a stretched oval, along an interior ridge; for a
  balloon+tail+bubbles, the peak follows the body's interior cleanly.
  This is the "centroid proportional to the shape itself" property.

## Non-goals

- Keeping any of the existing fill modes as fallbacks. The user
  explicitly asked to delete everything first.
- Reusing the existing per-shape gloss / `objectBoundingBox` machinery.
- Animating light direction or curve params.
- Computing lighting outside SVG (e.g., as a WebGL pass).

## Architecture

### Three heightmap sources, one lighting chain

All three modes share the lighting math and the contour-as-height
interpretation. They differ only in how they produce the distance-from-
rim heightmap that feeds the lighting filter:

1. **`bevel-rings`** — Generate N nested inset polygons via the
   existing `offsetClosedPolygons` from `src/clipping.ts`. Paint each
   ring at a fill opacity proportional to its distance band (or stack as
   discrete grayscale bands). Apply a small Gaussian blur to soften ring
   boundaries. Pure vector. Exact distance up to clipper-lib precision.
   Best fidelity at any shape size; cost is O(rings) clipper calls per
   render.

2. **`bevel-blur`** — Single `feGaussianBlur` applied to `SourceAlpha`.
   Same approach the existing `sculpted` / `beveled` modes used. Cheap
   (one filter primitive), but the heightmap saturates beyond ~3σ from
   the rim, so on large silhouettes the dome flattens.

3. **`bevel-dt`** — Rasterize the silhouette to an offscreen canvas at
   a configurable resolution, run a true 2-pass Euclidean distance
   transform on the alpha channel, expose the resulting grayscale as an
   `<image>` element fed into the filter chain via `feImage`.
   Pixel-accurate distance everywhere. Costs one raster pass per render
   plus the DT.

A select in the lab controls picks the mode. The three are exposed as
distinct `FillMode` values rather than as a sub-option of one mode,
because the rendering path (different filter inputs, different
DOM nodes) differs even though the math afterward is shared.

### The lighting chain

```
heightmap                                  (mode-specific)
  → feComponentTransfer (table, contour)   → height(x,y)
  → feDiffuseLighting (lighting-color)     → diffuse RGB
  → feComposite arithmetic (k1=baseColor)  → diffuse · base
  → feMerge w/ feSpecularLighting branch   → diffuse · base + specular
  → feComposite in SourceAlpha (operator=in) → clipped to silhouette
```

The contour is sampled at 33 evenly-spaced X positions via the existing
`interpolateCurveY` Hermite interpolator. The sampled values are written
into the `tableValues` attribute of `feFuncA` (or a single channel) so
the heightmap's alpha gets remapped from "distance from rim" to "height
along profile."

`feDiffuseLighting`'s `surfaceScale` attribute controls how strongly the
heightmap's grayscale modulates the surface normals — equivalent to a
bump strength slider.

`feDistantLight` defines the light direction with `azimuth` and
`elevation`. Both are exposed as sliders.

Diffuse and specular contributions are added (additive composite), not
multiplied, mirroring standard Phong shading. Base color is multiplied
into the diffuse term so the user's chosen body color tints the lit
surface.

### Why this gives inset vs outset for free

A surface normal at any point on the heightmap is approximately
`(−∂h/∂x, −∂h/∂y, 1/surfaceScale)` normalized. For a dome (height peaks
in the middle), normals near the peak point straight up, so a light from
above hits the peak directly — bright center. For a basin (height dips
in the middle), normals near the lowest point also point straight up,
but the rim now has positive slope facing outward, so normals on the rim
face the light — bright rim, dark center.

No code toggle. Same filter chain. The user changes the contour curve
shape and the rendering follows.

## Components

### Modified: `src/types.ts`

```ts
export type FillMode = 'bevel-rings' | 'bevel-blur' | 'bevel-dt';
```

Drops every previous fill mode. The `FillMode` type and the `EffectKind`
union otherwise unchanged.

### Modified: `src/controls.ts`

Rewrite the `fill` entry in `EFFECT_CONTROLS`:

```ts
fill: [
  { key: 'mode', kind: 'select',
    options: ['bevel-rings', 'bevel-blur', 'bevel-dt'],
    default: 'bevel-rings' },
  { key: 'base', kind: 'color', default: '#ffffff' },

  { kind: 'header', label: 'Contour (rim → center)' },
  { key: 'contour', kind: 'curve', length: 5,
    labels: ['Rim', 'Outer', 'Mid', 'Inner', 'Center'],
    min: -1, max: 1, step: 0.02,
    // Default: smooth dome — flat at rim, climbing to a peak in the
    // middle. Negate the inner/center Y values for an inset look.
    defaults: [0, -0.05, 0.25, 0.4, 0.5, 0.78, 0.75, 0.95, 1, 1] },

  { kind: 'header', label: 'Light' },
  { key: 'lightAzimuth',  kind: 'range', min: 0, max: 359, step: 1, default: 135 },
  { key: 'lightElevation', kind: 'range', min: 0, max: 90,  step: 1, default: 55  },
  { key: 'lightColor',     kind: 'color', default: '#ffffff' },

  { kind: 'header', label: 'Material' },
  { key: 'surfaceScale', kind: 'range', min: 0, max: 30,  step: 0.5, default: 8 },
  { key: 'diffuse',      kind: 'range', min: 0, max: 2,   step: 0.02, default: 1.0 },
  { key: 'specular',     kind: 'range', min: 0, max: 2,   step: 0.02, default: 0.6 },
  { key: 'shininess',    kind: 'range', min: 1, max: 128, step: 1,   default: 30 },
  { key: 'specularColor', kind: 'color', default: '#ffffff' },

  { kind: 'header', label: 'Rings (bevel-rings)', hideWhen: (p) => p.mode !== 'bevel-rings' },
  { key: 'rings',     kind: 'range', min: 4, max: 48, step: 1,   default: 20, hideWhen: (p) => p.mode !== 'bevel-rings' },
  { key: 'smoothing', kind: 'range', min: 0, max: 4,  step: 0.1, default: 1.2, hideWhen: (p) => p.mode !== 'bevel-rings' },

  { kind: 'header', label: 'Blur (bevel-blur)', hideWhen: (p) => p.mode !== 'bevel-blur' },
  { key: 'blur', kind: 'range', min: 1, max: 60, step: 0.5, default: 14, hideWhen: (p) => p.mode !== 'bevel-blur' },

  { kind: 'header', label: 'Distance transform (bevel-dt)', hideWhen: (p) => p.mode !== 'bevel-dt' },
  { key: 'dtResolution', kind: 'range', min: 64, max: 512, step: 16, default: 256, hideWhen: (p) => p.mode !== 'bevel-dt' },
],
```

The shared `Tints` / `Volume` / `Gradient` / `Aqua` / `Beveled` /
`Light` / `Depth` headers from the previous registry all disappear; the
new headers above replace them.

### Modified: `src/persistence.ts`

Bump `LAB_STORAGE_KEY` from `'speech-balloon-lab-v5'` to
`'speech-balloon-lab-v6'`. The fill-mode and contour-axis conventions
both change incompatibly (see below), so all stale snapshots from prior
versions get dropped silently on load. No migration shim; the v5
contour-orientation migration in `loadSnapshot` is removed along with it.

### Contour axis convention flip

The previous registry labeled curve X as `['Highlight', 'Inner', 'Mid',
'Outer', 'Rim']` (X=0 = center, X=1 = rim) and reversed the sampled
colors internally before feeding them to the table. The new registry
labels X as `['Rim', 'Outer', 'Mid', 'Inner', 'Center']` (X=0 = rim,
X=1 = center), matching the heightmap's natural orientation (alpha 0 at
rim, alpha 1 at deepest interior). The reversal step disappears.
Existing saved curves would render upside-down under the new convention,
which is the second reason for bumping the storage key.

### New: `src/distanceTransform.ts`

A small module exposing one function:

```ts
export function buildDistanceFieldImage(
  bodyPath: string,
  viewBox: { x: number; y: number; w: number; h: number },
  resolution: number,
): { dataUrl: string; vbWidth: number; vbHeight: number };
```

Internals:
1. Create an offscreen `HTMLCanvasElement` sized to `resolution` along
   the longer axis, with the shorter axis scaled to preserve the
   silhouette's aspect ratio.
2. Apply the inverse `viewBox` transform so the path draws filled into
   the canvas at the right scale.
3. Run a 2-pass squared-Euclidean distance transform
   (Felzenszwalb-Huttenlocher) on the alpha channel: for each row,
   compute 1D DT; for each column, compose with the 1D DT of the
   intermediate result.
4. Normalize the max distance to 1.0, write into the canvas's alpha
   channel as `Math.round(distance * 255)`.
5. Export as a data URL via `canvas.toDataURL('image/png')`.

The result is consumed via `<feImage href={dataUrl} />` in the filter
chain when `mode === 'bevel-dt'`.

### Modified: `src/SpeechBalloon.tsx`

Substantial rewrite of the fill section. Specifically:

**Delete:**
- `renderFill`, `FillRender` interface
- `beveledParams`, `sculptedParams`, `puffyParams` memos
- The whole `hasPuffy` inset-shadow filter and its sliders
  (`innerShadow`, `innerHighlight`, `sOffset`, `sBlur`, `hOffset`)
- The per-shape `glossPaint` / `bodyOnlyPath` branching for `aqua` and
  `raised` modes
- Inline `mix` / `parseHex` / `rgbToCss` / `interpolateCurveY` may stay
  (still used by contour sampling) or move to a small `color.ts` if
  cleaner

**Add:**
- A `buildHeightmapMarkup({ mode, params, bodyPath, bodyPolygons, viewBox })`
  helper returning `{ defsNodes, lightingInput }` — `defsNodes` is the
  JSX to inject into `<defs>` (e.g., the `<g>` of nested inset polygons
  for `bevel-rings`, or nothing for `bevel-blur` which uses
  `SourceAlpha`, or an `<image>` for `bevel-dt`); `lightingInput` is the
  string referenced by `feDiffuseLighting`'s `in=` attribute (e.g.
  `"SourceAlpha"`, `"heightmapBlur"`, `"heightmapImage"`).
- A single unified `<filter id="sb-fill">` per render that:
  1. Pulls the heightmap input.
  2. Applies the contour curve via `feComponentTransfer` /
     `feFuncA tableValues={…}`.
  3. Runs `feDiffuseLighting` with the chosen light + diffuse params,
     result `diffuse`.
  4. Composites `diffuse` with the base color via `feFlood` + `feComposite arithmetic`.
  5. Runs `feSpecularLighting` with the same light + specular params,
     result `specular`.
  6. `feMerge` of the diffuse-tinted-base and the specular layer.
  7. `feComposite operator="in" in2="SourceAlpha"` to clip.
- The body path renders once (`<path d={bodyPath} filter="url(#sb-fill)" />`).
  Tail bubbles and lightning ribbons share the filter so they pick up
  the same lighting.

**Keep:**
- All tail / bubble / lightning geometry (untouched).
- `strokeEffect`, `shadowEffect`, the existing stroke and drop-shadow
  rendering.
- `composeBodyPoints`, `attachmentS`, `classicTailOffsetAt`,
  `buildBubbles`, `buildLightning` — all geometry helpers stay as-is.

## Data flow

```
DesignState.effects[fill].params
  ↓
SpeechBalloon resolves: mode, contour curve, light dir, material props
  ↓
buildHeightmapMarkup(mode, params, bodyPath/polys, viewBox)
  → defs JSX + lightingInput ref
  ↓
<filter> chain:
  heightmap → curve remap → diffuse + specular → clip
  ↓
<path d={bodyPath} filter="url(#sb-fill)" fill={base} />
```

## Error handling

- Invalid contour points (NaN, out-of-order X) — already handled by
  `interpolateCurveY` (monotone resampling, clamping). No new guards.
- Empty silhouette — already handled upstream by the geometry layer
  (`composeBodyPoints` never returns an empty polygon for valid base
  shapes). No filter renders nothing; that's fine.
- Canvas DT failure (no 2D context, e.g. SSR) — `buildDistanceFieldImage`
  returns a 1×1 transparent data URL so the lighting filter still runs
  without throwing. The lighting will look flat, which is the correct
  degraded behavior.

## Testing

This is a visual lab tool; correctness is judged by eye. Verification
plan:

1. Load the lab, switch the fill mode through all three new options on
   the same shape (oval, default size). Confirm the dome is visible,
   the highlight position responds to the azimuth slider, and the
   apparent depth responds to `surfaceScale`.
2. Drag the contour's center Y from +1 to −1 in a single mode and
   confirm the dome transitions smoothly from outset (bright center) to
   inset (bright rim) without changing any other control.
3. Add a bubbles tail and resize the body to a tall thin balloon.
   Confirm the dome's peak follows the silhouette's medial axis (not
   the bbox center) for `bevel-rings` and `bevel-dt`. `bevel-blur` is
   expected to flatten on large shapes — that's the known tradeoff.
4. Lab is the test harness; no headless tests needed.

## Open questions

None — all design decisions resolved in the brainstorm.

## Out of scope

- Keeping `solid` as a fallback.
- Light-source UI other than azimuth/elevation sliders (no draggable
  light direction picker yet).
- Animated highlight scrub or recordable preset transitions.
- Stroke and shadow interaction tweaks. The new fill might look subtly
  different under heavy strokes; address only if it produces an obvious
  bug.
