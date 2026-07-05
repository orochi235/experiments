# Speech Balloon Lab — handoff

Branch: `main` (light-rig work merged).

## Recent work: QA sweep (task D) — DONE, browser-verified (2026-07-05)

The queued sweep from the concave-rim spec: the shading-panel dome row bug,
plus seams / corner fans / extreme params across all four fill modes.
Keeper screenshots in `screenshots-clean/qa-*.png`. Unit tests still 143
pass; typecheck clean; console clean across the whole sweep session (only
the known favicon 404).

### Fixed

- **Dome shading-panel slice mislabeling** (the queued bug, traced to
  `d8815fb`): `domeLayers` is slice-granular (one entry per light × lit-arc
  × subdivision — ~96 slices/light), and the paint loop pushed one panel row
  per SLICE labeled as if the index were a light index ("Key light", "Fill
  light", "Light 3…N" for hundreds of rows). Now each `domeLayers` entry
  carries `lightIndex`, and the paint loop wraps each light's slices in one
  `<g data-shading-id="dome.light-{i}">` pushing one row per LIGHT, labeled
  "Light 1…N" (matching the lit-bevel convention from `b0489e4`). Hide
  (display:none on the group) and highlight (pulse class) verified against
  the whole light. A light in the rig always gets its row, even if fully
  unlit. `qa-01-dome-rows-fix.png`.
- **BRDF shading-panel rows showed raw layer keys** ("0-d", "1-s", "2-r")
  because the paint loop used `label: layer.key`. `BrdfLayer` now carries a
  `label` ("Light N diffuse/specular/rim"). Found by the sweep's 6-light
  BRDF config.
- **Handoff misstatement corrected below:** BRDF does NOT consume per-light
  color — the spec (Renderer consumption section) says color is ignored and
  BRDF layers tint with `highlightColor`; the code matches the spec. The
  previous handoff claimed otherwise.

### Sweep matrix (all PASS unless noted as a finding)

1. Dome, 6 lights at extreme elevations (0°, 5°, 55°, 85°, 90°, plus an
   intensity-0 light): no NaN/Infinity in any path or gradient, 6 panel
   rows, el-0 light correctly produces a half-rim slice set (77 vs 96).
   `qa-02-dome-6lights.png`.
2. Lit-bevel, rectangle roundness 0 (sharp miters): crisp corner faces, no
   corner-fan artifacts, bands flow around the tail notch.
   `qa-04-litbevel-sharp.png`.
3. Lit-bevel, bevelWidth 200 on a 280×140 body: `bareBaseMaxBevel` clamp
   engages (≈3% pixel delta vs width 22 — band boundary only), no geometry
   blowup. `qa-05-litbevel-maxbevel.png`.
4. Lit-bevel, cloud body + lightning tail (concave stress): 198 paths, no
   NaN, faceted-but-correct lobe shading. `qa-06-litbevel-cloud-lightning.png`.
5. BRDF, 6 colored lights: 6 × (diffuse/specular/rim) layers, no NaN.
   Near-white wash is expected additive saturation with 5 bright lights,
   not a defect (per-light color is ignored by design).
   `qa-08-brdf-6lights.png`.
6. Aqua, cloud + lightning: renders correctly. `qa-07-aqua-cloud.png`.
7. Extreme body: 40×30 at shear 25° with a 60px tail — degraded but
   stable, no NaN. `qa-09-tiny-sheared.png`.
8. Spikes morph + lit-bevel (~80 concave vertices): 404 paths, no NaN,
   stable; shading is coarsely faceted at this rim complexity (see
   findings). `qa-10-spikes-litbevel.png`.
9. Fresh-default regression after the fixes: default two-light dome scene
   shows exactly Body fill + Light 1 + Light 2.

### Findings (documented, NOT fixed here)

- **Dome slice-boundary fan streaks:** at zoom ≥2 the key light's wedge
  shows radial banding — adjacent slices abut with per-slice gradient
  steps/AA hairlines, visible as a sunburst fan near the wedge apex
  (`qa-03-dome-seams-zoom.png`). The lit-bevel remedy (1px same-paint
  stroke) does NOT transfer: dome slices paint alpha gradients under
  screen blending, so overlap double-brightens. A real fix needs design
  work (e.g. per-light offscreen compositing or smoother per-slice stop
  interpolation).
- **Cloud shape side nubs:** the cloud base silhouette grows small
  capsule-shaped protrusions at its horizontal extremes (visible in both
  lit-bevel and aqua, so base geometry, not shading — pre-existing, shape
  generator). `qa-07-aqua-cloud.png`.
- **Light gizmos off-canvas at defaults:** with the default scene, canvas
  size, and zoom, BOTH default lights' discs project outside the canvas
  clip — the gizmo feature is invisible until a light is re-aimed from the
  panel or the canvas is enlarged. Generalizes the known "off-canvas discs"
  item below (it's not just the high-el key light).

## Earlier: user-editable light rig — DONE, browser-verified

**Spec:** `docs/superpowers/specs/2026-07-03-light-rig-design.md`
**Plan:** `docs/superpowers/plans/2026-07-04-light-rig.md`
**Commits:** `505fe28` → `b0489e4` (types/defaults/migration → state layer →
renderer → panel → gizmos → drag fixes → label fix)

What landed: the light rig is now scene-level user-editable state.
`DesignState.lights: LightInstance[]` (min 1 / max 6; `{az, el, intensity,
color}`) replaces the four legacy fill params (`lightAzimuth`,
`lightElevation`, `lightAngle`, `lightColor`), which are removed from the
controls and `fillRender` but still read by the migration.

- **State layer** (`src/lightRig.ts`): `defaultLights()` reproduces the old
  hardcoded pair exactly (az 270/el 55/1.0 white + az 90/el 25/0.35 white);
  `ensureLights` is the in-place workspace-config migration.
- **Migration semantics:** runs on both localStorage load paths and the
  file-import handler. Synthesizes `lights` from the first fill effect's
  legacy params (key light az/el/color from the params; aqua scenes read
  `lightAngle`; fill light derived at az+180 % 360, el 25, 0.35 white), then
  deletes the legacy params. Old scenes render pixel-identical post-migration.
- **Renderer** (`src/SpeechBalloon.tsx`): `domeLights` memo =
  `design.lights` (fallback `defaultLights()`). Per-mode consumption:
  - **lit-bevel** — full rig; **per-light color is a new capability**
    (light 1 was previously forced white).
  - **dome** — az/el/intensity of every light; color ignored (dome keeps its
    tint-pair model of highlight/shadow tints).
  - **BRDF** — was **already multi-light** before this cycle; it consumes
    az/el/intensity of every light. Per-light color is ignored (layers tint
    with `highlightColor`), per the spec's renderer-consumption section.
    The spec was corrected mid-cycle on the multi-light point — keying BRDF
    to `lights[0]` would have regressed it.
  - **aqua** — reads `lights[0].az` only; other lights and all other fields
    are inert by design.
- **`LightsPanel`** (`src/LightsPanel.tsx`): per-light az/el/intensity/color
  rows in the right panel, add/remove buttons enforcing the 1/6 bounds, and a
  "Show handles" toggle wired to `runtime.showLightHandles`.
- **On-canvas gizmos** (`src/lightGizmo.ts`): gold-ringed discs (fill =
  light color, doubling as a swatch) at the debug-overlay lollipop positions
  — the forward projection is the same math (ground point at dist·cos(el)
  along az, disc lifted 0.6·dist·sin(el) in screen −y). Pointer-capture drag
  maps back to az/el via the inverse solver; a no-op short-circuit avoids
  dirtying undo history on click-without-move.
- **Inverse solver:** a unimodal-f bisection. The plan's original solver had
  a real bug the implementer caught: f(0) can be positive with an interior
  negative dip (pointer above center), so testing f(0) mislabels reachable
  points as outside the reachable set. Fixed by locating the analytic
  minimum (sin el = −0.6·v / 1.36) and bisecting from there to 90°.

### Known minor items (documented, deliberate)

- **Multi-root snap:** a low-elevation light aimed up-screen whose disc sits
  outside the ground ring shares its on-screen disc position with a
  high-elevation configuration (two f-roots map to one point). Drags resolve
  to the high-el root, so such a light pops on first drag. Narrow case,
  undo-recoverable.
- **Index-keyed panel sections:** `LightsPanel` keys light sections by array
  index — an in-progress text edit in a numeric readout can misapply to the
  wrong light if another light is removed mid-edit. Theoretical; stable ids
  would fix it.
- **"Click gizmo highlights panel group"** from the spec was cut as YAGNI —
  the disc doubles as a color swatch, which covers the identification need.
- **Off-canvas discs:** a high-elevation light aimed up-screen (e.g. the
  default key at az 270/el 55) can project above the canvas clip at compact
  canvas sizes; the disc is then not grabbable until the light is re-aimed
  from the panel. Observed during verification; cosmetic, panel always works.

### Bugs found during this work

- **Fixed here:** the lit-bevel shading-rows generator labeled every light
  after the first "Fill light" (stale two-light ternary) — with a 3-light rig
  the panel showed two "Fill light" rows. Missed in the plan's Task 3, caught
  by browser-verification check 1, fixed at `b0489e4`: rows are now
  "Light 1…N" (spec-correct). Note this renames the old "Key light"/"Fill
  light" rows in two-light scenes too.
- **Pre-existing, was queued for the QA sweep (task D):** `ShadingLayersPanel`
  mislabeled dome gradient SLICES as "Light N" — one row per slice, not per
  light, so dome mode could show hundreds of bogus rows. Predates this branch
  (traced to `d8815fb`); **fixed in the task D sweep above.**

Unit tests: **143 pass** (vitest, 10 files). `npm run typecheck` clean.

### Browser verification status (2026-07-04)

Dev server at localhost:5181 (5180 was occupied by an unrelated project),
fresh localStorage, default scene = rectangle 280×140 + pointed tail.
Keeper screenshots in `screenshots-clean/lightrig-*.png`.

1. **Three tinted lights, lit-bevel** — PASS (after `b0489e4`). 3-light rig
   red az 270 / white az 90 / blue az 0: three tinted contributions visible
   on the bevel; shading panel lists exactly Ambient, Light 1, Light 2,
   Light 3, Specular under the lit-bevel group. First run FAILED on the row
   labels (the bug above); re-verified green after the fix.
   `lightrig-01-three-tinted.png`.
2. **Dome, same rig** — PASS. Additive wedges from all three light
   directions (bright top wedge, right-edge highlight, lower-right fill);
   light color correctly ignored (no red tint); no crash.
   `lightrig-02-dome-three.png`.
3. **BRDF third light** — PASS. DOM shows 3 lights × (diffuse/specular/rim)
   layers including `brdf.2-d`; toggling light 3's intensity 0↔1 shows a
   clear diffuse lobe washing in from the right (pixel-diff confirmed).
   `lightrig-03-brdf-third-light.png`.
4. **Aqua key-only** — PASS. Changing light 1's azimuth re-aims the gradient
   (and restoring the value restores the exact pixels); with handles hidden
   to isolate the balloon, editing lights 2–3 and adding a 4th light are
   pixel-identical no-ops. `lightrig-04-aqua-key.png`.
5. **Gizmo drag + undo** — PASS. Real-mouse (Playwright `page.mouse`) drag
   of light 3's disc toward the ground ring: panel az/el readouts update
   live mid-drag, elevation decreases (45→41) as the disc is pulled down;
   after pointer-up ONE ⌘Z restores the exact pre-drag values (az 0/el 45).
   The whole drag collapses into a single undo step.
   `lightrig-05-gizmo-drag.png`.
6. **Handles toggle** — PASS. "Show handles" off removes `.sb-light-handles`
   from the DOM (0 matches); on restores it (1 match).
7. **Two-light regression** — PASS. Fresh localStorage default scene carries
   the standard two-light rig (270/55/1.0 + 90/25/0.35, both white); with the
   reference config (lit-bevel, bevel width 12, bottom tail) the band
   structure matches `concave-07-regression.png` at matched scale — same
   bright top trapezoid, darker bottom band, roof-panel creases and ridge,
   shaded tail.
8. **Migration** — PASS. Seeded a pre-rig workspace (deleted `config.lights`,
   set fill params `lightAzimuth: 300, lightElevation: 40, lightColor:
   '#ff0000'`): after reload the panel shows Light 1 az 300/el 40/red and
   Light 2 az 120/el 25/white, all four legacy params deleted from
   `fill.params`, and the key light visibly aims from 300° (strongest red at
   the top-right). Clean state restored afterward.
9. **Console** — PASS. Across the whole session: only the known favicon 404
   and React DevTools info lines; 0 unexpected errors, 0 warnings.

---

## Earlier: concave-rim correctness (split-event straight skeleton) — shipped and stable

Merged to `main` 2026-07-03. The lit-bevel geometry layer
(`src/straightSkeleton.ts` SLAV engine with split events,
`src/bevelRegions.ts` face-based iso-t regions with per-island interiors)
shades concave silhouettes — tails, cloud lobes, lightning notches —
correctly, with a degraded-but-stable naive fallback (`Skeleton.method`
diagnostic). Spec:
`docs/superpowers/specs/2026-07-03-concave-rim-correctness-design.md`; plan:
`docs/superpowers/plans/2026-07-03-concave-rim-correctness.md`; keeper
screenshots: `screenshots-clean/concave-*.png`. Visual notes that remain
true: bevel width is clamped by `bareBaseMaxBevel`, and a tail attached at a
concave notch shows a real tail-pinch closing seam (not an artifact).

---

## Earlier (still relevant) architecture notes

Two repos:

- **`~/src/labkit`** — presentational primitives (`<LabShell>`,
  `<PropertyPanel>`, `<SliderRow>`, `<ColorRow>`, `<CurveField>`,
  `<LayerStack>`, `<SingletonExperimentProvider>`, undo/redo).
- **`~/src/experiments/speech-balloons/`** — domain layer. Main files:
  - `src/SpeechBalloon.tsx` — renderer + shading modes (dome / BRDF / aqua /
    lit-bevel) + debug overlays + light-gizmo layer.
  - `src/Lab.tsx` — the Lab page; contains `RimContourBlock` for the
    contour editor.
  - `src/controls.ts` — control descriptors driving the property panel.
  - `src/contourEditor.ts` — `remapAcrossPartition` helper.
  - `src/ShadingLayersPanel.tsx` — debug panel.
  - `src/shadingLayers.ts` — pure grouping helper.
  - `src/lightRig.ts` — light-rig defaults, bounds, `ensureLights` migration.
  - `src/LightsPanel.tsx` — per-light editor panel.
  - `src/lightGizmo.ts` — gizmo forward/inverse projection (bisection solver).
  - `src/straightSkeleton.ts` — split-event straight skeleton (SLAV engine,
    faces + ridges + `method` diagnostic; naive edge-collapse fallback).
  - `src/bevelRegions.ts` — face iso-t region decomposition for lit-bevel
    (band strips, roof panels, per-island interiors).
  - `src/litBevelShading.ts` — analytic Phong stop computation.

Note: `src/distanceTransform` was referenced in earlier planning docs but
was never created; the analytic renderer does not use a distance transform.

Composition model unchanged: shape-mode (single named silhouette) vs
compose-mode (base + ordered effect stack). State, persistence, undo/redo
all flow through labkit's experiment provider; localStorage key is
`lk:speech-balloon-lab-v12:workspaces`.

## Open issues

- QA-sweep findings (see the task D section at the top): dome
  slice-boundary fan streaks at zoom, cloud-shape side nubs, light gizmos
  off-canvas at default scene/zoom. All cosmetic, none queued to a task
  yet.
