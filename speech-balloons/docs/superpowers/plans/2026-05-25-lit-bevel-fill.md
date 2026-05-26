# Lit-bevel fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all seven existing speech-balloon fill modes with a single `feDiffuseLighting` + `feSpecularLighting` pipeline driven by a contour-as-height profile, with three selectable heightmap sources.

**Architecture:** One unified SVG filter chain reads a distance-from-rim heightmap, applies the user's contour curve as a height remap via `feComponentTransfer`, then runs Phong-style diffuse + specular lighting with an explicit `feDistantLight`. Three modes differ only in heightmap construction: polygon inset rings (clipper2-ts), Gaussian blur of SourceAlpha, or canvas Euclidean distance transform exposed as `<feImage>`.

**Tech Stack:** React 18, TypeScript, SVG filter primitives (`feDiffuseLighting`, `feSpecularLighting`, `feDistantLight`, `feComponentTransfer`, `feGaussianBlur`, `feImage`), Vite dev server, clipper2-ts for polygon offsetting, HTMLCanvasElement for distance-transform rasterization.

**Reference spec:** `docs/superpowers/specs/2026-05-25-lit-bevel-fill-design.md`

**Verification model:** This repo has no test framework. Each task ends with a Vite dev-server visual check (`npm run dev`, open the lab in a browser, exercise the named control). Use `npx tsc --noEmit` for type safety after structural changes.

**File map:**
- `src/types.ts` — replace `FillMode` union
- `src/persistence.ts` — bump storage key, drop v5 contour migration
- `src/controls.ts` — rewrite the `fill` entry in `EFFECT_CONTROLS`
- `src/SpeechBalloon.tsx` — strip seven fill rendering paths, install one lighting filter chain
- `src/distanceTransform.ts` — NEW: Euclidean distance transform helper

---

## Task 1: Replace `FillMode` union and bump storage key

**Files:**
- Modify: `src/types.ts:6`
- Modify: `src/persistence.ts:5,42-53`

- [ ] **Step 1: Replace `FillMode` union**

Edit `src/types.ts` line 6.

Old:
```ts
export type FillMode = 'solid' | 'radial' | 'puffy' | 'raised' | 'sculpted' | 'aqua' | 'beveled';
```

New:
```ts
export type FillMode = 'bevel-rings' | 'bevel-blur' | 'bevel-dt';
```

- [ ] **Step 2: Bump storage key and drop v5 migration shim**

Edit `src/persistence.ts`.

Replace line 5:
```ts
export const LAB_STORAGE_KEY = 'speech-balloon-lab-v5';
```
with:
```ts
export const LAB_STORAGE_KEY = 'speech-balloon-lab-v6';
```

Replace the migration block (lines ~42–53):
```ts
    // Forward-compat: contour was Y-only `number[5]`; migrate to interleaved [x, y, …].
    for (const eff of parsed.design.effects ?? []) {
      if (eff.kind === 'fill' && Array.isArray(eff.params?.contour)) {
        const arr = eff.params.contour as number[];
        if (arr.length === 5) {
          const out: number[] = [];
          for (let i = 0; i < arr.length; i++) out.push(i / (arr.length - 1), arr[i]);
          eff.params.contour = out;
        }
      }
    }
```
with:
```ts
    // No legacy migration: schema bumped to v6 because both the fill-mode
    // union and the contour X-axis orientation changed incompatibly.
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors will appear in `src/SpeechBalloon.tsx` and `src/controls.ts` referring to the old `FillMode` values. That's expected — subsequent tasks fix them. The two files we just touched must NOT contribute errors themselves.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/persistence.ts
git commit -m "refactor: bump fill-mode union to bevel-{rings,blur,dt} (v6 schema)"
```

---

## Task 2: Rewrite `EFFECT_CONTROLS.fill`

**Files:**
- Modify: `src/controls.ts:22-67`

- [ ] **Step 1: Replace the fill control block**

In `src/controls.ts`, replace the entire `fill: [ … ]` block inside `EFFECT_CONTROLS` (lines ~22–67) with:

```ts
  fill: [
    { key: 'mode', label: 'Mode', kind: 'select',
      options: ['bevel-rings', 'bevel-blur', 'bevel-dt'],
      default: 'bevel-rings' },
    { key: 'base', label: 'Base color', kind: 'color', default: '#ffffff' },

    { kind: 'header', label: 'Contour (rim → center)' },
    {
      key: 'contour',
      kind: 'curve',
      length: 5,
      labels: ['Rim', 'Outer', 'Mid', 'Inner', 'Center'],
      min: -1,
      max: 1,
      step: 0.02,
      // X=0 = rim (alpha 0 in heightmap), X=1 = center (alpha 1, deepest interior).
      // Default = smooth outset dome: flat at the rim, climbing to a peak at center.
      defaults: [0, -0.05, 0.25, 0.4, 0.5, 0.78, 0.75, 0.95, 1, 1],
    },

    { kind: 'header', label: 'Light' },
    { key: 'lightAzimuth', label: 'Azimuth (°)', kind: 'range', min: 0, max: 359, step: 1, default: 135 },
    { key: 'lightElevation', label: 'Elevation (°)', kind: 'range', min: 0, max: 90, step: 1, default: 55 },
    { key: 'lightColor', label: 'Light color', kind: 'color', default: '#ffffff' },

    { kind: 'header', label: 'Material' },
    { key: 'surfaceScale', label: 'Surface scale', kind: 'range', min: 0, max: 30, step: 0.5, default: 8 },
    { key: 'diffuse', label: 'Diffuse', kind: 'range', min: 0, max: 2, step: 0.02, default: 1.0 },
    { key: 'specular', label: 'Specular', kind: 'range', min: 0, max: 2, step: 0.02, default: 0.6 },
    { key: 'shininess', label: 'Shininess', kind: 'range', min: 1, max: 128, step: 1, default: 30 },
    { key: 'specularColor', label: 'Specular color', kind: 'color', default: '#ffffff' },

    { kind: 'header', label: 'Rings (bevel-rings)', hideWhen: (p) => p.mode !== 'bevel-rings' },
    { key: 'rings', label: 'Ring count', kind: 'range', min: 4, max: 48, step: 1, default: 20, hideWhen: (p) => p.mode !== 'bevel-rings' },
    { key: 'smoothing', label: 'Smoothing (px)', kind: 'range', min: 0, max: 4, step: 0.1, default: 1.2, hideWhen: (p) => p.mode !== 'bevel-rings' },

    { kind: 'header', label: 'Blur (bevel-blur)', hideWhen: (p) => p.mode !== 'bevel-blur' },
    { key: 'blur', label: 'Blur (σ)', kind: 'range', min: 1, max: 60, step: 0.5, default: 14, hideWhen: (p) => p.mode !== 'bevel-blur' },

    { kind: 'header', label: 'Distance transform (bevel-dt)', hideWhen: (p) => p.mode !== 'bevel-dt' },
    { key: 'dtResolution', label: 'Resolution (px)', kind: 'range', min: 64, max: 512, step: 16, default: 256, hideWhen: (p) => p.mode !== 'bevel-dt' },
  ],
```

- [ ] **Step 2: Update `effectSummary` for the fill case**

In the same file, the `effectSummary` switch for `'fill'` (around line 126) currently reads `mode` and `base`. It still works for the new modes, but to be informative add the heightmap mode name. Leave the existing implementation as-is — `mode` is still a string and base color is still meaningful.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors confined to `src/SpeechBalloon.tsx` (which still references the old fill modes). `controls.ts` must compile cleanly on its own.

- [ ] **Step 4: Commit**

```bash
git add src/controls.ts
git commit -m "refactor: rewrite fill EFFECT_CONTROLS for lit-bevel modes"
```

---

## Task 3: Strip old fill rendering from `SpeechBalloon.tsx`

Leaves the component in a compilable, browser-runnable state with a plain unlit base-color fill. Subsequent tasks add lighting back.

**Files:**
- Modify: `src/SpeechBalloon.tsx` (substantial — the whole fill section)

- [ ] **Step 1: Delete dead fill code**

In `src/SpeechBalloon.tsx`, delete:

1. The `RGB`, `parseHex`, `mix`, `rgbToCss`, and `erf` helpers at the top (lines ~27–57). They're reused only by the old fill modes.
2. `contourToPoints` and `interpolateCurveY` — **keep these**; reused for the new contour-curve sampling.
3. `measureTextWidth` and `measureCanvas` — keep, unrelated to fill.
4. The entire `FillRender` interface and `renderFill` function (lines ~113–223).
5. The `fill`, `fillMode`, `hasPuffy`, `puffyFillId`, `sculptedFillId`, `beveledFilterId` declarations. (Keep `fillEffect` — it's still useful for resolving params.)
6. The `beveledParams`, `sculptedParams`, `puffyParams` memos in their entirety.
7. The `minDim`, `sOffset`, `sBlur`, `hOffset` lines for the inset-shadow filter.
8. All filter `<defs>` JSX for `puffyFillId`, `beveledFilterId`, `sculptedFillId`, `puffyId` (the inner-shadow filter).
9. The big conditional ladder in the body group: `fillMode === 'puffy' ? … : fillMode === 'raised' || fillMode === 'aqua' ? … : fillMode === 'beveled' ? … : fillMode === 'sculpted' ? … : …`. Replace with a single `<path d={bodyPath} fill={baseColor} />`.

- [ ] **Step 2: Add a `baseColor` constant**

The existing `fillEffect` lookup stays in place. Add a sibling line right after it:

```ts
const baseColor = (fillEffect?.params.base as string) ?? '#ffffff';
```

The body path and lightning paths now use `fill={baseColor}` instead of the old `fill.paint` / `fill.glossPaint`:

```tsx
<path d={bodyPath} fill={baseColor} />

{lightningPaths.map((d, i) => (
  <path
    key={i}
    d={d}
    fill={baseColor}
    stroke={strokeW > 0 ? strokeColor : 'none'}
    strokeWidth={strokeW || 0}
    strokeLinejoin="round"
  />
))}
```

The `allBubbles` flat list and `bodyOnlyPath` constant can be deleted: with no per-shape gradient anchoring, the unioned `bodyPath` is sufficient for tail bubbles. The geometry module still emits unions through `bodyAndBubblesPolys` → `bodyPath`, so bubbles render as part of the body silhouette automatically.

Delete the `allBubbles` memo and the `bodyOnlyPath` memo.

- [ ] **Step 3: Typecheck and start the dev server**

Run: `npx tsc --noEmit`
Expected: clean compile.

Run: `npm run dev`
Open the printed URL. Expected: balloon renders as a flat white shape with the existing tail / stroke / shadow / text. No lighting. Lab control panel still shows the new fill controls from Task 2 (they have no visual effect yet).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "refactor: strip seven legacy fill modes from SpeechBalloon"
```

---

## Task 4: Add the unified lighting filter (bevel-blur path)

Wire up the full lighting chain using `feGaussianBlur` of `SourceAlpha` as the heightmap. This validates the lighting math end-to-end with the simplest heightmap source. The next two tasks add the other two heightmap sources to the same chain.

**Files:**
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Add fill-param resolution memo**

Above the JSX return, add:

```ts
// Resolve fill params + sampled contour table for the lighting filter.
const fillRender = useMemo(() => {
  const p = fillEffect?.params ?? {};
  const mode = (p.mode as FillMode) ?? 'bevel-rings';
  const base = (p.base as string) ?? '#ffffff';
  const contour = (p.contour as number[]) ?? [0, -0.05, 0.25, 0.4, 0.5, 0.78, 0.75, 0.95, 1, 1];
  const cPoints = contourToPoints(contour);

  // Sample the smooth Hermite curve at 33 evenly-spaced X positions, remap
  // from [-1, 1] (signed height) to [0, 1] (alpha channel for feFuncA table).
  const N = 33;
  const table: string[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = Math.max(-1, Math.min(1, interpolateCurveY(cPoints, t)));
    table.push(((y + 1) / 2).toFixed(4));
  }

  return {
    mode,
    base,
    contourTable: table.join(' '),
    lightAzimuth: (p.lightAzimuth as number) ?? 135,
    lightElevation: (p.lightElevation as number) ?? 55,
    lightColor: (p.lightColor as string) ?? '#ffffff',
    surfaceScale: (p.surfaceScale as number) ?? 8,
    diffuse: (p.diffuse as number) ?? 1.0,
    specular: (p.specular as number) ?? 0.6,
    shininess: (p.shininess as number) ?? 30,
    specularColor: (p.specularColor as string) ?? '#ffffff',
    rings: Math.max(2, Math.round((p.rings as number) ?? 20)),
    smoothing: (p.smoothing as number) ?? 1.2,
    blur: (p.blur as number) ?? 14,
    dtResolution: Math.max(16, Math.round((p.dtResolution as number) ?? 256)),
  };
}, [fillEffect]);
```

Make sure `FillMode` is imported. The existing import at the top of the file already imports from `./types`; add `FillMode` to that import list.

- [ ] **Step 2: Add filter id and write the unified filter chain**

Above the `return` statement, add:

```ts
const fillFilterId = `${idPrefix}-fill`;
```

Then in the `<defs>` block, after the existing `hasShadow` filter (or wherever the old fill filters used to live — they've been deleted), add:

```tsx
<filter id={fillFilterId} x="-25%" y="-25%" width="150%" height="150%">
  {/* Step 1: heightmap source. bevel-blur = SourceAlpha blurred. */}
  {fillRender.mode === 'bevel-blur' && (
    <feGaussianBlur in="SourceAlpha" stdDeviation={fillRender.blur} result="heightmap" />
  )}
  {/* (bevel-rings and bevel-dt heightmap inputs added in later tasks.) */}

  {/* Step 2: remap heightmap alpha through the contour curve. */}
  <feComponentTransfer in="heightmap" result="profiled">
    <feFuncA type="table" tableValues={fillRender.contourTable} />
  </feComponentTransfer>

  {/* Step 3: diffuse lighting from a distant light. */}
  <feDiffuseLighting
    in="profiled"
    surfaceScale={fillRender.surfaceScale}
    diffuseConstant={fillRender.diffuse}
    lightingColor={fillRender.lightColor}
    result="diffuse"
  >
    <feDistantLight azimuth={fillRender.lightAzimuth} elevation={fillRender.lightElevation} />
  </feDiffuseLighting>

  {/* Step 4: multiply diffuse light by the base color.
      feFlood the base, clip to SourceAlpha, then blend with diffuse (multiply). */}
  <feFlood floodColor={fillRender.base} result="baseFlood" />
  <feComposite in="baseFlood" in2="SourceAlpha" operator="in" result="baseClipped" />
  <feBlend in="diffuse" in2="baseClipped" mode="multiply" result="litBase" />

  {/* Step 5: specular catch-light. */}
  <feSpecularLighting
    in="profiled"
    surfaceScale={fillRender.surfaceScale}
    specularConstant={fillRender.specular}
    specularExponent={fillRender.shininess}
    lightingColor={fillRender.specularColor}
    result="specular"
  >
    <feDistantLight azimuth={fillRender.lightAzimuth} elevation={fillRender.lightElevation} />
  </feSpecularLighting>
  <feComposite in="specular" in2="SourceAlpha" operator="in" result="specularClipped" />

  {/* Step 6: additive composite — diffuse-tinted base + specular highlight. */}
  <feComposite in="specularClipped" in2="litBase" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />

  {/* Step 7: final clip to silhouette. */}
  <feComposite in="lit" in2="SourceAlpha" operator="in" />
</filter>
```

- [ ] **Step 3: Apply the filter to the body path**

Change the body `<path>` rendering inside the `<g filter={…shadowId}>` group from:

```tsx
<path d={bodyPath} fill={baseColor} />
```

to:

```tsx
<path d={bodyPath} fill={baseColor} filter={`url(#${fillFilterId})`} />
```

Also apply the filter to lightning ribbons:

```tsx
{lightningPaths.map((d, i) => (
  <path
    key={i}
    d={d}
    fill={baseColor}
    filter={`url(#${fillFilterId})`}
    stroke={strokeW > 0 ? strokeColor : 'none'}
    strokeWidth={strokeW || 0}
    strokeLinejoin="round"
  />
))}
```

- [ ] **Step 4: Typecheck and verify**

Run: `npx tsc --noEmit`
Expected: clean compile.

Run: `npm run dev`
Open the lab. Switch the fill mode to `bevel-blur` (it might already be the default `bevel-rings`, which currently has no heightmap source wired up and will render as the plain flat base color — that's expected for now).

With `bevel-blur` selected:
- A lit dome should appear on the body.
- Drag the **Azimuth** slider 0 → 359°: the highlight should rotate around the dome.
- Drag the **Elevation** slider 0 → 90°: the dome should flatten as light approaches straight-down.
- Drag **Surface scale** 0 → 30: the lighting effect should go from flat to strong.
- Drag the contour curve's center point from +1 to −1: dome should transition from bright-center (outset) to bright-rim (inset).

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "feat: lit-bevel fill pipeline with bevel-blur heightmap source"
```

---

## Task 5: Add `bevel-rings` heightmap source

**Files:**
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Build inset-ring data URL**

The clipper module already exports `offsetClosedPolygons` and `polygonsToSvgPath`. The rings approach builds N concentric inset polygons, serializes them as a small inline SVG with grayscale fills, then exposes that via `feImage`.

Add a helper inside `SpeechBalloon.tsx` (above the component or in a `useMemo`):

```ts
// Compute the body's axis-aligned bounding box from the body polygon.
function polysBBox(polys: Polygon[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const pt of poly) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
```

Import `Polygon` from `./clipping` (it's already exported there).

- [ ] **Step 2: Build the rings data URL via memo**

In the component, add (alongside the other memos, after `bodyAndBubblesPolys`):

```ts
const ringsHeightmap = useMemo<{ dataUrl: string; x: number; y: number; w: number; h: number } | null>(() => {
  if (fillRender.mode !== 'bevel-rings') return null;
  const bb = polysBBox(bodyAndBubblesPolys);
  if (bb.w <= 0 || bb.h <= 0) return null;

  const rings = fillRender.rings;
  // Inset step = max possible inset before the polygon collapses, divided by ring count.
  // Use min half-dimension as a conservative cap.
  const maxInset = Math.min(bb.w, bb.h) / 2;
  const step = maxInset / rings;

  // Build N grayscale rings. Ring i covers (i*step, (i+1)*step) inset distance.
  // Grayscale: ring i (deepest) gets the brightest color so heightmap alpha = 1 at center.
  const paths: string[] = [];
  for (let i = 0; i < rings; i++) {
    const inset = offsetClosedPolygons(bodyAndBubblesPolys, -i * step);
    if (inset.length === 0) break;
    const d = polygonsToSvgPath(inset);
    // Brightness: ring i is brighter than ring i-1 → painter's algo paints them
    // from outside-in, so the deepest visible color wins.
    const v = Math.round(255 * (i / (rings - 1)));
    paths.push(`<path d="${d}" fill="rgb(${v},${v},${v})" transform="translate(${-bb.x},${-bb.y})" />`);
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w}" height="${bb.h}" viewBox="0 0 ${bb.w} ${bb.h}">` +
    paths.join('') +
    `</svg>`;
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return { dataUrl, ...bb };
}, [fillRender.mode, fillRender.rings, bodyAndBubblesPolys]);
```

- [ ] **Step 3: Wire `bevel-rings` into the filter chain**

In the `<filter id={fillFilterId} …>` block, add a branch for `bevel-rings` alongside the existing `bevel-blur`:

```tsx
{fillRender.mode === 'bevel-rings' && ringsHeightmap && (
  <>
    <feImage
      href={ringsHeightmap.dataUrl}
      x={ringsHeightmap.x}
      y={ringsHeightmap.y}
      width={ringsHeightmap.w}
      height={ringsHeightmap.h}
      preserveAspectRatio="none"
      result="ringsImage"
    />
    <feGaussianBlur in="ringsImage" stdDeviation={fillRender.smoothing} result="heightmap" />
  </>
)}
```

Also: `feImage`'s `href` attribute is the SVG 2 spec name; some older browsers want `xlinkHref`. React's TypeScript types accept both — use `href`. If targeting older Safari, also pass `xlinkHref={ringsHeightmap.dataUrl}` for safety. For this lab (modern browsers only) `href` alone is sufficient.

Important: `feDiffuseLighting` consumes the **alpha** of the heightmap. The rings data URL paints opaque grayscale rectangles, so alpha is 1 everywhere — useless for lighting. Fix: after the blur, copy the luminance channel into alpha via `feColorMatrix`:

Modify the rings branch to:

```tsx
{fillRender.mode === 'bevel-rings' && ringsHeightmap && (
  <>
    <feImage
      href={ringsHeightmap.dataUrl}
      x={ringsHeightmap.x}
      y={ringsHeightmap.y}
      width={ringsHeightmap.w}
      height={ringsHeightmap.h}
      preserveAspectRatio="none"
      result="ringsImage"
    />
    <feColorMatrix
      in="ringsImage"
      type="matrix"
      values="0 0 0 0 0
              0 0 0 0 0
              0 0 0 0 0
              0.333 0.333 0.333 0 0"
      result="ringsAlpha"
    />
    <feGaussianBlur in="ringsAlpha" stdDeviation={fillRender.smoothing} result="heightmap" />
  </>
)}
```

Apply the same alpha-from-luminance trick to `bevel-dt` in the next task.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Run: `npm run dev`
Switch mode to `bevel-rings`. Expected:
- A lit dome appears, similar to `bevel-blur` but sharper-edged (ring discretization visible at low ring counts).
- Drag **Ring count** 4 → 48: the dome smooths out as count rises.
- Drag **Smoothing** 0 → 4 px: dome edges soften.
- Drag the body width/height in the lab so the silhouette becomes very tall or wide: the dome peak should follow the silhouette's interior medial axis, not the bbox center. (This is the "centroid proportional to shape" property.)

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "feat: bevel-rings heightmap via nested clipper insets as feImage"
```

---

## Task 6: Add `distanceTransform.ts` and wire `bevel-dt`

**Files:**
- Create: `src/distanceTransform.ts`
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Create `src/distanceTransform.ts`**

```ts
// 2-pass Euclidean Distance Transform (Felzenszwalb–Huttenlocher 2012)
// applied to the alpha channel of a rasterized silhouette.
//
// Usage:
//   const heightmap = buildDistanceFieldImage(bodyPath, bbox, 256);
//   <feImage href={heightmap.dataUrl} x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} />

const INF = 1e20;

/** 1-D squared-distance transform of `f` along an axis of length `n`.
 *  Writes results into `out`. `v` and `z` are scratch buffers (length n and n+1). */
function dt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

/** Squared-distance transform of a 2-D binary image (1 inside, 0 outside).
 *  Output values are squared distance from each interior pixel to the nearest
 *  outside pixel. Pixels marked outside get distance 0. */
function distanceTransform2D(inside: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const f = new Float64Array(Math.max(w, h));
  const tmp = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  // Initialize: outside = 0, inside = +INF (distance from outside is infinite
  // until we propagate).
  for (let i = 0; i < w * h; i++) out[i] = inside[i] ? INF : 0;

  // Columns first.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    dt1d(f, h, tmp, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = tmp[y];
  }
  // Rows.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    dt1d(f, w, tmp, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = tmp[x];
  }
  return out;
}

export interface DistanceFieldImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Rasterize an SVG path to a canvas, run a 2-D Euclidean DT on the alpha
 *  channel, and return a PNG data URL where pixel value = normalized distance
 *  to the nearest exterior pixel (max distance → 255). Used as a heightmap
 *  input for the lit-bevel fill filter. */
export function buildDistanceFieldImage(
  bodyPath: string,
  bbox: { x: number; y: number; w: number; h: number },
  resolution: number,
): DistanceFieldImage | null {
  if (typeof document === 'undefined' || bbox.w <= 0 || bbox.h <= 0) return null;

  // Scale so the longer axis = `resolution`, preserving aspect ratio.
  const scale = resolution / Math.max(bbox.w, bbox.h);
  const w = Math.max(2, Math.round(bbox.w * scale));
  const h = Math.max(2, Math.round(bbox.h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Translate the path into the canvas coordinate space and draw filled white.
  ctx.fillStyle = '#fff';
  ctx.translate(-bbox.x * scale, -bbox.y * scale);
  ctx.scale(scale, scale);
  const p = new Path2D(bodyPath);
  ctx.fill(p);

  // Read alpha → binary inside mask.
  const img = ctx.getImageData(0, 0, w, h);
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;

  // Compute squared distance transform → Euclidean distance.
  const sq = distanceTransform2D(inside, w, h);
  let maxDist = 0;
  for (let i = 0; i < w * h; i++) {
    const d = Math.sqrt(sq[i]);
    if (d > maxDist) maxDist = d;
    img.data[i * 4 + 0] = 0;
    img.data[i * 4 + 1] = 0;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = d; // temporarily store distance in alpha; rescaled below
  }

  // Normalize alpha so the deepest interior pixel = 255.
  const norm = maxDist > 0 ? 255 / maxDist : 0;
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4 + 3] = Math.min(255, Math.round(img.data[i * 4 + 3] * norm));
  }

  ctx.putImageData(img, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}
```

- [ ] **Step 2: Build the DT heightmap in `SpeechBalloon.tsx`**

Add the import:

```ts
import { buildDistanceFieldImage } from './distanceTransform';
```

Add a memo alongside `ringsHeightmap`:

```ts
const dtHeightmap = useMemo<{ dataUrl: string; x: number; y: number; w: number; h: number } | null>(() => {
  if (fillRender.mode !== 'bevel-dt') return null;
  const bb = polysBBox(bodyAndBubblesPolys);
  if (bb.w <= 0 || bb.h <= 0) return null;
  const img = buildDistanceFieldImage(bodyPath, bb, fillRender.dtResolution);
  if (!img) return null;
  return { dataUrl: img.dataUrl, x: bb.x, y: bb.y, w: bb.w, h: bb.h };
}, [fillRender.mode, fillRender.dtResolution, bodyPath, bodyAndBubblesPolys]);
```

- [ ] **Step 3: Wire `bevel-dt` into the filter chain**

In the filter, add the third heightmap branch:

```tsx
{fillRender.mode === 'bevel-dt' && dtHeightmap && (
  <feImage
    href={dtHeightmap.dataUrl}
    x={dtHeightmap.x}
    y={dtHeightmap.y}
    width={dtHeightmap.w}
    height={dtHeightmap.h}
    preserveAspectRatio="none"
    result="heightmap"
  />
)}
```

Note: the DT image's alpha channel already encodes distance, so no `feColorMatrix` luminance-to-alpha step is needed (unlike `bevel-rings`, where the SVG fills as opaque grayscale).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Run: `npm run dev`
Switch mode to `bevel-dt`. Expected:
- A lit dome appears, smoothest of the three modes (no ring discretization, no Gaussian saturation).
- Drag **Resolution** 64 → 512: dome gets sharper / smoother at higher resolutions; lower resolutions produce slightly pixelated dome edges.
- Switch between `bevel-rings`, `bevel-blur`, `bevel-dt` rapidly; visually compare. All three should render a lit dome that responds identically to the light + contour controls. The differences should be in dome quality, not orientation.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/distanceTransform.ts src/SpeechBalloon.tsx
git commit -m "feat: bevel-dt heightmap via canvas Euclidean distance transform"
```

---

## Task 7: Final visual exercise + cleanup pass

**Files:**
- Modify: `src/SpeechBalloon.tsx` (only if unused imports remain)

- [ ] **Step 1: Final typecheck and dead-code scan**

Run: `npx tsc --noEmit`
Expected: clean.

Search `SpeechBalloon.tsx` for any remaining references to deleted helpers (`renderFill`, `FillRender`, `parseHex`, `mix`, `rgbToCss`, `erf`, `puffyParams`, etc.). Remove any leftover imports and unused identifiers.

Run: `npx tsc --noEmit` again. Clean.

- [ ] **Step 2: Full lab exercise**

Run: `npm run dev`. In the lab:

1. **All three modes round-trip:** Cycle `bevel-rings` → `bevel-blur` → `bevel-dt`. Each renders a lit dome.
2. **Inset/outset via contour:** With `bevel-dt`, drag the curve's `Inner` and `Center` Y values from +1 down to −1. The dome should smoothly invert — bright center → dark center, dark rim → bright rim.
3. **Light azimuth rotation:** Drag `Azimuth` 0 → 359°. Highlight rotates around the dome on all three modes.
4. **Multi-tail dome alignment:** Add a `bubbles` tail effect. Switch to `bevel-rings` and `bevel-dt`. The lit surface should flow continuously across the body and bubbles, with the deepest highlights inside each bubble's interior (not at the body's bbox center). `bevel-blur` will show this less cleanly because of blur saturation.
5. **Wide vs tall silhouettes:** Drag the body width slider to make a long thin balloon, then a tall thin one. Confirm the dome's peak follows the silhouette's medial axis instead of the bbox center. Most visible on `bevel-rings` and `bevel-dt`.
6. **Aqua look:** Pick a saturated base color (e.g. `#3b82f6`), specular white, shininess ~50, elevation ~65, surface scale ~10. The result should resemble an Aqua-style button: smooth lit body with a bright catch-light near the top.

Stop the dev server.

- [ ] **Step 3: Commit (if any cleanup happened)**

If the dead-code scan removed anything:

```bash
git add src/SpeechBalloon.tsx
git commit -m "chore: drop remaining dead fill helpers"
```

Otherwise skip the commit.

- [ ] **Step 4: Update HANDOFF / TODO if relevant**

If `TODO.md` or `HANDOFF.md` mention the old fill modes, update or remove those mentions. (Quick `grep -n "puffy\|aqua\|sculpted\|beveled\|radial" TODO.md HANDOFF.md` to check.) Commit any updates separately:

```bash
git add TODO.md HANDOFF.md
git commit -m "docs: update fill-mode references after lit-bevel rewrite"
```

---

## Verification summary

After all tasks complete:

- `npx tsc --noEmit` is clean.
- `npm run dev` renders three working lit-bevel fill modes.
- The contour curve, light azimuth/elevation, and material params behave identically across modes.
- The dome's apparent center follows the silhouette's medial axis on `bevel-rings` and `bevel-dt`, validating the "centroid proportional to shape" property.
- Inset vs outset surface behavior emerges from curve shape, not from a toggle.
