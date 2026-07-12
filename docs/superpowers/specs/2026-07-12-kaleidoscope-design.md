# Kaleidoscope Lab — Design

An interactive, web-based kaleidoscope lab for generating wallpapers from LEGO
part renders produced by [brick-icons](https://github.com/orochi235/brick-icons).
Lives in this repo as the `kaleidoscope/` experiment.

## Goal

Scatter LEGO part icons in a source "chamber," run the chamber through a
symmetry engine (radial kaleidoscope or plane tiling), tune colors and layout
interactively, and export the result as a wallpaper (PNG at device
resolutions, or SVG).

## Decisions

| Topic | Decision |
|---|---|
| Home | `experiments/kaleidoscope/` — single HTML file + `assets/` subdir, no build step, dark theme chrome |
| Part art | brick-icons **colored-outline (flat3) SVGs**, rendered once in a canonical neutral base color; grayscale PNG stamps are a nice-to-have later mode, not load-bearing |
| Symmetry | Both engines, switchable: **radial** N-fold mirror kaleidoscope and **plane tiling** via wallpaper groups |
| Arrangement | **Random, then tweak**: seeded scatter from knobs, plus per-part drag/rotate/scale/delete/recolor afterward |
| Color | **Palette presets + edit**: preset palettes (incl. background color), scatter assigns colors from the palette, per-part overrides |
| Export | **PNG** (resolution presets + custom) and **SVG** |
| Layout | **Split panes**: chamber editor left, live preview right, knob sidebar. Edit-in-place-on-the-preview is an optional later enhancement |
| Rendering | **SVG-native scene graph** (approach A). Canvas preview compositor held in reserve as a perf escape hatch; the chamber model doesn't care what consumes it |

## Scene model

A single state object drives everything; rendering is a pure function of it.

```js
scene = {
  seed,
  mode: 'radial' | 'tiling',
  chamber: {
    width, height,
    parts: [{ id, partRef, x, y, rotation, scale, colorIndex, colorOverride? }]
  },
  radial:  { order: 3..16, mirror: true },
  tiling:  { group: 'p1'|'pm'|'pmm'|'p4m'|'p6m'|'p3m1', tileSize },
  palette: { name, colors: [...], background },
  partSet: [enabledPartIds],
  density, sizeRange, rotationJitter
}
```

- **Shuffle** rerolls `chamber.parts` from `seed` + knobs (density, sizeRange,
  rotationJitter, partSet, palette length).
- **Tweaks** mutate individual part entries and survive engine/palette/knob
  changes; only a reroll discards them.
- Seeded RNG (any small PRNG, e.g. mulberry32) so seed + knobs reproduce a
  scatter exactly.

## Symmetry engines

Chamber content renders once into `<defs>` as `<g id="chamber">`; engines
instance it via `<use>` so the browser repeats one subtree rather than
duplicating nodes.

**Radial.** Output is `order × (mirror ? 2 : 1)` wedges. Each wedge is
`<use href="#chamber">` with a rotation (plus reflection matrix on alternating
wedges when `mirror` is on), clipped to its sector with `clip-path`. Mirror on
= classic kaleidoscope; mirror off = pinwheel rotation symmetry.

**Tiling.** The chamber composes into an SVG `<pattern>` tile according to the
wallpaper group: identity for `p1`, mirrored pairs for `pm`/`pmm`, 4-fold
reflected quadrants for `p4m`, 6-fold mirrored triangles for `p6m`/`p3m1`
(reusing the radial wedge logic at order 6). A viewport-covering `<rect>` is
filled with the pattern. Starting set is those six groups — the reflective
ones that read as "kaleidoscope wallpaper" — not all 17.

**Seams.** In tiling mode, parts near chamber edges are cloned across the
opposite edge (toroidal wrap) so tiles read continuous. Radial mode needs
nothing; sector clipping handles it.

## Color system

- **Recolor pipeline.** Every color in a brick-icons outline SVG (three flat
  fills + all gradient stops) is a shade of the single base part color
  (verified against `docs/gallery` output). At load, each part SVG is parsed
  once and each hex is stored as a lightness ratio relative to the base.
  Recoloring = apply the ratios to a new base in OKLCH and emit a
  `<symbol id="{part}-{color}">` variant. Cached per (part, color); palettes
  are small so the cache stays bounded.
- **Palettes.** Built-in presets: classic LEGO brights, pastels, and two or
  three monochrome/duotone ramps. Each preset = ordered color list +
  background color. Custom palette = editable copy of any preset. Parts store
  a `colorIndex`, so switching palettes recolors the whole composition in
  place.
- **Overrides.** A selected part can cycle through the palette or take an
  arbitrary color, stored as `colorOverride` and surviving palette swaps.

## UI

Three regions:

1. **Chamber editor (left pane).** The chamber at comfortable editing scale.
   Parts are DOM elements: click to select, drag to move, handles (or
   scroll/modifier gestures) for rotate/scale, keyboard delete. Selection
   exposes the color control.
2. **Live preview (right pane, dominant).** The current engine's full output,
   re-rendered on every scene change (cheap: engines only re-instance
   `#chamber`).
3. **Knob sidebar.** Mode toggle; radial order + mirror; tiling group + tile
   size; part-set checklist (from manifest); density / size range / rotation
   jitter; palette picker + editor + background; seed field + Shuffle; export
   controls.

Optional later enhancement (not v1): edit-in-place — highlight the source
wedge/tile inside the preview itself and allow dragging parts there.

## Assets

- `kaleidoscope/assets/*.svg` — checked in, generated by a documented
  brick-icons batch command (recorded in the experiment README) from the
  curated `parts.txt` list, outline/flat3 style, canonical neutral base color.
- `kaleidoscope/assets/manifest.json` — part ids + display names; the lab
  reads the manifest rather than hardcoding the set. Regenerating assets =
  rerun the command, update the manifest.

## Export & persistence

- **PNG.** Serialize the current scene SVG at the chosen preset (5K/4K/QHD
  desktop, iPhone, custom W×H) — presets re-derive the viewBox so tiling fills
  exactly and radial stays centered — then rasterize `Image` → offscreen
  `<canvas>` → `toBlob` download.
- **SVG.** The same serialized document with used symbols and palette baked
  in, downloaded directly.
- **Persistence.** Full scene JSON autosaves to `localStorage`; Export/Import
  scene buttons for durable copies. The seed+knobs subset (no tweaks) encodes
  into the URL hash for cheap sharing.

## Failure handling & self-test

- Missing/failed asset fetches render a labeled placeholder rect (part id) so
  a broken manifest is visible, never silent.
- `?selftest` query flag runs console assertions: recolor ratio round-trip,
  seeded RNG determinism, tile composition per wallpaper group. No test
  framework — single-file experiment scale.

## Out of scope (v1)

- Grayscale-PNG stamp mode (nice-to-have follow-up)
- Edit-in-place preview editing
- Animation / live-wallpaper output
- The other 11 wallpaper groups
- Canvas compositor (perf escape hatch only if SVG instancing proves too slow)
