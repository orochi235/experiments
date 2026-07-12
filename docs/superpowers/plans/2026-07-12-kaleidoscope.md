# Kaleidoscope Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive kaleidoscope lab experiment that scatters LEGO part SVGs (from brick-icons) in an editable chamber, renders them through radial or wallpaper-group symmetry, and exports PNG/SVG wallpapers.

**Architecture:** SVG-native scene graph. A single `scene` state object is the source of truth; the chamber renders once into a shared hidden `<defs>` SVG and both the editor pane and the symmetry preview instance it via `<use>`. Engines are pure functions scene → SVG DOM. Exports serialize the same document.

**Tech Stack:** Vanilla ES modules, no build step, no framework, no test framework (a `?selftest` console-assertion harness instead). Assets pre-rendered by the sibling `brick-icons` project.

**Spec:** `docs/superpowers/specs/2026-07-12-kaleidoscope-design.md`

**Serving during development:** experiments are plain static files, but this one uses `fetch` + ES modules, so use a local server:

```bash
cd <experiments repo root> && python3 -m http.server 8642
# open http://localhost:8642/kaleidoscope/
# selftest: http://localhost:8642/kaleidoscope/?selftest
```

---

## File structure

```
kaleidoscope/
  index.html          # page shell: split panes, sidebar controls, inline CSS, loads js/main.js
  README.md           # what it is + exact asset regeneration command
  assets/
    manifest.json     # [{ id, name }] — the lab reads this, never hardcodes parts
    <part>.svg        # brick-icons outline/flat3 renders, canonical neutral base color
  js/
    rng.js            # mulberry32 PRNG + range helpers
    color.js          # hex ↔ OKLCH, shade-ratio remapping
    palettes.js       # preset palette data
    parts.js          # manifest/SVG loading, base-color detection, recolored <symbol> cache
    scene.js          # scene state: defaults, seeded scatter, (de)serialization, hash codec
    engines.js        # chamber group builder + radial & tiling renderers
    editor.js         # chamber editor pane: render, select, drag, rotate, scale, delete
    ui.js             # sidebar knob bindings
    export.js         # standalone SVG doc builder, SVG & PNG download
    selftest.js       # console assertions, runs when ?selftest
    main.js           # orchestration: load, update(), wiring
```

Module contracts (used consistently by every task below):

- `rng.js`: `mulberry32(seed) -> () => float [0,1)`, `randRange(rand, min, max)`, `randInt(rand, n)`, `randPick(rand, array)`
- `color.js`: `hexToOklch(hex) -> {L,C,h}`, `oklchToHex({L,C,h}) -> '#rrggbb'`, `remapColor(hex, baseHex, newBaseHex) -> '#rrggbb'`
- `parts.js`: `loadParts(baseUrl) -> Promise<PartStore>`; `store.list -> [{id,name}]`; `store.symbolId(partId, colorHex) -> string` (creates the recolored `<symbol>` in a hidden document-level SVG on first request); `store.symbolMarkup(partId, colorHex) -> string` (for export)
- `scene.js`: `defaultScene()`, `scatter(scene, store)`, `serialize(scene)`, `deserialize(json)`, `encodeHash(scene) -> string`, `decodeHash(hashString) -> partial scene | null`, `saveLocal(scene)`, `loadLocal() -> scene | null`
- `engines.js`: `chamberGroup(scene, store, {wrap}) -> SVGGElement`, `renderPreview(svgEl, scene, store)`
- `editor.js`: `renderChamber(svgEl, scene, store, onChange)` — `onChange(kind)` fires after any tweak; module owns selection state
- `export.js`: `buildSvgDocument(scene, store, w, h) -> string`, `downloadSvg(scene, store)`, `downloadPng(scene, store, w, h)`
- `main.js`: owns the `scene` instance and `update()` (re-render preview + chamber + autosave)

---

### Task 1: Scaffold the experiment page and barrel entry

**Files:**
- Create: `kaleidoscope/index.html`
- Create: `kaleidoscope/README.md`
- Create: `kaleidoscope/js/main.js`
- Modify: `index.html` (repo-root barrel)

- [ ] **Step 1: Create `kaleidoscope/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kaleidoscope Lab</title>
<style>
  :root {
    --bg: #1a1a2e; --panel: #16162a; --edge: #2e2e4a;
    --text: #e8e8f0; --dim: #9a9ab0; --accent: #7ac8ff;
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.4 system-ui, sans-serif;
    display: grid; grid-template-columns: minmax(260px, 1fr) 2fr 260px;
    grid-template-rows: auto 1fr; height: 100vh;
  }
  header {
    grid-column: 1 / -1; padding: 8px 14px;
    border-bottom: 1px solid var(--edge); display: flex; gap: 12px; align-items: baseline;
  }
  header h1 { font-size: 16px; font-weight: 600; }
  header .hint { color: var(--dim); font-size: 12px; }
  .pane { position: relative; overflow: hidden; }
  #chamber-pane { border-right: 1px solid var(--edge); background: var(--panel); }
  .pane-label {
    position: absolute; top: 6px; left: 10px; z-index: 2;
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim);
  }
  #chamber-svg, #preview-svg { width: 100%; height: 100%; display: block; touch-action: none; }
  #sidebar {
    border-left: 1px solid var(--edge); background: var(--panel);
    overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 14px;
  }
  #sidebar fieldset { border: 1px solid var(--edge); border-radius: 6px; padding: 8px 10px; }
  #sidebar legend { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); padding: 0 4px; }
  #sidebar label { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; }
  #sidebar input[type=range] { width: 130px; }
  #sidebar input[type=number], #sidebar input[type=text], #sidebar select {
    background: var(--bg); color: var(--text); border: 1px solid var(--edge); border-radius: 4px; padding: 3px 6px; width: 90px;
  }
  #sidebar button {
    background: var(--bg); color: var(--text); border: 1px solid var(--edge);
    border-radius: 4px; padding: 5px 10px; cursor: pointer;
  }
  #sidebar button:hover { border-color: var(--accent); }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .swatch { width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--edge); cursor: pointer; padding: 0; }
  .swatch.active { outline: 2px solid var(--accent); }
  #part-list { max-height: 140px; overflow-y: auto; }
  #part-list label { justify-content: flex-start; }
  #sidebar input.dim-input { width: 64px; }
</style>
</head>
<body>
<header>
  <h1>Kaleidoscope Lab</h1>
  <span class="hint">LEGO parts via brick-icons · drag parts in the chamber · scroll = rotate, shift+scroll = scale, del = remove</span>
</header>

<div class="pane" id="chamber-pane">
  <span class="pane-label">Chamber</span>
  <svg id="chamber-svg"></svg>
</div>

<div class="pane" id="preview-pane">
  <span class="pane-label">Preview</span>
  <svg id="preview-svg"></svg>
</div>

<aside id="sidebar">
  <fieldset>
    <legend>Symmetry</legend>
    <label>Mode
      <select id="ctl-mode">
        <option value="radial">Radial</option>
        <option value="tiling">Tiling</option>
      </select>
    </label>
    <label data-mode="radial">Order <input type="range" id="ctl-order" min="3" max="16" step="1"></label>
    <label data-mode="radial">Mirror <input type="checkbox" id="ctl-mirror"></label>
    <label data-mode="tiling">Group
      <select id="ctl-group">
        <option>p1</option><option>pm</option><option>pmm</option>
        <option>p4m</option><option>p6m</option><option>p3m1</option>
      </select>
    </label>
    <label data-mode="tiling">Tile size <input type="range" id="ctl-tilesize" min="100" max="600" step="10"></label>
  </fieldset>

  <fieldset>
    <legend>Scatter</legend>
    <label>Density <input type="range" id="ctl-density" min="3" max="60" step="1"></label>
    <label>Min size <input type="range" id="ctl-sizemin" min="0.2" max="2" step="0.05"></label>
    <label>Max size <input type="range" id="ctl-sizemax" min="0.2" max="3" step="0.05"></label>
    <label>Rotation jitter <input type="range" id="ctl-jitter" min="0" max="180" step="5"></label>
    <label>Seed <input type="number" id="ctl-seed" min="0" step="1"></label>
    <button id="ctl-shuffle">Shuffle (reroll)</button>
  </fieldset>

  <fieldset>
    <legend>Parts</legend>
    <div id="part-list"></div>
  </fieldset>

  <fieldset>
    <legend>Palette</legend>
    <label>Preset <select id="ctl-palette"></select></label>
    <div class="swatches" id="palette-swatches"></div>
    <label>Background <input type="color" id="ctl-bg"></label>
    <div id="selection-color" hidden>
      <label>Selected part</label>
      <div class="swatches" id="selection-swatches"></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Export</legend>
    <label>Preset
      <select id="ctl-export-preset">
        <option value="5120x2880">5K (5120×2880)</option>
        <option value="3840x2160">4K (3840×2160)</option>
        <option value="2560x1440">QHD (2560×1440)</option>
        <option value="1179x2556">iPhone (1179×2556)</option>
        <option value="custom">Custom…</option>
      </select>
    </label>
    <label id="export-custom" hidden>W×H
      <span><input type="number" id="ctl-export-w" value="1920" class="dim-input"> ×
      <input type="number" id="ctl-export-h" value="1080" class="dim-input"></span>
    </label>
    <button id="ctl-export-png">Export PNG</button>
    <button id="ctl-export-svg">Export SVG</button>
  </fieldset>
</aside>

<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create a placeholder `js/main.js`** (proves module loading works; replaced in Task 8)

```js
console.log('kaleidoscope: main.js loaded');
```

- [ ] **Step 3: Create `kaleidoscope/README.md`**

```markdown
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
```

- [ ] **Step 4: Verify the page renders**

Run: `cd <repo root> && python3 -m http.server 8642` (background), open `http://localhost:8642/kaleidoscope/`.
Expected: header, two dark panes labeled Chamber/Preview, sidebar with all control groups; console shows `kaleidoscope: main.js loaded`; no 404s except none.

- [ ] **Step 5: Add the experiment to the root barrel `index.html`**

Follow the existing card pattern in the root `index.html` (read it first): add a card linking to `kaleidoscope/index.html` with description "Interactive kaleidoscope & wallpaper-group pattern generator using LEGO part renders from brick-icons; exports PNG/SVG wallpapers."

- [ ] **Step 6: Commit**

```bash
git add kaleidoscope/ index.html
git commit -m "kaleidoscope: scaffold experiment shell and barrel entry"
```

---

### Task 2: Generate part assets and manifest

**Files:**
- Create: `kaleidoscope/assets/<part>.svg` (one per part)
- Create: `kaleidoscope/assets/manifest.json`

The brick-icons repo is a sibling project (`../brick-icons` relative to this repo in the usual layout; confirm with the human if missing). Its venv must be active or its CLI on PATH; LDView renders under Rosetta — if `brick-icons` fails, stop and ask rather than debugging its toolchain.

- [ ] **Step 1: Render the curated part list in the canonical neutral color**

`0x9ba19d` is LEGO medium stone gray — mid-lightness, so shade ratios have headroom in both directions.

```bash
cd ../brick-icons && source .venv/bin/activate
OUT=../experiments/kaleidoscope/assets
mkdir -p "$OUT"
grep -v '^\s*#' parts.txt | awk '{print $1}' | while read -r part; do
  [ -z "$part" ] && continue
  brick-icons "$part" --format svg --shading outline --shade-style flat3 \
    --part-color 0x9ba19d -o "$OUT/$part.svg" || echo "FAILED: $part"
done
ls "$OUT" | wc -l
```

Expected: one `.svg` per non-comment line of `parts.txt` (spot-check a few open in browser), `FAILED:` lines investigated or the part dropped from the manifest.

- [ ] **Step 2: Write `assets/manifest.json`**

Part names come from `parts.txt` comments/descriptions if present; otherwise use the part id as the name. Shape:

```json
{
  "parts": [
    { "id": "3001", "name": "Brick 2 x 4" },
    { "id": "3941", "name": "Brick Round 2 x 2" }
  ],
  "baseColor": "#9ba19d"
}
```

Generate with a throwaway script or by hand; every entry must have a matching `assets/<id>.svg`.

- [ ] **Step 3: Verify assets parse the way `parts.js` will assume**

For three different parts, check the invariants the loader relies on:

```bash
cd <repo root>/kaleidoscope/assets
for f in 3001.svg 3941.svg 3960.svg; do
  grep -c 'viewBox' "$f"                       # expect >= 1 (root svg has viewBox)
  grep -o 'fill="#[0-9a-f]*"' "$f" | sort | uniq -c   # expect a dominant hex = shades of #9ba19d
done
```

Expected: each file has a root `viewBox`, a white background `<rect>`, and solid fills + gradient stops that are all gray shades.

- [ ] **Step 4: Commit**

```bash
git add kaleidoscope/assets/
git commit -m "kaleidoscope: add brick-icons part assets and manifest"
```

---

### Task 3: Selftest harness + seeded RNG

**Files:**
- Create: `kaleidoscope/js/rng.js`
- Create: `kaleidoscope/js/selftest.js`

- [ ] **Step 1: Write `js/selftest.js` with the harness and the RNG tests (they will fail first)**

```js
// Console assertion suite. Runs only when the page is opened with ?selftest.
const results = [];

export function assert(name, cond) {
  results.push({ name, pass: !!cond });
  console[cond ? 'log' : 'error'](`${cond ? 'PASS' : 'FAIL'} ${name}`);
}

export function assertClose(name, a, b, tol = 1e-6) {
  assert(name, Math.abs(a - b) <= tol);
}

export async function runSelftest() {
  results.length = 0;  // reruns from the console shouldn't accumulate
  const { mulberry32, randRange, randInt } = await import('./rng.js');

  // RNG determinism
  const a = mulberry32(1234), b = mulberry32(1234);
  assert('rng: same seed, same sequence',
    [a(), a(), a()].join() === [b(), b(), b()].join());
  const c = mulberry32(1);
  assert('rng: values in [0,1)', Array.from({ length: 100 }, c).every(v => v >= 0 && v < 1));
  const d = mulberry32(7);
  assert('rng: randRange respects bounds',
    Array.from({ length: 100 }, () => randRange(d, 2, 5)).every(v => v >= 2 && v < 5));
  const e = mulberry32(7);
  assert('rng: randInt respects bounds',
    Array.from({ length: 100 }, () => randInt(e, 4)).every(v => Number.isInteger(v) && v >= 0 && v < 4));

  // Isolate groups: a throwing group records a FAIL instead of killing the
  // suite and the summary line.
  for (const [group, fn] of [['color', testColor], ['scene', testScene], ['engines', testEngines]]) {
    try { await fn(); } catch (err) { assert(`${group}: test group threw (${err.message})`, false); }
  }

  const failed = results.filter(r => !r.pass);
  console.log(`selftest: ${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0;
}

// Filled in by later tasks:
async function testColor() {}
async function testScene() {}
async function testEngines() {}
```

- [ ] **Step 2: Wire selftest into `js/main.js`** (append; main.js is still otherwise a placeholder)

```js
if (new URLSearchParams(location.search).has('selftest')) {
  const { runSelftest } = await import('./selftest.js');
  runSelftest();
}
```

- [ ] **Step 3: Verify it fails** — open `http://localhost:8642/kaleidoscope/?selftest`.

Expected: console error — failed import of `./rng.js` (module doesn't exist yet). That's the failing state.

- [ ] **Step 4: Write `js/rng.js`**

```js
// mulberry32: tiny 32-bit seeded PRNG, plenty for scatter reproducibility.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rand, min, max) => min + rand() * (max - min);
export const randInt = (rand, n) => Math.floor(rand() * n);
export const randPick = (rand, arr) => arr[randInt(rand, arr.length)];
```

- [ ] **Step 5: Verify RNG tests pass** — reload `?selftest`.

Expected: `PASS rng: ...` ×4, `selftest: 4/4 passed`.

- [ ] **Step 6: Commit**

```bash
git add kaleidoscope/js/rng.js kaleidoscope/js/selftest.js kaleidoscope/js/main.js
git commit -m "kaleidoscope: selftest harness and seeded RNG"
```

---

### Task 4: Color remap module

**Files:**
- Create: `kaleidoscope/js/color.js`
- Modify: `kaleidoscope/js/selftest.js` (fill in `testColor`)

Every color in a brick-icons outline SVG is a shade of the part's base color. Recoloring maps each shade's OKLCH relationship to the base (lightness ratio, chroma ratio, hue offset) onto a new base.

- [ ] **Step 1: Fill in `testColor()` in `js/selftest.js`**

```js
async function testColor() {
  const { hexToOklch, oklchToHex, remapColor } = await import('./color.js');

  const rt = oklchToHex(hexToOklch('#c91a09'));
  assert('color: hex→oklch→hex round-trips', rt === '#c91a09' || nearHex(rt, '#c91a09', 2));

  assert('color: remap base to itself is identity-ish',
    nearHex(remapColor('#9ba19d', '#9ba19d', '#9ba19d'), '#9ba19d', 2));

  // A darker shade of gray base remapped onto red stays darker than red
  const shade = remapColor('#5c605e', '#9ba19d', '#c91a09');
  const L = (h) => hexToOklch(h).L;
  assert('color: shade ordering preserved', L(shade) < L('#c91a09'));

  assert('color: remap is deterministic',
    remapColor('#5c605e', '#9ba19d', '#c91a09') === shade);

  // Full asset shade ramp onto red stays monotone in L (catches base-noise
  // amplification producing lightness kinks in gradient bands)
  const ramp = ['#555956', '#595c5a', '#757976', '#8b918d', '#979d99', '#9aa09c', '#9ea4a0', '#cad1cc'];
  const Ls = ramp.map(s => hexToOklch(remapColor(s, '#9ba19d', '#c91a09')).L);
  assert('color: remapped ramp is monotone', Ls.every((v, i) => i === 0 || v >= Ls[i - 1] - 1e-4));

  // Out-of-gamut highlight keeps the target hue after chroma fitting
  // (catches per-channel gamut clipping shifting hue). Red keeps enough
  // fitted chroma for a well-defined output hue; very light targets clamp
  // to near-white where hue is float noise.
  const hR = hexToOklch('#c91a09').h;
  const hHi = hexToOklch(remapColor('#cad1cc', '#9ba19d', '#c91a09')).h;
  assert('color: fitted highlight hue stays true', Math.abs(hHi - hR) < 6 * Math.PI / 180);
}

function nearHex(a, b, tol) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= tol);
}
```

- [ ] **Step 2: Verify failure** — reload `?selftest`. Expected: FAIL/import error for `./color.js`.

- [ ] **Step 3: Write `js/color.js`**

```js
// sRGB hex ↔ OKLCH. Reference: Björn Ottosson's OKLab conversion constants.

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; }

export function hexToOklch(hex) {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToSrgb({ L, C, h }) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(linearToSrgb);
}

export function oklchToHex(c) {
  const to255 = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  return '#' + oklchToSrgb(c).map(v => to255(v).toString(16).padStart(2, '0')).join('');
}

// Largest in-gamut chroma at (L, h): per-channel clipping shifts hue, so
// out-of-gamut colors reduce chroma (hue and lightness held) instead.
function fitChroma({ L, C, h }) {
  const fits = (c) => oklchToSrgb({ L, C: c, h }).every(v => v >= -1e-4 && v <= 1 + 1e-4);
  if (fits(C)) return C;
  let lo = 0, hi = C;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// How much of a shade's above-base lightness survives remapping (0 = flatten
// all highlights to the base color, 1 = keep the baked lighting as-is).
const HIGHLIGHT_COMPRESSION = 0.45;

// Map `hex`'s relationship to `baseHex` onto `newBaseHex`.
export function remapColor(hex, baseHex, newBaseHex) {
  const c = hexToOklch(hex), b = hexToOklch(baseHex), n = hexToOklch(newBaseHex);
  // Below this chroma the base is effectively gray and its per-shade hue and
  // chroma variation is quantization noise (the neutral asset base #9ba19d
  // has C ≈ 0.009): keep the new base's hue, scale chroma with lightness.
  const baseIsGray = b.C < 2e-2;
  const rL = b.L > 1e-6 ? c.L / b.L : 1;
  // Compress above-base ratios: the baked LDView lighting makes top faces
  // read too bright relative to the rest of the part once remapped, and on
  // light targets rL > 1 clamps to flat white. Shadows (rL <= 1) untouched;
  // the L ceiling keeps highlights tinted instead of pure white.
  const rLc = rL <= 1 ? rL : 1 + (rL - 1) * HIGHLIGHT_COMPRESSION;
  const L = Math.min(0.985, Math.max(0, n.L * rLc));
  const C = baseIsGray ? n.C * rLc : n.C * (c.C / b.C);
  const h = baseIsGray ? n.h : n.h + (c.h - b.h);
  return oklchToHex({ L, C: fitChroma({ L, C, h }), h });
}
```

- [ ] **Step 4: Verify** — reload `?selftest`. Expected: all `color:` assertions PASS (summary 10/10).

- [ ] **Step 5: Commit**

```bash
git add kaleidoscope/js/color.js kaleidoscope/js/selftest.js
git commit -m "kaleidoscope: OKLCH color remapping"
```

---

### Task 5: Palette presets

**Files:**
- Create: `kaleidoscope/js/palettes.js`

- [ ] **Step 1: Write `js/palettes.js`**

```js
// Each preset: ordered color list + background. Hexes for the LEGO set are
// the standard LDraw/BrickLink values. Every color must stay clearly visible
// against its preset's background (dark-on-dark reads as missing parts).
export const PRESETS = {
  'classic-brights': {
    // #f2f3f2 is the real LEGO material white (off-white), intentionally not
    // LDraw's software white #ffffff.
    colors: ['#c91a09', '#0055bf', '#f2cd37', '#237841', '#fe8a18', '#f2f3f2'],
    background: '#1a1a2e',
  },
  pastel: {
    colors: ['#fecccf', '#b4d4f7', '#fff5b8', '#c9e4c5', '#e6d3f2', '#ffe0c2'],
    background: '#2a2438',
  },
  'mono-blue': {
    colors: ['#1a4a8a', '#2f6fc4', '#6ea3e8', '#b7d2f5', '#e3eefb'],
    background: '#080f1c',
  },
  'duotone-ember': {
    colors: ['#c91a09', '#fe8a18', '#ff5d3c', '#ffb56b'],
    background: '#140803',
  },
};

export function getPreset(name) {
  const p = PRESETS[name] ?? PRESETS['classic-brights'];
  return { name: PRESETS[name] ? name : 'classic-brights', colors: [...p.colors], background: p.background };
}
```

- [ ] **Step 2: Sanity-check in console** — `(await import('./js/palettes.js')).getPreset('pastel')` from the page's devtools returns the pastel copy; mutating the returned array does not change `PRESETS`.

- [ ] **Step 3: Commit**

```bash
git add kaleidoscope/js/palettes.js
git commit -m "kaleidoscope: palette presets"
```

---

### Task 6: Part loading and recolored symbol cache

**Files:**
- Create: `kaleidoscope/js/parts.js`

- [ ] **Step 1: Write `js/parts.js`**

```js
import { remapColor } from './color.js';

// Loads the manifest + part SVGs, owns a hidden document-level <svg> that
// accumulates recolored <symbol>s. <use href="#id"> resolves across SVG
// elements within the same document, so one defs host serves every pane.
export async function loadParts(baseUrl = 'assets') {
  const manifest = await (await fetch(`${baseUrl}/manifest.json`)).json();
  const parts = new Map();

  await Promise.all(manifest.parts.map(async ({ id, name }) => {
    try {
      const text = await (await fetch(`${baseUrl}/${id}.svg`)).text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      if (root.tagName !== 'svg') throw new Error('not svg');
      root.querySelector('rect[fill="white"]')?.remove();  // background plate
      parts.set(id, { id, name, viewBox: root.getAttribute('viewBox'), inner: root.innerHTML });
    } catch (err) {
      console.warn(`kaleidoscope: part ${id} failed to load (${err.message}); placeholder used`);
      parts.set(id, { id, name, viewBox: '0 0 100 100', inner: PLACEHOLDER(id), broken: true });
    }
  }));

  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  const cache = new Map();  // `${partId}|${color}` -> symbol id
  const base = manifest.baseColor;

  function recoloredInner(part, color) {
    if (part.broken) return part.inner;
    const memo = new Map();
    return part.inner.replace(/#[0-9a-fA-F]{6}/g, (hex) => {
      const k = hex.toLowerCase();
      if (!memo.has(k)) memo.set(k, remapColor(k, base, color));
      return memo.get(k);
    });
  }

  return {
    list: manifest.parts,
    baseColor: base,
    symbolId(partId, color) {
      const key = `${partId}|${color}`;
      if (!cache.has(key)) {
        const part = parts.get(partId);
        const sym = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
        sym.id = `sym-${partId}-${color.slice(1)}`;
        sym.setAttribute('viewBox', part.viewBox);
        sym.innerHTML = recoloredInner(part, color);
        host.appendChild(sym);
        cache.set(key, sym.id);
      }
      return cache.get(key);
    },
    symbolMarkup(partId, color) {
      this.symbolId(partId, color);  // ensure cached
      return document.getElementById(`sym-${partId}-${color.slice(1)}`).outerHTML;
    },
  };
}

const PLACEHOLDER = (id) => `
  <rect x="5" y="5" width="90" height="90" fill="none" stroke="#e05555" stroke-width="3" stroke-dasharray="6 4"/>
  <text x="50" y="55" text-anchor="middle" fill="#e05555" font-size="16" font-family="monospace">${id}</text>`;
```

Internal-id collision note: brick-icons SVGs define gradients as `id="g0"…` AND a part-specific silhouette clip path `id="sclip"` — identical ids across parts/colors collide in a shared document (first-in-document wins, silently mis-clipping every later part's linework). **Namespace ALL ids** (the assets contain no `href="#…"` and no external `url()` refs, so blanket rewriting is safe):

```js
function namespaceIds(markup, ns) {
  return markup
    .replaceAll('id="', `id="${ns}-`)
    .replaceAll('url(#', `url(#${ns}-`);
}
// in symbolId(): sym.innerHTML = namespaceIds(recoloredInner(part, color), `${partId}-${color.slice(1)}`);
```

Also in `symbolId()`: normalize `color = color.toLowerCase()` at the top (case-variant hexes would mint duplicate symbols), cache the `<symbol>` element itself rather than its id string (avoids document-level `getElementById` and makes `symbolMarkup` destructuring-safe via local helpers, not `this`), and leave a `TODO(task-12)` noting the cache needs eviction or a transient-scratch-symbol path before a live color picker scrubs it with hundreds of hexes.

- [ ] **Step 2: Manual verification in console** (on the served page):

```js
const store = await (await import('./js/parts.js')).loadParts('assets');
store.symbolId('3001', '#c91a09');
document.querySelectorAll('symbol').length;  // ≥ 1
```

Then append a probe to the preview svg from the console and confirm a red 2×4 brick renders:

```js
const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
u.setAttribute('href', '#' + store.symbolId('3001', '#c91a09'));
u.setAttribute('width', 300); u.setAttribute('height', 300);
document.getElementById('preview-svg').setAttribute('viewBox', '0 0 300 300');
document.getElementById('preview-svg').appendChild(u);
```

Expected: a red brick with correct shading (three red shades + gradients, dark linework), not gray, not flat.

- [ ] **Step 3: Verify the placeholder path** — `store2 = await loadParts('bogus')` logs fetch failures and every part gets the dashed placeholder; the page keeps working.

- [ ] **Step 4: Commit**

```bash
git add kaleidoscope/js/parts.js
git commit -m "kaleidoscope: part loader with recolored symbol cache"
```

---

### Task 7: Scene state + seeded scatter

**Files:**
- Create: `kaleidoscope/js/scene.js`
- Modify: `kaleidoscope/js/selftest.js` (fill in `testScene`)

- [ ] **Step 1: Fill in `testScene()` in `js/selftest.js`**

```js
async function testScene() {
  const { defaultScene, scatter, serialize, deserialize, encodeHash, decodeHash } =
    await import('./scene.js');
  const fakeStore = { list: [{ id: '3001' }, { id: '3941' }, { id: '4070' }] };

  const s1 = defaultScene(), s2 = defaultScene();
  s1.seed = s2.seed = 42;
  scatter(s1, fakeStore); scatter(s2, fakeStore);
  assert('scene: scatter is deterministic',
    JSON.stringify(s1.chamber.parts) === JSON.stringify(s2.chamber.parts));
  assert('scene: scatter respects density', s1.chamber.parts.length === s1.density);
  assert('scene: parts land inside chamber', s1.chamber.parts.every(p =>
    p.x >= 0 && p.x <= s1.chamber.width && p.y >= 0 && p.y <= s1.chamber.height));
  assert('scene: scatter only uses enabled parts', (() => {
    const s = defaultScene(); s.seed = 7; s.partSet = ['3941'];
    scatter(s, fakeStore);
    return s.chamber.parts.every(p => p.partRef === '3941');
  })());

  const round = deserialize(serialize(s1));
  assert('scene: serialize round-trips', JSON.stringify(round) === JSON.stringify(s1));

  const h = encodeHash(s1);
  const dec = decodeHash(h);
  assert('scene: hash round-trips seed+knobs',
    dec.seed === s1.seed && dec.mode === s1.mode && dec.density === s1.density &&
    dec.radial.order === s1.radial.order && dec.tiling.group === s1.tiling.group);
  assert('scene: hash omits tweaks', dec.chamber === undefined);
  assert('scene: decodeHash rejects garbage', decodeHash('#s=%%%') === null);
  assert('scene: decodeHash rejects valid-base64 non-scene', decodeHash('#s=YWJj') === null);
  assert('scene: all-stale partSet falls back to full list', (() => {
    const s = defaultScene(); s.seed = 3; s.partSet = ['not-a-part'];
    scatter(s, fakeStore);
    return s.chamber.parts.length > 0 && s.chamber.parts.every(p => p.partRef !== undefined);
  })());
  assert('scene: deserialize recovers from empty palette colors', (() => {
    const bad = { ...defaultScene(), palette: { name: 'classic-brights', colors: [], background: '#000000' } };
    return deserialize(JSON.stringify(bad)).palette.colors.length > 0;
  })());
}
```

- [ ] **Step 2: Verify failure** — reload `?selftest`. Expected: import error for `./scene.js`.

- [ ] **Step 3: Write `js/scene.js`**

```js
import { mulberry32, randRange, randInt, randPick } from './rng.js';
import { getPreset } from './palettes.js';

export const CHAMBER_W = 400, CHAMBER_H = 400, PART_UNIT = 100;
const STORAGE_KEY = 'kaleidoscope-scene-v1';

export function defaultScene() {
  return {
    seed: 1,
    mode: 'radial',
    chamber: { width: CHAMBER_W, height: CHAMBER_H, parts: [] },
    radial: { order: 6, mirror: true },
    tiling: { group: 'p6m', tileSize: 300 },
    palette: getPreset('classic-brights'),
    partSet: [],            // filled from manifest at startup (all enabled)
    density: 14,
    sizeRange: [0.5, 1.4],
    rotationJitter: 180,
  };
}

// Reroll chamber.parts from seed + knobs. Discards tweaks by design.
export function scatter(scene, store) {
  const all = store.list.map(p => p.id);
  const filtered = scene.partSet.length
    ? scene.partSet.filter(id => store.list.some(p => p.id === id))
    : all;
  const enabled = filtered.length ? filtered : all;  // stale/emptied partSet: fall back
  // Persisted or hash-supplied state bypasses the slider's [3,60] — clamp so a
  // garbage density can't crash Array.from or hang the tab.
  const density = Math.min(200, Math.max(0, Math.trunc(scene.density) || 0));
  const rand = mulberry32(scene.seed);
  scene.chamber.parts = Array.from({ length: density }, (_, i) => ({
    id: i,
    partRef: randPick(rand, enabled),
    x: randRange(rand, 0, scene.chamber.width),
    y: randRange(rand, 0, scene.chamber.height),
    rotation: randRange(rand, -scene.rotationJitter, scene.rotationJitter),
    scale: randRange(rand, scene.sizeRange[0], scene.sizeRange[1]),
    colorIndex: randInt(rand, scene.palette.colors.length),
  }));
}

export const partColor = (scene, part) =>
  part.colorOverride ?? scene.palette.colors[part.colorIndex % scene.palette.colors.length];

export const serialize = (scene) => JSON.stringify(scene);
export function deserialize(json) {
  const d = defaultScene();
  const s = { ...d, ...JSON.parse(json) };
  // Deep-merge nested keys so older saves survive schema growth.
  for (const k of ['chamber', 'radial', 'tiling', 'palette']) s[k] = { ...d[k], ...s[k] };
  if (!Array.isArray(s.palette.colors) || !s.palette.colors.length) s.palette = getPreset(s.palette.name);
  if (!Array.isArray(s.sizeRange) || s.sizeRange.length !== 2) s.sizeRange = d.sizeRange;
  return s;
}

// URL hash carries seed + knobs only (no tweaks): cheap sharing of rerollable state.
export function encodeHash(scene) {
  const { seed, mode, radial, tiling, density, sizeRange, rotationJitter, partSet } = scene;
  const payload = { seed, mode, radial, tiling, density, sizeRange, rotationJitter,
    partSet, paletteName: scene.palette.name };
  return '#s=' + btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeHash(hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash ?? '');
  if (!m) return null;
  try {
    let b64 = m[1].replaceAll('-', '+').replaceAll('_', '/');
    while (b64.length % 4) b64 += '=';
    const p = JSON.parse(atob(b64));
    if (typeof p.seed !== 'number') return null;
    return p;
  } catch { return null; }
}

export const saveLocal = (scene) => localStorage.setItem(STORAGE_KEY, serialize(scene));
export function loadLocal() {
  const json = localStorage.getItem(STORAGE_KEY);
  try { return json ? deserialize(json) : null; } catch { return null; }
}
```

- [ ] **Step 4: Verify** — reload `?selftest`. Expected: all `scene:` assertions PASS (running total now rng+color+scene).

- [ ] **Step 5: Commit**

```bash
git add kaleidoscope/js/scene.js kaleidoscope/js/selftest.js
git commit -m "kaleidoscope: scene state, seeded scatter, hash codec"
```

---

### Task 8: Radial engine + first live render

**Files:**
- Create: `kaleidoscope/js/engines.js`
- Rewrite: `kaleidoscope/js/main.js`
- Modify: `kaleidoscope/js/selftest.js` (start `testEngines`)

- [ ] **Step 1: Add radial assertions to `testEngines()` in `js/selftest.js`**

```js
async function testEngines() {
  const { chamberGroup, renderPreview } = await import('./engines.js');
  const { defaultScene, scatter } = await import('./scene.js');
  const fakeStore = {
    list: [{ id: 'x' }],
    symbolId: (id, color) => `sym-${id}-${color.slice(1)}`,
  };
  const scene = defaultScene();
  scene.seed = 5; scene.density = 4;
  scatter(scene, fakeStore);

  const g = chamberGroup(scene, fakeStore, {});
  assert('engines: chamber has one use per part',
    g.querySelectorAll('use').length === 4);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  scene.mode = 'radial'; scene.radial = { order: 6, mirror: true };
  renderPreview(svg, scene, fakeStore);
  assert('engines: radial mirror renders 2×order wedges',
    svg.querySelectorAll('[data-wedge]').length === 12);
  scene.radial.mirror = false;
  renderPreview(svg, scene, fakeStore);
  assert('engines: radial no-mirror renders order wedges',
    svg.querySelectorAll('[data-wedge]').length === 6);
  assert('engines: background rect uses palette background',
    svg.querySelector('rect').getAttribute('fill') === scene.palette.background);
}
```

- [ ] **Step 2: Verify failure** — reload `?selftest`. Expected: import error for `./engines.js`.

- [ ] **Step 3: Write `js/engines.js`** (radial now; `buildTiling` throws until Task 9)

```js
import { partColor, PART_UNIT } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export const PREVIEW_R = 500;                    // radial preview radius
export const WRAP_MARGIN = 0.2;                  // tiling: clone parts within 20% of an edge

// One <g> containing a <use> per chamber part. With {wrap:true}, parts near an
// edge are cloned across the opposite edge (toroidal) so tiles read seamless.
export function chamberGroup(scene, store, { wrap = false } = {}) {
  const { width: w, height: h } = scene.chamber;
  const g = el('g', { 'data-chamber': '' });
  const mx = w * WRAP_MARGIN, my = h * WRAP_MARGIN;
  for (const part of scene.chamber.parts) {
    const offsets = [[0, 0]];
    if (wrap) {
      const dx = part.x < mx ? w : part.x > w - mx ? -w : 0;
      const dy = part.y < my ? h : part.y > h - my ? -h : 0;
      if (dx) offsets.push([dx, 0]);
      if (dy) offsets.push([0, dy]);
      if (dx && dy) offsets.push([dx, dy]);
    }
    for (const [ox, oy] of offsets) {
      g.appendChild(el('use', {
        href: '#' + store.symbolId(part.partRef, partColor(scene, part)),
        x: -PART_UNIT / 2, y: -PART_UNIT / 2, width: PART_UNIT, height: PART_UNIT,
        transform: `translate(${part.x + ox},${part.y + oy}) rotate(${part.rotation}) scale(${part.scale})`,
        'data-part-id': part.id,
      }));
    }
  }
  return g;
}

export function renderPreview(svgEl, scene, store) {
  svgEl.replaceChildren();
  if (scene.mode === 'radial') buildRadial(svgEl, scene, store);
  else buildTiling(svgEl, scene, store);
}

function buildRadial(svgEl, scene, store) {
  const R = PREVIEW_R;
  svgEl.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svgEl.appendChild(el('rect', {
    x: -R, y: -R, width: 2 * R, height: 2 * R, fill: scene.palette.background,
  }));

  const defs = el('defs');
  // Chamber placed radially: x → [0, R] outward from apex, y centered on the axis.
  const { width: w, height: h } = scene.chamber;
  const s = R / w;
  const placed = el('g', { id: 'radial-chamber' });
  const inner = el('g', { transform: `translate(0,${(-h * s) / 2}) scale(${s})` });
  inner.appendChild(chamberGroup(scene, store, {}));
  placed.appendChild(inner);
  defs.appendChild(placed);

  const n = scene.radial.order * (scene.radial.mirror ? 2 : 1);
  const wedge = 360 / n;
  const half = (wedge / 2) * (Math.PI / 180);
  const sector = `M0,0 L${R * Math.cos(-half)},${R * Math.sin(-half)} ` +
    `A${R},${R} 0 0 1 ${R * Math.cos(half)},${R * Math.sin(half)} Z`;
  const clip = el('clipPath', { id: 'radial-sector' });
  clip.appendChild(el('path', { d: sector }));
  defs.appendChild(clip);
  svgEl.appendChild(defs);

  for (let k = 0; k < n; k++) {
    const mirrored = scene.radial.mirror && k % 2 === 1;
    const gk = el('g', {
      'data-wedge': k,
      transform: `rotate(${k * wedge})${mirrored ? ' scale(1,-1)' : ''}`,
      'clip-path': 'url(#radial-sector)',
    });
    gk.appendChild(el('use', { href: '#radial-chamber' }));
    svgEl.appendChild(gk);
  }
}

function buildTiling() {
  throw new Error('tiling engine: implemented in Task 9');
}
```

Wedge geometry note: the sector clip spans `±wedge/2` around the +x axis while the chamber is drawn along +x with y centered, so every wedge shows the chamber's central band; mirrored copies share the seam edges exactly.

- [ ] **Step 4: Rewrite `js/main.js` as the real orchestrator**

```js
import { loadParts } from './parts.js';
import { defaultScene, scatter, decodeHash, saveLocal } from './scene.js';
import { renderPreview } from './engines.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  if (new URLSearchParams(location.search).has('selftest')) {
    const { runSelftest } = await import('./selftest.js');
    await runSelftest();
  }

  const store = await loadParts('assets');
  let scene = defaultScene();
  const fromHash = decodeHash(location.hash);
  if (fromHash) Object.assign(scene, fromHash, { palette: scene.palette });
  if (!scene.partSet.length) scene.partSet = store.list.map(p => p.id);
  scatter(scene, store);

  function update() {
    renderPreview($('preview-svg'), scene, store);
    document.body.style.background = scene.palette.background;
    saveLocal(scene);
  }
  update();

  // Later tasks extend boot(): editor pane (Task 10), sidebar (Task 12),
  // export (Task 13), persistence load (Task 14).
  window.__kaleido = { scene, store, update };  // console access during development
}

boot();
```

- [ ] **Step 5: Verify selftest passes** — reload `?selftest`. Expected: all engine radial assertions PASS.

- [ ] **Step 6: Verify visually** — open the page (no query). Expected: right pane shows a 6-fold mirrored mandala of colored LEGO parts on the dark background; changing `__kaleido.scene.radial.order = 10; __kaleido.update()` in the console re-renders with 10-fold symmetry.

- [ ] **Step 7: Commit**

```bash
git add kaleidoscope/js/engines.js kaleidoscope/js/main.js kaleidoscope/js/selftest.js
git commit -m "kaleidoscope: radial engine and live preview"
```

---

### Task 9: Tiling engine — rectangular groups (p1, pm, pmm, p4m)

**Files:**
- Modify: `kaleidoscope/js/engines.js`
- Modify: `kaleidoscope/js/selftest.js`

- [ ] **Step 1: Extend `testEngines()`**

```js
  // append inside testEngines(), after the radial assertions:
  for (const [group, expectedUses] of [['p1', 1], ['pm', 2], ['pmm', 4]]) {
    scene.mode = 'tiling'; scene.tiling = { group, tileSize: 300 };
    renderPreview(svg, scene, fakeStore);
    assert(`engines: ${group} tile composes ${expectedUses} chamber copies`,
      svg.querySelectorAll('pattern use[href="#tiling-chamber"]').length === expectedUses);
    assert(`engines: ${group} pattern rect present`,
      svg.querySelector('rect[fill^="url(#"]') !== null);
  }
  // p4m composes via an intermediate cell def: 2 chamber uses in the cell,
  // 4 cell uses in the pattern (cell lives in <defs>, not under <pattern>).
  scene.mode = 'tiling'; scene.tiling = { group: 'p4m', tileSize: 300 };
  renderPreview(svg, scene, fakeStore);
  assert('engines: p4m cell mirrors chamber across the diagonal',
    svg.querySelectorAll('#p4m-cell use[href="#tiling-chamber"]').length === 2);
  assert('engines: p4m pattern stamps 4 cells',
    svg.querySelectorAll('pattern use[href="#p4m-cell"]').length === 4);
  assert('engines: p4m pattern rect present',
    svg.querySelector('rect[fill^="url(#"]') !== null);
```

- [ ] **Step 2: Verify failure** — reload `?selftest`. Expected: `tiling engine: implemented in Task 9` errors.

- [ ] **Step 3: Replace `buildTiling` in `js/engines.js`**

```js
export const TILE_VIEW = 1000;   // tiling preview viewBox is 0..1000 square

function buildTiling(svgEl, scene, store) {
  svgEl.setAttribute('viewBox', `0 0 ${TILE_VIEW} ${TILE_VIEW}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  const defs = el('defs');
  const { width: w, height: h } = scene.chamber;
  const k = scene.tiling.tileSize / w;          // chamber units → preview units
  const src = el('g', { id: 'tiling-chamber' });
  src.appendChild(chamberGroup(scene, store, { wrap: true }));
  defs.appendChild(src);

  const clipRect = el('clipPath', { id: 'tile-cell' });
  clipRect.appendChild(el('rect', { width: w, height: h }));
  defs.appendChild(clipRect);

  const pattern = el('pattern', { id: 'tile', patternUnits: 'userSpaceOnUse' });
  const use = (transform) => {
    const g = el('g', transform ? { transform } : {});
    const u = el('use', { href: '#tiling-chamber', 'clip-path': 'url(#tile-cell)' });
    g.appendChild(u);
    return g;
  };

  const group = scene.tiling.group;
  if (group === 'p1') {
    pattern.setAttribute('width', w * k); pattern.setAttribute('height', h * k);
    pattern.appendChild(el('g', { transform: `scale(${k})` })).appendChild(use());
  } else if (group === 'pm') {
    pattern.setAttribute('width', 2 * w * k); pattern.setAttribute('height', h * k);
    const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
    g.appendChild(use());
    g.appendChild(use(`translate(${2 * w},0) scale(-1,1)`));
  } else if (group === 'pmm') {
    pattern.setAttribute('width', 2 * w * k); pattern.setAttribute('height', 2 * h * k);
    const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
    g.appendChild(use());
    g.appendChild(use(`translate(${2 * w},0) scale(-1,1)`));
    g.appendChild(use(`translate(0,${2 * h}) scale(1,-1)`));
    g.appendChild(use(`translate(${2 * w},${2 * h}) scale(-1,-1)`));
  } else if (group === 'p4m') {
    // Square cell: chamber clipped to the below-diagonal triangle + its
    // diagonal reflection, then that cell reflected pmm-style into 2×2.
    const s = Math.min(w, h);
    const tri = el('clipPath', { id: 'tile-tri' });
    tri.appendChild(el('path', { d: `M0,0 L${s},0 L${s},${s} Z` }));
    defs.appendChild(tri);
    const cell = el('g', { id: 'p4m-cell' });
    const t1 = el('g', { 'clip-path': 'url(#tile-tri)' });
    t1.appendChild(el('use', { href: '#tiling-chamber' }));
    const t2 = el('g', { 'clip-path': 'url(#tile-tri)', transform: 'matrix(0,1,1,0,0,0)' });
    t2.appendChild(el('use', { href: '#tiling-chamber' }));
    cell.appendChild(t1); cell.appendChild(t2);
    defs.appendChild(cell);
    pattern.setAttribute('width', 2 * s * k); pattern.setAttribute('height', 2 * s * k);
    const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
    for (const t of ['', `translate(${2 * s},0) scale(-1,1)`,
                     `translate(0,${2 * s}) scale(1,-1)`, `translate(${2 * s},${2 * s}) scale(-1,-1)`]) {
      const gg = el('g', t ? { transform: t } : {});
      gg.appendChild(el('use', { href: '#p4m-cell' }));
      g.appendChild(gg);
    }
  } else {
    buildHexTiling(svgEl, defs, pattern, scene, store, k);  // Task 10 (p6m, p3m1)
  }

  defs.appendChild(pattern);
  svgEl.appendChild(defs);
  svgEl.appendChild(el('rect', {
    width: TILE_VIEW, height: TILE_VIEW, fill: scene.palette.background,
  }));
  svgEl.appendChild(el('rect', {
    width: TILE_VIEW, height: TILE_VIEW, fill: 'url(#tile)',
  }));
}

function buildHexTiling() {
  throw new Error('hex tiling: implemented in Task 10');
}
```

Note for the selftest count: `p4m` composes 2 chamber uses per cell × 4 cells = 8, matching the assertion table.

- [ ] **Step 4: Verify selftest** — reload `?selftest`. Expected: p1/pm/pmm/p4m assertions PASS (p6m/p3m1 not asserted yet).

- [ ] **Step 5: Verify visually** — console: `__kaleido.scene.mode='tiling'; __kaleido.scene.tiling={group:'pmm',tileSize:250}; __kaleido.update()`. Expected: seamless mirrored tiling fills the preview; parts crossing tile edges continue across the seam (that's the wrap clones working). Try each of the four groups.

- [ ] **Step 6: Commit**

```bash
git add kaleidoscope/js/engines.js kaleidoscope/js/selftest.js
git commit -m "kaleidoscope: rectangular tiling groups p1 pm pmm p4m"
```

---

### Task 10: Tiling engine — hexagonal groups (p6m, p3m1)

**Files:**
- Modify: `kaleidoscope/js/engines.js`
- Modify: `kaleidoscope/js/selftest.js`

The hex groups reuse the radial wedge construction: a mirrored order-6 (p6m) or order-3 (p3m1) motif stamped on a hexagonal lattice inside a rectangular pattern tile.

- [ ] **Step 1: Extend `testEngines()`**

```js
  // append inside testEngines():
  for (const group of ['p6m', 'p3m1']) {
    scene.mode = 'tiling'; scene.tiling = { group, tileSize: 300 };
    renderPreview(svg, scene, fakeStore);
    assert(`engines: ${group} builds a motif`, svg.querySelector('#hex-motif') !== null);
    assert(`engines: ${group} stamps motif on hex lattice (5 stamps)`,
      svg.querySelectorAll('pattern > g > use[href="#hex-motif"]').length === 5);
  }
```

- [ ] **Step 2: Verify failure** — reload `?selftest`. Expected: `hex tiling: implemented in Task 10`.

- [ ] **Step 3: Implement. First extract the wedge-motif builder from `buildRadial`, then use it in both places.**

In `buildRadial`, replace the block that creates `placed`, `clip`, and the wedge loop with a call to the new shared helper, keeping behavior identical:

```js
// shared: builds a mirrored/rotated wedge motif of the chamber, radius R,
// appending its defs into `defs` and returning the motif <g>.
function wedgeMotif(defs, scene, store, { order, mirror, R, idPrefix, dataWedge = false }) {
  const { width: w, height: h } = scene.chamber;
  const s = R / w;
  const placed = el('g', { id: `${idPrefix}-chamber` });
  const inner = el('g', { transform: `translate(0,${(-h * s) / 2}) scale(${s})` });
  inner.appendChild(chamberGroup(scene, store, {}));
  placed.appendChild(inner);
  defs.appendChild(placed);

  const n = order * (mirror ? 2 : 1);
  const wedge = 360 / n;
  const half = (wedge / 2) * (Math.PI / 180);
  const clip = el('clipPath', { id: `${idPrefix}-sector` });
  clip.appendChild(el('path', {
    d: `M0,0 L${R * Math.cos(-half)},${R * Math.sin(-half)} ` +
       `A${R},${R} 0 0 1 ${R * Math.cos(half)},${R * Math.sin(half)} Z`,
  }));
  defs.appendChild(clip);

  const motif = el('g');
  for (let k = 0; k < n; k++) {
    const mirrored = mirror && k % 2 === 1;
    const gk = el('g', {
      ...(dataWedge ? { 'data-wedge': k } : {}),
      transform: `rotate(${k * wedge})${mirrored ? ' scale(1,-1)' : ''}`,
      'clip-path': `url(#${idPrefix}-sector)`,
    });
    gk.appendChild(el('use', { href: `#${idPrefix}-chamber` }));
    motif.appendChild(gk);
  }
  return motif;
}
```

`buildRadial` becomes:

```js
function buildRadial(svgEl, scene, store) {
  const R = PREVIEW_R;
  svgEl.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svgEl.appendChild(el('rect', {
    x: -R, y: -R, width: 2 * R, height: 2 * R, fill: scene.palette.background,
  }));
  const defs = el('defs');
  svgEl.appendChild(defs);
  svgEl.appendChild(wedgeMotif(defs, scene, store, {
    order: scene.radial.order, mirror: scene.radial.mirror,
    R, idPrefix: 'radial', dataWedge: true,
  }));
}
```

And `buildHexTiling`:

```js
function buildHexTiling(svgEl, defs, pattern, scene, store, k) {
  const group = scene.tiling.group;                 // 'p6m' | 'p3m1'
  const r = scene.chamber.width;                    // motif radius in chamber units
  const motif = wedgeMotif(defs, scene, store, {
    order: group === 'p6m' ? 6 : 3, mirror: true, R: r, idPrefix: 'hex',
  });
  motif.id = 'hex-motif';
  defs.appendChild(motif);

  // Hex lattice: vectors (√3r, 0) and (√3r/2, 1.5r). Rect tile W=√3r, H=3r
  // holds one full column plus the half-offset row; corner stamps wrap it.
  const W = Math.sqrt(3) * r, H = 3 * r;
  pattern.setAttribute('width', W * k); pattern.setAttribute('height', H * k);
  const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
  for (const [cx, cy] of [[0, 0], [W, 0], [W / 2, H / 2], [0, H], [W, H]]) {
    g.appendChild(el('use', { href: '#hex-motif', x: cx, y: cy,
      transform: `translate(${cx},${cy})` }));
  }
}
```

**Correction to apply while implementing:** `<use>` on a `<g>` ignores `x`/`y` when a transform is present — use only the `transform` attribute (drop the `x`/`y` attributes shown above).

- [ ] **Step 4: Verify selftest** — reload `?selftest`. Expected: all engine assertions PASS, including radial ones (regression check: extraction didn't change wedge counts).

- [ ] **Step 5: Verify visually** — `__kaleido.scene.tiling={group:'p6m',tileSize:300}; __kaleido.update()`. Expected: honeycomb of mirrored mandala motifs covering the plane, no large voids (motifs at √3·r spacing overlap slightly by design). Also check `p3m1` and re-check `radial` mode still renders.

- [ ] **Step 6: Commit**

```bash
git add kaleidoscope/js/engines.js kaleidoscope/js/selftest.js
git commit -m "kaleidoscope: hexagonal tiling groups p6m p3m1 via shared wedge motif"
```

---

### Task 11: Chamber editor — render, select, drag

**Files:**
- Create: `kaleidoscope/js/editor.js`
- Modify: `kaleidoscope/js/main.js`

- [ ] **Step 1: Write `js/editor.js`**

```js
import { partColor, PART_UNIT } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

let selectedId = null;
export const getSelected = (scene) =>
  scene.chamber.parts.find(p => p.id === selectedId) ?? null;
export const clearSelection = () => { selectedId = null; };

// Renders the chamber at editing scale and wires pointer interactions.
// onChange(kind) is called after any mutation: 'tweak' | 'select'.
export function renderChamber(svgEl, scene, store, onChange) {
  const { width: w, height: h } = scene.chamber;
  svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.replaceChildren();
  svgEl.appendChild(el('rect', { width: w, height: h, fill: scene.palette.background }));
  svgEl.appendChild(el('rect', {
    width: w, height: h, fill: 'none', stroke: '#7ac8ff44', 'stroke-dasharray': '6 4',
  }));

  for (const part of scene.chamber.parts) {
    const g = el('g', {
      transform: `translate(${part.x},${part.y}) rotate(${part.rotation}) scale(${part.scale})`,
      'data-id': part.id, style: 'cursor:grab',
    });
    g.appendChild(el('use', {
      href: '#' + store.symbolId(part.partRef, partColor(scene, part)),
      x: -PART_UNIT / 2, y: -PART_UNIT / 2, width: PART_UNIT, height: PART_UNIT,
    }));
    if (part.id === selectedId) {
      g.appendChild(el('rect', {
        x: -PART_UNIT / 2, y: -PART_UNIT / 2, width: PART_UNIT, height: PART_UNIT,
        fill: 'none', stroke: '#7ac8ff', 'stroke-width': 2 / part.scale, 'vector-effect': 'non-scaling-stroke',
      }));
    }
    svgEl.appendChild(g);
  }

  wirePointerHandlers(svgEl, scene, onChange);
}

function svgPoint(svgEl, clientX, clientY) {
  const pt = new DOMPoint(clientX, clientY);
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

function wirePointerHandlers(svgEl, scene, onChange) {
  svgEl.onpointerdown = (ev) => {
    const g = ev.target.closest('g[data-id]');
    if (!g) { selectedId = null; onChange('select'); return; }
    selectedId = Number(g.dataset.id);
    const part = scene.chamber.parts.find(p => p.id === selectedId);
    const start = svgPoint(svgEl, ev.clientX, ev.clientY);
    const orig = { x: part.x, y: part.y };
    svgEl.setPointerCapture(ev.pointerId);
    onChange('select');

    svgEl.onpointermove = (mv) => {
      const p = svgPoint(svgEl, mv.clientX, mv.clientY);
      part.x = Math.min(scene.chamber.width, Math.max(0, orig.x + p.x - start.x));
      part.y = Math.min(scene.chamber.height, Math.max(0, orig.y + p.y - start.y));
      onChange('tweak');
    };
    svgEl.onpointerup = () => { svgEl.onpointermove = svgEl.onpointerup = null; };
  };
}
```

- [ ] **Step 2: Wire into `js/main.js`** — add the import and extend `update()`:

```js
import { renderChamber } from './editor.js';
// inside boot(), replace update():
  function update() {
    renderPreview($('preview-svg'), scene, store);
    renderChamber($('chamber-svg'), scene, store, (kind) => {
      if (kind === 'tweak') renderPreview($('preview-svg'), scene, store);
      renderChamber($('chamber-svg'), scene, store, arguments.callee ?? undefined);
      saveLocal(scene);
    });
    document.body.style.background = scene.palette.background;
    saveLocal(scene);
  }
```

**Correction to apply while implementing:** `arguments.callee` is illegal in modules — structure it as a named callback instead:

```js
  const onEditorChange = (kind) => {
    if (kind === 'tweak') renderPreview($('preview-svg'), scene, store);
    renderChamber($('chamber-svg'), scene, store, onEditorChange);
    saveLocal(scene);
  };
  function update() {
    renderPreview($('preview-svg'), scene, store);
    renderChamber($('chamber-svg'), scene, store, onEditorChange);
    document.body.style.background = scene.palette.background;
    saveLocal(scene);
  }
```

- [ ] **Step 3: Verify manually** — reload. Expected: left pane shows the scattered parts inside a dashed chamber boundary; clicking a part shows a selection outline; dragging it moves it (clamped to the chamber) and the preview mandala updates live while dragging; clicking empty space deselects.

- [ ] **Step 4: Check drag perf** — drag briskly with density 30+ (`__kaleido.scene.density=30; …scatter…update()`). If it stutters badly, note it — the spec's canvas escape hatch is *not* to be built now; just record observed behavior in the commit message.

- [ ] **Step 5: Commit**

```bash
git add kaleidoscope/js/editor.js kaleidoscope/js/main.js
git commit -m "kaleidoscope: chamber editor with select and drag"
```

---

### Task 12: Chamber editor — rotate, scale, delete, per-part color

**Files:**
- Modify: `kaleidoscope/js/editor.js`
- Modify: `kaleidoscope/js/main.js`

- [ ] **Step 1: Add wheel + keyboard handlers to `wirePointerHandlers` in `js/editor.js`** (append inside the function):

```js
  svgEl.onwheel = (ev) => {
    const part = scene.chamber.parts.find(p => p.id === selectedId);
    if (!part) return;
    ev.preventDefault();
    const d = Math.sign(ev.deltaY);
    if (ev.shiftKey) part.scale = Math.min(3, Math.max(0.2, part.scale * (1 - d * 0.06)));
    else part.rotation = (part.rotation + d * 5) % 360;
    onChange('tweak');
  };

  svgEl.tabIndex = 0;  // focusable for keyboard events
  svgEl.onkeydown = (ev) => {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedId !== null) {
      scene.chamber.parts = scene.chamber.parts.filter(p => p.id !== selectedId);
      selectedId = null;
      onChange('tweak');
    }
  };
```

- [ ] **Step 2: Add the per-part color override UI in `js/main.js`** — a `renderSelectionSwatches` helper called from `onEditorChange`:

```js
import { getSelected } from './editor.js';
import { partColor } from './scene.js';

  function renderSelectionSwatches() {
    const sel = getSelected(scene);
    const box = $('selection-color');
    box.hidden = !sel;
    if (!sel) return;
    const row = $('selection-swatches');
    row.replaceChildren(...scene.palette.colors.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (partColor(scene, sel) === c ? ' active' : '');
      b.style.background = c;
      b.onclick = () => { sel.colorOverride = c; onEditorChange('tweak'); };
      return b;
    }));
    const custom = document.createElement('input');
    custom.type = 'color'; custom.className = 'swatch';
    custom.value = partColor(scene, sel);
    custom.oninput = () => { sel.colorOverride = custom.value; onEditorChange('tweak'); };
    row.appendChild(custom);
  }
  // call renderSelectionSwatches() at the end of onEditorChange and update()
```

- [ ] **Step 3: Verify manually** — select a part: scroll rotates it (preview follows), shift+scroll scales, Delete removes it (click the chamber first so it has focus), the sidebar "Selected part" swatch row appears; clicking a swatch or picking a custom color recolors just that part; Shuffle-free knob changes keep the override (verify by switching palette preset once Task 13 lands — for now check `sel.colorOverride` persists in `__kaleido.scene`).

- [ ] **Step 4: Commit**

```bash
git add kaleidoscope/js/editor.js kaleidoscope/js/main.js
git commit -m "kaleidoscope: rotate/scale/delete and per-part color override"
```

---

### Task 13: Sidebar knob wiring

**Files:**
- Create: `kaleidoscope/js/ui.js`
- Modify: `kaleidoscope/js/main.js`

- [ ] **Step 1: Write `js/ui.js`**

```js
import { scatter } from './scene.js';
import { PRESETS, getPreset } from './palettes.js';

const $ = (id) => document.getElementById(id);

// Bind every sidebar control to the scene. reroll() = scatter + update;
// update() = re-render only (tweaks preserved).
export function bindSidebar(scene, store, { update, reroll }) {
  const setModeVisibility = () => {
    document.querySelectorAll('[data-mode]').forEach(elm => {
      elm.style.display = elm.dataset.mode === scene.mode ? '' : 'none';
    });
  };

  // Symmetry
  $('ctl-mode').value = scene.mode;
  $('ctl-mode').onchange = (e) => { scene.mode = e.target.value; setModeVisibility(); update(); };
  $('ctl-order').value = scene.radial.order;
  $('ctl-order').oninput = (e) => { scene.radial.order = +e.target.value; update(); };
  $('ctl-mirror').checked = scene.radial.mirror;
  $('ctl-mirror').onchange = (e) => { scene.radial.mirror = e.target.checked; update(); };
  $('ctl-group').value = scene.tiling.group;
  $('ctl-group').onchange = (e) => { scene.tiling.group = e.target.value; update(); };
  $('ctl-tilesize').value = scene.tiling.tileSize;
  $('ctl-tilesize').oninput = (e) => { scene.tiling.tileSize = +e.target.value; update(); };
  setModeVisibility();

  // Scatter knobs (reroll on change — they define the scatter)
  $('ctl-density').value = scene.density;
  $('ctl-density').oninput = (e) => { scene.density = +e.target.value; reroll(); };
  $('ctl-sizemin').value = scene.sizeRange[0];
  $('ctl-sizemin').oninput = (e) => { scene.sizeRange[0] = +e.target.value; reroll(); };
  $('ctl-sizemax').value = scene.sizeRange[1];
  $('ctl-sizemax').oninput = (e) => { scene.sizeRange[1] = +e.target.value; reroll(); };
  $('ctl-jitter').value = scene.rotationJitter;
  $('ctl-jitter').oninput = (e) => { scene.rotationJitter = +e.target.value; reroll(); };
  $('ctl-seed').value = scene.seed;
  $('ctl-seed').onchange = (e) => { scene.seed = +e.target.value; reroll(); };
  $('ctl-shuffle').onclick = () => {
    scene.seed = Math.floor(Math.random() * 2 ** 31);
    $('ctl-seed').value = scene.seed;
    reroll();
  };

  // Part set
  $('part-list').replaceChildren(...store.list.map(({ id, name }) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = scene.partSet.includes(id);
    cb.onchange = () => {
      scene.partSet = cb.checked
        ? [...scene.partSet, id]
        : scene.partSet.filter(p => p !== id);
      if (!scene.partSet.length) { cb.checked = true; scene.partSet = [id]; return; }
      reroll();
    };
    label.append(cb, ` ${name} (${id})`);
    return label;
  }));

  // Palette
  $('ctl-palette').replaceChildren(...Object.keys(PRESETS).map(n => {
    const o = document.createElement('option'); o.value = o.textContent = n; return o;
  }));
  $('ctl-palette').value = scene.palette.name;
  $('ctl-palette').onchange = (e) => {
    scene.palette = getPreset(e.target.value);
    renderPaletteSwatches();
    $('ctl-bg').value = scene.palette.background;
    update();  // recolors in place — colorIndex entries survive
  };
  $('ctl-bg').value = scene.palette.background;
  $('ctl-bg').oninput = (e) => { scene.palette.background = e.target.value; update(); };

  function renderPaletteSwatches() {
    $('palette-swatches').replaceChildren(...scene.palette.colors.map((c, i) => {
      const inp = document.createElement('input');
      inp.type = 'color'; inp.className = 'swatch'; inp.value = c;
      inp.oninput = () => { scene.palette.colors[i] = inp.value; update(); };
      return inp;
    }));
  }
  renderPaletteSwatches();
}
```

- [ ] **Step 2: Wire into `js/main.js`**

```js
import { bindSidebar } from './ui.js';
// inside boot(), after the first update():
  const reroll = () => { scatter(scene, store); update(); };
  bindSidebar(scene, store, { update, reroll });
```

- [ ] **Step 3: Verify every knob manually.** Expected behaviors worth checking specifically:
  - Mode select hides/shows the radial vs tiling rows (`data-mode` labels).
  - Order/mirror/group/tile-size re-render *without* rerolling (drag a part first; the tweak survives).
  - Density/size/jitter/seed/Shuffle reroll (tweaks discarded — by design).
  - Unchecking parts rerolls with only checked parts; the last checkbox refuses to uncheck.
  - Palette preset swap recolors the existing composition in place (same layout, new colors); editing a single palette swatch live-recolors every part with that colorIndex; background color updates both panes.

- [ ] **Step 4: Commit**

```bash
git add kaleidoscope/js/ui.js kaleidoscope/js/main.js
git commit -m "kaleidoscope: sidebar knob wiring"
```

---

### Task 14: Export SVG + PNG

**Files:**
- Create: `kaleidoscope/js/export.js`
- Modify: `kaleidoscope/js/main.js`

- [ ] **Step 1: Write `js/export.js`**

```js
import { renderPreview } from './engines.js';
import { partColor } from './scene.js';

// Build a standalone SVG document string at w×h. Re-renders the scene into a
// detached svg with a viewBox re-derived for the target aspect ratio, then
// inlines every referenced <symbol> so the file is self-contained.
export function buildSvgDocument(scene, store, w, h) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);          // clip-path/use resolution needs it in-document
  renderPreview(svg, scene, store);

  // Re-derive viewBox for target aspect so tiling fills exactly & radial centers.
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
  const targetAR = w / h, srcAR = vw / vh;
  let nx = vx, ny = vy, nw = vw, nh = vh;
  if (targetAR > srcAR) { nw = vh * targetAR; nx = vx - (nw - vw) / 2; }
  else { nh = vw / targetAR; ny = vy - (nh - vh) / 2; }
  svg.setAttribute('viewBox', `${nx} ${ny} ${nw} ${nh}`);
  // widen background rects to the new viewBox
  svg.querySelectorAll('rect').forEach(r => {
    if (r.getAttribute('fill') === scene.palette.background || r.getAttribute('fill')?.startsWith('url(')) {
      r.setAttribute('x', nx); r.setAttribute('y', ny);
      r.setAttribute('width', nw); r.setAttribute('height', nh);
    }
  });

  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);

  // Inline every symbol referenced by the scene.
  const symbols = new Set(scene.chamber.parts.map(p =>
    store.symbolMarkup(p.partRef, partColor(scene, p))));
  const defsMarkup = `<defs>${[...symbols].join('')}</defs>`;
  const markup = svg.outerHTML.replace('>', `>${defsMarkup}`);
  svg.remove();
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const stamp = (scene) => `kaleidoscope-${scene.mode}-${scene.seed}`;

export function downloadSvg(scene, store, w = 2560, h = 1440) {
  const doc = buildSvgDocument(scene, store, w, h);
  download(new Blob([doc], { type: 'image/svg+xml' }), `${stamp(scene)}.svg`);
}

export function downloadPng(scene, store, w, h) {
  const doc = buildSvgDocument(scene, store, w, h);
  const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => download(blob, `${stamp(scene)}-${w}x${h}.png`), 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert('PNG export failed: SVG did not rasterize'); };
  img.src = url;
}
```

- [ ] **Step 2: Wire the export controls in `js/main.js`**

```js
import { downloadPng, downloadSvg } from './export.js';
// inside boot():
  const exportSize = () => {
    const v = $('ctl-export-preset').value;
    if (v === 'custom') return [+$('ctl-export-w').value, +$('ctl-export-h').value];
    return v.split('x').map(Number);
  };
  $('ctl-export-preset').onchange = (e) => {
    $('export-custom').hidden = e.target.value !== 'custom';
  };
  $('ctl-export-png').onclick = () => downloadPng(scene, store, ...exportSize());
  $('ctl-export-svg').onclick = () => downloadSvg(scene, store, ...exportSize());
```

- [ ] **Step 3: Verify exports.**
  - PNG at QHD in radial mode: downloads, opens at exactly 2560×1440, mandala centered, background fills edge-to-edge, parts crisp (vector-rasterized at full res, not scaled preview pixels).
  - PNG at iPhone preset in tiling p6m: portrait aspect, pattern fills fully, no seams.
  - SVG export: downloads, opens standalone in a fresh browser tab (file is self-contained — symbols inlined, no external refs), scales cleanly when zoomed.
  - Custom size 1000×1000 works.

- [ ] **Step 4: Commit**

```bash
git add kaleidoscope/js/export.js kaleidoscope/js/main.js
git commit -m "kaleidoscope: SVG and PNG wallpaper export"
```

---

### Task 15: Persistence, hash sharing, final polish

**Files:**
- Modify: `kaleidoscope/js/main.js`
- Modify: `kaleidoscope/js/scene.js` (only if bugs found)
- Modify: `kaleidoscope/README.md`

- [ ] **Step 1: Load persisted state on boot in `js/main.js`** — replace the scene initialization block:

```js
import { defaultScene, scatter, decodeHash, encodeHash, saveLocal, loadLocal } from './scene.js';
import { getPreset } from './palettes.js';

  let scene;
  const fromHash = decodeHash(location.hash);
  if (fromHash) {
    scene = { ...defaultScene(), ...fromHash, palette: getPreset(fromHash.paletteName) };
    if (!scene.partSet.length) scene.partSet = store.list.map(p => p.id);
    scatter(scene, store);          // hash = seed+knobs, so scatter reproduces it
  } else {
    scene = loadLocal();            // full state incl. tweaks
    if (!scene) {
      scene = defaultScene();
      scene.partSet = store.list.map(p => p.id);
      scatter(scene, store);
    }
  }
```

And keep the URL hash current — append to `update()`:

```js
    history.replaceState(null, '', encodeHash(scene));
```

- [ ] **Step 2: Verify persistence flows.**
  - Tweak a part, set a weird palette, reload (no hash → but `update()` writes one; clear it first via `location.href = location.pathname`): localStorage restores full state including the tweak.
  - Copy the URL, open in a private window: same composition minus tweaks (scatter reproduces from seed+knobs).
  - `?selftest` still fully passes.
  - Corrupt localStorage (`localStorage.setItem('kaleidoscope-scene-v1','{')`) and reload: page boots with defaults, no crash.

- [ ] **Step 3: Cross-check the spec** — walk `docs/superpowers/specs/2026-07-12-kaleidoscope-design.md` section by section against the implementation; fix gaps now (placeholder rects on missing assets, background in palette, tweaks surviving engine/palette switches, out-of-scope items *not* implemented).

- [ ] **Step 4: Update `kaleidoscope/README.md`** — add a Controls section documenting: drag/scroll/shift+scroll/Delete interactions, what rerolls vs what preserves tweaks, URL-hash sharing semantics (seed+knobs only), and localStorage autosave.

- [ ] **Step 5: Final selftest + visual pass** — `?selftest` all green; each mode/group renders; one PNG and one SVG export each open correctly.

- [ ] **Step 6: Commit**

```bash
git add kaleidoscope/
git commit -m "kaleidoscope: persistence, hash sharing, README polish"
```
