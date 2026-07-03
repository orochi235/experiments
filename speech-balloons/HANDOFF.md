# Speech Balloon Lab — handoff

Branch: `concave-rim`.

## Recent work: concave-rim correctness (split-event straight skeleton) — DONE, browser-verified

**Spec:** `docs/superpowers/specs/2026-07-03-concave-rim-correctness-design.md`
**Plan:** `docs/superpowers/plans/2026-07-03-concave-rim-correctness.md`
**Commits:** `76e3714` (spec) → this one; core work `1b7a64c` → `8bdf70f`

What landed: the lit-bevel renderer's geometry layer was rewritten so concave
silhouettes (tails, cloud lobes, lightning notches) shade correctly. Before
this, the naive edge-collapse skeleton had no split events, so the tail
rendered flat and phantom wedge creases radiated from the tail join into the
body interior (see `screenshots-clean/lit-bevel-01-smoke.png` for the old
state).

- **`src/straightSkeleton.ts` — SLAV engine with split events.** Wavefront
  simulation over a list of active vertices; handles edge events *and* split
  events (a reflex vertex's bisector hitting a non-adjacent wavefront edge).
  Candidate events are recomputed from scratch after every processed event —
  polygons are small, and recomputation eliminates stale-queue bugs. Vertex
  motion is recorded as arcs which are chained into per-edge `SkeletonFace`
  outlines (`faces`, not the old two-chain cells). `Skeleton.method` is a
  diagnostic: `'slav'` normally, `'naive'` when the v1 edge-collapse-only
  engine had to take over (self-intersections, stalled wavefronts, budget
  overruns — degraded-but-stable, never a crash).
- **`src/bevelRegions.ts` — face-based region construction.** Each skeleton
  face is clipped at the bevel seam by an iso-t line (t is affine within a
  face) into a band strip and optional roof panel. The interior beyond the
  seam is assembled by clipper union of the per-face above-pieces, yielding
  **one interior region per island** — a waisted silhouette whose depth field
  has two maxima above a saddle produces two independent interiors, each with
  its own gradient frame and per-island `x0` (shallower pockets get a
  truncated, dimmer blob profile). Per-component above-clips prevent panel
  strokes from tracing Sutherland–Hodgman bridges (the stray-1px-line bug).
- **Tail-pinch closing seams** are emitted into the ridge output so the debug
  overlay shows the skeleton re-routing around a tail (ridge down the tail
  spine + closing seams at the join).

Four engine fixes found during implementation:
1. **`splitTarget` via `posAt`** — the split-event target edge is located by
   walking the *current* wavefront positions (`posAt(v, t)`), not birth
   positions, so splits land on the right live edge.
2. **Zero-length collapse handling** — already-zero-length, non-growing edges
   (vertex events leave coincident vertices) are collapsed instead of
   generating degenerate events.
3. **`trajThrough` re-anchoring** — new vertices born at an event are
   re-anchored through their actual birth point, so the near-parallel
   straight-line trajectory fallback's anchor error never leaks into face
   outlines (phantom-vertex fix, pinned by test at `d0e8718`).
4. **`retireNullRing`** — a wavefront ring whose vertices have all gone
   trajectory-less and coincident is retired cleanly instead of stalling the
   simulation.

`src/SpeechBalloon.tsx` was intentionally untouched — its `litBevel` memo
consumes `buildRegions`, whose contract didn't change.

Unit tests: **125 pass** (vitest, 8 files). `npm run typecheck` clean.

### Browser verification status (2026-07-03)

Dev server at localhost:5180, rectangle 280×140 + pointed tail unless noted.
All keeper screenshots in `screenshots-clean/concave-*.png`.

1. **Tail integration** — PASS. Fill lit-bevel, interior roof-panels, bevel
   width 12: the bevel band flows around the tail join and down the tail's
   flanks; the tail shades (lit flank + spine crease), no phantom wedge
   creases into the body interior. Compare `concave-01-tail-band.png` against
   the old `lit-bevel-01-smoke.png` (flat tail + creases).
2. **Debug overlay** — PASS. Goldenrod skeleton ridges re-route around the
   tail: a ridge runs down the tail's spine and the tail-pinch closing seams
   appear at the join. `concave-02-ridges.png`.
3. **Azimuth sweep at the tail** — PASS. Bottom tail, azimuth 225° / 315°
   (±45° around 270°): tail flanks light/shade like ordinary rim faces and
   mirror correctly, no popping. `concave-03-az-225.png`, `concave-03-az-315.png`.
4. **Interior islands** — PASS. Oval 380×150 + wobble morph (frequency 2,
   amplitude 30, phase 0.10) pinches into a dumbbell; at bevel width 48 with
   interior dome-blob the DOM shows **2** paths under
   `[data-shading-id="lit-bevel.interior"]`, each with its own radial
   gradient. An asymmetric 3-island variant additionally showed the shallow
   middle pocket with a truncated (dimmer, x0 < 1) blob profile vs. the deep
   lobes. Islands rendering at all implies `method` stayed `'slav'` (the
   naive fallback cannot produce them). `concave-04-islands.png`.
   Note: a plain rectangle+tail never islands (single depth maximum) — the
   plan's original check was corrected accordingly.
5. **Lightning + cloud** — PASS. Lightning tail on rectangle: zigzag notches
   shade facet-by-facet, no crashes (`concave-05-lightning.png`). Cloud body
   (8 lobes, depth 0.4) + lightning tail, roof-panels interior: busy concave
   silhouette shades cleanly, no black/empty regions, no stray 1-px lines
   crossing region gaps (`concave-06-cloud.png`).
6. **Convex regression** — PASS. Rounded rect (roundness 0.5) shows the same
   band structure as `lit-bevel-01-smoke.png` with the tail now shaded
   (`concave-07-regression.png`). Hexagon (polygon body) renders clean
   mitered per-edge bevel faces + roof panels — a strict improvement over
   `lit-bevel-06-polygon.png`.
7. **Console** — PASS. 0 errors / 0 warnings across the whole session.

### Visual notes

- Bevel width is clamped by `bareBaseMaxBevel` (max inradius of the bare base
  shape), so the interior can never be fully drowned via the slider.
- A tail attached at a concave notch produces a visible crease from the join —
  that is the real tail-pinch closing seam (also drawn by the debug overlay),
  not an artifact.

---

## Earlier (still relevant) architecture notes

Two repos:

- **`~/src/labkit`** — presentational primitives (`<LabShell>`,
  `<PropertyPanel>`, `<SliderRow>`, `<ColorRow>`, `<CurveField>`,
  `<LayerStack>`, `<SingletonExperimentProvider>`, undo/redo).
- **`~/src/experiments/speech-balloons/`** — domain layer. Main files:
  - `src/SpeechBalloon.tsx` — renderer + shading modes (dome / BRDF / aqua /
    lit-bevel) + debug overlays.
  - `src/Lab.tsx` — the Lab page; contains `RimContourBlock` for the
    contour editor.
  - `src/controls.ts` — control descriptors driving the property panel.
  - `src/contourEditor.ts` — `remapAcrossPartition` helper.
  - `src/ShadingLayersPanel.tsx` — debug panel.
  - `src/shadingLayers.ts` — pure grouping helper.
  - `src/straightSkeleton.ts` — split-event straight skeleton (SLAV engine,
    faces + ridges + `method` diagnostic; naive edge-collapse fallback).
  - `src/bevelRegions.ts` — face iso-t region decomposition for lit-bevel
    (band strips, roof panels, per-island interiors).
  - `src/litBevelShading.ts` — analytic Phong stop computation (new).

Note: `src/distanceTransform` was referenced in earlier planning docs but
was never created; the analytic renderer does not use a distance transform.

Composition model unchanged: shape-mode (single named silhouette) vs
compose-mode (base + ordered effect stack). State, persistence, undo/redo
all flow through labkit's experiment provider; localStorage key is
`lk:speech-balloon-lab-v12:workspaces`.

## Open issues

No known open issues.
