# Sky Models 2D Skyscape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expandable 2D skyscape view to each model strip in `sky-color/sky-models.html`, with three swappable projections (fisheye, equirectangular, sun-facing panorama) and a global time cursor.

**Architecture:** Refactor each model function to accept an arbitrary view direction (azimuth + elevation) instead of view elevation only. Strip rendering passes `viewAz = 0` so existing 1D output is unchanged. A new dome renderer maps each canvas pixel to a (viewAz, viewEl) through the active projection, calls the model, and writes the result via `ImageData`. A new global `selectedHour` controls dome render time, set by clicking/dragging on any strip. Disclosure controls in the strip headers toggle inline `.expanded-pane` divs that hold the dome canvas and a projection selector. Expand state and projection persist in `localStorage`.

**Tech Stack:** Single-file vanilla JS / HTML5 Canvas (no bundler, no framework). Edit only `sky-color/sky-models.html`.

**Testing approach:** This is a single-file HTML experiment with no test infrastructure. Each task ends with a manual verification step: open the file in a browser, exercise the new behavior, confirm strips and 2D views render correctly. The bar is "looks right and matches what the strip already shows for `viewAz = 0`."

---

## File Structure

All work happens in one file:

- **Modify**: `sky-color/sky-models.html`

Within that file, edits land in these regions (line numbers approximate, will drift as edits are made):

- **CSS block** (~lines 6–187): new styles for disclosure caret, expanded pane, projection selector, time cursor.
- **HTML body** (~lines 369–700, six `.strip-container` blocks): add caret button to each `.strip-header`; add `.expanded-pane` div after each strip's `.math-block`.
- **Math utilities** (~lines 1012–1090): add `viewDirFromAzEl` helper.
- **Model functions** (~lines 1151–1720): change each signature; replace γ/viewDir computation.
- **Render loop** (~lines 1776–1962): pass `viewAz = 0` through to models; draw the time cursor on each strip.
- **New code at end of `<script>`**: dome state, projection math, dome render, expand/collapse handlers, time-cursor handlers, localStorage persistence.

---

## Task 1: Add `viewDirFromAzEl` helper and switch Preetham to general γ

This is the smallest model change — Preetham already has γ in its math, just needs to be fed correctly. Doing it first proves the refactor pattern with the lowest risk, since the strip render still uses `viewAz = 0` which is identical to the old `|viewθ − sunθ|` formula along the sun's meridian.

**Files:**
- Modify: `sky-color/sky-models.html` (math utilities region ~line 1015; `preethamColor` ~lines 1151–1230; `renderAll` model dispatch ~lines 1888–1900)

- [ ] **Step 1: Add the helper near other math utilities**

Find the existing `lerp` definition:

```js
const lerp = (a, b, t) => a + (b - a) * t;
```

Add immediately after:

```js
// View direction vector from azimuth+elevation (degrees).
// Coordinates match the existing sky models: sun lives at +z meridian.
// x: east (perpendicular to sun meridian), y: up, z: toward sun horizontally.
// viewAz = 0 → in sun's vertical plane (same as legacy hardcoded viewDir).
function viewDirFromAzEl(azDeg, elDeg) {
  const az = azDeg * PI / 180;
  const el = elDeg * PI / 180;
  const ce = Math.cos(el);
  return [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)];
}

// Scattering angle γ between view and sun directions, both in radians.
// sunAz is assumed = 0 throughout this lab.
function scatteringAngle(sunElevRad, viewElDeg, viewAzDeg) {
  const ve = viewElDeg * PI / 180;
  const va = viewAzDeg * PI / 180;
  const cosG = Math.sin(sunElevRad) * Math.sin(ve) +
               Math.cos(sunElevRad) * Math.cos(ve) * Math.cos(va);
  return Math.acos(clamp(cosG, -1, 1));
}
```

- [ ] **Step 2: Change Preetham signature and γ calculation**

Find the current `preethamColor` signature:

```js
function preethamColor(sunElev, turbidity, viewElevDeg) {
```

Replace with:

```js
function preethamColor(sunElev, turbidity, viewElevDeg, viewAzDeg) {
```

Find the existing γ line (around line 1199):

```js
  // View direction
  const viewTheta = PI / 2 - deg(viewElevDeg); // view zenith angle
  const gamma = Math.abs(viewTheta - st); // simplified: view in sun's vertical plane
```

Replace with:

```js
  // View direction
  const viewTheta = PI / 2 - deg(viewElevDeg); // view zenith angle
  const gamma = scatteringAngle(sunElev, viewElevDeg, viewAzDeg || 0);
```

- [ ] **Step 3: Update the call site in `renderAll`**

Find the model dispatch block (around line 1888):

```js
        } else if (name === 'preetham') {
          contrib = preethamColor(sElev, T, ve);
```

Replace with:

```js
        } else if (name === 'preetham') {
          contrib = preethamColor(sElev, T, ve, 0);
```

- [ ] **Step 4: Verify strip output is unchanged**

Open `sky-color/sky-models.html` in a browser. The Preetham strip should look bit-identical to before this change (default sliders, default preset). Click around the Day-of-Year and Latitude sliders, confirm Preetham still produces the same colors as the other models do at viewAz = 0 along the sun's meridian.

If anything looks visibly different, the math is wrong — revisit the `scatteringAngle` derivation. Along the sun's meridian (viewAz = 0), `cosG = sin(sunEl)·sin(viewEl) + cos(sunEl)·cos(viewEl) = cos(sunEl − viewEl)`, so γ = |sunEl − viewEl| = |viewθ − sunθ|, which matches the old code.

- [ ] **Step 5: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Refactor Preetham to accept viewAz for 2D skyscape support"
```

---

## Task 2: Switch Hosek-Wilkie and CIE to general γ

Same pattern as Task 1 but for two more models.

**Files:**
- Modify: `sky-color/sky-models.html` (`hosekColor` ~line 1491; `cieClearColor` ~line 1602; `renderAll` dispatch)

- [ ] **Step 1: Change Hosek signature and view/sun vectors**

Find:

```js
function hosekColor(sunElev, turbidity, viewElevDeg, altitude, albedo) {
```

Replace with:

```js
function hosekColor(sunElev, turbidity, viewElevDeg, viewAzDeg, altitude, albedo) {
```

Find:

```js
  const ve = deg(viewElevDeg);
  const viewDir = [0, Math.sin(ve), Math.cos(ve)];
  const sunDir = [0, Math.sin(sunElev), Math.cos(sunElev)];
```

Replace with:

```js
  const viewDir = viewDirFromAzEl(viewAzDeg || 0, viewElevDeg);
  const sunDir = [0, Math.sin(sunElev), Math.cos(sunElev)];
```

- [ ] **Step 2: Change CIE signature and γ calculation**

Find:

```js
function cieClearColor(sunElev, turbidity, viewElevDeg) {
  if (sunElev < deg(-6)) return [0, 0, 0];
  const sunTheta = PI / 2 - sunElev;
  const viewTheta = PI / 2 - deg(viewElevDeg);
  const gamma = Math.abs(viewTheta - sunTheta);
```

Replace with:

```js
function cieClearColor(sunElev, turbidity, viewElevDeg, viewAzDeg) {
  if (sunElev < deg(-6)) return [0, 0, 0];
  const sunTheta = PI / 2 - sunElev;
  const viewTheta = PI / 2 - deg(viewElevDeg);
  const gamma = scatteringAngle(sunElev, viewElevDeg, viewAzDeg || 0);
```

- [ ] **Step 3: Update both call sites in `renderAll`**

Find:

```js
        } else if (name === 'cie') {
          contrib = cieClearColor(sElev, T, ve);
        } else {
          contrib = hosekColor(sElev, T, ve, alt, alb);
        }
```

Replace with:

```js
        } else if (name === 'cie') {
          contrib = cieClearColor(sElev, T, ve, 0);
        } else {
          contrib = hosekColor(sElev, T, ve, 0, alt, alb);
        }
```

- [ ] **Step 4: Verify strips unchanged**

Reload the page. Hosek-Wilkie and CIE strips must look identical to before. Test with a few different turbidity and latitude values to be sure.

- [ ] **Step 5: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Refactor Hosek-Wilkie and CIE to accept viewAz for 2D skyscape support"
```

---

## Task 3: Switch Nishita (and Rayleigh/Ozone variants) to general view direction

The three Nishita-family functions share the same hardcoded `viewDir = [0, sin(ve), cos(ve)]` line. Replace it with the helper.

**Files:**
- Modify: `sky-color/sky-models.html` (`nishitaColor` ~line 1394; `nishitaOzoneColor` ~line 1649; `renderAll` dispatch)

- [ ] **Step 1: Change `nishitaColor` signature and view direction**

Find:

```js
function nishitaColor(sunElev, turbidity, viewElevDeg, altitude, mieScale) {
```

Replace with:

```js
function nishitaColor(sunElev, turbidity, viewElevDeg, viewAzDeg, altitude, mieScale) {
```

Find:

```js
  // View direction (in sun's plane: x=toward sun horizontal, y=up)
  const ve = deg(viewElevDeg);
  const viewDir = [0, Math.sin(ve), Math.cos(ve)]; // looking south-ish at given elevation
```

Replace with:

```js
  // View direction from caller-specified (azimuth, elevation)
  const viewDir = viewDirFromAzEl(viewAzDeg || 0, viewElevDeg);
```

- [ ] **Step 2: Change `nishitaOzoneColor` signature and view direction**

Find:

```js
function nishitaOzoneColor(sunElev, turbidity, viewElevDeg, altitude, ozoneStrength) {
```

Replace with:

```js
function nishitaOzoneColor(sunElev, turbidity, viewElevDeg, viewAzDeg, altitude, ozoneStrength) {
```

Find:

```js
  const ve = deg(viewElevDeg);
  const viewDir = [0, Math.sin(ve), Math.cos(ve)];
```

Replace with:

```js
  const viewDir = viewDirFromAzEl(viewAzDeg || 0, viewElevDeg);
```

- [ ] **Step 3: Update three call sites in `renderAll`**

Find:

```js
        if (name === 'rayleigh') {
          contrib = nishitaColor(sElev, T, ve, alt, 0);
        } else if (name === 'preetham') {
          contrib = preethamColor(sElev, T, ve, 0);
        } else if (name === 'nishita') {
          contrib = nishitaColor(sElev, T, ve, alt);
        } else if (name === 'ozone') {
          contrib = nishitaOzoneColor(sElev, T, ve, alt, ozone);
```

Replace with:

```js
        if (name === 'rayleigh') {
          contrib = nishitaColor(sElev, T, ve, 0, alt, 0);
        } else if (name === 'preetham') {
          contrib = preethamColor(sElev, T, ve, 0);
        } else if (name === 'nishita') {
          contrib = nishitaColor(sElev, T, ve, 0, alt);
        } else if (name === 'ozone') {
          contrib = nishitaOzoneColor(sElev, T, ve, 0, alt, ozone);
```

- [ ] **Step 4: Verify strips unchanged**

Reload. Rayleigh, Nishita, and Ozone strips must look identical to before. Try a few presets (Earth, Mars, Tatooine multi-star) — multi-star presets exercise the per-star loop in the dispatch.

- [ ] **Step 5: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Refactor Nishita/Rayleigh/Ozone to accept viewAz for 2D skyscape support"
```

---

## Task 4: Add a global time cursor on all strips

`selectedHour` is needed before we add the dome (the dome renders at `selectedHour`), and the cursor is visible regardless of whether anything is expanded.

**Files:**
- Modify: `sky-color/sky-models.html` (CSS, strip render loop, end of script)

- [ ] **Step 1: Add cursor styles to the CSS block**

Find the existing strip CSS:

```css
canvas.strip { width: 100%; height: 70px; border-radius: 6px; display: block; }
```

Add immediately after:

```css
.strip-wrap { position: relative; }
.time-cursor {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: rgba(255,255,255,0.5); pointer-events: none;
  transform: translateX(-0.5px);
}
.time-cursor::before {
  content: ''; position: absolute; top: -2px; left: -4px;
  width: 0; height: 0;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 6px solid rgba(255,255,255,0.7);
  pointer-events: auto; cursor: ew-resize;
}
canvas.strip { cursor: crosshair; }
```

- [ ] **Step 2: Wrap each strip canvas in a `.strip-wrap`**

There are six `.strip-container` blocks. In each one, find:

```html
  <canvas class="strip" id="cRayleigh"></canvas>
```

Replace with:

```html
  <div class="strip-wrap">
    <canvas class="strip" id="cRayleigh"></canvas>
    <div class="time-cursor" id="curRayleigh"></div>
  </div>
```

Do the same for `cPreetham`/`curPreetham`, `cNishita`/`curNishita`, `cHosek`/`curHosek`, `cOzone`/`curOzone`, `cCie`/`curCie`.

- [ ] **Step 3: Add `selectedHour` state and cursor update function**

Just before the existing `function renderAll() {` line, add:

```js
let selectedHour = 12.0;
const cursors = {
  rayleigh: document.getElementById('curRayleigh'),
  preetham: document.getElementById('curPreetham'),
  nishita:  document.getElementById('curNishita'),
  hosek:    document.getElementById('curHosek'),
  ozone:    document.getElementById('curOzone'),
  cie:      document.getElementById('curCie'),
};

function updateTimeCursors() {
  const frac = (selectedHour - HOUR_START) / (HOUR_END - HOUR_START);
  const pct = clamp(frac, 0, 1) * 100;
  for (const el of Object.values(cursors)) el.style.left = pct + '%';
}
```

- [ ] **Step 4: Call `updateTimeCursors()` at the end of `renderAll`**

Find the end of `renderAll` (the closing `}` after the time-axis loop, around line 1962). Just before the closing `}`, add:

```js
  updateTimeCursors();
```

- [ ] **Step 5: Wire click/drag handlers on each strip canvas**

At the very end of the `<script>` block (after `renderAll();` initial call), add:

```js
function hourFromEvent(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
  return HOUR_START + x * (HOUR_END - HOUR_START);
}

let scrubbing = false;
for (const [name, canvas] of Object.entries(canvases)) {
  canvas.addEventListener('mousedown', (ev) => {
    scrubbing = true;
    selectedHour = hourFromEvent(canvas, ev);
    updateTimeCursors();
    scheduleDomeRender();
    ev.preventDefault();
  });
}
window.addEventListener('mousemove', (ev) => {
  if (!scrubbing) return;
  // Use whichever canvas the cursor is over (fallback to first)
  const target = ev.target.closest && ev.target.closest('canvas.strip');
  const canvas = target || canvases.rayleigh;
  selectedHour = hourFromEvent(canvas, ev);
  updateTimeCursors();
  scheduleDomeRender();
});
window.addEventListener('mouseup', () => { scrubbing = false; });
```

Note: `scheduleDomeRender` is defined in Task 5 but is forward-referenced here. Until Task 5 lands, replace the two `scheduleDomeRender();` calls above with `/* dome render later */`. **Or**, equivalently, define a stub now:

```js
function scheduleDomeRender() { /* implemented in Task 5 */ }
```

Pick the stub approach so the file stays runnable between tasks.

- [ ] **Step 6: Verify**

Reload. Each strip shows a thin white vertical line at the noon position with a small triangle handle at the top. Clicking on any strip moves the line; click-and-drag scrubs it across all strips in sync. Cursor stays inside the strip on drag.

- [ ] **Step 7: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Add global time cursor on all sky model strips"
```

---

## Task 5: Add disclosure controls, expanded panes, and a fisheye dome renderer

This is the biggest task. It adds the UI for expanding a strip and renders the first projection (fisheye). Equirectangular and sun-facing are added in Task 6 with minimal changes — Task 5 establishes the renderer plumbing.

**Files:**
- Modify: `sky-color/sky-models.html` (CSS, HTML, end of script)

- [ ] **Step 1: Add CSS for caret, expanded pane, dome canvas, projection selector**

In the CSS block, add at the end (just before `</style>`):

```css
.strip-header { display: flex; gap: 8px; align-items: baseline; }
.expand-caret {
  background: none; border: none; color: #aaa; cursor: pointer;
  font-size: 0.9rem; padding: 0 4px; line-height: 1;
  transition: transform 0.15s; flex-shrink: 0;
}
.expand-caret.open { transform: rotate(90deg); }
.expanded-pane {
  display: none; margin-top: 12px; padding-top: 12px;
  border-top: 1px solid #2a3a5a;
}
.expanded-pane.open { display: block; }
.proj-selector { display: flex; gap: 4px; margin-bottom: 10px; }
.proj-btn {
  background: #1a1a2e; border: 1px solid #2a3a5a; color: #aaa;
  border-radius: 4px; padding: 4px 10px; cursor: pointer;
  font-size: 0.75rem;
}
.proj-btn.active { background: #2a4a6a; border-color: #7ec8e3; color: #fff; }
.proj-btn:hover:not(.active) { background: #2a3a5a; color: #ddd; }
canvas.dome { display: block; background: #0a0a14; border-radius: 6px; }
.dome-caption {
  font-size: 0.72rem; color: #888; margin-top: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dome-wrap {
  display: flex; flex-direction: column; align-items: center;
}
```

The existing `.strip-header` rule (around line 64) currently uses `display: flex; justify-content: space-between`. The new flex layout above changes alignment so the caret can sit at the left. Find the existing rule:

```css
  .strip-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 8px;
  }
```

Replace with:

```css
  .strip-header {
    display: flex; align-items: baseline; gap: 10px;
    margin-bottom: 8px;
  }
  .strip-header .strip-desc { margin-left: auto; }
```

The `margin-left: auto` pushes the description to the right edge, preserving the previous justify-between visual.

- [ ] **Step 2: Add caret button and expanded pane to each strip**

For each of the six strips, in the `.strip-header`, prepend a caret button. The current header is e.g.:

```html
  <div class="strip-header">
    <span class="strip-title">Rayleigh Only</span>
    <span class="strip-desc">Nishita with Mie scattering disabled — pure molecular scattering baseline</span>
  </div>
```

Replace with:

```html
  <div class="strip-header">
    <button class="expand-caret" data-model="rayleigh">▸</button>
    <span class="strip-title">Rayleigh Only</span>
    <span class="strip-desc">Nishita with Mie scattering disabled — pure molecular scattering baseline</span>
  </div>
```

Do the same for the other five strips. Use `data-model` values: `preetham`, `nishita`, `hosek`, `ozone`, `cie`.

Then, after each strip's `.math-block` (the existing `</div>` that closes `.math-block`), add the expanded pane. For Rayleigh, find:

```html
    <div class="math-cell">
      <div class="math-label">No Mie Term</div>
      <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
        <mrow>
          <msub><mi>&beta;</mi><mi>M</mi></msub><mo>=</mo><mn>0</mn>
        </mrow>
      </math>
    </div>
  </div>
</div>
```

(The last two `</div>`s close `.math-block` and `.strip-container`.) Insert the expanded pane between those two closing divs:

```html
    <div class="math-cell">
      <div class="math-label">No Mie Term</div>
      <math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
        <mrow>
          <msub><mi>&beta;</mi><mi>M</mi></msub><mo>=</mo><mn>0</mn>
        </mrow>
      </math>
    </div>
  </div>
  <div class="expanded-pane" data-model="rayleigh">
    <div class="proj-selector">
      <button class="proj-btn active" data-proj="fisheye">Fisheye</button>
      <button class="proj-btn" data-proj="equirect">Panorama 360°</button>
      <button class="proj-btn" data-proj="sunfacing">Sun-facing</button>
    </div>
    <div class="dome-wrap">
      <canvas class="dome" data-model="rayleigh" width="480" height="480"></canvas>
      <div class="dome-caption" data-model="rayleigh"></div>
    </div>
  </div>
</div>
```

Repeat for the other five strips, changing `data-model` and matching the strip's last math-block content (each strip has its own math equations).

- [ ] **Step 3: Add dome state, model dispatch, and projection math**

At the end of the `<script>` block, before the `// Wrap each slider…` line, add:

```js
// =========================================================================
// 2D Dome / skyscape rendering
// =========================================================================

const domeState = {
  // model name -> { expanded: bool, projection: 'fisheye'|'equirect'|'sunfacing' }
  rayleigh: { expanded: false, projection: 'fisheye' },
  preetham: { expanded: false, projection: 'fisheye' },
  nishita:  { expanded: false, projection: 'fisheye' },
  hosek:    { expanded: false, projection: 'fisheye' },
  ozone:    { expanded: false, projection: 'fisheye' },
  cie:      { expanded: false, projection: 'fisheye' },
};

const DOME_STORAGE_KEY = 'sky-models-dome-state-v1';
try {
  const saved = JSON.parse(localStorage.getItem(DOME_STORAGE_KEY) || '{}');
  for (const k of Object.keys(domeState)) {
    if (saved[k]) Object.assign(domeState[k], saved[k]);
  }
} catch (_) { /* ignore */ }

function persistDomeState() {
  try { localStorage.setItem(DOME_STORAGE_KEY, JSON.stringify(domeState)); }
  catch (_) { /* ignore */ }
}

// Call a model with full (sunElev, sunAz=0, viewEl, viewAz, ...)
function modelCall(name, sElev, T, viewEl, viewAz, alt, alb, ozone) {
  if (name === 'rayleigh') return nishitaColor(sElev, T, viewEl, viewAz, alt, 0);
  if (name === 'preetham') return preethamColor(sElev, T, viewEl, viewAz);
  if (name === 'nishita')  return nishitaColor(sElev, T, viewEl, viewAz, alt);
  if (name === 'hosek')    return hosekColor(sElev, T, viewEl, viewAz, alt, alb);
  if (name === 'ozone')    return nishitaOzoneColor(sElev, T, viewEl, viewAz, alt, ozone);
  if (name === 'cie')      return cieClearColor(sElev, T, viewEl, viewAz);
  return [0, 0, 0];
}

// Map pixel (px, py) in a canvas of (w, h) to (viewAz, viewEl) in degrees,
// or null if pixel is outside the sky (below horizon / outside fisheye disk).
function pixelToViewAzEl(projection, px, py, w, h) {
  if (projection === 'fisheye') {
    const cx = w / 2, cy = h / 2;
    const dx = (px - cx) / cx;       // -1..1
    const dy = (py - cy) / cy;       // -1..1
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > 1) return null;
    const viewEl = (1 - r) * 90;
    const viewAz = Math.atan2(dx, -dy) * 180 / PI;  // up on screen = away from sun
    return [viewAz, viewEl];
  }
  if (projection === 'equirect') {
    const viewAz = (px / w) * 360 - 180;
    const viewEl = 90 - (py / h) * 100;             // last 10% is below horizon
    if (viewEl < 0) return null;
    return [viewAz, viewEl];
  }
  if (projection === 'sunfacing') {
    const viewAz = (px / w) * 180 - 90;
    const viewEl = 90 - (py / h) * 100;
    if (viewEl < 0) return null;
    return [viewAz, viewEl];
  }
  return null;
}

// Project a (viewAz, viewEl) in degrees back to pixel coords. Used for sun disk.
// Returns [px, py, visible] where visible is false if the point is outside the canvas.
function viewAzElToPixel(projection, viewAz, viewEl, w, h) {
  if (viewEl < 0) return [0, 0, false];
  if (projection === 'fisheye') {
    const r = 1 - viewEl / 90;
    const az = viewAz * PI / 180;
    const dx = r * Math.sin(az);
    const dy = -r * Math.cos(az);
    return [w / 2 + dx * (w / 2), h / 2 + dy * (h / 2), true];
  }
  if (projection === 'equirect') {
    // Wrap viewAz into -180..180
    let a = ((viewAz + 180) % 360 + 360) % 360 - 180;
    const px = (a + 180) / 360 * w;
    const py = (90 - viewEl) / 100 * h;
    return [px, py, true];
  }
  if (projection === 'sunfacing') {
    if (viewAz < -90 || viewAz > 90) return [0, 0, false];
    const px = (viewAz + 90) / 180 * w;
    const py = (90 - viewEl) / 100 * h;
    return [px, py, true];
  }
  return [0, 0, false];
}

const GROUND_COLOR = [26, 26, 31]; // dark ground, matches #1a1a1f-ish

function renderDome(name) {
  const state = domeState[name];
  if (!state.expanded) return;
  const canvas = document.querySelector(`canvas.dome[data-model="${name}"]`);
  if (!canvas) return;
  const caption = document.querySelector(`.dome-caption[data-model="${name}"]`);

  // Read controls
  const T = parseFloat(document.getElementById('turbidity').value);
  const lat = parseFloat(document.getElementById('latitude').value);
  const doySlider = parseInt(document.getElementById('dayOfYear').value);
  const doy = ((doySlider - 1 + 354) % 365) + 1;
  const alb = parseFloat(document.getElementById('albedo').value);
  const ozone = parseFloat(document.getElementById('ozoneStrength').value);
  const alt = 0;
  const style = {
    hueShift:     parseFloat(document.getElementById('hueShift').value),
    saturation:   parseFloat(document.getElementById('saturation').value),
    vibrance:     parseFloat(document.getElementById('vibrance').value),
    exposure:     parseFloat(document.getElementById('exposure').value),
    contrast:     parseFloat(document.getElementById('contrast').value),
    warmth:       parseFloat(document.getElementById('warmth').value),
    twilightGlow: parseFloat(document.getElementById('twilightGlow').value),
    nightTint:    parseFloat(document.getElementById('nightTint').value),
  };
  const preset = PRESETS[activePreset];

  // Adjust canvas size for projection
  if (state.projection === 'fisheye') {
    canvas.width = 480; canvas.height = 480;
  } else {
    canvas.width = 480; canvas.height = 240;
  }
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const nStars = activeStars.length;
  const primaryStar = activeStars[0];
  const primarySunElev = sunElevation(lat, doy, selectedHour + primaryStar.hourOffset);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;
      const ve = pixelToViewAzEl(state.projection, px, py, w, h);
      if (!ve) {
        data[idx]     = GROUND_COLOR[0];
        data[idx + 1] = GROUND_COLOR[1];
        data[idx + 2] = GROUND_COLOR[2];
        data[idx + 3] = 255;
        continue;
      }
      const [viewAz, viewEl] = ve;
      let rgb = [0, 0, 0];
      for (let si = 0; si < nStars; si++) {
        const star = activeStars[si];
        const sElev = sunElevation(lat, doy, selectedHour + star.hourOffset);
        const contrib = modelCall(name, sElev, T, viewEl, viewAz, alt, alb, ozone);
        rgb[0] += contrib[0] * star.color[0] * star.intensity;
        rgb[1] += contrib[1] * star.color[1] * star.intensity;
        rgb[2] += contrib[2] * star.color[2] * star.intensity;
      }
      if (preset.scatterTweak) {
        let [hh, ss, ll] = rgbToHsl(clamp(rgb[0],0,255), clamp(rgb[1],0,255), clamp(rgb[2],0,255));
        hh += preset.scatterTweak.hueShift / 360;
        ss *= preset.scatterTweak.satBoost;
        ss = clamp(ss, 0, 1);
        rgb = hslToRgb(hh, ss, ll);
      }
      rgb = applyStyle(rgb, primarySunElev, style);
      data[idx]     = clamp(Math.round(rgb[0]), 0, 255);
      data[idx + 1] = clamp(Math.round(rgb[1]), 0, 255);
      data[idx + 2] = clamp(Math.round(rgb[2]), 0, 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Sun disk pass — one per star, in its own color.
  for (const star of activeStars) {
    const sElev = sunElevation(lat, doy, selectedHour + star.hourOffset);
    if (sElev <= 0) continue;
    const sAz = 0; // sun lives at viewAz = 0 by convention
    const sunElDeg = sElev * 180 / PI;
    const [sx, sy, vis] = viewAzElToPixel(state.projection, sAz, sunElDeg, w, h);
    if (!vis) continue;
    // ~2° disk; pixels-per-degree depends on projection
    const pxPerDeg = state.projection === 'fisheye'
      ? (w / 2) / 90
      : w / (state.projection === 'sunfacing' ? 180 : 360);
    const rDisk = Math.max(2, pxPerDeg * 1.0);
    const rGlow = rDisk * 4;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, rGlow);
    const [sr, sg, sb] = star.color;
    grad.addColorStop(0, `rgba(${Math.round(sr*255)},${Math.round(sg*255)},${Math.round(sb*255)},1)`);
    grad.addColorStop(rDisk / rGlow, `rgba(${Math.round(sr*255)},${Math.round(sg*255)},${Math.round(sb*255)},0.9)`);
    grad.addColorStop(1, `rgba(${Math.round(sr*255)},${Math.round(sg*255)},${Math.round(sb*255)},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sx, sy, rGlow, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Caption
  if (caption) {
    const hr = Math.floor(selectedHour);
    const mn = Math.round((selectedHour - hr) * 60);
    const hhmm = `${String(hr).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
    const sunElDeg = (primarySunElev * 180 / PI).toFixed(0);
    caption.textContent = `${hhmm} · sun elev ${sunElDeg}°`;
  }
}

let domeRaf = null;
let domeTimer = null;
function scheduleDomeRender() {
  if (domeTimer) clearTimeout(domeTimer);
  domeTimer = setTimeout(() => {
    if (domeRaf) cancelAnimationFrame(domeRaf);
    domeRaf = requestAnimationFrame(() => {
      for (const name of Object.keys(domeState)) {
        if (domeState[name].expanded) renderDome(name);
      }
    });
  }, 150);
}

// Caret + projection button wiring
function setExpanded(name, open) {
  domeState[name].expanded = open;
  const pane = document.querySelector(`.expanded-pane[data-model="${name}"]`);
  const caret = document.querySelector(`.expand-caret[data-model="${name}"]`);
  if (pane) pane.classList.toggle('open', open);
  if (caret) caret.classList.toggle('open', open);
  persistDomeState();
  if (open) renderDome(name); // immediate render on expand
}
function setProjection(name, proj) {
  domeState[name].projection = proj;
  const pane = document.querySelector(`.expanded-pane[data-model="${name}"]`);
  if (pane) {
    pane.querySelectorAll('.proj-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.proj === proj);
    });
  }
  persistDomeState();
  renderDome(name);
}

document.querySelectorAll('.expand-caret').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.model;
    setExpanded(name, !domeState[name].expanded);
  });
});
document.querySelectorAll('.expanded-pane .proj-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const pane = btn.closest('.expanded-pane');
    const name = pane.dataset.model;
    setProjection(name, btn.dataset.proj);
  });
});

// Restore expanded state and active projection from storage on load
for (const name of Object.keys(domeState)) {
  const s = domeState[name];
  if (s.expanded) {
    const pane = document.querySelector(`.expanded-pane[data-model="${name}"]`);
    const caret = document.querySelector(`.expand-caret[data-model="${name}"]`);
    if (pane) pane.classList.add('open');
    if (caret) caret.classList.add('open');
  }
  const pane = document.querySelector(`.expanded-pane[data-model="${name}"]`);
  if (pane) {
    pane.querySelectorAll('.proj-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.proj === s.projection);
    });
  }
}
// Initial dome render for any restored-open panes
scheduleDomeRender();
```

- [ ] **Step 4: Replace the stub `scheduleDomeRender` from Task 4**

The stub function `function scheduleDomeRender() { /* implemented in Task 5 */ }` added in Task 4 must now be removed — it would shadow the real one. Delete the stub line if present.

- [ ] **Step 5: Verify fisheye dome**

Reload. Each strip header now has a `▸` caret. Click it on Preetham — the caret rotates and a 480×480 fisheye canvas appears below, showing a circular sky with a bright spot where the sun is. The horizon ring is the edge of the disk; the zenith is in the middle. Outside the disk is dark gray (ground). Caption reads `12:00 · sun elev N°`. Drag the time cursor on any strip — the dome catches up ~150ms after release. Expand Hosek too — both panes render. Toggle close and re-open: works.

The "Panorama 360°" and "Sun-facing" buttons exist but render as fisheye for now — that's intentional, fixed in Task 6.

Refresh the page — the previously expanded panes stay expanded (localStorage).

- [ ] **Step 6: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Add expandable 2D fisheye skyscape view for each sky model"
```

---

## Task 6: Wire up equirectangular and sun-facing panorama projections

The renderer in Task 5 already handles all three projection cases through `pixelToViewAzEl` / `viewAzElToPixel`. The only work left is to test those branches end-to-end, since Task 5 verified fisheye but not the others. If any bugs surface they'll be small fixes in the projection math.

**Files:**
- Modify: `sky-color/sky-models.html` (likely no edits; verify behavior)

- [ ] **Step 1: Test equirectangular**

Reload. Expand Preetham, click "Panorama 360°". Canvas changes to 480×240, showing a panorama with the sun centered horizontally, sky above, narrow ground strip at the bottom (the last 10% of the height). The sky color gradient should be smooth left-to-right (no wrap seam at ±180°). Zenith is at the top edge.

- [ ] **Step 2: Test sun-facing**

Click "Sun-facing". Canvas stays 480×240. The sun is centered. Image only covers ±90° of azimuth (front hemisphere). Sun should look slightly bigger than in 360° mode because pixels-per-degree doubled.

- [ ] **Step 3: Cross-check radial symmetry along the sun meridian**

In all three projections, pixels along the sun's vertical meridian (viewAz = 0) should be the exact colors the 1D strip shows for that view elevation at this time. Visual check: in equirectangular, the central vertical column should grade smoothly from horizon color at the bottom to zenith color at the top, matching what a viewer of the strip would imagine the slice through the sun looks like.

- [ ] **Step 4: Sanity-check multi-star presets**

Switch to the Tatooine preset. Expand Preetham. There should be two sun disks at different positions (one for each star, separated by the hour offset). Switch to Namek (triple G-type) and confirm three disks.

- [ ] **Step 5: If any bug surfaces, fix it inline**

Most likely failure modes and their fixes:

- **Sun in wrong position in fisheye**: the `atan2(dx, -dy)` convention in `pixelToViewAzEl` puts "up on screen = north (away from sun)". If the sun appears at the *top* of the disk instead of the bottom, swap `atan2(dx, -dy)` to `atan2(dx, dy)` (or vice versa) in *both* `pixelToViewAzEl` and `viewAzElToPixel`.
- **Equirectangular has a discontinuity at the seam**: `viewAz` wrapping logic in `viewAzElToPixel` is the suspect. The current `((viewAz + 180) % 360 + 360) % 360 - 180` handles wrap, but if sun disk straddles the seam it'll only draw on one side. That's acceptable for v1; no fix needed.
- **Sun-facing crops the sun**: check that the disk's `rGlow` extension doesn't push the disk off-canvas — if it does, clamp the gradient radii at the canvas edge or skip drawing.

- [ ] **Step 6: Commit (if any fixes were made)**

```bash
git add sky-color/sky-models.html
git commit -m "Verify and stabilize panorama projections for 2D skyscape"
```

If no edits were needed, skip the commit. Note this in the task closure.

---

## Task 7: Performance pass — coarse render during time scrubbing

Six expanded panes × 480² fisheye × Nishita raymarching can take 2–3 seconds. During an active drag (`scrubbing === true`) we want responsive feedback. Render at half resolution while scrubbing; upscale.

**Files:**
- Modify: `sky-color/sky-models.html` (`renderDome` and `scheduleDomeRender`)

- [ ] **Step 1: Add a coarse render mode to `renderDome`**

Find the canvas size assignment in `renderDome`:

```js
  if (state.projection === 'fisheye') {
    canvas.width = 480; canvas.height = 480;
  } else {
    canvas.width = 480; canvas.height = 240;
  }
  const w = canvas.width, h = canvas.height;
```

Replace with:

```js
  const fullW = state.projection === 'fisheye' ? 480 : 480;
  const fullH = state.projection === 'fisheye' ? 480 : 240;
  canvas.width = fullW; canvas.height = fullH;
  const coarse = scrubbing; // top-level `scrubbing` flag from Task 4
  const step = coarse ? 4 : 1; // render every 4th pixel during scrub
  const w = fullW, h = fullH;
```

Then change the per-pixel loop to use `step`:

Find:

```js
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
```

Replace with:

```js
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
```

And inside the pixel loop, after computing the final color values, replicate the pixel into a `step × step` block. Find the four `data[idx + N] = ...` lines and the `data[idx + 3] = 255;`. Replace the assignment block:

```js
      data[idx]     = clamp(Math.round(rgb[0]), 0, 255);
      data[idx + 1] = clamp(Math.round(rgb[1]), 0, 255);
      data[idx + 2] = clamp(Math.round(rgb[2]), 0, 255);
      data[idx + 3] = 255;
```

With:

```js
      const r = clamp(Math.round(rgb[0]), 0, 255);
      const g = clamp(Math.round(rgb[1]), 0, 255);
      const b = clamp(Math.round(rgb[2]), 0, 255);
      for (let dy = 0; dy < step && py + dy < h; dy++) {
        for (let dx = 0; dx < step && px + dx < w; dx++) {
          const j = ((py + dy) * w + (px + dx)) * 4;
          data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = 255;
        }
      }
```

Also update the ground-color branch in the same way — find:

```js
      if (!ve) {
        data[idx]     = GROUND_COLOR[0];
        data[idx + 1] = GROUND_COLOR[1];
        data[idx + 2] = GROUND_COLOR[2];
        data[idx + 3] = 255;
        continue;
      }
```

Replace with:

```js
      if (!ve) {
        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const j = ((py + dy) * w + (px + dx)) * 4;
            data[j] = GROUND_COLOR[0];
            data[j + 1] = GROUND_COLOR[1];
            data[j + 2] = GROUND_COLOR[2];
            data[j + 3] = 255;
          }
        }
        continue;
      }
```

- [ ] **Step 2: Drive `_scrubbing` from the strip drag handlers**

Find the mousedown handler added in Task 4:

```js
  canvas.addEventListener('mousedown', (ev) => {
    scrubbing = true;
    selectedHour = hourFromEvent(canvas, ev);
    updateTimeCursors();
    scheduleDomeRender();
    ev.preventDefault();
  });
```

Replace with:

```js
  canvas.addEventListener('mousedown', (ev) => {
    scrubbing = true;
    selectedHour = hourFromEvent(canvas, ev);
    updateTimeCursors();
    scheduleDomeRender(50);
    ev.preventDefault();
  });
```

And the mouseup handler:

```js
window.addEventListener('mouseup', () => { scrubbing = false; });
```

Replace with:

```js
window.addEventListener('mouseup', () => {
  if (scrubbing) {
    scrubbing = false;
    scheduleDomeRender(0); // final full-res render
  }
});
```

- [ ] **Step 3: Update `scheduleDomeRender` to accept a delay argument**

Find:

```js
function scheduleDomeRender() {
  if (domeTimer) clearTimeout(domeTimer);
  domeTimer = setTimeout(() => {
```

Replace with:

```js
function scheduleDomeRender(delayMs) {
  if (domeTimer) clearTimeout(domeTimer);
  const delay = delayMs == null ? 150 : delayMs;
  domeTimer = setTimeout(() => {
```

- [ ] **Step 4: Verify**

Reload. Expand a couple of panes. Drag the time cursor on a strip — domes update during drag at coarse resolution (visibly blocky, ~120² effective). Release — within ~150ms domes re-render at full resolution. Smooth feel during drag.

- [ ] **Step 5: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Add coarse-resolution dome rendering during time cursor scrub"
```

---

## Task 8: Polish — caret affordance, mobile width, final review

Small fit-and-finish items.

**Files:**
- Modify: `sky-color/sky-models.html` (CSS)

- [ ] **Step 1: Make the dome canvas responsive on narrow viewports**

In the CSS block, add:

```css
canvas.dome { max-width: 100%; height: auto; }
@media (max-width: 600px) {
  canvas.dome { width: 100%; }
}
```

- [ ] **Step 2: Hide the caret if a strip is collapsed but ensure hover affordance**

Find:

```css
.expand-caret {
  background: none; border: none; color: #aaa; cursor: pointer;
  font-size: 0.9rem; padding: 0 4px; line-height: 1;
  transition: transform 0.15s; flex-shrink: 0;
}
```

Replace with:

```css
.expand-caret {
  background: none; border: none; color: #7ec8e3; cursor: pointer;
  font-size: 0.95rem; padding: 0 4px; line-height: 1;
  transition: transform 0.15s; flex-shrink: 0; opacity: 0.7;
}
.expand-caret:hover { opacity: 1; }
```

- [ ] **Step 3: Manual end-to-end check**

Run through these scenarios in order:

1. Fresh load (clear localStorage first: `localStorage.removeItem('sky-models-dome-state-v1')` in DevTools, then reload). All strips look unchanged from before this feature. Time cursor at noon on all six.
2. Expand each model in turn. Each renders fisheye correctly.
3. Switch each to "Panorama 360°" — all six render.
4. Switch each to "Sun-facing" — all six render.
5. Drag the time cursor across the day — domes scrub coarse, then full-res on release.
6. Move the turbidity / albedo / ozone sliders with all six expanded — strips update instantly, domes catch up after debounce.
7. Switch presets (Earth → Mars → Tatooine → Namek). Domes track preset changes. Multi-star presets show multiple suns.
8. Reload page mid-session. Expanded state and per-pane projections restored.
9. Resize browser narrow (mobile-ish). Dome canvases shrink to container width.

- [ ] **Step 4: Commit**

```bash
git add sky-color/sky-models.html
git commit -m "Polish dome view: responsive canvas, caret hover affordance"
```

---

## Notes on coordinate conventions and γ

The legacy strip code computed γ as `|viewθ − sunθ|` while assuming "view in sun's vertical plane." Along that meridian, the great-circle angle between view and sun *is* exactly `|sunEl − viewEl|`, so the legacy formula was correct for the 1D case. The new `scatteringAngle(sunElev, viewEl, viewAz)` reduces to the same value when `viewAz = 0`, so all six strip outputs are bit-identical before and after the refactor. Off the meridian, the new formula is the proper spherical-trig angle that Preetham/Hosek/CIE expect.

The sun is fixed at `(sunAz = 0)` in this lab's coordinate system. This is a coordinate convention, not a model limitation. The dome view is always centered on (or includes) the sun meridian.

## Coordinate-system rotation in fisheye

In the fisheye `pixelToViewAzEl`, `viewAz = atan2(dx, -dy)` places `viewAz = 0` (the sun direction) at the *bottom* of the disk. If user feedback suggests rotating so the sun is at the top (or wherever feels more natural), change the sign on `-dy` and update `viewAzElToPixel`'s fisheye branch to match.
