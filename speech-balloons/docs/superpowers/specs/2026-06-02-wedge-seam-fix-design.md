# Fix Dome Wedge Seams via Angular Sub-Slicing

## Background

The v2 multi-light dome (handoff `docs/superpowers/handoffs/2026-06-02-multi-light-dome-v2.md`) paints each light's lit region by:

1. `computeLitArcs(angleSampler, az, el, samples, rimTiltRad)` → centroid-radial-angle ranges where the rim is lit.
2. `buildLightWedgePath` → one pie wedge clipPath from centroid to the lit arc on the body silhouette.
3. One SVG `<linearGradient>` per light, axis aligned to the light azimuth, length `rLit + rFar` through the centroid.
4. `sampleLightStops` → gradient stops along that axis using `domeSurfaceTilt(r)` for the surface tilt and the per-light radius along the axis for the radial coord.

An SVG linearGradient is constant along lines perpendicular to its axis. Off-axis points inside the wedge inherit brightness from their projection onto the axis. On non-circular bodies, that projection misrepresents the actual radial distance from centroid to rim in the off-axis direction. Adjacent lights' wedges meet at terminator angles where each side carries its own single-axis approximation; the two approximations disagree, producing visible spoke seams.

## Goal

Make per-light shading body-shape-aware in **every** radial direction, not just along the light azimuth, so wedge boundaries become natural terminator curves rather than visual seams. Stay in SVG (no canvas overlay, no bitmap baking).

## Non-goals

- Replacing the linear-gradient SVG primitive with canvas/filter-based shading.
- Reconciling the pre-existing `(W/2, H/2)` vs. bbox-centroid inconsistency between `angleSampler` and `radiusAt` — out of scope; pre-dates this work.
- Renaming `crownHeight`.
- Stripping or wiring up `domeGloss` / `specStrength` / `specSize`.
- Adding any new user-facing control.

## Design

### Per-slice shading

For each light L and each lit arc `[α₀, α₁]` (centroid-radial angles, as returned by `computeLitArcs`):

1. Estimate perimeter arc-length over `[α₀, α₁]` by sampling 2–4 intermediate angles via `angleSampler`.
2. `N = clamp(ceil(arcLengthPx / 8), 4, 32)`.
3. Step `α` from `α₀` to `α₁` in `N` equal angular steps. For each step `k` with mid-angle `α_k` and edges `α_k ± Δ/2`:
   - `r_k = |angleSampler(α_k) − centroid|`
   - **clipPath**: `M centroid → L angleSampler(α_k − Δ/2) → small-step along perimeter to angleSampler(α_k + Δ/2) → L centroid → Z`
   - **linearGradient axis**: `(centroid) → (centroid + (cos α_k, sin α_k) · r_k)`
   - **stops** at offsets `s ∈ [0, 1]` (0 = centroid, 1 = rim):
     - `r = s`
     - `bwNorm = bevelWidthPx / r_k`
     - `θ = domeSurfaceTilt(r, rimTiltRad, crownHeight, bwNorm)`
     - `N3 = (cos α_k · cos θ, sin α_k · cos θ, sin θ)`
     - `phys = max(0, N3 · L)`
     - `paint = max(0, contour(1 − r))`
     - `opacity = phys · paint`

Multiple lit arcs per light → repeat per arc. Multiple lights → unchanged from today (each light's sub-wedges layer with the existing per-light intensity wrapper).

At the boundary between sub-slices k and k+1 within one light, the only mismatch is `N3` rotated by Δ — small for small Δ. Between adjacent lights' wedges at a terminator, each side now samples its own radial direction, so the discontinuity is just the natural one where `N·L → 0`.

### New helpers in `src/SpeechBalloon.tsx`

- `subdivideArc(angleSampler, α0, α1, centroid, targetPxPerSlice = 8, min = 4, max = 32) → number[]` — returns `N + 1` α-boundaries.
- `buildSliceWedgePath(angleSampler, αStart, αEnd, centroid, arcResolutionRad) → string` — one pie-wedge SVG-d.
- `sampleSliceStops({ axisAngleRad, rLocal, rimTiltRad, crownHeight, bevelWidthPx, light, contour, samples? }) → GradientStop[]` — half-axis stops (s=0 centroid, s=1 rim), single in-plane normal direction.

`sampleLightStops` stays for tests and back-compat but is no longer called from the renderer.

### `domeLayers` memo restructured

Today: one entry per light.

After: a flat array of sub-slice entries, each `{ clipD, x1, y1, x2, y2, stops, intensity }`. `intensity` is per-light (same for all sub-slices of a light) and still applied via the per-light `<g opacity=…>` wrapper that already exists in the JSX.

The render loop's shape is unchanged — it just iterates more entries.

### Component wiring

- `src/SpeechBalloon.tsx`: new helpers + `domeLayers` memo rewrite + JSX loop unchanged.
- `src/controls.ts`: unchanged.
- `src/types.ts`: unchanged.

## Testing

`src/dome.test.ts` gains:

1. **Single-slice circular parity.** With a unit-circle sampler, axis-angle = light azimuth, `r_local = 1` (so `rLit = rFar = 1`, `sCentroid = 0.5`): for any radial coord `r ∈ [0, 1]`, the opacity returned by `sampleSliceStops` at offset `s_new = r` equals the opacity returned by `sampleLightStops` at offset `s_old = (1 − r)/2` within `1e-6`. (Lit half only; the new function does not cover the far side.)
2. **Slice-boundary continuity.** Two adjacent sub-slices on a unit-circle sampler agree at their shared boundary within `1e-4`. (Same brightness because the boundary radial direction is the same for both — only the *axis* direction differs slightly.)
3. **Ellipse local radius.** On an axis-aligned 2:1 ellipse sampler, `r_local` at the major-axis direction is twice `r_local` at the minor-axis direction. Sampler-driven; no hardcoded ellipse math.
4. **`subdivideArc` clamps.** Arc with ≤ 4 sample-equivalent perimeter px → N = 4. Arc with ≥ 256 sample-equivalent perimeter px → N = 32. In between, N ≈ ceil(arcLenPx / 8).
5. **Backwards-compat for existing `sampleLightStops` and `computeLitArcs` tests** — all stay green.

Visual verification (dev server):

- v1 parity (`rimTilt=0, crownHeight=0`) on a circle and a long rectangle — indistinguishable from current build at the same params.
- A long rectangle with `rimTilt=30°, crownHeight=0.4`, single key light from the side — the old visible spoke seams along the wedge edges should be gone or significantly attenuated.
- Debug overlay still draws correctly; sub-slice clipPaths do not bleed past the body silhouette.

## Open questions

None blocking implementation.
