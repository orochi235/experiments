# Sky Models Lab — Expandable 2D Skyscape

## Goal

Extend `sky-color/sky-models.html` so each model strip is expandable into a 2D skyscape rendering at a chosen moment in time. Today each strip is a 1D timeline: X = time of day, Y = a single fixed viewing elevation, pixel color = sky color at that view. The expansion shows the full sky dome for one model at one instant, with a user-selectable projection.

## Scope

In scope:

- A disclosure control on each strip that toggles an inline 2D pane.
- Three projections per pane, swappable via segmented control: fisheye, equirectangular, sun-facing panorama.
- A global time cursor on all strips — click/drag to set the moment the expanded panes render.
- Extending all six model functions to take an arbitrary view direction (az, el) rather than view elevation only.
- A sun disk in the dome, positioned by real azimuth/elevation, colored by stellar temperature, replicated per star for multi-star presets.

Out of scope (deferred):

- A fully expanded modal/lightbox view. May be added later; the inline accordion design should not preclude it.
- Performance work beyond debouncing dome renders and using `ImageData`.
- Automated tests (this is a single-file HTML experiment with no test infra).

## Architecture

### Disclosure + pane layout

- Each `.strip-container` gets a caret button (`▸` / `▾`) prepended to `.strip-header`. Clicking the button or the title toggles a sibling `.expanded-pane` div appended to the container.
- The pane contains a projection selector (segmented control: three buttons) and a `<canvas class="dome">`, plus a small caption line showing the rendered time and sun position.
- Multiple panes may be expanded simultaneously for side-by-side comparison.
- Expand state and chosen projection persist in `localStorage` per-strip so refresh restores layout.

### Global time cursor

- A new global `selectedHour` (initial value: 12.0) controls the dome render time.
- Every strip draws a 1px vertical cursor at the X position of `selectedHour`, plus a small triangle handle at the top edge.
- Click anywhere on a strip → set `selectedHour`. Drag the handle → scrub.
- Changing `selectedHour` re-renders the cursor on every strip and triggers a debounced dome re-render for any expanded pane.

### Model refactor

All six model entry points unify on:

```js
modelColor(sunElev, sunAz, viewElev, viewAz, ...params)
```

Sun azimuth is fixed at 0 (the sun lives on the +z meridian). Internally each model computes γ (angle between view and sun directions) as:

```js
γ = acos(sin(sunEl)·sin(viewEl) + cos(sunEl)·cos(viewEl)·cos(viewAz − sunAz))
```

Per-model changes:

- **Preetham, Hosek-Wilkie, CIE**: replace the `γ = |viewθ − sunθ|` line that fakes "view in sun's vertical plane" with the real γ formula. Rest of the model is unchanged.
- **Nishita, Rayleigh-only, Nishita+Ozone**: replace the hardcoded `viewDir = [0, sin(ve), cos(ve)]` with `viewDir = [cos(viewEl)·sin(viewAz), sin(viewEl), cos(viewEl)·cos(viewAz)]`. Sun stays at `[0, sin(sunEl), cos(sunEl)]`. Existing scattering math is unchanged.

A shared helper `viewDirFromAzEl(azDeg, elDeg) → [x, y, z]` lives near the other math utilities. Strip rendering calls with `viewAz = 0` so existing 1D output is bit-identical to the current behavior.

### Projection math

For a canvas pixel, compute `(viewAz, viewEl)`, call the model, write the pixel.

- **Fisheye (equal-angle)**: square canvas of side `S`. For pixel `(px, py)` offset from center `(S/2, S/2)`: radius `r = √(px² + py²) / (S/2)`. Pixels with `r > 1` are drawn as ground color. Otherwise `viewEl = (1 − r) · 90°`, `viewAz = atan2(px, −py)` (so up on screen = away from sun).
- **Equirectangular**: 2:1 canvas. `viewAz = (px / W) · 360° − 180°` (sun-centered: 0° in the middle). `viewEl = 90° − (py / H) · 100°` so Y goes from +90° (top) to −10° (bottom). Pixels with `viewEl < 0` get the ground color.
- **Sun-facing panorama**: same as equirectangular but `viewAz` spans −90°…+90° (front hemisphere only). Wider angular resolution per pixel.

### Sun disk pass

After the sky pass, draw each star's disk:

- Project each star's `(az = star.hourOffset-adjusted, el)` into pixel space via the active projection.
- Draw a circle of angular diameter ~2° (in pixels for the current projection), filled with `blackbodyRGB(stellarTemp)`, with a soft radial falloff (~3× the disk radius) using additive blending against the sky.
- Clip against the horizon: pixels with `viewEl < 0` are not drawn.

### Render strategy

- **Strips**: unchanged — render on every slider change as today.
- **Panes**: render only when expanded. Use a single debounced path (~150ms after the last input event) so dragging a slider keeps the strips smooth and the dome catches up after release. Each pane renders independently into its own `ImageData` for direct pixel writes (faster than per-pixel `fillRect`).
- **Canvas size**: fisheye = 480×480; panoramas = 480×240. Scaled by `devicePixelRatio`. Responsive: on containers narrower than the canvas, scale down preserving aspect.
- **Style pass**: `applyStyle()` runs per-pixel in the dome exactly as it does for the strip, so global style sliders affect both views identically.

## Data flow

1. User changes a control (slider, time cursor, preset, etc.).
2. `scheduleRender()` runs strips immediately on next rAF (unchanged).
3. `scheduleDomeRender()` (new) debounces ~150ms, then iterates expanded panes and renders each.
4. Expanding a pane runs a one-shot render immediately, ignoring the debounce.
5. Switching projection on an already-expanded pane runs a one-shot render immediately.

## Edge cases

- **Below-horizon view pixels** (outside fisheye circle, equirectangular Y below horizon): flat ground color `#1a1a1a`-ish, consistent with the existing dark theme.
- **Sun below horizon**: the dome still renders — the models already produce twilight colors for `sunElev < 0`. The sun disk is clipped against the ground plane.
- **Deep twilight cutoffs**: Preetham returns black below sunElev = −6°, Nishita variants below −8°. The dome correctly shows full black for those times — this is intended model behavior, not a bug.
- **Multi-star presets**: each active star contributes scattering at its hour-offset sun position (existing per-star loop in the strip generalizes to the dome). Each star also gets its own disk.
- **localStorage corruption / version mismatch**: on parse error, fall back to all-collapsed default. No migration logic needed.

## UI specifics

- Caret button: 16px, aligned with the strip title baseline, rotates 90° when expanded via CSS transform with a short transition.
- Projection selector: segmented control with three labeled buttons (`Fisheye`, `Panorama 360°`, `Sun-facing`). Active button highlighted in the same accent color as the strip's reset buttons.
- Caption under the dome: small monospace-ish text, e.g. `"14:30 · sun elev 42°"`. (Sun azimuth is fixed at 0 by coordinate convention, so it isn't shown.)
- Time cursor: 1px vertical line in `rgba(255,255,255,0.5)` with a 6px triangle handle at the top. Cursor is drawn after the sky pass so it sits above the model output.
- Mobile (container < 600px): all dome canvases scale to container width; fisheye becomes a square fitting the container.

## Risks and tradeoffs

- **Performance**: 480×480 fisheye × 6 expanded models × Nishita's 192-op-per-pixel raymarch is ~265M ops per render. Debouncing keeps the strips smooth, but rendering all six expanded at once will take noticeable time (~1–3 s on a modern laptop). Acceptable for this exploratory lab; if it becomes painful, downsample (e.g. render at 240×240 and upscale) or render at lower sample counts for the dome only.
- **Model fidelity**: the existing Preetham/Hosek/CIE wrappers approximate γ with `|viewθ − sunθ|`. The new code uses real γ, which is what those models were designed for — strip output won't change (viewAz = 0 makes the two formulas equivalent in the sun's meridian), but the math is more correct overall.
- **Visual consistency**: the dome may surface artifacts at the horizon (Preetham/Hosek are known to have horizon problems at low sun elevations). This is a feature, not a bug — the lab is for comparing model behavior.
