# Multi-Light Dome v2 — Handoff

**Branch:** `port-to-labkit`
**Spec:** `docs/superpowers/specs/2026-06-02-contour-driven-normal-tilt-design.md`
**Plan:** `docs/superpowers/plans/2026-06-02-contour-driven-normal-tilt.md`
**Date paused:** 2026-06-02

---

## What this is

v2 of the multi-light dome shading. v1 (shipped 2026-05-31) treated the rim normal as if it lay entirely in the SVG plane — elevation barely did anything, and the contour curve had to fake a 3D look by painting the rim dark. v2 lifts the math to a real 3D body-of-revolution model with three new controls and the contour now only modulates physics rather than defining the dome shape.

## Update: 2026-06-02 — Dome polish shipped

The following items from the open-issues list are now closed (pending Mike's visual sign-off on the screenshots in `.playwright-mcp/dome-screenshots/`):

- **(1) Wedge seams fixed** via angular sub-slicing of each per-light wedge so adjacent wedges share the same sub-sample boundary rather than diverging at the seam ray. Commit `7a95d98`.
- **Contour editor gained bevel-ridge band + flip-vertically button** — the yellow `lk-curve-field__marks` band now shows the bevel-width region on the contour x-axis, and a "Flip vertically" button was added alongside the existing "Flip horizontally". Relevant labkit commits: `90a404e`, `acaa049`, `bae1d22`, `f4c5fae`; speech-balloons wiring: `4f95c2c`.
- **Bevel-width slider caps at geometric medial-axis distance** so it cannot exceed the largest inscribed circle radius of the body. Commit `24b6aeb`. Observed max on cloud shape: 16 px.
- **Debug overlay uses clipper miter inset for the bevel ring** so the yellow inset polygon follows the body outline with correct sharp/rounded corners rather than a simple offset. Commit `5c1abb2`.

Remaining open items: **(2)** rename `crownHeight` (tilt-blend factor, not a height); **(3)** strip / wire `domeGloss`/`specStrength`/`specSize`. Item **(4)** visual sign-off is captured in the screenshots above and awaits Mike's review.

---

## Controls

All on the `dome` fill effect. The control labels in `controls.ts` still use the original names.

| Control | Range | Default | What it does |
| - | - | - | - |
| `rimTilt` | 0–90° | 0° | Tilt of the surface normal at the silhouette. 0 = vertical wall; 90 = rim faces straight up. |
| `crownHeight` | 0–1 | 0 | How much steeper the tilt becomes toward the centroid. 0 = uniform tilt; 1 = centroid faces straight up (full hemisphere). |
| `bevelWidth` | 0–min(W,H)/2 px | 22 px | Width of the outer band that holds `rimTilt` before the interior ramps to crown. Constant pixel inset along the body's outward normal. |
| `contour` | curve | flat at y=1 | Optional painterly multiplier on top of physics. Default does nothing; user can paint deviations. |
| `lightAzimuth` / `lightElevation` | unchanged | unchanged | Key light direction. |

**UX gotcha:** with `crownHeight = 0` the bevel face and the interior have the same tilt, so `bevelWidth` is invisible. To see the bevel ring you need `crownHeight > 0`. Mention this if a user asks "why is my bevelWidth slider doing nothing."

**Dead sliders left in place:** `domeGloss`, `specStrength`, `specSize` exist in the schema but are not consumed by the renderer. They were part of the pre-v1 single-gradient dome and will come back when specular highlights ship (refinement #4 in the spec). The user explicitly chose to leave them rather than strip them.

## Key implementation files

- `src/SpeechBalloon.tsx` — all dome math lives at module scope (above the component):
  - `domeSurfaceTilt(r, rimTiltRad, crownHeight, bwNorm)` — θ(r) for the body of revolution
  - `computeLitArcs(sampler, az, el, samples, rimTiltRad)` — lit perimeter arcs via 3D N·L
  - `buildLightWedgePath` — centroid-to-arc clipPath
  - `sampleLightStops({ azimuthDeg, elevationDeg, rimTiltRad, crownHeight, rLit, rFar, bevelWidthPx, contour, samples? })` — per-light gradient stops
  - `bareBaseBBox(sampler)` — bbox of the base sampler (no tails/spikes/lobes baked in)
- `src/dome.test.ts` — 50 tests including 6 for `domeSurfaceTilt`, 4 for tilted `computeLitArcs`, 4 for `sampleLightStops`.
- `src/controls.ts` — control schema with `rimTilt`, `crownHeight`. Default contour is `[0, 1, 1, 1]` (flat at y=1).

## How the math works now (departed from the original spec)

The spec described a circular radial coord `r = distance / max(w,h)/2`. The user pushed for the math to follow the body shape, so it was upgraded:

- For each light, `rLit = attachmentS(light.az, sampler, cx, cy) → distance from centroid to perimeter in the light's azimuth direction`. Same with `rFar = ...` for the opposite direction.
- Gradient axis endpoints are `centroid ± rLit·L_dir` (lit) and `centroid − rFar·L_dir` (far). The centroid lands at `s = rLit / (rLit + rFar)` along the rendered SVG axis, not at 0.5.
- `bwNorm` is computed per-side: `bevelWidthPx / rLit` and `bevelWidthPx / rFar`. The bevel face is a constant `bevelWidth`-pixel inset along the body's outward normal in pixel space.
- The wedge clipPath was already body-shape-aware (uses the actual sampler). The change made the gradient values inside the wedge also body-shape-aware.

This is closer to refinement #3 in the spec ("per-segment radial bands") than to the original v2 plan, but only ALONG the light axis. Off-axis points inside the wedge still get linearly interpolated gradient values, so the seams between adjacent wedges may still be visible on highly non-circular bodies. Full per-direction shading is still a separate refinement.

## Debug overlay

Toggle "Dome debug overlay" in the runtime panel (top-left controls). It draws:

- Solid red ring = body silhouette
- Solid yellow ring = bevel band's inner boundary, constant `bevelWidth` pixels inset along each perimeter point's outward normal
- Yellow lines = light azimuth rays from centroid to actual rim in each light's direction
- Red dot = centroid (bbox center of the bare base sampler)

State lives at `runtime.domeDebug: boolean` (added to `types.ts`).

## Decisions made along the way (non-obvious)

1. **Contour stays a painterly multiplier**, not a surface profile. User explicitly chose this over option (a) "make contour the height profile" or (b) "hybrid both". Implication: with crown=0, brightness comes entirely from contour × cosEl uniform across the lit half; with crown>0, physics dominates and contour is fine-tuning.
2. **Bevel face overrides nothing**. The bevel band still gets multiplied by the contour at the rim end. With the new flat-at-1 default contour this is no longer a problem; with a custom dark-rim contour the bevel face will go dark.
3. **`crownHeight` is poorly named** — it's a *tilt blend factor*, not a height. We discussed renaming to `bevelAngle` / `domeCurvature` / `bevelWidth` but didn't apply the rename in this session. If the user wants this cleanup, it's a search-and-replace in `controls.ts`, `SpeechBalloon.tsx` (fillRender + domeLayers), and the spec/plan.
4. **`autoOuterRoundness` was deleted** — it was a leftover from the pre-v1 lit-bevel mode that subtly re-rounded rectangle corners based on `bevelWidth`. Gone in commit `be302ae`.
5. **Default contour changed** to `[0, 1, 1, 1]` in commit `fc6fbed`. v1's `[0, -1, 0.5, 0.5, 1, 0.7]` painted the rim dark to fake a dome; with v2 physics that's no longer needed and was making `bevelWidth` invisible.

## Open issues / what's next

In rough order of how urgently they came up:

1. **Wedge seams on non-circular bodies.** The per-light wedges share radial-ray boundaries; with the new flat contour those boundaries can be visible. Per-light-axis math fixed the lit/far asymmetry; off-axis points inside the wedge still inherit linear-axis brightness. The real fix is full per-direction shading (spec refinement #3).
2. **Rename `crownHeight`.** Currently the name doesn't describe what it does. Pending UX confirmation.
3. **Strip dead `domeGloss` / `specStrength` / `specSize`** when specular work begins, OR wire them up. User chose "leave for now."
4. **Visual verification of Task 6 cases** was paused before finishing — the user got distracted by the wedge-seam issue. Tests pass; visual states (v1 parity, rim tilt widening, full dome, bevel band) are all individually checkable but were not formally signed off.

## Restarting the session

Read this file plus:
- `docs/superpowers/specs/2026-06-02-contour-driven-normal-tilt-design.md` — design
- `docs/superpowers/plans/2026-06-02-contour-driven-normal-tilt.md` — original plan (note: math has departed from this; the body-shape upgrade lives in commit `d4949ed`)

Branch state: 13 commits ahead of `0fa1dcf` (the spec commit). Tests: 50 passing. Dev server: `npm run dev` (default port 5180).
