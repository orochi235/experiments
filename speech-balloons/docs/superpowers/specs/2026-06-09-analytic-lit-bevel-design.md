# Analytic lit-bevel: region-based vector lighting (replaces the filter implementation)

## Purpose

Replace the SVG-filter implementation of the `lit-bevel` fill mode
(feDiffuseLighting/feSpecularLighting over a rasterized heightmap) with an
analytic vector renderer. The balloon's beveled 3D surface is decomposed
into a small set of regions, each of which is lit exactly and rendered as
a single SVG gradient path. The output for a rounded rectangle is ~30–50
paths total, independent of light count — no filters, no rasterization.

The mode keeps the name `lit-bevel`: the look it names (a lit 3D bevel
rising to a domed interior) is unchanged; only the machinery beneath it is
replaced. The filter implementation and its heightmap-source controls are
deleted.

## Core idea

The surface is fully determined by existing inputs: height
`z = height · h(d)`, where `d` is normalized distance from the rim
(0 at rim, 1 at the medial axis) and `h` is the user's contour curve with
the bevel seam at `x_b = bevelWidth / dMax`. The surface normal at any
point lies in the plane spanned by the local inward direction and
vertical, tilted by the contour slope `h′(x)`.

Each light conceptually projects illumination onto this virtual 3D model;
where the projection crosses a surface boundary it is cut, and each
contiguous piece becomes one gradient path. Concretely this falls out of
three observations:

1. **Region decomposition is light-independent.** The regions are the
   surface decomposition itself (band strips, corner fans, interior
   panels). Lights never add regions — they only change the gradient
   stops computed inside each region.
2. **Along a straight rim segment, intensity is a 1D function.** The
   segment's outward direction `m̂` is constant, so `N·L` varies only
   across the strip via `h′(x)`. Each strip is therefore an *exact*
   linear gradient whose stops are sampled from the contour slope.
3. **Corner arcs are fans of near-straight segments.** A single radial
   gradient cannot carry angular intensity variation, so arcs are
   subdivided by an angle tolerance and each slice treated as straight.
   Matched stops at slice boundaries make the fan read as smooth.

## Decisions log (from brainstorming, 2026-06-09)

- Lighting is **emergent from geometry** (`N·L`), not authored footprints
  — designed so stylized/quantized fills can swap in later (cel bands =
  quantize the 1D intensity function before emitting stops).
- **Generic over the rim polyline from day one.** The rounded rect is the
  first *test case*, not the first code path. Concave correctness (tail
  joins, lightning notches, self-intersecting insets) is explicitly
  deferred: v1 renders concave bodies with naive miter behavior,
  degraded-but-stable.
- **Interior treatment is a param** with all three variants:
  `roof-panels` (faithful: straight-skeleton cells), `dome-blob` (one
  offset radial gradient), `flat` (one tint).
- **Lights: reuse the existing dome rig** — the `domeLights` array derived
  in `SpeechBalloon.tsx` (key light from `lightAzimuth`/`lightElevation`
  + hardcoded opposite fill light, el 25°, intensity 0.35). Distant
  lights only. Exposing a user-editable light list stays a separate TODO.
- **Diffuse + specular both in v1.**
- **Replaces `lit-bevel`** rather than adding a fifth mode.
- **Merged stops, not per-light translucent overlays** (see Compositing).
- Regions must meet **continuously** at shared boundaries (the
  "transparent gradient edges" requirement): adjacent regions sample the
  same `N·L` at the shared boundary, plus ~0.5px outward expansion per
  region to kill SVG hairline seams.

## Geometry & region generation

Inputs: closed rim polyline (what the renderer already has),
`bevelWidth` (px), `dMax` (max inset of the bare body, existing), contour
`h(x)` with seam `x_b`, `interiorTreatment`, `cornerStep` (degrees).

Region kinds:

- **`strip`** — per rim segment: a quad from the rim edge inset to the
  bevel seam. Gradient frame: linear, along the inward direction.
  x-range `[0, x_b]`.
- **`fan`** — corner arcs subdivided every `cornerStep` degrees; each
  slice is an annular sector treated as a straight segment with the
  slice-midpoint azimuth. Same x-range as strips.
- **`panel`** — (`roof-panels` only) each edge's straight-skeleton cell
  beyond the seam, ending at ridge polylines. x-range `[x_b, 1]`.
- **`blob`** — (`dome-blob` only) the whole interior past the seam as one
  radial gradient, center offset toward the net light direction.
- **`flat`** — (`flat` only) the interior as a single uniform tint (a
  distant light on a flat surface is constant).

The straight skeleton comes from the miter-inset interpretation: under
miter offsetting, vertices travel along angle bisectors — which is the
straight skeleton. Track edge-collapse events as the inset grows; each
edge's swept area is its roof panel; ridge polylines are the bisector
trajectories. This reuses the conceptual machinery of
`offsetClosedPolygon` rather than importing a skeleton library.

## Shading & compositing

Per sample point `x` inside a region, in **linear RGB**:

```
s(x)        = h′(x) · height / dMax                    (surface slope)
N(x)        = normalize(m̂ · s(x) + ẑ)                  (in the m̂–z plane)
diffuse(x)  = Σᵢ lightColorᵢ · intensityᵢ · max(0, N(x)·Lᵢ)
specular(x) = Σᵢ lightColorᵢ · intensityᵢ · specStrength
                · max(0, N(x)·Hᵢ)^shininess
color(x)    = albedo ⊗ (ambient + diffuse(x)) + specular(x)
            → clamp to [0,1] → convert to sRGB hex
```

`Lᵢ` from the existing `lightDirection(az, el)` helper; `Hᵢ` is the
half-vector with the viewer straight overhead (`V = ẑ`). `ambient` is the
floor unlit regions fall to — darkness is absence of light, never a
painted black overlay.

**Merged stops:** each region renders once, as a single opaque gradient
path whose stops carry the final summed color. Rationale:

- Exact — browser blending of translucent overlays happens in sRGB, so
  `plus-lighter` stacking would be physically wrong.
- Path count independent of light count.
- Opaque output needs no backdrop guard.
- Stylization hook: quantize intensity before emitting stops.

**Per-contributor isolation** (shading-layers panel) recomputes stops
with an `exclude` set (ambient / key light / fill light / specular)
rather than hiding DOM nodes. Same UX, exact math. A per-light
translucent-overlay debug view may exist later but the renderer is not
built around it.

## Controls & params

Reused unchanged: `base` (albedo), `bevelWidth`, contour + partition,
`lightAzimuth`, `lightElevation`.

Removed with the filter implementation: `heightmapSource`, `blur`,
`rings`, `smoothing`, `dtResolution`. Stale keys in saved workspaces are
ignored; missing new keys take declared defaults — no migration.

Kept, reinterpreted:

- `surfaceScale` → relabeled **"Bevel height"** — physical height
  amplitude scaling the contour (sets normal tilt via
  `s = h′ · height / dMax`).
- `diffuse` (gain), `specular` (strength), `shininess` (exponent),
  `lightColor` (tints the key light), `specularColor`.

New:

- `interiorTreatment` — select `['roof-panels', 'dome-blob', 'flat']`,
  default `roof-panels`.
- `ambient` — range 0–1, default 0.25.
- `cornerStep` — corner-fan angle tolerance, range ~4–30°, default 12°,
  in a debug/advanced group.

All `hideWhen: p.mode !== 'lit-bevel'`, as today.

## Code architecture

New pure modules (no DOM, all unit-testable):

- **`src/straightSkeleton.ts`** — rim polyline → per-edge cells + ridge
  polylines via miter-inset bisector tracking with collapse events.
- **`src/bevelRegions.ts`** —
  `buildRegions(rim, bevelWidthPx, dMax, interiorTreatment, cornerStepDeg)
  → Region[]`. A `Region` carries outline points, kind, outward azimuth
  (or angular range), x-range, and gradient frame (linear axis or radial
  center). Pure geometry, light-independent.
- **`src/litBevelShading.ts`** —
  `computeStops(region, lights, contour, material, exclude) →
  {offset, color}[]`. Linear-light accumulation, clamp, sRGB hex out.
  `exclude` makes panel isolation a parameter, not a special case.

In `SpeechBalloon.tsx`: delete the filter-based block (the
`litBevelRingPaths` memo and the filter-chain JSX) and replace with a
slim memo: `buildRegions` → `computeStops` per region → one `<path>` +
one gradient def per region, grouped and clipped to the body silhouette,
each region expanded ~0.5px against hairline seams. Net lines in that
file should go down.

Shading panel registration via existing `pushShading`: rows for
Ambient / Key light / Fill light / Specular (toggle via `exclude`), plus
region-kind groups (band / interior) that pulse-highlight the actual DOM
groups.

## Testing

Unit (vitest):

- `straightSkeleton.test.ts` — square ridges meet at center; W×H
  rectangle yields a ridge of length |W−H| on the long axis; cell areas
  sum to polygon area; collapse events in distance order.
- `bevelRegions.test.ts` — strip count = edge count; fan spans sum to
  corner turning angles; regions tile the silhouette (no gaps, overlap ≤
  seam epsilon); strip x-ranges `[0, x_b]`, panels `[x_b, 1]`.
- `litBevelShading.test.ts` —
  - flat contour (`h′ = 0`) → intensity exactly `sin(elevation)`,
    azimuth-independent;
  - **boundary continuity:** color at a shared region boundary equal
    from both sides (strip↔panel at the seam, fan-slice↔fan-slice);
  - `exclude` all lights → exactly `ambient × albedo`; exclude specular
    → no stop exceeds the diffuse ceiling;
  - monotonicity: adding a light never darkens any stop.

Browser (dev server + headless Playwright screenshots):

- Azimuth swept 360° — bright band rotates continuously, no popping at
  fan boundaries.
- Elevation → 90° flattens contrast; contour edits reshape the band
  profile live; partition drag moves the seam crease.
- `interiorTreatment` cycling — ridges appear only for `roof-panels`;
  `flat` matches `roof-panels` when the interior contour is flat.
- Spiky burst + lightning: per-facet lit/dark alternation; concave joins
  degraded-but-stable.
- DOM sanity: ~30–50 paths for a rounded rect, independent of light
  count.
- Side-by-side A/B against `dome` / `brdf` under identical lighting.

## Out of scope

- Concave-rim correctness (self-intersecting insets at tail joins /
  lightning notches) — v1 renders them naively; correctness pass later.
- User-editable light list (existing TODO stands), point lights,
  distance falloff.
- Stylized/quantized fills (cel bands) — enabled by the architecture,
  not built in v1.
- Per-light translucent-overlay debug view.
- Iso-band fallback renderer from the distance field (kept in the back
  pocket for pathological silhouettes).
