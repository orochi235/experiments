# Sky Color WebGL Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the single-file sky-color CSS/Canvas2D experiment to a Vite project that renders all six atmospheric scattering models as WebGL2 fragment shaders, with a stacked Canvas2D overlay for incidentals.

**Architecture:** Per-panel pair of stacked canvases (WebGL2 + Canvas2D). Twelve fragment-shader programs (6 strips + 6 domes) assembled from chunks via `vite-plugin-glsl`'s `#include`. Plain-JS state store. Single shared full-screen-quad VAO. Multi-star handled with bounded uniform arrays in shader. Overlay (sun arcs, horizon, sun glow, time cursor) drawn on Canvas2D.

**Tech Stack:** Vite, `vite-plugin-glsl`, WebGL2, vanilla JS/DOM/Canvas2D. No framework, no FBOs, no LUTs.

**Source project:** `~/src/experiments/sky-color/sky-models.html` (read-only reference)
**Target directory:** `~/src/experiments/sky-color-gl/` (this repo)

**Spec:** [`../specs/2026-05-11-webgl-port-design.md`](../specs/2026-05-11-webgl-port-design.md)

**Testing note:** Per the spec, there are **no formal tests**. The QA loop for each task is: implement → run dev server → eyeball the result in a browser → commit. Use Chrome DevTools console for shader compile errors.

---

## Task 1: Scaffold Vite project

**Files:**
- Create: `~/src/experiments/sky-color-gl/package.json`
- Create: `~/src/experiments/sky-color-gl/vite.config.js`
- Create: `~/src/experiments/sky-color-gl/.gitignore`
- Create: `~/src/experiments/sky-color-gl/index.html` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sky-color-gl",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "vite-plugin-glsl": "^1.3.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [glsl({ compress: false, watch: true })],
  server: { open: false },
});
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules
dist
.DS_Store
*.log
```

- [ ] **Step 4: Create minimal `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Sky Color Models — WebGL</title>
<style>
  body { margin: 0; background: #1a1a2e; color: #e0e0e0;
         font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="hello" width="400" height="200"></canvas>
<script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Install and verify**

```bash
cd ~/src/experiments/sky-color-gl
npm install
```

Expected: installs without errors. `node_modules/` appears.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js .gitignore index.html
git commit -m "chore: scaffold Vite project"
```

---

## Task 2: "Hello triangle" — verify WebGL2 + Vite GLSL pipeline

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/main.js`
- Create: `~/src/experiments/sky-color-gl/src/shaders/hello.vert.glsl`
- Create: `~/src/experiments/sky-color-gl/src/shaders/hello.frag.glsl`

- [ ] **Step 1: Create vertex shader `src/shaders/hello.vert.glsl`**

```glsl
#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
```

- [ ] **Step 2: Create fragment shader `src/shaders/hello.frag.glsl`**

```glsl
#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  fragColor = vec4(uv.x, uv.y, 0.5, 1.0);
}
```

- [ ] **Step 3: Create `src/main.js`**

```js
import vertSrc from './shaders/hello.vert.glsl';
import fragSrc from './shaders/hello.frag.glsl';

const canvas = document.getElementById('hello');
const gl = canvas.getContext('webgl2');
if (!gl) { document.body.textContent = 'WebGL2 not available'; throw new Error('no webgl2'); }

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertSrc));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(prog));
}

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

gl.useProgram(prog);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.uniform2f(gl.getUniformLocation(prog, 'uResolution'), canvas.width, canvas.height);
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

Note: this uses a fullscreen *triangle* (3 verts), not a quad. Standard trick — overdraws ~50% but avoids extra vertex setup.

- [ ] **Step 4: Run dev server, verify**

```bash
cd ~/src/experiments/sky-color-gl
npm run dev
```

Open the printed URL in a browser. Expected: a 400×200 yellow-to-pink gradient. Console should show no errors.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: hello-triangle WebGL2 + vite-plugin-glsl smoke test"
```

---

## Task 3: Extract GL utilities into `src/render/gl.js`

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/render/gl.js`
- Modify: `~/src/experiments/sky-color-gl/src/main.js`

- [ ] **Step 1: Create `src/render/gl.js`**

```js
// Shared WebGL2 helpers: program compile/link, fullscreen-triangle VAO,
// uniform location caching. All panels reuse the same VAO (the verts are
// generic enough that no per-program attribute binding is needed).

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 not available');
  return gl;
}

export function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    throw new Error(`shader compile failed:\n${log}\n\n--- source ---\n${src}`);
  }
  return s;
}

export function linkProgram(gl, vertSrc, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

export function makeFullscreenTriangle(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, attrName: 'aPos' };
}

// Cache uniform locations on the program object itself.
export function u(gl, prog, name) {
  if (!prog._u) prog._u = {};
  if (prog._u[name] === undefined) prog._u[name] = gl.getUniformLocation(prog, name);
  return prog._u[name];
}
```

- [ ] **Step 2: Rewrite `src/main.js` to use the helpers**

```js
import vertSrc from './shaders/hello.vert.glsl';
import fragSrc from './shaders/hello.frag.glsl';
import { createGL, linkProgram, makeFullscreenTriangle, u } from './render/gl.js';

const canvas = document.getElementById('hello');
const gl = createGL(canvas);
const prog = linkProgram(gl, vertSrc, fragSrc);
const { vao, attrName } = makeFullscreenTriangle(gl);

gl.bindVertexArray(vao);
const aPos = gl.getAttribLocation(prog, attrName);
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

gl.useProgram(prog);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.uniform2f(u(gl, prog, 'uResolution'), canvas.width, canvas.height);
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

- [ ] **Step 3: Verify in browser**

Reload the dev URL. Expected: same yellow-to-pink gradient. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "refactor: extract WebGL helpers into render/gl.js"
```

---

## Task 4: Port `stars.js` from source HTML

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/stars.js`

The source HTML contains these functions/constants:
- `PI`, `TAU` (line 1169)
- `viewDirFromAzEl` (line 1178)
- `scatteringAngle` (line 1187)
- `sunElevation` (line 1196)
- `sunPos` (line 1206)
- `angleDiffRad` (line 1218)
- `blackbodyRGB` (line 1432, ~30 lines)
- Atmosphere constants: `EARTH_R`, `ATMO_R`, `HR`, `HM`, `BETA_R`, `BETA_M`, `SUN_INTENSITY` (lines 1415–1421)

- [ ] **Step 1: Create `src/stars.js`**

Copy each function verbatim from the source HTML at the line ranges above. Wrap atmosphere constants in `export let` declarations (they are mutated by `applyPresetPhysics`). Export everything.

```js
// Source: ~/src/experiments/sky-color/sky-models.html lines 1169, 1178, 1187,
// 1196, 1206, 1218, 1415-1421, 1432.
// Copy verbatim; convert `let` constants to `export let`, functions to `export function`.

export const PI = Math.PI;
export const TAU = 2 * PI;

// ... viewDirFromAzEl, scatteringAngle, sunElevation, sunPos, angleDiffRad

export let EARTH_R = 6371e3;
export let ATMO_R = 6471e3;
export let HR = 8000;
export let HM = 1200;
export let BETA_R = [5.5e-6, 13.0e-6, 22.4e-6];
export let BETA_M = 21e-6;
export let SUN_INTENSITY = 20;

// ... blackbodyRGB

// Helper used by presets.js to mutate atmosphere constants:
export function setAtmosphere({ earthR, atmoR, hr, hm, betaR, betaM, sunIntensity }) {
  if (earthR != null) EARTH_R = earthR;
  if (atmoR != null) ATMO_R = atmoR;
  if (hr != null) HR = hr;
  if (hm != null) HM = hm;
  if (betaR != null) BETA_R = betaR;
  if (betaM != null) BETA_M = betaM;
  if (sunIntensity != null) SUN_INTENSITY = sunIntensity;
}
```

- [ ] **Step 2: Smoke test in console**

Add a temporary import in `main.js`:
```js
import * as stars from './stars.js';
console.log('sunElev at noon, 40°lat, doy=183:', stars.sunElevation(40, 183, 12) * 180 / stars.PI);
console.log('blackbody 5778K:', stars.blackbodyRGB(5778));
```

Reload the dev URL, check console. Expected: sun elevation ~73° (Northern summer noon, mid-latitude), blackbody for 5778K close to `[1.0, 0.95, 0.9]` roughly. Remove the temporary lines.

- [ ] **Step 3: Commit**

```bash
git add src/stars.js src/main.js
git commit -m "feat: port stars.js (sun position, blackbody RGB, atmosphere constants)"
```

---

## Task 5: Port `presets.js`

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/presets.js`

Source HTML contains:
- `PRESETS` table (line 1463, ~110 lines, 17 presets)
- `applyPresetPhysics` (line 1928, ~40 lines)
- Initial `activeStars` definition (line 1578)

- [ ] **Step 1: Create `src/presets.js`**

Copy the `PRESETS` table verbatim from source line 1463 onward (locate end by reading the file). Copy `applyPresetPhysics` from line 1928. Convert references like `EARTH_R = ...` inside `applyPresetPhysics` to use the imported `setAtmosphere` helper from `stars.js`.

```js
// Source: ~/src/experiments/sky-color/sky-models.html lines 1463 (PRESETS),
// 1928 (applyPresetPhysics).

import { setAtmosphere, blackbodyRGB } from './stars.js';

export const PRESETS = {
  // ... copy verbatim from source
};

export function applyPresetPhysics(presetName, atmoDensity, sunDist, stellarTemp) {
  // ... copy verbatim, but rewrite mutations of EARTH_R/ATMO_R/HR/HM/BETA_R/BETA_M/SUN_INTENSITY
  // to call setAtmosphere({...}) instead.
  // Returns { activeStars, stellarColor } so the caller can update state.
}
```

The source's `applyPresetPhysics` mutates module-scope variables (`activeStars`, `stellarColor`). Convert it to return them as a result so `state.js` owns the data.

- [ ] **Step 2: Smoke test in console**

```js
import * as presets from './presets.js';
const r = presets.applyPresetPhysics('earth', 1, 1, 5778);
console.log('earth stars:', r.activeStars);
const m = presets.applyPresetPhysics('tatooine', 1, 1, 5778);
console.log('tatooine stars (binary):', m.activeStars);
```

Reload dev URL. Expected: `earth` returns one star; `tatooine` returns two stars with different hourOffsets/temps.

- [ ] **Step 3: Commit**

```bash
git add src/presets.js
git commit -m "feat: port presets.js with 17 preset planets and applyPresetPhysics"
```

---

## Task 6: Create `state.js` skeleton + `scheduleRender` stub

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/state.js`

- [ ] **Step 1: Create `src/state.js`**

```js
import { applyPresetPhysics } from './presets.js';

export const state = {
  // Atmosphere
  T: 3, lat: 40, doy: 183, hour: 12.0, viewEl: 90,
  albedo: 0.3, ozone: 1, alt: 0,

  // Style
  style: {
    hueShift: 0, saturation: 1, vibrance: 0, exposure: 0,
    contrast: 1, warmth: 0, twilightGlow: 0, nightTint: 0,
  },

  // Preset / planet physics
  preset: 'earth',
  atmoDens: 1, sunDist: 1, stellarTemp: 5778,

  // Stars (filled by applyPresetPhysics)
  stars: [{ temp: 5778, intensity: 1, hourOffset: 0, color: [1, 1, 1] }],
  stellarColor: [1, 1, 1],

  // Per-dome state (projection, expanded)
  dome: {
    rayleigh: { expanded: false, projection: 'fisheye' },
    preetham: { expanded: false, projection: 'fisheye' },
    nishita:  { expanded: false, projection: 'fisheye' },
    hosek:    { expanded: false, projection: 'fisheye' },
    ozone:    { expanded: false, projection: 'fisheye' },
    cie:      { expanded: false, projection: 'fisheye' },
  },
};

let renderFn = null;
let rafPending = false;

export function setRenderFn(fn) { renderFn = fn; }

export function scheduleRender() {
  if (rafPending || !renderFn) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderFn();
  });
}

export function applyPreset(name) {
  state.preset = name;
  const r = applyPresetPhysics(name, state.atmoDens, state.sunDist, state.stellarTemp);
  state.stars = r.activeStars;
  state.stellarColor = r.stellarColor;
  scheduleRender();
}

export function setStateValue(path, value) {
  const parts = path.split('.');
  let o = state;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
  scheduleRender();
}
```

- [ ] **Step 2: No verify step (no UI yet); commit**

```bash
git add src/state.js
git commit -m "feat: add state store and scheduleRender debouncer"
```

---

## Task 7: Build shared shader chunk `common.glsl`

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/shaders/common.glsl`

This is the single most important shader file. It declares uniforms and provides all helpers used by every model shader.

- [ ] **Step 1: Create `src/shaders/common.glsl`**

```glsl
// Shared declarations and helpers for all model shaders.
// Included at the top of every strip_<model>.glsl and dome_<model>.glsl.

precision highp float;
out vec4 fragColor;

const float PI  = 3.14159265358979;
const float TAU = 6.28318530717958;

// Common uniforms
uniform vec2  uResolution;

// Atmosphere
uniform float uT;          // turbidity
uniform float uAlbedo;
uniform float uOzone;
uniform float uAlt;        // altitude in meters

// Strip-only
uniform float uViewElDeg;
uniform float uHourStart;
uniform float uHourEnd;
uniform float uLat;
uniform float uDoy;

// Dome-only
uniform int uProjection;   // 0=fisheye, 1=equirect, 2=sunfacing

// Stars (multi-star summation, up to 4)
const int MAX_STARS = 4;
uniform int   uNStars;
uniform float uStarElev[MAX_STARS];      // radians (precomputed JS-side per panel kind)
uniform float uStarAzOff[MAX_STARS];     // degrees, relative to primary
uniform vec3  uStarColor[MAX_STARS];     // linear RGB 0..1
uniform float uStarIntensity[MAX_STARS];

// Strip only: per-star hour offset so each fragment can recompute its own sun elev
uniform float uStarHourOffset[MAX_STARS];

// Scatter tweak (preset's exotic-sky post-physics adjust)
uniform float uScatterHueShift;
uniform float uScatterSatBoost;

// Style
uniform float uHueShift, uSaturation, uVibrance, uExposure,
              uContrast, uWarmth, uTwilightGlow, uNightTint;

// Ground color (for fisheye-outside-disc and below-horizon)
const vec3 GROUND_COLOR = vec3(26.0, 26.0, 31.0);

// --- Color space helpers ----------------------------------------------------

// Port of JS YxyToRGB (source ~line 1223).
vec3 YxyToRGB(float Y, float x, float y) {
  // Translate JS function line-for-line here.
  // (Plan author: paste the JS body, replace `Math.*` with GLSL builtins.)
  return vec3(0.0);  // PLACEHOLDER — replace in implementation
}

// Port of toneMapAndGamma (source ~line 1235).
vec3 toneMap(vec3 rgb, float exposure) {
  // PLACEHOLDER
  return rgb;
}

// Port of rgbToHsl (source ~line 1249).
vec3 rgbToHsl(vec3 c) {
  // PLACEHOLDER
  return vec3(0.0);
}

// Port of hslToRgb (source ~line 1264).
vec3 hslToRgb(vec3 hsl) {
  // PLACEHOLDER
  return vec3(0.0);
}

// Port of applyStyle (source ~line 1279).
vec3 applyStyle(vec3 rgb, float primarySunElev) {
  // PLACEHOLDER
  return rgb;
}

// Scatter tweak (HSL-space hue shift + sat boost, identity when (0, 1)).
vec3 applyScatterTweak(vec3 rgb) {
  if (uScatterHueShift == 0.0 && uScatterSatBoost == 1.0) return rgb;
  vec3 hsl = rgbToHsl(clamp(rgb, 0.0, 255.0));
  hsl.x = fract(hsl.x + uScatterHueShift / 360.0);
  hsl.y = clamp(hsl.y * uScatterSatBoost, 0.0, 1.0);
  return hslToRgb(hsl);
}

// Port of scatteringAngle (source ~line 1187).
float scatteringAngle(float sunElevRad, float viewElDeg, float viewAzDeg) {
  // PLACEHOLDER
  return 0.0;
}

// Pixel → (viewAz, viewEl) in degrees. Returns false if outside fisheye disc.
// Port of pixelToViewAzEl (source ~line 2391).
bool pixelToViewAzEl(vec2 px, vec2 dims, out float viewAz, out float viewEl) {
  // PLACEHOLDER — switch on uProjection (0/1/2)
  viewAz = 0.0; viewEl = 0.0;
  return true;
}

// Strip-only: compute hour for this fragment, then sun elevation per star.
float fragHour() {
  return mix(uHourStart, uHourEnd, gl_FragCoord.x / uResolution.x);
}

// Port of sunElevation (source ~line 1196).
float sunElevationAt(float hour) {
  // PLACEHOLDER
  return 0.0;
}

// Each model declares its own modelColor() function in its own .glsl.
```

**This is intentionally placeholder-heavy** because every helper is a verbatim port. The implementation step is the actual transliteration. Doing it now in one go is faster than spreading it across six tasks where each model "fills in" a helper.

- [ ] **Step 2: Replace every PLACEHOLDER with the GLSL port of the corresponding JS function**

For each helper, open the source HTML at the line range, read the JS, and write the equivalent GLSL:

- `YxyToRGB` ← source line 1223 (12 lines). JS uses `Math.exp`. GLSL: `exp()`.
- `toneMap` ← source line 1235 (toneMapAndGamma, 14 lines). JS uses `Math.pow`, `Math.exp`. GLSL: `pow`, `exp`. Note the JS function returns 0–255 floats; keep that here.
- `rgbToHsl` ← source line 1249 (15 lines). All `Math.max`/`Math.min`/`Math.abs` → GLSL builtins.
- `hslToRgb` ← source line 1264 (15 lines).
- `applyStyle` ← source line 1279 (~68 lines). Has `if (sunElev < ...)` branches — GLSL supports these. Uses `Math.sin`, `Math.cos`, `Math.exp`, `Math.pow`.
- `scatteringAngle` ← source line 1187 (9 lines). Uses `Math.cos`, `Math.sin`, `Math.acos`.
- `pixelToViewAzEl` ← source line 2391 (28 lines). Three branches by projection mode. Convert `if/else if` chain to GLSL `if/else if`. Returns `null` in JS for outside-disc; here, return false.
- `sunElevationAt` ← source line 1196 (10 lines).

Style notes: keep variable names identical to the JS; comment any non-obvious math identically. The whole file should end up ~250–300 lines of GLSL.

- [ ] **Step 3: Sanity-check compilation**

Won't run yet (no shader uses it standalone). Verify by adding a temp test shader that does `fragColor = vec4(YxyToRGB(1.0, 0.31, 0.33) / 255.0, 1.0);` and loading it through the existing hello-triangle path. Expected: a flat warm-ish white panel, no compile errors in console. Remove the temp shader after.

- [ ] **Step 4: Commit**

```bash
git add src/shaders/common.glsl
git commit -m "feat: port shared shader helpers to common.glsl (color spaces, projection, style)"
```

---

## Task 8: Strip `main()` and first model shader (`preetham`)

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/shaders/strip_main.glsl`
- Create: `~/src/experiments/sky-color-gl/src/shaders/preetham.glsl`
- Create: `~/src/experiments/sky-color-gl/src/shaders/strip_preetham.glsl`
- Create: `~/src/experiments/sky-color-gl/src/shaders/vert.glsl`

Why preetham first: it's the simplest of the realistic models (no ray-marching, just Perez coefficients). Good way to wire up the full pipeline before tackling Nishita's ray-sphere math.

- [ ] **Step 1: Create vertex shader `src/shaders/vert.glsl` (shared by all programs)**

```glsl
#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
```

(This replaces `hello.vert.glsl`.)

- [ ] **Step 2: Create `src/shaders/preetham.glsl`**

Port the JS `preethamColor` function (source line 1347, ~24 lines including the nested `perezCoeffs` and `perez` helpers). All-analytic — no LUTs, no ray marching.

```glsl
// Source: ~/src/experiments/sky-color/sky-models.html lines 1347-1414.
// Perez/Preetham analytic clear-sky model.

float perez(float A, float B, float C, float D, float E, float theta, float gamma) {
  // Source line 1387 helper
  return (1.0 + A * exp(B / cos(theta))) * (1.0 + C * exp(D * gamma) + E * cos(gamma) * cos(gamma));
}

vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  // ... transliterate verbatim from preethamColor
  // Returns RGB in 0..255 range to match JS contract.
}
```

The Perez A..E coefficients for x, Y, y channels are computed inline via `perezCoeffs(a0, a1, a2, a3, a4)` in the JS source (line 1371). In GLSL, just inline the `a0 + a1*T` math directly — six channels (Y, x, y) × five coefficients × turbidity-dependence.

- [ ] **Step 3: Create `src/shaders/strip_main.glsl`**

```glsl
// Strip rendering: x → hour → sun elev (per star) → modelColor → blend stars → style.

void main() {
  float hour = fragHour();
  vec3 rgb = vec3(0.0);
  float primaryElev = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uNStars) break;
    float sElev = sunElevationAt(hour + uStarHourOffset[i]);
    if (i == 0) primaryElev = sElev;
    vec3 c = modelColor(sElev, uT, uViewElDeg, 0.0, uAlt, uAlbedo, uOzone);
    rgb += c * uStarColor[i] * uStarIntensity[i];
  }
  rgb = applyScatterTweak(rgb);
  rgb = applyStyle(rgb, primaryElev);
  fragColor = vec4(clamp(rgb, 0.0, 255.0) / 255.0, 1.0);
}
```

- [ ] **Step 4: Create `src/shaders/strip_preetham.glsl`**

```glsl
#version 300 es
#include "./common.glsl"
#include "./preetham.glsl"
#include "./strip_main.glsl"
```

- [ ] **Step 5: Wire into `main.js` to verify**

Replace the hello-triangle shader pair with `vert.glsl` + `strip_preetham.glsl`. Set uniforms to sensible defaults (turbidity 3, lat 40, doy 183, hourStart 3, hourEnd 22, viewEl 90, nStars 1, star[0] = elev N/A here but the strip computes it itself, color [1,1,1], intensity 1, hourOffset 0, identity scatter tweak, identity style).

```js
// Sketch — final wiring lives in main.js once panels exist
gl.useProgram(prog);
gl.uniform2f(u(gl, prog, 'uResolution'), canvas.width, canvas.height);
gl.uniform1f(u(gl, prog, 'uT'), 3.0);
gl.uniform1f(u(gl, prog, 'uLat'), 40.0);
gl.uniform1f(u(gl, prog, 'uDoy'), 183.0);
gl.uniform1f(u(gl, prog, 'uHourStart'), 3.0);
gl.uniform1f(u(gl, prog, 'uHourEnd'), 22.0);
gl.uniform1f(u(gl, prog, 'uViewElDeg'), 90.0);
gl.uniform1i(u(gl, prog, 'uNStars'), 1);
gl.uniform1fv(u(gl, prog, 'uStarElev'), new Float32Array(4));
gl.uniform1fv(u(gl, prog, 'uStarAzOff'), new Float32Array(4));
gl.uniform3fv(u(gl, prog, 'uStarColor'), new Float32Array([1,1,1, 0,0,0, 0,0,0, 0,0,0]));
gl.uniform1fv(u(gl, prog, 'uStarIntensity'), new Float32Array([1,0,0,0]));
gl.uniform1fv(u(gl, prog, 'uStarHourOffset'), new Float32Array(4));
gl.uniform1f(u(gl, prog, 'uScatterHueShift'), 0.0);
gl.uniform1f(u(gl, prog, 'uScatterSatBoost'), 1.0);
gl.uniform1f(u(gl, prog, 'uHueShift'), 0.0);
gl.uniform1f(u(gl, prog, 'uSaturation'), 1.0);
gl.uniform1f(u(gl, prog, 'uVibrance'), 0.0);
gl.uniform1f(u(gl, prog, 'uExposure'), 0.0);
gl.uniform1f(u(gl, prog, 'uContrast'), 1.0);
gl.uniform1f(u(gl, prog, 'uWarmth'), 0.0);
gl.uniform1f(u(gl, prog, 'uTwilightGlow'), 0.0);
gl.uniform1f(u(gl, prog, 'uNightTint'), 0.0);
gl.uniform1f(u(gl, prog, 'uAlbedo'), 0.3);
gl.uniform1f(u(gl, prog, 'uOzone'), 1.0);
gl.uniform1f(u(gl, prog, 'uAlt'), 0.0);
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

Resize the canvas in HTML to width 800, height 70 to match a typical strip.

- [ ] **Step 6: Verify in browser**

Expected: a 800×70 horizontal gradient that goes dark at edges (night, sun far below horizon) and bright blue in the middle (noon). Matches the look of the strip in `sky-models.html` for the Preetham row.

Compare side-by-side with the original page if anything looks off.

- [ ] **Step 7: Commit**

```bash
git add src/shaders/
git commit -m "feat: first end-to-end shader — Preetham strip"
```

---

## Task 9: Dome `main()` and dome Preetham

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/shaders/dome_main.glsl`
- Create: `~/src/experiments/sky-color-gl/src/shaders/dome_preetham.glsl`

- [ ] **Step 1: Create `src/shaders/dome_main.glsl`**

```glsl
// Dome rendering: (px, py) → (viewAz, viewEl) per projection mode →
// modelColor with per-star sun elev and az offset → blend → style.

void main() {
  float viewAz, viewEl;
  bool inside = pixelToViewAzEl(gl_FragCoord.xy, uResolution, viewAz, viewEl);
  if (!inside) {
    fragColor = vec4(GROUND_COLOR / 255.0, 1.0);
    return;
  }
  vec3 rgb = vec3(0.0);
  float primaryElev = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uNStars) break;
    float sElev = uStarElev[i];
    if (i == 0) primaryElev = sElev;
    vec3 c = modelColor(sElev, uT, viewEl, viewAz - uStarAzOff[i],
                       uAlt, uAlbedo, uOzone);
    rgb += c * uStarColor[i] * uStarIntensity[i];
  }
  rgb = applyScatterTweak(rgb);
  rgb = applyStyle(rgb, primaryElev);
  fragColor = vec4(clamp(rgb, 0.0, 255.0) / 255.0, 1.0);
}
```

- [ ] **Step 2: Create `src/shaders/dome_preetham.glsl`**

```glsl
#version 300 es
#include "./common.glsl"
#include "./preetham.glsl"
#include "./dome_main.glsl"
```

- [ ] **Step 3: Swap `main.js` to this shader temporarily**

Use a 480×480 canvas, set `uProjection=0` (fisheye), compute primary star elev JS-side using `stars.sunElevation(40, 183, 12)` and write it to `uStarElev[0]`.

- [ ] **Step 4: Verify in browser**

Expected: a fisheye sky disc — bright blue overhead, ground color outside the disc, brightening toward the sun. Compare with the original page's Preetham fisheye dome.

Then change `uProjection=1` (equirect, canvas 960×480) and `uProjection=2` (sunfacing, 960×480) and re-verify each.

- [ ] **Step 5: Commit**

```bash
git add src/shaders/dome_main.glsl src/shaders/dome_preetham.glsl src/main.js
git commit -m "feat: dome Preetham renders in all 3 projection modes"
```

---

## Task 10: Build `programs.js` — compile and cache all model programs

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/render/programs.js`

By now we've proved the pipeline works for one model. Time to build the registry.

- [ ] **Step 1: Create `src/render/programs.js`**

```js
import { linkProgram } from './gl.js';

import vertSrc from '../shaders/vert.glsl';

import sRayleigh from '../shaders/strip_rayleigh.glsl';
import sPreetham from '../shaders/strip_preetham.glsl';
import sNishita  from '../shaders/strip_nishita.glsl';
import sHosek    from '../shaders/strip_hosek.glsl';
import sOzone    from '../shaders/strip_ozone.glsl';
import sCie      from '../shaders/strip_cie.glsl';

import dRayleigh from '../shaders/dome_rayleigh.glsl';
import dPreetham from '../shaders/dome_preetham.glsl';
import dNishita  from '../shaders/dome_nishita.glsl';
import dHosek    from '../shaders/dome_hosek.glsl';
import dOzone    from '../shaders/dome_ozone.glsl';
import dCie      from '../shaders/dome_cie.glsl';

const STRIP_SRC = { rayleigh: sRayleigh, preetham: sPreetham, nishita: sNishita,
                    hosek: sHosek, ozone: sOzone, cie: sCie };
const DOME_SRC  = { rayleigh: dRayleigh, preetham: dPreetham, nishita: dNishita,
                    hosek: dHosek, ozone: dOzone, cie: dCie };

// Stubbed model shaders return solid magenta until their model is implemented.
// As each model's .glsl gets ported, the imports above will pick up the real code.

export function buildPrograms(gl) {
  const out = { strip: {}, dome: {} };
  for (const [name, src] of Object.entries(STRIP_SRC)) {
    if (!src) continue;
    try { out.strip[name] = linkProgram(gl, vertSrc, src); }
    catch (e) { console.warn(`strip_${name} skipped:`, e.message); }
  }
  for (const [name, src] of Object.entries(DOME_SRC)) {
    if (!src) continue;
    try { out.dome[name] = linkProgram(gl, vertSrc, src); }
    catch (e) { console.warn(`dome_${name} skipped:`, e.message); }
  }
  return out;
}
```

- [ ] **Step 2: Create stub shader files for the 5 unimplemented models**

For each of `rayleigh`, `nishita`, `hosek`, `ozone`, `cie`, create:

`src/shaders/<model>.glsl`:
```glsl
vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  return vec3(255.0, 0.0, 255.0);  // stub: magenta
}
```

`src/shaders/strip_<model>.glsl`:
```glsl
#version 300 es
#include "./common.glsl"
#include "./<model>.glsl"
#include "./strip_main.glsl"
```

`src/shaders/dome_<model>.glsl`:
```glsl
#version 300 es
#include "./common.glsl"
#include "./<model>.glsl"
#include "./dome_main.glsl"
```

- [ ] **Step 3: Smoke test**

In `main.js`, replace the single-program logic with:
```js
import { buildPrograms } from './render/programs.js';
const programs = buildPrograms(gl);
console.log('programs:', programs);
```

Reload. Expected: console shows `{ strip: { rayleigh, preetham, ... }, dome: { ... } }` with 12 programs. No compile errors.

- [ ] **Step 4: Commit**

```bash
git add src/render/programs.js src/shaders/
git commit -m "feat: program registry — 12 shaders compile (5 stubbed magenta)"
```

---

## Task 11: Port Nishita model

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/shaders/nishita.glsl`

Source: HTML lines 1580 (`raySphereIntersect`) and 1590 (`nishitaColor`, ~95 lines).

- [ ] **Step 1: Replace nishita.glsl stub with the port**

```glsl
// Source: ~/src/experiments/sky-color/sky-models.html lines 1580 (raySphereIntersect),
// 1590-1684 (nishitaColor).

// raySphereIntersect: returns vec2(tNear, tFar), or vec2(-1.0) if no hit.
// JS returns null; here we sentinel with negative.
vec2 raySphereIntersect(vec3 ro, vec3 rd, float r) {
  // ... port
  return vec2(-1.0);  // PLACEHOLDER
}

vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  // Port nishitaColor verbatim. Uses EARTH_R, ATMO_R, HR, HM, BETA_R, BETA_M,
  // SUN_INTENSITY — but in GLSL these become uniforms (added to common.glsl
  // in Task 12) OR hardcoded constants matching JS defaults.
  //
  // For now: hardcode the Earth defaults (line 1415-1421). The preset system
  // mutates these on the JS side; we'll thread them as uniforms in Task 12.
  //
  // ... port body
  return vec3(0.0);  // PLACEHOLDER
}
```

The JS function has a 16-step ray-march along the view ray and a 16-step shadow-march along the sun direction at each step. Straight loops in GLSL — fast.

- [ ] **Step 2: Verify in browser**

Point `main.js` at `dome_nishita.glsl` (or modify the panel logic so Nishita is the active panel). Expected: a more physically-correct gradient than Preetham — visible Rayleigh blue overhead, brighter horizon, no horizon discontinuity. Compare to original page's Nishita panel.

- [ ] **Step 3: Commit**

```bash
git add src/shaders/nishita.glsl
git commit -m "feat: port Nishita scattering model"
```

---

## Task 12: Add atmosphere uniforms (so presets work)

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/shaders/common.glsl`
- Modify: `~/src/experiments/sky-color-gl/src/shaders/nishita.glsl`
- Modify: `~/src/experiments/sky-color-gl/src/render/programs.js` (or wherever uniforms are bound — likely a new file `render/uniforms.js`)

Until now we've hardcoded Earth atmosphere constants in Nishita. To make presets affect Nishita-derived models, these need to be uniforms.

- [ ] **Step 1: Add uniforms to `common.glsl`**

```glsl
// Atmosphere physics (mutated by presets)
uniform float uEarthR;
uniform float uAtmoR;
uniform float uHR;
uniform float uHM;
uniform vec3  uBetaR;
uniform float uBetaM;
uniform float uSunIntensity;
```

- [ ] **Step 2: Replace hardcoded constants in `nishita.glsl` with uniforms**

- [ ] **Step 3: Create `src/render/uniforms.js`**

```js
import { u } from './gl.js';
import { EARTH_R, ATMO_R, HR, HM, BETA_R, BETA_M, SUN_INTENSITY } from '../stars.js';

// Set all uniforms common to every program from current state + derived data.
// Per-panel uniforms (uResolution, uProjection, uViewElDeg, uStar* etc.) are
// set separately by the caller.
export function setSharedUniforms(gl, prog, state) {
  gl.useProgram(prog);
  gl.uniform1f(u(gl, prog, 'uT'), state.T);
  gl.uniform1f(u(gl, prog, 'uAlbedo'), state.albedo);
  gl.uniform1f(u(gl, prog, 'uOzone'), state.ozone);
  gl.uniform1f(u(gl, prog, 'uAlt'), state.alt);
  gl.uniform1f(u(gl, prog, 'uLat'), state.lat);
  gl.uniform1f(u(gl, prog, 'uDoy'), state.doy);

  // Atmosphere physics (mutated by applyPresetPhysics)
  gl.uniform1f(u(gl, prog, 'uEarthR'), EARTH_R);
  gl.uniform1f(u(gl, prog, 'uAtmoR'), ATMO_R);
  gl.uniform1f(u(gl, prog, 'uHR'), HR);
  gl.uniform1f(u(gl, prog, 'uHM'), HM);
  gl.uniform3fv(u(gl, prog, 'uBetaR'), new Float32Array(BETA_R));
  gl.uniform1f(u(gl, prog, 'uBetaM'), BETA_M);
  gl.uniform1f(u(gl, prog, 'uSunIntensity'), SUN_INTENSITY);

  // Style
  gl.uniform1f(u(gl, prog, 'uHueShift'), state.style.hueShift);
  gl.uniform1f(u(gl, prog, 'uSaturation'), state.style.saturation);
  gl.uniform1f(u(gl, prog, 'uVibrance'), state.style.vibrance);
  gl.uniform1f(u(gl, prog, 'uExposure'), state.style.exposure);
  gl.uniform1f(u(gl, prog, 'uContrast'), state.style.contrast);
  gl.uniform1f(u(gl, prog, 'uWarmth'), state.style.warmth);
  gl.uniform1f(u(gl, prog, 'uTwilightGlow'), state.style.twilightGlow);
  gl.uniform1f(u(gl, prog, 'uNightTint'), state.style.nightTint);

  // Stars
  const n = Math.min(state.stars.length, 4);
  gl.uniform1i(u(gl, prog, 'uNStars'), n);
  const elev = new Float32Array(4), azOff = new Float32Array(4),
        color = new Float32Array(12), intensity = new Float32Array(4),
        hourOff = new Float32Array(4);
  for (let i = 0; i < n; i++) {
    const s = state.stars[i];
    elev[i] = s._elev ?? 0;          // filled in by recomputeDerived
    azOff[i] = s._azOff ?? 0;
    color[i*3] = s.color[0]; color[i*3+1] = s.color[1]; color[i*3+2] = s.color[2];
    intensity[i] = s.intensity;
    hourOff[i] = s.hourOffset;
  }
  gl.uniform1fv(u(gl, prog, 'uStarElev'), elev);
  gl.uniform1fv(u(gl, prog, 'uStarAzOff'), azOff);
  gl.uniform3fv(u(gl, prog, 'uStarColor'), color);
  gl.uniform1fv(u(gl, prog, 'uStarIntensity'), intensity);
  gl.uniform1fv(u(gl, prog, 'uStarHourOffset'), hourOff);

  // Scatter tweak (from preset)
  // Preset shape: PRESETS[name].scatterTweak = { hueShift, satBoost } | undefined
  const tweak = state.scatterTweak; // we'll add this to state in Task 19
  gl.uniform1f(u(gl, prog, 'uScatterHueShift'), tweak?.hueShift ?? 0);
  gl.uniform1f(u(gl, prog, 'uScatterSatBoost'), tweak?.satBoost ?? 1);
}
```

- [ ] **Step 4: Update main.js to use `setSharedUniforms`**

- [ ] **Step 5: Verify**

Run dev server, reload. Same Nishita output as before (Earth values are the defaults). No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/shaders/common.glsl src/shaders/nishita.glsl src/render/uniforms.js src/main.js
git commit -m "feat: atmosphere physics as uniforms (presets can now affect scattering)"
```

---

## Task 13: Port Rayleigh model

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/shaders/rayleigh.glsl`

Source: in the original JS, Rayleigh is rendered via `nishitaColor(..., mieScale=0)` (see source line 2098 in `renderAll`). So Rayleigh is Nishita with Mie scattering zeroed.

- [ ] **Step 1: Replace rayleigh.glsl stub**

```glsl
// Rayleigh-only: Nishita's model with Mie scattering zeroed.
// Source: ~/src/experiments/sky-color/sky-models.html line 2098.
// Includes the Nishita ray-march code inlined here; could share via #include,
// but keeping it copy-pasted lets us tune the mie-zero variant independently
// if needed.

vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  // ... same body as nishita.glsl modelColor BUT all Mie terms multiplied by 0
  // (or trivially: copy nishitaColor and force betaM = 0 locally).
  return vec3(0.0);  // PLACEHOLDER
}
```

Simpler implementation: just include `nishita.glsl` and wrap, but `vite-plugin-glsl` would then have two `modelColor` definitions in the same compilation unit. Easiest: copy-paste the body and set Mie contribution to 0.

- [ ] **Step 2: Verify**

Swap `main.js` to dome_rayleigh briefly. Expected: bluer sky than Nishita (no Mie haze near sun), darker horizon. No magenta.

- [ ] **Step 3: Commit**

```bash
git add src/shaders/rayleigh.glsl
git commit -m "feat: port Rayleigh model (Nishita with Mie=0)"
```

---

## Task 14: Port Hosek-Wilkie model

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/shaders/hosek.glsl`

Source: HTML line 1686, ~110 lines. Analytic (Cornette-Shanks phase function for Mie + Hosek coefficient formulas).

- [ ] **Step 1: Port verbatim**

The JS function uses a 9-coefficient formula per channel (A..I), each coefficient computed from turbidity and albedo via polynomial. All `Math.exp`, `Math.pow`, `Math.cos` → GLSL builtins.

- [ ] **Step 2: Verify**

Swap to dome_hosek. Expected: a sky qualitatively similar to Nishita but with slightly different horizon/zenith balance. Compare to original.

- [ ] **Step 3: Commit**

```bash
git add src/shaders/hosek.glsl
git commit -m "feat: port Hosek-Wilkie analytic model"
```

---

## Task 15: Port CIE Clear Sky model

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/shaders/cie.glsl`

Source: HTML line 1796, ~46 lines.

- [ ] **Step 1: Port verbatim**

CIE Clear Sky has fixed coefficients (no turbidity sweep) — simplest of the analytic models.

- [ ] **Step 2: Verify**

Swap to dome_cie. Expected: clean, slightly desaturated sky with characteristic CIE horizon brightness.

- [ ] **Step 3: Commit**

```bash
git add src/shaders/cie.glsl
git commit -m "feat: port CIE Clear Sky model"
```

---

## Task 16: Port Nishita+Ozone model

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/shaders/ozone.glsl`

Source: HTML line 1843, ~70 lines. Adds an ozone absorption term to Nishita's ray-march.

- [ ] **Step 1: Port verbatim**

Reads `uOzone` uniform for strength.

- [ ] **Step 2: Verify**

Swap to dome_ozone. Move ozone slider in original to compare. Expected: distinctive twilight purple/violet at sun elevations 0° to -8°.

- [ ] **Step 3: Commit**

```bash
git add src/shaders/ozone.glsl
git commit -m "feat: port Nishita+Ozone model"
```

---

## Task 17: HTML markup — all panels and controls

**Files:**
- Modify: `~/src/experiments/sky-color-gl/index.html`

Copy the body markup from the source HTML, stripped of inline `<style>` and `<script>`. Keep:
- `.controls` (turbidity, latitude, viewElev, dayOfYear, albedo, ozoneStrength) — drop the `iq` slider
- `.controls.style` (hueShift, saturation, vibrance, exposure, contrast, warmth, twilightGlow, nightTint)
- `.controls.planet` + preset picker buttons
- `.controls.planet` (atmoDensity, sunDistance, stellarTemp)
- The six `<section>` blocks, each with a strip canvas, a dome-frame containing a dome canvas + projection-toggle UI, and captions

Also copy the inline `<style>` block (source lines 5–230ish) into `src/styles.css`. Import it from `main.js`.

- [ ] **Step 1: Copy markup from source HTML body**

In `index.html`'s `<body>`, replace the single `<canvas id="hello">` with the full control panel + 6 sections. Remove:
- The `<div id="iqModal">` and the `iq` slider
- All `<script>` tags

For each strip and dome canvas, wrap in a positioned `<div class="panel-wrap">` and add a sibling `<canvas class="overlay">`:

```html
<div class="panel-wrap">
  <canvas class="strip gl" id="cRayleigh"></canvas>
  <canvas class="strip overlay" id="oRayleigh"></canvas>
</div>
```

with CSS:
```css
.panel-wrap { position: relative; }
.panel-wrap .overlay { position: absolute; top: 0; left: 0; pointer-events: none; }
```

- [ ] **Step 2: Move inline CSS into `src/styles.css`**

Copy source lines 5–230 (the inline `<style>` block) into `src/styles.css`. Add the panel-wrap rules above.

- [ ] **Step 3: Import CSS from main.js**

```js
import './styles.css';
```

- [ ] **Step 4: Verify**

Reload dev URL. Expected: the original layout appears — sliders, presets, six empty panels. No canvases rendering yet (no main.js wiring).

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/main.js
git commit -m "feat: import HTML/CSS from source — full layout, IQ joke dropped"
```

---

## Task 18: Wire slider DOM → state

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/ui/controls.js`

- [ ] **Step 1: Create `src/ui/controls.js`**

```js
import { state, setStateValue, applyPreset, scheduleRender } from '../state.js';

// Map: DOM id → state path + label-id + formatter
const SLIDERS = [
  { id: 'turbidity',     path: 'T',                  label: 'vTurb',   fmt: v => v.toFixed(1) },
  { id: 'latitude',      path: 'lat',                label: 'vLat',    fmt: v => v + '°' },
  { id: 'viewElev',      path: 'viewEl',             label: 'vElev',   fmt: v => v + '°' },
  { id: 'dayOfYear',     path: '_doySlider',         label: 'vDay',    fmt: v => `${v}` /* mapped to doy in scheduleRender */ },
  { id: 'albedo',        path: 'albedo',             label: 'vAlbedo', fmt: v => v.toFixed(2) },
  { id: 'ozoneStrength', path: 'ozone',              label: 'vOzone',  fmt: v => v.toFixed(2) },
  { id: 'hueShift',      path: 'style.hueShift',     label: 'vHue',    fmt: v => v + '°' },
  { id: 'saturation',    path: 'style.saturation',   label: 'vSat',    fmt: v => v.toFixed(2) },
  { id: 'vibrance',      path: 'style.vibrance',     label: 'vVib',    fmt: v => v.toFixed(2) },
  { id: 'exposure',      path: 'style.exposure',     label: 'vExp',    fmt: v => v.toFixed(1) },
  { id: 'contrast',      path: 'style.contrast',     label: 'vCont',   fmt: v => v.toFixed(2) },
  { id: 'warmth',        path: 'style.warmth',       label: 'vWarm',   fmt: v => v.toFixed(2) },
  { id: 'twilightGlow',  path: 'style.twilightGlow', label: 'vGlow',   fmt: v => v.toFixed(2) },
  { id: 'nightTint',     path: 'style.nightTint',    label: 'vNight',  fmt: v => v.toFixed(2) },
  { id: 'atmoDensity',   path: 'atmoDens',           label: 'vAtmoDens',  fmt: v => v.toFixed(2) },
  { id: 'sunDistance',   path: 'sunDist',            label: 'vSunDist',   fmt: v => v.toFixed(2) + ' AU' },
  { id: 'stellarTemp',   path: 'stellarTemp',        label: 'vStellarTemp', fmt: v => Math.round(v) + ' K' },
];

export function wireControls() {
  for (const s of SLIDERS) {
    const el = document.getElementById(s.id);
    if (!el) continue;
    const labelEl = document.getElementById(s.label);
    const update = () => {
      const v = parseFloat(el.value);
      setStateValue(s.path, v);
      if (labelEl) labelEl.textContent = s.fmt(v);

      // Day-of-year slider has a winter-solstice offset in the original.
      if (s.id === 'dayOfYear') {
        const doy = ((parseInt(el.value) - 1 + 354) % 365) + 1;
        state.doy = doy;
      }

      // Planet sliders re-apply preset physics
      if (s.id === 'atmoDensity' || s.id === 'sunDistance' || s.id === 'stellarTemp') {
        applyPreset(state.preset);
      }

      scheduleRender();
    };
    el.addEventListener('input', update);
    update();
  }

  // Preset buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });
}
```

- [ ] **Step 2: Call from main.js**

```js
import { wireControls } from './ui/controls.js';
wireControls();
```

- [ ] **Step 3: Verify**

Reload dev URL. Move sliders. Expected: value labels next to each slider update in real time. No render yet (next task).

- [ ] **Step 4: Commit**

```bash
git add src/ui/controls.js src/main.js
git commit -m "feat: wire slider DOM to state with live value labels"
```

---

## Task 19: Per-panel rendering — derive star geom, render visible panels, link sliders to redraw

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/main.js`
- Modify: `~/src/experiments/sky-color-gl/src/render/gl.js` (add `recomputeDerived`)
- Modify: `~/src/experiments/sky-color-gl/src/state.js` (add `scatterTweak` field; remember to thread through to uniforms)

- [ ] **Step 1: Add `recomputeDerived` to `src/render/gl.js`**

```js
import { sunPos, sunElevation, angleDiffRad, PI } from '../stars.js';

// Fill state.stars[i]._elev and _azOff for the current hour/lat/doy.
// Primary star sits at azOff = 0; secondaries are offset by their hourOffset
// projected onto the sky.
export function recomputeDerived(state, selectedHour) {
  const lat = state.lat, doy = state.doy;
  const primaryPos = sunPos(lat, doy, selectedHour + state.stars[0].hourOffset);
  for (const s of state.stars) {
    const p = sunPos(lat, doy, selectedHour + s.hourOffset);
    s._elev = p[0];
    s._azOff = angleDiffRad(p[1], primaryPos[1]) * 180 / PI;
  }
  state._primarySunElev = primaryPos[0];
}
```

- [ ] **Step 2: Add `scatterTweak` to state**

In `src/state.js`, in `applyPreset()`, after retrieving the preset:
```js
import { PRESETS } from './presets.js';
// ...
export function applyPreset(name) {
  state.preset = name;
  const preset = PRESETS[name];
  state.scatterTweak = preset.scatterTweak || null;
  // ... rest unchanged
}
```

- [ ] **Step 3: Build panel registry in main.js**

```js
import { state, scheduleRender, setRenderFn } from './state.js';
import { createGL, makeFullscreenTriangle } from './render/gl.js';
import { buildPrograms } from './render/programs.js';
import { setSharedUniforms } from './render/uniforms.js';
import { recomputeDerived } from './render/gl.js';
import { wireControls } from './ui/controls.js';
import { applyPreset } from './state.js';
import './styles.css';

const MODELS = ['rayleigh', 'preetham', 'nishita', 'hosek', 'ozone', 'cie'];

// Each panel reuses the GL context of its sibling. Cleanest is one GL context
// per <canvas class="gl">. WebGL2 context creation is cheap.
const panels = [];
for (const m of MODELS) {
  const stripCanvas = document.getElementById(`c${capitalize(m)}`);
  const domeCanvas  = document.querySelector(`canvas.dome[data-model="${m}"]`);
  if (stripCanvas) panels.push({ kind: 'strip', model: m, canvas: stripCanvas });
  if (domeCanvas)  panels.push({ kind: 'dome',  model: m, canvas: domeCanvas });
}

// Per-panel: create context + cache program
for (const p of panels) {
  p.gl = createGL(p.canvas);
  const programs = buildPrograms(p.gl);
  p.program = programs[p.kind][p.model];
  const { vao, attrName } = makeFullscreenTriangle(p.gl);
  p.vao = vao;
  const aPos = p.gl.getAttribLocation(p.program, attrName);
  p.gl.bindVertexArray(vao);
  p.gl.enableVertexAttribArray(aPos);
  p.gl.vertexAttribPointer(aPos, 2, p.gl.FLOAT, false, 0, 0);
  p.gl.bindVertexArray(null);
}

// Visibility tracking
const visible = new Set();
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const p = panels.find(pp => pp.canvas === e.target);
    if (!p) continue;
    if (e.isIntersecting) visible.add(p); else visible.delete(p);
  }
  scheduleRender();
}, { rootMargin: '200px' });
for (const p of panels) io.observe(p.canvas);

// Resize: match canvas internal size to CSS size × DPR with caps
const MAX_W = { strip: 1500, dome_fisheye: 720, dome_other: 1200 };
function sizeCanvas(p) {
  const rect = p.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  let cap;
  if (p.kind === 'strip') cap = MAX_W.strip;
  else cap = state.dome[p.model].projection === 'fisheye' ? MAX_W.dome_fisheye : MAX_W.dome_other;
  const w = Math.round(Math.min(rect.width * dpr, cap));
  const aspect = p.kind === 'dome'
    ? (state.dome[p.model].projection === 'fisheye' ? 1 : 2)
    : rect.width / rect.height;
  const h = Math.round(w / aspect);
  if (p.canvas.width !== w || p.canvas.height !== h) {
    p.canvas.width = w; p.canvas.height = h;
  }
}
const ro = new ResizeObserver(() => { for (const p of panels) sizeCanvas(p); scheduleRender(); });
for (const p of panels) ro.observe(p.canvas);

function render() {
  const selectedHour = state.hour;
  recomputeDerived(state, selectedHour);
  for (const p of visible) {
    if (!p.program) continue;
    sizeCanvas(p);
    const gl = p.gl;
    gl.viewport(0, 0, p.canvas.width, p.canvas.height);
    gl.useProgram(p.program);
    gl.bindVertexArray(p.vao);
    setSharedUniforms(gl, p.program, state);
    // Per-panel uniforms
    gl.uniform2f(gl.getUniformLocation(p.program, 'uResolution'), p.canvas.width, p.canvas.height);
    if (p.kind === 'strip') {
      gl.uniform1f(gl.getUniformLocation(p.program, 'uViewElDeg'), state.viewEl);
      gl.uniform1f(gl.getUniformLocation(p.program, 'uHourStart'), 3.0);
      gl.uniform1f(gl.getUniformLocation(p.program, 'uHourEnd'), 22.0);
    } else {
      const projMap = { fisheye: 0, equirect: 1, sunfacing: 2 };
      gl.uniform1i(gl.getUniformLocation(p.program, 'uProjection'),
                   projMap[state.dome[p.model].projection]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
setRenderFn(render);

wireControls();
applyPreset('earth');  // initial preset → fills stars, scatterTweak

function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }
```

- [ ] **Step 4: Verify**

Reload dev URL. Expected:
- All 6 strips render with their respective models
- All 6 domes render in their current projection (default fisheye)
- Moving any slider re-renders within a frame
- Clicking preset buttons changes the look (e.g. `mars` → ruddy sky)

If a model panel is magenta, that's a port that hasn't been done yet (should only be the case if you got here before tasks 13–16; not expected at this point).

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/render/gl.js src/state.js
git commit -m "feat: end-to-end rendering — all 12 panels driven by state"
```

---

## Task 20: Projection toggle per dome

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/ui/projectionToggle.js`
- Modify: `~/src/experiments/sky-color-gl/src/main.js` (wire it)

In the source HTML, each dome has a projection toggle in its top-left (lines ~470, 550, etc. — `<div class="projection-toggle">` or similar). Find the actual markup pattern in source and replicate.

- [ ] **Step 1: Find the projection toggle markup in source**

```bash
grep -n "projection" ~/src/experiments/sky-color/sky-models.html | head
```

Locate the button group; copy its markup into our `index.html` per dome.

- [ ] **Step 2: Create `src/ui/projectionToggle.js`**

```js
import { state, scheduleRender } from '../state.js';

export function wireProjectionToggles() {
  document.querySelectorAll('.projection-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const model = btn.dataset.model;
      const proj = btn.dataset.projection;
      state.dome[model].projection = proj;
      btn.parentElement.querySelectorAll('.projection-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scheduleRender();
    });
  });
}
```

- [ ] **Step 3: Call from `main.js`**

```js
import { wireProjectionToggles } from './ui/projectionToggle.js';
wireProjectionToggles();
```

- [ ] **Step 4: Verify**

Click projection buttons on each dome. Expected: dome reshapes (fisheye square → equirect 2:1 → sunfacing 2:1) and rerenders with the new projection.

- [ ] **Step 5: Commit**

```bash
git add src/ui/projectionToggle.js src/main.js index.html
git commit -m "feat: per-dome projection toggle"
```

---

## Task 21: Hour scrubbing — click/drag on strip canvases to set hour

**Files:**
- Modify: `~/src/experiments/sky-color-gl/src/main.js`

In the source, `hourFromEvent` (line 2710) and `scrubbing` flag (line 2716) handle this. The "coarse during scrub" path goes away (GPU is fast enough).

- [ ] **Step 1: Add hour scrubber binding in `main.js`**

```js
import { setStateValue } from './state.js';

function setupHourScrub() {
  for (const p of panels.filter(pp => pp.kind === 'strip')) {
    const canvas = p.canvas;
    let down = false;
    function updateFromEvent(ev) {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const hour = 3 + x * (22 - 3);
      setStateValue('hour', Math.max(3, Math.min(22, hour)));
    }
    canvas.addEventListener('pointerdown', e => { down = true; canvas.setPointerCapture(e.pointerId); updateFromEvent(e); });
    canvas.addEventListener('pointermove', e => { if (down) updateFromEvent(e); });
    canvas.addEventListener('pointerup',   e => { down = false; });
  }
}
setupHourScrub();
```

- [ ] **Step 2: Verify**

Click and drag on any strip. Expected: hour updates, all panels rerender. Overlay time cursor doesn't exist yet (Task 22).

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: hour scrubbing on strip canvases"
```

---

## Task 22: Overlay canvases — sun arcs, horizon, time cursor, sun-disk glow

**Files:**
- Create: `~/src/experiments/sky-color-gl/src/render/overlay.js`
- Modify: `~/src/experiments/sky-color-gl/src/main.js`

- [ ] **Step 1: Create `src/render/overlay.js`**

```js
import { sunElevation, PI, TAU } from '../stars.js';

const ARC_COLORS = ['rgba(255,255,255,0.15)', 'rgba(255,180,100,0.18)', 'rgba(150,200,255,0.18)'];

export function drawStripOverlay(ctx, p, state) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Sun-elevation arcs per star
  for (let si = 0; si < state.stars.length; si++) {
    const star = state.stars[si];
    ctx.strokeStyle = ARC_COLORS[si] || ARC_COLORS[0];
    ctx.lineWidth = 1;
    ctx.setLineDash(si === 0 ? [] : [3, 3]);
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const hour = 3 + (x / w) * (22 - 3);
      const sElev = sunElevation(state.lat, state.doy, hour + star.hourOffset);
      const y = h - (sElev / (PI / 2)) * (h * 0.8) - h * 0.1;
      const yc = Math.max(0, Math.min(h, y));
      if (x === 0) ctx.moveTo(x, yc); else ctx.lineTo(x, yc);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Horizon
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.9); ctx.lineTo(w, h * 0.9);
  ctx.stroke();
  ctx.setLineDash([]);

  // Time cursor
  const cursorX = ((state.hour - 3) / (22 - 3)) * w;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(cursorX - 1, 0, 2, h);
}

// Compute pixel for (azDeg, elDeg) on a dome given projection mode + canvas dims.
// Mirrors source line 2419 (viewAzElToPixel) for the no-bool return.
function viewAzElToPixel(projection, az, elDeg, w, h) {
  // Port from source HTML line 2419-2444
  // returns { x, y, visible }
  // PLACEHOLDER — implement
  return { x: 0, y: 0, visible: false };
}

export function drawDomeOverlay(ctx, p, state) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const projection = state.dome[p.model].projection;
  const SUN_RADIUS_DEG = 1.0;
  const GLOW_RATIO = 4;
  const pxPerDeg = projection === 'fisheye' ? (w / 2) / 90
                 : projection === 'sunfacing' ? w / 180
                 : w / 360;
  for (let si = 0; si < state.stars.length; si++) {
    const star = state.stars[si];
    if (star._elev <= 0) continue;
    const { x, y, visible } = viewAzElToPixel(projection, star._azOff, star._elev * 180 / PI, w, h);
    if (!visible) continue;
    const rDisk = Math.max(2, pxPerDeg * SUN_RADIUS_DEG);
    const rGlow = rDisk * GLOW_RATIO;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rGlow);
    const [sr, sg, sb] = star.color;
    const css = `rgb(${Math.round(sr*255)},${Math.round(sg*255)},${Math.round(sb*255)})`;
    grad.addColorStop(0, css);
    grad.addColorStop(rDisk / rGlow, css.replace('rgb', 'rgba').replace(')', ',0.9)'));
    grad.addColorStop(1, css.replace('rgb', 'rgba').replace(')', ',0)'));
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, rGlow, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
```

- [ ] **Step 2: Port `viewAzElToPixel` from source HTML line 2419-2444**

Replace the PLACEHOLDER above with the actual port. The JS returns `[px, py, visible]`; here we return an object for clarity.

- [ ] **Step 3: Wire overlays into the render loop**

In `main.js`, change the panel registry to also discover the overlay canvas:

```js
for (const p of panels) {
  const overlayId = p.kind === 'strip'
    ? p.canvas.id.replace(/^c/, 'o')      // cRayleigh → oRayleigh
    : `od${p.model}`;                     // dome overlays — define IDs in markup
  p.overlay = document.getElementById(overlayId);
  if (p.overlay) p.overlayCtx = p.overlay.getContext('2d');
}
```

And in the render loop, after the GL draw:

```js
import { drawStripOverlay, drawDomeOverlay } from './render/overlay.js';
// inside frame loop, after gl.drawArrays:
if (p.overlay) {
  p.overlay.width = p.canvas.width;
  p.overlay.height = p.canvas.height;
  if (p.kind === 'strip') drawStripOverlay(p.overlayCtx, p, state);
  else drawDomeOverlay(p.overlayCtx, p, state);
}
```

- [ ] **Step 4: Add overlay canvases to `index.html`**

For each strip and dome, ensure there's a sibling `<canvas class="overlay" id="oXxx">` with matching dimensions and `pointer-events: none` styling.

- [ ] **Step 5: Verify**

Reload. Expected:
- Each strip has the sun-elevation arc(s), dashed horizon, and a vertical time cursor that tracks the hour slider
- Each dome shows a glowing sun disk (where sun is above horizon and in-frame for the current projection)
- Multi-star presets (Tatooine etc.) show two separate suns/arcs

- [ ] **Step 6: Commit**

```bash
git add src/render/overlay.js src/main.js index.html
git commit -m "feat: Canvas2D overlays — sun arcs, horizon, time cursor, sun-disk glow"
```

---

## Task 23: README + final polish

**Files:**
- Create: `~/src/experiments/sky-color-gl/README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# sky-color-gl

WebGL2 port of the sky-color experiment. Six atmospheric scattering models
(Rayleigh, Preetham, Nishita, Hosek-Wilkie, Ozone, CIE Clear) rendered as
fragment shaders, with planet presets and per-pixel postprocess style.

## Run

    npm install
    npm run dev

Opens at http://localhost:5173 (or whatever Vite picks).

## Build

    npm run build
    npm run preview

## Source

Ported from `~/src/experiments/sky-color/sky-models.html`. Design and plan in
`docs/specs/` and `docs/plans/`.
```

- [ ] **Step 2: Final visual sweep**

Run `npm run dev`. Walk through:
- Each preset button — verify each looks distinct and plausible
- Each projection toggle on each dome — fisheye / equirect / sunfacing
- All sliders — sweep each end to end and confirm visible effect
- Scrub the hour on a strip — all panels track in real time, no lag
- Multi-star presets (Tatooine, Hoth) — confirm two sun-glows on the dome

Note any visual issues. Fix them or file follow-ups.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-review

**Spec coverage:**
- All 6 strip models — tasks 8, 11, 13–16
- All 6 dome models — task 9 (preetham), 10 (registry stubs picked up by 11–16)
- Multi-star summation — task 7 (shader), 12 (uniforms), 19 (recomputeDerived)
- All UI controls — task 18 (sliders), 20 (projection), 21 (hour scrub)
- Overlays (arcs, horizon, cursor, sun disk) — task 22
- IQ joke dropped — task 17 (markup pruning)
- No formal tests — confirmed throughout
- Vite + `vite-plugin-glsl` — task 1
- Shader chunk assembly via `#include` — tasks 7, 8, 10
- WebGL2 — task 2
- Per-panel stacked GL+overlay canvas — tasks 17, 22
- Eliminated chunked rendering / generation cancellation / scrub coarse path — task 19 (none of that machinery exists)
- DPR + MAX_W caps — task 19

**Placeholder scan:**
- Task 7 step 1 deliberately contains `PLACEHOLDER` markers — these are explicit "transliterate this JS function" instructions, immediately resolved in step 2. Not a plan defect.
- Task 13 step 1 has a similar planned PLACEHOLDER for Rayleigh, resolved in same task.
- Task 22 step 1 has a PLACEHOLDER for `viewAzElToPixel`, resolved in step 2.

**Type consistency:**
- `state.stars[i]._elev` / `_azOff` (set in `recomputeDerived`) used consistently in `uniforms.js` and `overlay.js`
- `state.dome[model].projection` ∈ `'fisheye' | 'equirect' | 'sunfacing'` used in main.js, projectionToggle.js, overlay.js — consistent
- `modelColor(sunElev, T, viewElDeg, viewAzDeg, alt, albedo, ozone)` signature consistent across `preetham.glsl`, `nishita.glsl`, etc.
- Uniform names consistent between `common.glsl` and `uniforms.js`

**No gaps found.**
