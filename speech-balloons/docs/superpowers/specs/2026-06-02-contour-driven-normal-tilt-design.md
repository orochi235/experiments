# Contour-Driven Normal Tilt for Multi-Light Dome (v2)

## Background

The v1 multi-light dome (shipped 2026-05-31) shades the body by:

1. For each light, finding the rim arcs where `n2d · L_xy > 0` (the in-plane outward normal faces the light's in-plane direction).
2. Building a centroid-to-arc wedge clipPath.
3. Painting a linear gradient along the light's azimuth inside that wedge.
4. Modulating the gradient stops with a user-painted `contour` brightness curve.

The rim's surface normal is treated as if it lies entirely in the SVG plane (z = 0). Elevation barely affects which arcs are lit — it only kicks in at the extremes. There is no notion of the body having any out-of-plane shape, so a low light and a high overhead light look near-identical on the rim.

## Goal

Lift the lit-arc terminator and the per-light brightness gradient to a true 3D shading model driven by an implicit body-of-revolution surface. The user controls the shape with two intuitive sliders; the contour curve remains a *painterly modulation on top of physics*, not the sole brightness driver.

## Non-goals

- Replacing the contour with a height-profile curve editor (rejected — keep contour semantics stable).
- Specular highlights (separate future refinement).
- Per-segment radial bands / per-rim-position surface profile for non-elliptical bodies (separate future refinement).
- A mesh-based surface abstraction (separate future refinement).

## Design

### New / repurposed params on the `dome` fill effect

`rimTilt` and `crownHeight` are new. `bevelWidth` already exists in the schema (a vestige of the old lit-bevel mode that today does nothing useful — its only remaining effect is feeding `autoOuterRoundness`). We repurpose it as the radial transition-band width in the tilt model.

| Param         | Range          | Default | Meaning                                                                                                                                                                                |
| ------------- | -------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rimTilt`     | 0–90°          | 0°      | Tilt of the surface normal at the rim, lifted out of the SVG plane.                                                                                                                    |
| `crownHeight` | 0–1            | 0       | How much the surface bulges toward the centroid. 0 = flat. 1 = strong dome.                                                                                                            |
| `bevelWidth`  | 0–min(W,H)/2 px | 22 px   | Radial width of the rim-to-crown transition band. `bw ≥ R` collapses to a single smooth ramp (no flat plateau). Small `bw` produces a flat-topped body with a tilted ring at the rim. |

When `rimTilt = 0`, `crownHeight = 0` (any `bevelWidth`) the renderer produces output indistinguishable from v1 (within sampling noise).

The old `autoOuterRoundness` coupling on rectangle bodies is removed in the same change — it existed to match a bevel ring's inner-shape inset, which no longer exists.

### Implicit surface model

A radially symmetric body of revolution centered on the bbox centroid. Radial coordinate `r ∈ [0, 1]` with `r = 0` at the centroid and `r = 1` at the rim along the current radial direction. Bbox-centroid is the reference origin and `R = max(bbox.w, bbox.h) / 2` is the radial scale. Distance from centroid is divided by `R` to get `r`. This is isotropic and will visibly stretch on long rectangles; refinement #3 fixes that.

Rather than deriving the surface from a height-profile curve, we parameterize the surface tilt `θ(r)` (the angle the outward normal lifts above the SVG plane) directly from the sliders:

```
crownTilt = lerp(rimTilt, π/2, crownHeight)
bwNorm    = clamp(bevelWidth / R, 0, 1)
rBevel    = 1 - bwNorm                        // start of the transition band (toward centroid)

θ(r) =
  rimTilt                                                    if r ≥ rBevel        (the bevel face)
  lerp(crownTilt, rimTilt, (r - 0) / (rBevel - 0))           if r < rBevel        (interior ramp)
```

In words: the outermost band of width `bevelWidth` holds the rim tilt — that's the bevel face. Inside that band, the tilt ramps linearly from `crownTilt` at the centroid to `rimTilt` at the inner edge of the bevel. (Smooth blends with the bevel face by construction since both meet at `rimTilt`.)

Behavior at the corners of the parameter space:

- `crownHeight = 0` (any `rimTilt`, any `bevelWidth`): `crownTilt = rimTilt`, so `θ(r) = rimTilt` everywhere — flat surface at uniform tilt. With `rimTilt = 0` this is v1 exactly.
- `crownHeight = 1, rimTilt = 0, bevelWidth = R`: pure hemispherical dome (vertical rim, horizontal crown, single ramp).
- `crownHeight = 1, rimTilt = 0, small bevelWidth`: flat-topped body with a narrow vertical band at the rim — this is the classic bevel look.
- `crownHeight = 0.4, rimTilt = 30°, bevelWidth = 22px`: gentle plateau with a 30°-tilted bevel at the rim. The shading reads as a beveled body.

This is not derived from a height profile, but the result is a valid body of revolution (the field `θ(r)` can be integrated back to one if needed — we just don't need to). It trades "literal h(r) curve" for well-behaved knobs with no degenerate regimes.

### Math relationships used downstream

For a sample at radial position `r` with the in-plane normal direction `(nx, ny)`:

```
N3 = (nx · cos θ(r), ny · cos θ(r), sin θ(r))
```

At the rim, `(nx, ny)` is the perimeter's outward normal from the existing `angleSampler`. Inside the wedge (sampling along the light azimuth), `(nx, ny)` is `sign(d) · (cos az, sin az)` where `d` is signed distance from centroid along the gradient axis.

### Math changes

**`lightDirection`** stays as-is.

**`computeLitArcs`** gains a `rimTiltRad` parameter. New per-sample test:

```ts
const Lxy = nx * Lx + ny * Ly;           // current 2D test
const NdotL =
  Math.cos(rimTiltRad) * Lxy +            // tilted in-plane component
  Math.sin(rimTiltRad) * L[2];            // up component dotted with L_z
lit[i] = NdotL > 1e-9;
```

The 3D normal is `(nx · cos θ, ny · cos θ, sin θ)`. Substituting into `N · L` gives the expression above. At `θ = 0` it collapses to the v1 test.

**New per-light gradient sampler** replaces the global `contourStops` memo. For each light:

1. Find the gradient axis: centroid ± `(cos az, sin az) · R` (today's `x1,y1,x2,y2`).
2. Sample N = 16 points along the axis. For each sample `s ∈ [0, 1]`:
   - World position: `lerp(start, end, s)`.
   - Signed distance from centroid along the axis: `d = (s - 0.5) · 2R`. Negative = lit side, positive = shadow side.
   - Radial coordinate: `r = clamp(|d| / R, 0, 1)`.
   - Surface tilt at `r`: `θ(r)`.
   - In-plane normal direction: along the gradient axis, pointing toward the rim on that side. `n2d = sign(d) · (cos az, sin az)`.
   - 3D normal: `N3 = (n2d_x · cos θ, n2d_y · cos θ, sin θ)`.
   - Physical factor: `phys = max(0, N3 · L)`.
   - Painterly multiplier: `paint = max(0, interp(contour, s_to_t(s)))` where `s_to_t(s)` maps gradient-axis `s` back to the contour's radial parameter `t` (lit rim → centroid → far rim, same convention as today's contour-stops code).
   - Stop opacity: `amount · light.intensity · phys · paint`.
3. Emit N+1 SVG `<stop>` elements (offset = s, opacity = above).

**`domeLayers` memo** now produces per-light `stops: Array<{offset, opacity}>` instead of a single global `contourStops` shared across lights, because the physical factor differs per light.

### Component wiring

- `controls.ts`: append `rimTilt` and `crownHeight` range controls to the dome fill-effect param schema. The existing `bevelWidth` control stays — its label and `hideWhen` are unchanged.
- Default contour stays unchanged.
- `SpeechBalloon.tsx`:
  - `computeLitArcs` signature gains `rimTiltRad`.
  - `angleSampler` is unchanged.
  - `contourStops` memo is removed; replaced by per-light stops inside `domeLayers`.
  - Render: the existing `<linearGradient>` per layer now emits the per-layer stops array.
  - `autoOuterRoundness` and the `effectiveBaseParams` memo are deleted. The body sampler now uses `design.baseParams` directly. The vestigial coupling between `bevelWidth` and rectangle roundness goes away.

## Testing

`src/dome.test.ts` is extended:

1. **Backwards-compat**: `computeLitArcs(sampler, az, el, samples, 0)` matches v1 output on the unit-circle sampler (existing 3 tests stay green).
2. **High rim tilt extends lit arc**: With `rimTilt = 80°` and a horizontal light from `+x`, `el = 30°`, the lit arc now covers more than half the rim (since the upward-tilted normal catches the elevated light from behind).
3. **Full lit at rimTilt = 90° + any positive elevation**: Whole rim returns as a single full-circle arc.
4. **New helper `domeSurfaceTilt(r, rimTiltRad, crownHeight, bwNorm)` is unit-tested**:
   - `rimTilt = 30°, crownHeight = 0.5, bwNorm = 0.2, r = 1` → `θ = 30°` (rim).
   - `crownHeight = 0` → `θ(r) = rimTilt` for all `r` and any `bwNorm`.
   - `rimTilt = 0, crownHeight = 1, bwNorm = 1, r = 0` → `θ = 90°` (full hemispherical dome at centroid).
   - `rimTilt = 0, crownHeight = 1, bwNorm = 1, r = 0.5` → `θ = 45°` (linear ramp midpoint).
   - `rimTilt = 0, crownHeight = 1, bwNorm = 0.1, r = 0.95` → `θ = 0°` (inside bevel band).
   - `rimTilt = 0, crownHeight = 1, bwNorm = 0.1, r = 0.5` → `θ = 40°` (interior ramp: `lerp(90°, 0°, 0.5/0.9) = 90° · 4/9`).
5. **Gradient sampler unit test**: For a horizontal light at elevation 0, the brightest sample falls at the lit-rim end (`s = 0`). For an overhead light (`el = 90°`) with positive `crownHeight`, the brightest sample shifts toward the centroid (`s ≈ 0.5`).

Visual verification: run dev server, drag the new sliders, confirm:

- `rimTilt = 0, crownHeight = 0`: indistinguishable from current dome.
- `rimTilt = 45°`: rim catches more light; both lit arcs visibly widen.
- `rimTilt = 0, crownHeight = 1`, light overhead (`el ≈ 70°`): bright spot lands near the centroid; the rim is darker than the middle. This is the "real dome" look the plan calls for.
- `rimTilt = 30°, crownHeight = 0.4, bevelWidth = 22px` on a rectangle: reads as a flat-topped beveled body with light catching the tilted bevel ring. Dragging `bevelWidth` should visibly widen/narrow the lit ring.

## Open questions

None blocking implementation. One note for the implementer: linear interpolation of `θ(r)` is the simplest curve. If the linear shape looks visually flat between rim and crown when `crownHeight` is high, swap to an ease (e.g. `1 - (1-r)^2`) before changing any other math. The unit tests assume linear; update them in the same change.
