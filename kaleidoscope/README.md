# Kaleidoscope Lab

Interactive kaleidoscope/wallpaper generator using LEGO part renders from
[brick-icons](https://github.com/orochi235/brick-icons). Scatter parts in the
left "chamber" pane, watch the symmetry preview on the right, export PNG/SVG.

Design spec: `../docs/superpowers/specs/2026-07-12-kaleidoscope-design.md`

## Running

Uses `fetch` + ES modules, so serve over HTTP from the repo root:

    python3 -m http.server 8642
    open http://localhost:8642/kaleidoscope/

Append `?selftest` to run the console assertion suite.

## Controls

**Chamber editing** (left pane — click the chamber once first so it has
keyboard focus, then):

- **Drag** a part to move it.
- **Scroll** over a selected part to rotate it; **shift+scroll** to scale it.
- **Delete** (or Backspace) removes the selected part.
- Selecting a part reveals a color-override row under the chamber: click a
  palette swatch or use the custom color picker to recolor just that part.

**What Shuffle/knob changes discard vs. preserve:** density, size range,
rotation jitter, seed, and the part-set checklist all define the *scatter* —
changing any of them (or hitting Shuffle) rerolls `chamber.parts` from
scratch and **discards per-part tweaks** (drags, rotations, scales, color
overrides). Symmetry knobs (mode, radial order/mirror, tiling group/tile
size), the palette (preset choice, swatch edits, background), and export
settings only re-render — **tweaks survive** these changes.

**Sharing via URL.** The address bar's `#s=...` hash always reflects the
current seed + knobs + palette preset (updated live via
`history.replaceState`, so it never adds new history entries or pushes new
navigations). Opening a shared link reproduces the same composition by
re-running the scatter — it does **not** carry per-part tweaks, since those
aren't part of the seed+knobs contract.

**Autosave.** The full scene (including tweaks) autosaves to
`localStorage` on every change. Reloading the page with no hash in the URL
restores that full state. Reloading with a hash present prioritizes the
hash (fresh scatter from seed+knobs+palette) over the saved tweaks. If
`localStorage` holds corrupted JSON, the app falls back to defaults rather
than failing to load.

**Export.** Pick a resolution preset (5K/4K/QHD/desktop/iPhone) or choose
Custom and enter a width/height; PNG rasterizes the current composition at
that size, SVG downloads the same composition as a standalone document with
symbols and palette baked in. Custom dimensions are validated (must be
positive integers up to 16384px) — invalid values simply no-op instead of
downloading a broken file. **Save scene… / Load scene…** round-trip the full
scene (including tweaks) as a JSON file for durable copies that outlive
`localStorage`.

## Regenerating assets

Parts are pre-rendered by brick-icons (see that repo for setup) in a canonical
neutral base color and recolored at runtime. From the brick-icons repo root:

    while read -r part _; do
      [ -z "$part" ] || [ "${part#\#}" != "$part" ] && continue
      brick-icons "$part" --format svg --shading outline --shade-style flat3 \
        --part-color 0x9ba19d -o <this dir>/assets/"$part".svg
    done < parts.txt

Then regenerate `assets/manifest.json` (`baseColor` — must match the
`--part-color` above — plus id + display name per part) — see
`assets/manifest.json` for the shape.
