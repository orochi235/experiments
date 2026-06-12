# Shading-layers debug panel

## Purpose

Give the Lab a directory of every shading path/gradient the balloon currently
renders so we can click one and see exactly where it sits on the canvas.
This is dev-only inspection; nothing here changes the rendered design or
persists across reloads.

## Surface

- New panel in the right sidebar (`<aside className="sb-side-panel sb-side-panel-right">`),
  mounted immediately below the existing `EffectLayerStack` titled "Tails".
- Heading: **Shading layers**.
- Rows grouped by render layer (Body / Dome / BRDF / Aqua / Bevel). Each row
  shows the human label and a small swatch (the layer's primary color or a
  generic chip for gradients).
- A single filter toggle at the top: **"Hide non-light surfaces"**. When on,
  rows for the body fill, bevel band, and aqua gradient hide; only the
  Lambertian / specular / rim/Fresnel contributors remain.
- Clicking a row toggles a single `highlightedShadingId`. Re-clicking the same
  row clears it. Single-select only.

## Discovery: render-time registry

The simplest version of the renderer-published list. During render
`SpeechBalloon` builds an array of descriptors. Whenever a JSX wrapper
emits a shading element, it also pushes one entry into a local array via
a small helper:

```ts
type ShadingItem = { id: string; label: string; group: ShadingGroup };
const shadingItems: ShadingItem[] = [];
const register = (item: ShadingItem) => { shadingItems.push(item); return item.id; };
```

Each emit site looks like:

```tsx
<path
  data-shading-id={register({ id: 'dome.key', label: 'Key light', group: 'dome' })}
  // … existing props
/>
```

After the render pass, `SpeechBalloon` calls `onShadingItems?.(shadingItems)`
inside a `useEffect` so the Lab gets a stable copy without a render-during-render.

Two consequences of doing it this way:

- The list always matches what's actually mounted. Mode-switching, multi-light
  toggling, and effect add/remove flow automatically.
- The single source of truth is the renderer. The panel never needs to know
  which mode is active; it just shows what came back.

**Explicitly:** only one fill mode's worth of items is ever in the list at a
time. Switching from dome to BRDF causes the dome wedges to unmount and drop
out of `shadingItems` on the next render pass; the BRDF Lambertian / specular
/ rim rows take their place. Aqua mode shows only the aqua gradient row (plus
body/bevel if the "Hide non-light surfaces" filter is off). There is no
"available across all modes" view.

## Highlight mechanism

Pure CSS, driven by a data attribute already on the element. `Lab` keeps
`highlightedShadingId: string | null` in component state and passes it down.
`SpeechBalloon` adds the `shading-pulse` class to the element whose
`data-shading-id` matches:

```css
@keyframes shading-pulse {
  0%, 100% { filter: drop-shadow(0 0 0 magenta); }
  50%      { filter: drop-shadow(0 0 6px magenta); }
}
.shading-pulse { animation: shading-pulse 1.2s ease-in-out infinite; }
```

If the SVG `<filter>` chain on a given path swallows `drop-shadow`, the
fallback is a sibling outline `<path>` with `stroke="magenta"`,
`stroke-dasharray`, and the same animation. Decide per-element which fits
better; start with `drop-shadow` and only add the sibling outline where
needed.

## State scope

`highlightedShadingId` lives in `Lab` component state. It is **not** part of
`runtime` (so it doesn't reach the undo stack, doesn't persist across
reloads, doesn't survive an export). The same goes for the `Hide non-light
surfaces` toggle.

`shadingItems` is also Lab-local state, populated from
`onShadingItems`. If `SpeechBalloon` unmounts or switches modes, the list
auto-refreshes on the next render pass.

## Grouping taxonomy

```ts
type ShadingGroup =
  | 'body'    // base fill
  | 'dome'    // per-light dome wedges + dome specular
  | 'brdf'    // Lambertian / specular / rim/Fresnel (BRDF mode)
  | 'aqua'    // aqua-mode body gradient
  | 'bevel';  // bevel inset path
```

The "Hide non-light surfaces" toggle hides `body`, `bevel`, and `aqua`.
`dome` and `brdf` are the lighting groups and always show.

## Non-goals

- No multi-select.
- No reordering or hiding individual layers in the actual render (this is
  inspection only).
- The existing "Heightmap overlay" / "Dome debug overlay" checkboxes stay
  where they are — not folded into this panel.
- No keyboard shortcuts in v1.

## Open questions

None blocking. Worth revisiting after first use: whether the highlight should
also dim the rest of the scene (current answer: no, full scene stays
visible), and whether the panel should expand to expose per-layer opacity
sliders for finer inspection.
