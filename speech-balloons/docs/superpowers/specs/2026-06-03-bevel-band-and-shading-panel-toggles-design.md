# Contour-editor bevel-ridge band + Shading-panel per-row visibility

Two small, file-disjoint additions bundled as one spec.

## Part A — Bevel-ridge band on the contour editor

### Purpose

Today the partition handle marks `x = bevelWidth / dMax` where `dMax` is the
medial-axis max-bevel of the bare body. On a circle the partition is at the
exact normalized-x where the bevel meets the dome interior; on a non-circular
body the bevel actually reaches different normalized-x in different rim
directions, and a single handle line misrepresents that range. The user sees
no indication of the "real" bevel zone.

This part draws a faint yellow band across the contour editor's plot at
`[bw / Rmax, bw / Rmin]`, where `Rmin` and `Rmax` come from
`bareBaseRadiusRange(sampler)`. On a circle the band collapses to a thin
line (`Rmin === Rmax`). On a rectangle or other asymmetric body the band
visibly shows the bevel's normalized-x range.

### Surface

- The rim contour editor uses `LayeredCurveEditor` (not the simpler
  `CurveField`), so this spec adds a new `CurveLayer` — `createMarksLayer`
  — whose only job is to render a translucent yellow band rectangle in
  plot space. It's added to `RimContourBlock`'s `layers` array as the
  first (bottom) entry so the bevel / spline curves and the partition
  diamond paint on top of it.
- Plain `CurveBlock` usages (non-partition contours) just thread `marks`
  through to `@labkit/react`'s `CurveField`, which already accepts it.
- No new controls. No persistence. Purely derived from `bevelWidth` + body
  shape on every render.

### Data flow

- `EffectLayerStackProps`, `ControlListProps`, and `renderRow` already take
  `bodyW`, `bodyH`, `bodyShape`, `bodyParams` (these were threaded through
  earlier — confirm during implementation; if any are missing, this spec
  adds them).
- `renderRow` for `c.key === 'contour'` computes:
  ```ts
  const { Rmin, Rmax } = bareBaseRadiusRange(sampler);
  if (Rmin > 1e-3 && Rmax > 1e-3) {
    const xMax = Math.min(1, params.bevelWidth / Rmin);
    const xMin = Math.min(1, params.bevelWidth / Rmax);
    marks = [{ kind: 'band', x: [xMin, xMax], color: '#ffcc00' }];
  }
  ```
  Pass `marks` into `RimContourBlock`; it builds the marks layer (see
  Surface) and adds it as the bottom layer of the `LayeredCurveEditor`.

### Pre/post

- Visible only when `mode ∈ {dome, brdf, lit-bevel}` (same `hideWhen` as the
  contour control itself).
- The band never changes the contour values or the partition state; it's a
  read-only annotation.

### Out of scope

- Snapping the partition handle to the band.
- Showing the band on the slider rows.

## Part B — Shading-panel per-row visibility checkbox

### Purpose

The shading-layers panel (added recently) lets the user pulse one shading
element via magenta drop-shadow to find it visually. To debug compound
shading, users now want to **toggle individual contributors off** so the
remaining ones can be assessed in isolation.

### Surface

Each panel row gains a checkbox on the left of the label.

- **Checked** (default) — element renders.
- **Unchecked** — element is suppressed entirely (skipped at render time).

The existing row-name click that toggles the magenta highlight pulse is
**unchanged**. Visibility and highlight are independent.

The "Hide non-light surfaces" toggle at the panel head is unchanged.

### State

- New `runtime` field: `hiddenShadingIds: string[]` (default `[]`). Lives in
  `runtime` (same place as `domeDebug`) so it persists across reloads but
  isn't part of the design snapshot / undo stream.
- `Lab` owns it via `setRuntime`. Passes both `hiddenShadingIds` and a
  setter down through props.

### Data flow

- `ShadingItem` (in `src/shadingLayers.ts`) gains nothing — the id already
  exists. The hidden set is consulted at render time, not stored on the item.
- `SpeechBalloon` receives `hiddenShadingIds: Set<string>` as a prop and
  consults it whenever it emits a tagged shading element:
  ```ts
  if (hiddenShadingIds.has(itemId)) continue; // skip emit
  pushShading({ id: itemId, ... });
  ```
  Tagged elements that get suppressed do not call `pushShading` either;
  this prevents the panel from showing rows for invisible contributors —
  wait, that's wrong. If we suppress the push, the row disappears from
  the panel and the user can't re-enable it. **Correct behavior**: still
  `pushShading` (so the row stays in the panel), but skip emitting the
  JSX element when the id is hidden.
- The renderer pushes the shading registry entry first, then conditionally
  emits the element:
  ```ts
  pushShading({ id, label, kind, role });
  if (hiddenShadingIds.has(id)) return null;
  return <g data-shading-id={id}>...</g>;
  ```

### Panel UI

```
[✓]  Body fill                       (row name pulses on click)
[ ]  Key light                       (this contributor is suppressed)
[✓]  Fill light    ← row pulse on    (this row is highlighted)
[✓]  Lambertian wedge 1
...
```

The checkbox is a real `<input type="checkbox">`, accessible by keyboard.
Click on the checkbox doesn't bubble to the row click — `e.stopPropagation`
on the checkbox onChange so it doesn't also flip the highlight.

### Order of operations

The renderer is called once per render. It pushes the full list of
shading items (the panel mirrors what's currently emitted) and skips
emitting those that are hidden. So the panel shows the same set of rows
regardless of which are hidden, and visibility toggles re-render
SpeechBalloon to add/remove elements.

### Out of scope

- Group toggles ("hide all BRDF lights").
- Save-snapshot inclusion of hidden state.
- Per-light toggle vs. per-effect toggle distinction — every panel row
  is one toggle.

## Testing

### Part A

No unit test — purely a visual mark. Verify in dev server: on a circle the
yellow band visually collapses to a line at the partition; on a rectangle
the band spans `[bw/Rmax, bw/Rmin]` and is visibly wider.

### Part B

- `shadingLayers.test.ts` already covers the registry. Add a test verifying
  that `hiddenShadingIds` filtering at render time can be expressed
  predictably given a known `items` list (i.e., that the renderer never
  needs to consult the panel state in any way other than "is id ∈ Set").
- Visual verify in dev server: toggle checkboxes one at a time on a
  multi-light dome and confirm the affected contributor disappears from
  the render while remaining visible (and re-enableable) in the panel.

## Files

### Part A
- Modify: `src/Lab.tsx` — thread `bodyShape/bodyParams` through panel chain
  if not already; compute `marks` in `renderRow`; pass into `RimContourBlock`;
  add a marks layer to the `LayeredCurveEditor`'s layer stack.

### Part B
- Modify: `src/types.ts` — add `hiddenShadingIds: string[]` to `RuntimeState`.
- Modify: `src/Lab.tsx` — pull `hiddenShadingIds` from runtime, pass into
  `<SpeechBalloon>` and `<ShadingLayersPanel>`, expose a setter.
- Modify: `src/ShadingLayersPanel.tsx` — render checkbox per row, wire to
  setter.
- Modify: `src/SpeechBalloon.tsx` — at each `pushShading` callsite, after
  the push, check `hiddenShadingIds.has(id)` and skip emit when hidden.
