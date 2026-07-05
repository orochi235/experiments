# User-Editable Light Rig — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm session)

## Problem

The light rig is hardcoded: `domeLights` in `SpeechBalloon.tsx` builds a
two-light array — a key light from the fill effect's `lightAzimuth` /
`lightElevation` params and an implicit fill light at `az+180°, el 25°,
intensity 0.35`. Lit-bevel tints the key with `lightColor` and forces the
fill light white. BRDF reuses the same azimuth/elevation params; aqua has
its own 2D `lightAngle`. Users can't add, remove, recolor, or re-aim lights
independently, and the light model differs per mode.

The goal is **consistency**: one scene-level light list, editable in the
panel and on canvas, consumed by every shading mode.

## Decisions (from brainstorm)

- **Scope:** all four fill modes consume the rig. Lit-bevel, dome, **and
  BRDF** use every light — implementation revealed `brdfLayers` already
  loops over the full `domeLights` array (diffuse/specular/rim per light),
  so keying BRDF to `lights[0]` would have been a regression, not a
  simplification. Only aqua is single-light and reads `lights[0].az`.
  (Supersedes the brainstorm's "BRDF reads lights[0]" assumption.)
- **Per-light properties:** azimuth, elevation, intensity, color.
- **Editing surfaces:** inline panel section (per-light slider groups)
  **plus** draggable on-canvas gizmos. Both ship in this cycle; the plan
  sequences rig model → panel → gizmos.
- **Architecture:** scene-level rig on `DesignState` (not a fill-effect
  param). Lights physically belong to the scene, not the material; effect
  `ParamBag` stays `number | string | boolean | number[]`; and a single rig
  is what makes cross-mode consistency structural.

## Data model

```ts
export interface LightInstance {
  az: number;        // degrees, 0..359
  el: number;        // degrees, 0..90
  intensity: number; // 0..2
  color: string;     // hex
}
```

- `DesignState.lights: LightInstance[]` — sibling of `effects`.
- Constraints: min 1 light, max 6.
- New-scene default (matches today's hardcoded pair exactly):
  `[{ az: 270, el: 55, intensity: 1.0, color: '#ffffff' },
    { az: 90, el: 25, intensity: 0.35, color: '#ffffff' }]`
- Undo/redo, persistence, and workspace snapshots come free: `DesignState`
  is already the undo/persistence unit.

## Migration

In `main.tsx`'s existing migration pass over stored workspaces
(`lk:speech-balloon-lab-v12:workspaces`):

- If a workspace's design lacks `lights`, synthesize it from the first
  fill effect's params:
  - `lights[0]`: `az` from `lightAzimuth` (or `lightAngle` when the fill's
    `mode` is `'aqua'`), `el` from `lightElevation` (55 fallback; aqua has
    no elevation → 55), `intensity: 1.0`, `color` from `lightColor`
    (`#ffffff` fallback).
  - `lights[1]`: `{ az: (lights[0].az + 180) % 360, el: 25,
    intensity: 0.35, color: '#ffffff' }` — the old implicit fill light.
  - No fill effect at all → the new-scene default.
- Delete `lightAzimuth`, `lightElevation`, `lightColor`, and `lightAngle`
  from fill params, and remove their descriptors from `controls.ts`.
- Result must be pixel-identical for existing scenes (the synthesized rig
  reproduces the old hardcoded pair, including lit-bevel's white fill
  light).

## Renderer

- `<SpeechBalloon>` gains a `lights: LightInstance[]` prop; the
  `domeLights` memo is deleted.
- **Lit-bevel:** passes the full list to `computeStops`; each light uses
  its **own** color (today light 1 is forced white — per-light color is a
  new capability, not a regression).
- **Dome:** per-light az/el/intensity as today, color ignored — dome's
  shading is highlight/shadow tint-pair based. Documented in code where
  the rig is consumed.
- **BRDF:** consumes the full rig as today (per-light diffuse/specular/rim
  layers); per-light intensity already scales each layer. Color ignored
  (BRDF layers tint with `highlightColor`).
- **Aqua:** reads `lights[0].az`. Elevation/intensity/color ignored.
- **Shading panel:** lit-bevel light rows derive from `lights.length`
  (labels "Light 1…N"). The debug overlay's light lollipops likewise
  render one per rig entry.

## Panel UI

A "Lights" section in the right property panel, implemented as a custom
block in `Lab.tsx` (same pattern as `RimContourBlock`), always visible —
lights are scene state, not fill state.

- Per-light collapsible group: header "Light N" with a ✕ remove button
  (disabled when only 1 light remains); rows Azimuth (0–359°), Elevation
  (0–90°), Intensity (0–2, step 0.02), Color — using labkit `SliderRow` /
  `ColorRow`.
- "+ Add light" button at the bottom (disabled at 6). New lights spawn as
  `{ az: 90, el: 45, intensity: 0.5, color: '#ffffff' }`.
- "Show handles" toggle in the section header controls gizmo visibility
  (default on). Stored in `RuntimeState` (not design state — it's a view
  preference and shouldn't pollute undo history).

## On-canvas gizmos

The debug overlay's existing per-light lollipop drawing (ground dot +
elevation pole + lifted disc, distance `0.75 × max body dimension` scaled
by `cos(el)`) becomes an interactive layer, independent of the debug
overlay toggle:

- Visible when the "Show handles" toggle is on.
- **Drag the disc**: azimuth = angle of the pointer around the body
  bbox center (the overlay's existing projection origin); elevation =
  radial distance mapped through the same
  `cos(el)`-projection used for display (pull toward the centroid = higher
  elevation, push to the outer ring = grazing). Clamped to el 0–90.
- Intensity and color are panel-only (no scroll/modifier gestures in v1).
- One drag = one undo step (commit on pointer-up).
- Clicking a gizmo highlights/expands that light's panel group; the
  gizmo of the panel-expanded light renders emphasized.

## Testing

Unit (vitest):
- Migration: old fill params → expected rig (dome/brdf and aqua variants;
  missing-fill fallback; already-migrated designs untouched; params
  removed from the bag).
- Renderer selection: aqua consumes `lights[0].az` only.
- `computeStops` with two differently-colored lights produces
  per-light-tinted sums (extends existing litBevelShading tests).
- Gizmo math: pointer position ↔ az/el round-trip at representative
  elevations (0, 45, 90).

Browser verification (dev server + Playwright, screenshots to
`screenshots-clean/lightrig-*.png`):
- Multi-light lit-bevel: 3 lights with distinct colors — three tinted
  contributions visible, shading-panel rows read "Light 1…3".
- Dome with 3 lights: additive wedges render, no regression at 2 lights
  vs. pre-change screenshots.
- BRDF: adding a third light adds a visible diffuse contribution; aqua:
  moving light 0 re-aims the gradient, adding lights changes nothing.
- Gizmo drag: azimuth + elevation respond per the projection; drag is one
  undo step; handles hide when toggled off.
- Persistence: reload round-trips the rig; a seeded pre-migration
  localStorage snapshot migrates and renders pixel-identical.

## Out of scope

- Multi-light BRDF/aqua rework.
- Gizmo gestures for intensity/color.
- Baked export refactor (TODO.md) — `lights` rides along in the raw
  snapshot as-is.
- The dome-mode "Light 3…40" shading-panel row bug is task D's QA sweep;
  if the row-derivation rewrite here happens to fix it, D just verifies.
