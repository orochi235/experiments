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

## Regenerating assets

Parts are pre-rendered by brick-icons (see that repo for setup) in a canonical
neutral base color and recolored at runtime. From the brick-icons repo root:

    while read -r part _; do
      [ -z "$part" ] || [ "${part#\#}" != "$part" ] && continue
      brick-icons "$part" --format svg --shading outline --shade-style flat3 \
        --part-color 0x9ba19d -o <this dir>/assets/"$part".svg
    done < parts.txt

Then regenerate `assets/manifest.json` (id + display name per part) — see
`assets/manifest.json` for the shape.
