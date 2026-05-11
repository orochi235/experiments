# Sky Color WebGL Port — Design

**Date:** 2026-05-11
**Source project:** `~/src/experiments/sky-color/sky-models.html` (single-file Canvas2D implementation)
**Target project:** `~/src/experiments/sky-color-gl/` (this repo)

## Motivation

The original is a single 2746-line HTML file that renders six atmospheric scattering models (Rayleigh, Preetham, Nishita, Hosek-Wilkie, Ozone-extended Nishita, CIE Clear) into:

- 6 "strip" canvases (1D color-over-time bars)
- 6 "dome" canvases (full 2D sky panoramas, up to ~1200×600, three projection modes)

Each pixel runs full scattering math in JS. The dome panels are the bottleneck: 6 panels × hundreds of thousands of pixels × multiple expensive math calls (`pow`, `exp`, `acos`) make slider interaction visibly laggy even with the existing optimizations (chunked rAF rendering, generation-based cancellation, coarse step during scrub, IntersectionObserver-gated rendering).

The fix is to move per-pixel work to the GPU. The math is already in closed-form analytic functions, no LUTs — all six models port near-1:1 to GLSL fragment shaders. Expected speedup is large enough that all "make it tolerable on CPU" infrastructure (chunking, cancellation, coarse-during-scrub) becomes unnecessary.

This is a **parallel copy**, not a rewrite-in-place. The original repo stays as-is.

## Scope

In scope:
- All 6 scattering models, ported to fragment shaders
- All 6 strip canvases + all 6 dome canvases, fully GPU-rendered
- All existing UI controls: turbidity, latitude, day-of-year, view elevation, hour scrubber, albedo, ozone, style sliders (hue/saturation/vibrance/exposure/contrast/warmth/twilightGlow/nightTint), preset picker, planet sliders (atmoDens/sunDist/stellarTemp), projection toggle (fisheye/equirect/sunfacing), multi-star presets, time cursor, captions
- Sun-elevation arcs, horizon lines, sun-disk glow — rendered to a stacked Canvas2D overlay per panel

Out of scope:
- The IQ joke modal — drop entirely
- Math parity with the original — not a requirement; float32/float64 differences are acceptable
- Canvas2D fallback for WebGL-unavailable browsers — modern browsers only
- Formal tests (unit, snapshot, parity) — visual check in browser is the QA plan
- Architectural changes to the model math itself — straight transliteration

## Technology choices

- **WebGL 2** — universal in modern browsers; no extension-juggling for `float` textures, `for` loops with non-constant bounds, etc.
- **Vite** + `vite-plugin-glsl` — gives proper `.glsl` editor support and resolves `#include` directives at build time
- **No framework** — plain JS, plain DOM. Mirrors the original.
- **No FBOs, no multi-pass** — each panel is a single full-screen-quad draw

## Architecture

### Data flow

```
DOM controls (sliders, buttons, scrubber)
        │ input events
        ▼
state store (plain JS object)
        │ scheduleRender (rAF debounce)
        ▼
for each visible panel:
   ├─ GL pass:      bind program, set uniforms, draw fullscreen quad
   └─ overlay pass: draw arcs / horizon / sun glow / cursor on Canvas2D
```

### Per-panel canvas pair

Each strip and dome panel is a stacked pair of canvases inside a positioned wrapper:

- `<canvas class="gl">` — WebGL2 context, scattering output
- `<canvas class="overlay">` — Canvas2D, absolutely positioned over the GL canvas with `pointer-events: none`, holds incidentals (lines, arcs, glow, time cursor)

Rationale: WebGL is great at per-pixel math; bad at thin antialiased lines and additive radial glows. Canvas2D is the inverse. Overlay surfaces are small (~480²), redraw cost is trivial.

### Shader assembly (Approach C)

Each of the 12 shader programs is composed from chunks via `#include`:

```glsl
// shaders/dome_nishita.glsl
#include "./common.glsl"
#include "./nishita.glsl"
#include "./dome_main.glsl"
```

- `common.glsl` — uniform declarations + helpers (`YxyToRGB`, `rgbToHsl`/`hslToRgb`, `toneMap`, `applyStyle`, `applyScatterTweak`, `pixelToViewAzEl`, `scatteringAngle`, constants)
- `<model>.glsl` — exports `vec3 modelColor(float sunElev, float T, float viewEl, float viewAz, float alt, float albedo, float ozone)`
- `strip_main.glsl` / `dome_main.glsl` — `main()` that drives multi-star summation, scatter tweak, style postprocess, output

`vite-plugin-glsl` inlines includes at build time. No runtime resolver to write.

### Uniforms (shared schema)

```glsl
uniform vec2  uResolution;
uniform int   uProjection;       // dome only: 0=fisheye, 1=equirect, 2=sunfacing
uniform float uT, uAlbedo, uOzone, uAlt;
uniform float uViewElDeg;        // strip only
uniform float uHourStart, uHourEnd;  // strip only

uniform int   uNStars;
uniform float uStarElev[4];      // radians
uniform float uStarAzOff[4];     // degrees, relative to primary
uniform vec3  uStarColor[4];     // linear blackbody RGB
uniform float uStarIntensity[4];

uniform float uScatterHueShift, uScatterSatBoost;
uniform float uHueShift, uSaturation, uVibrance, uExposure,
              uContrast, uWarmth, uTwilightGlow, uNightTint;
```

`MAX_STARS = 4`. Multi-star is a bounded `for` loop with `if (i >= uNStars) break;`.

### Models output 0–255 range

Each `modelColor` returns RGB in 0–255 to match the existing JS contract (the JS code does `Math.round(rgb[0])` etc. before writing pixel bytes). Mains divide by 255.0 before `gl_FragColor`. Keeps shader-vs-JS code visually one-to-one.

### State store

`src/state.js` exports a plain object plus helpers:

```js
state = {
  T, lat, doy, hour, viewEl, albedo, ozone, alt,
  style: { hueShift, saturation, vibrance, exposure, contrast, warmth, twilightGlow, nightTint },
  preset, atmoDens, sunDist, stellarTemp,
  stars: [{ hourOffset, color, intensity }, …],
  dome: { rayleigh: { expanded, projection }, … },
}
```

`bindSlider(id, key)` wires DOM input → state mutation → `scheduleRender()`.
`applyPreset(name)` mutates state and recomputes derived star data.

### Render loop

```
scheduleRender():
  if rafPending: return
  rafPending = true
  rAF(frame)

frame():
  rafPending = false
  derived = recomputeDerived(state)  // primarySunElev, per-star elev + azOffset
  for panel in visiblePanels:
    program = programs[panel.kind][panel.model]
    setUniforms(program, state, derived, panel)
    draw fullscreen quad on panel.glCanvas
    drawOverlay(panel.overlayCtx, state, derived, panel)
  updateLabels(state)
```

- Single shared fullscreen-quad VAO
- All 12 programs compiled once at startup, cached
- IntersectionObserver tracks panel visibility (ported from original)
- ResizeObserver triggers re-render and `canvas.width/height = rect.{w,h} * dpr` (clamped: 720 for fisheye, 1200 for equirect/sunfacing — same caps as original)

### Eliminated infrastructure

These existed because CPU rendering was slow. GPU makes them obsolete:

- Chunked `ROWS_PER_CHUNK` row-by-row rendering loop
- `renderGen` generation-based cancellation
- `scrubbing` → coarse step (× 4 block replicate) path
- `runRenderQueue` async queue
- `createImageData` / `putImageData` / manual `Uint8ClampedArray` pixel writes

## File layout

```
~/src/experiments/sky-color-gl/
├── package.json              # vite, vite-plugin-glsl
├── vite.config.js
├── index.html                # body skeleton, control DOM, canvas containers
├── src/
│   ├── main.js               # entry: wire DOM → state → render
│   ├── state.js
│   ├── presets.js            # PRESETS table, applyPresetPhysics
│   ├── stars.js              # blackbody RGB, sunPos, sunElevation, angleDiffRad
│   ├── render/
│   │   ├── gl.js             # WebGL2 context, quad VAO, program cache, draw loop
│   │   ├── programs.js       # build/cache the 12 programs
│   │   └── overlay.js        # Canvas2D overlay drawing
│   ├── shaders/
│   │   ├── common.glsl
│   │   ├── strip_main.glsl
│   │   ├── dome_main.glsl
│   │   ├── rayleigh.glsl
│   │   ├── preetham.glsl
│   │   ├── nishita.glsl
│   │   ├── hosek.glsl
│   │   ├── ozone.glsl
│   │   ├── cie.glsl
│   │   ├── strip_rayleigh.glsl    # includes common + rayleigh + strip_main
│   │   ├── strip_preetham.glsl
│   │   ├── strip_nishita.glsl
│   │   ├── strip_hosek.glsl
│   │   ├── strip_ozone.glsl
│   │   ├── strip_cie.glsl
│   │   ├── dome_rayleigh.glsl
│   │   ├── dome_preetham.glsl
│   │   ├── dome_nishita.glsl
│   │   ├── dome_hosek.glsl
│   │   ├── dome_ozone.glsl
│   │   └── dome_cie.glsl
│   └── ui/
│       ├── controls.js
│       ├── presetPicker.js
│       └── projectionToggle.js
└── README.md
```

JS modules ported from the original (essentially unchanged):

- `sunPos`, `sunElevation`, `angleDiffRad` → `src/stars.js`
- `blackbodyRGB`, multi-star derivation → `src/stars.js`
- `PRESETS` table, `applyPresetPhysics` → `src/presets.js`
- Slider construction, reset buttons, value labels → `src/ui/controls.js`
- `IntersectionObserver` visible-panel tracking → `src/render/gl.js`

## Testing

No formal test suite. Visual check in browser during development is the QA plan.

If a model looks wrong, debug by reading the shader. The original JS source remains in the sibling repo for reference.

## Risks and unknowns

- **Per-model shader compilation time on first load.** 12 shaders, each ~200–400 lines of GLSL. Modern drivers compile this in milliseconds; should not be a problem but worth measuring once running.
- **Float32 precision in deep-twilight pixels.** Some terms involve `pow(small, large)` (Perez) and `exp(-large)` (Mie). May produce visible color drift at sun elevations far below horizon. Acceptable per scope.
- **DPR scaling vs MAX_W cap.** Existing JS caps internal pixel buffer at 720 (fisheye) / 1200 (equirect). At 2x DPR on a wide screen this clips visible resolution. Keep the same caps for the port; revisit later if needed.

## Out-of-scope follow-ups (not part of this port)

- Pull weasel into the project — weasel doesn't add anything here
- Drop strips entirely or replace with a different visualization
- HDR / wide-gamut output
- Sharable URL state (encode sliders in hash)
