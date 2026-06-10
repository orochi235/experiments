# Speech Balloon Lab — handoff

Branch: `port-to-labkit`.

## Recent work: analytic lit-bevel renderer — DONE, browser-verified

**Spec:** `docs/superpowers/specs/2026-06-03-contour-editor-constrained-anchors-design.md`,
`docs/superpowers/specs/2026-06-09-analytic-lit-bevel-design.md` (if present)
**Plan:** `docs/superpowers/plans/2026-06-09-analytic-lit-bevel.md`
**Commits:** `4c5286f` → `0d3a99e` (10 commits)

What landed: the `lit-bevel` fill mode was rebuilt from scratch. The SVG-filter
heightmap pipeline (`feDiffuseLighting`, `feConvolveMatrix`, bevel-rings offscreen
canvas) was deleted and replaced with a pure analytic region renderer.

Three new modules:
- `src/straightSkeleton.ts` — wavefront straight-skeleton for polygon offsets
- `src/bevelRegions.ts` — `buildRegions`: decomposes a rim polyline into strip
  bands (one per rim edge), corner fans (one per convex corner), and a single
  interior region (roof-panels / dome-blob / flat)
- `src/litBevelShading.ts` — `computeStops`: analytic Phong lighting (ambient +
  N directional lights + specular) sampled along each region's gradient axis;
  returns gradient stops

`SpeechBalloon.tsx` changes: the lit-bevel rendering branch replaces the old
`<filter>` / heightmap block with a `useMemo` (`litBevel`) that calls
`buildRegions` + `computeStops` per polygon, and emits one `<path>` per region
with a `<linearGradient>` or `<radialGradient>` fill. Band regions go under
`data-shading-id="lit-bevel.band"`, interior regions under
`data-shading-id="lit-bevel.interior"`. The `feDiffuseLighting` element is
gone (`document.querySelector('feDiffuseLighting')` returns null).

`src/controls.ts` changes: heightmap controls removed; new "Lit bevel — material"
block (Bevel height / Ambient / Diffuse / Specular / Shininess / Key light color /
Specular color) and "Lit bevel — interior" block (Interior select: roof-panels /
dome-blob / flat; Corner step).

Unit tests: 96 pass (vitest).

### Browser verification status (2026-06-10)

1. **Smoke** — PASS. No JS errors (favicon 404 only). `!!document.querySelector('feDiffuseLighting')` → `false`. Path count: **61** paths in `lit-bevel.band` + `lit-bevel.interior` groups (within spec range). Lit bevel band and structured interior render correctly.

2. **Azimuth sweep** — PASS. Bright rim band correctly follows azimuth: az=0° lights the right edge, az=180° lights the left, az=45° lights the top-right corner. No visible popping or discontinuities at corner fans at 45°.

3. **Elevation** — PASS. At el=85° shading flattens toward near-uniform. At el=15° band contrast is strong and directional (vivid lit/shadow sides). Correct.

4. **Interior treatments** — PASS. All three render distinctly: `roof-panels` shows interior panel creases; `dome-blob` gives a smooth radial gradient; `flat` is a uniform interior with only the bevel band active.

5. **Contour responsiveness** — PASS. Clicking "Flip horizontally" in the contour editor immediately recomputes the shading (bevel profile inverts, lighting changes). Live update confirmed.

6. **Other bodies** — PASS. Switching to polygon (hexagon) renders correctly with lit-bevel; per-facet bevel strips visible, no crashes. Path count drops to 14 (fewer rim vertices → fewer regions). Cloud and oval not separately tested.

7. **Shading panel** — PARTIAL / BUG (pre-existing). The panel rows for lit-bevel (`Ambient`, `Key light`, `Fill light`, `Specular`, `Bevel band`, `Interior`) do not appear after switching from dome mode. The panel shows the dome mode's 193 entries (Body fill + 192 dome wedges) because of a pre-existing bug: `shadingItemsKey` in `SpeechBalloon.tsx` (line 1507) is computed from `shadingItems` *before* the JSX evaluates and fills the array (always `""` ), so the `useEffect` that calls `onShadingItems` never re-fires after mount. The correct 6 lit-bevel `[data-shading-id]` elements exist in the SVG; only the panel list is stale. Toggling the "Key light" row in the dome-labeled panel is a no-op for lit-bevel rendering. **This bug predates the analytic lit-bevel work** (present in commit `bbc78e4`).

8. **A/B dome vs lit-bevel** — PASS. Mode switch produces visually distinct results at identical azimuth/elevation/bevelWidth: dome is a soft radial gradient; lit-bevel shows a physically-modeled bevel band + structured interior.

9. **DOM sanity** — PASS. Path count is stable at 61 for rectangle base across multiple render cycles. The 6 `data-shading-id` groups are exactly `lit-bevel.ambient`, `lit-bevel.light-0`, `lit-bevel.light-1`, `lit-bevel.specular`, `lit-bevel.band`, `lit-bevel.interior` — correct, light-count-independent.

### Visual notes

- Hairline seams between band regions are present but minimal — the 1 px same-paint stroke overlap from the implementation nearly eliminates them.
- Corner fans at 45° azimuth show no visible popping; transitions are smooth.
- The shading panel shows "dome" as the group header for lit-bevel's Key/Fill light entries even after switching (see item 7 above).

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
  - `src/straightSkeleton.ts` — wavefront straight-skeleton (new).
  - `src/bevelRegions.ts` — region decomposition for lit-bevel (new).
  - `src/litBevelShading.ts` — analytic Phong stop computation (new).

Note: `src/distanceTransform` was referenced in earlier planning docs but
was never created; the analytic renderer does not use a distance transform.

Composition model unchanged: shape-mode (single named silhouette) vs
compose-mode (base + ordered effect stack). State, persistence, undo/redo
all flow through labkit's experiment provider; localStorage key is
`lk:speech-balloon-lab-v12:workspaces`.

## Open issues

### Shading panel does not update on mode switch (pre-existing, not fixed by lit-bevel work)

Root cause: `shadingItemsKey` (line 1507, `SpeechBalloon.tsx`) is computed
before the `return` statement runs, so it is always `""` (empty array at that
point). The `useEffect([shadingItemsKey, onShadingItems], …)` dep never
changes after mount, so `onShadingItems` is called exactly once — with the
initial mode's items (dome). Switching to lit-bevel changes the SVG
`data-shading-id` elements correctly but the panel list stays frozen.

Fix: move `shadingItemsKey` computation after the JSX rendering phase, or use
a different mechanism (e.g., deduplicated `useEffect` keyed on the mode string,
or a `useRef` accumulator pattern).
