import { applyPresetPhysics } from './presets.js';
import { PRESETS } from './presets.js';

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
  scatterTweak: null,
  groundColor: [26, 26, 31],
  // null = use preset's color. Otherwise [r,g,b] 0-255 set via the color picker.
  groundOverride: null,
  // Procedural starfield overlaid on previews when the sun is below horizon
  showStars: true,
  // 'visual' (default) | 'actual' — planet toolbar orb sizing mode
  planetScale: 'visual',

  // Global projection (one toggle controls all 6 dome previews + lightbox)
  projection: 'sunfacing',

  // Lightbox: currently-zoomed model name, or null
  lightboxModel: null,
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

// Slider updates are pushed back into the DOM so the user sees them change.
const SLIDER_BINDINGS = [
  ['atmoDensity', 'atmoDens', 'vAtmoDens', v => v.toFixed(2)],
  ['sunDistance', 'sunDist',  'vSunDist',  v => v.toFixed(2) + ' AU'],
  ['stellarTemp', 'stellarTemp', 'vStellarTemp', v => Math.round(v) + ' K'],
  ['turbidity',   'T',         'vTurb',    v => v.toFixed(1)],
  ['albedo',      'albedo',    'vAlbedo',  v => v.toFixed(2)],
  ['ozoneStrength', 'ozone',   'vOzone',   v => v.toFixed(2)],
];

export function applyPreset(name) {
  state.preset = name;
  const preset = PRESETS[name];
  if (!preset) return;
  state.scatterTweak = preset.scatterTweak || null;

  // Mirror the source's selectPreset: pull the preset's atmospheric/stellar
  // defaults into both state and the DOM sliders, so the user sees them change
  // and downstream calls (applyPresetPhysics) see consistent values.
  let avgTemp = 0;
  for (const s of preset.stars) avgTemp += s.temp * s.intensity;
  const presetValues = {
    atmoDensity:   preset.atmoDensity,
    sunDistance:   preset.sunDist,
    stellarTemp:   Math.round(avgTemp),
    turbidity:     preset.turbidity,
    albedo:        preset.albedo,
    ozoneStrength: preset.ozone,
  };
  for (const [sliderId, stateKey, labelId, fmt] of SLIDER_BINDINGS) {
    const v = presetValues[sliderId];
    if (v == null) continue;
    state[stateKey] = v;
    const el = document.getElementById(sliderId);
    if (el) el.value = v;
    const labelEl = document.getElementById(labelId);
    if (labelEl) labelEl.textContent = fmt(v);
  }

  const r = applyPresetPhysics(name, state.atmoDens, state.sunDist, state.stellarTemp);
  state.stars = r.activeStars;
  state.stellarColor = r.stellarColor;
  state.groundColor = r.groundColor;

  // Populate the compact preset summary shown when the presets list is collapsed
  const sumEl = document.getElementById('presetSummary');
  const btn = document.querySelector(`[data-preset="${name}"]`);
  if (sumEl && btn) {
    const nm = btn.querySelector('.preset-name');
    const src = btn.querySelector('.preset-source');
    const star = btn.querySelector('.preset-star');
    sumEl.innerHTML =
      (nm   ? `<span class="ps-name">${nm.innerHTML}</span>`     : '') +
      (src  ? `<span class="ps-source">${src.innerHTML}</span>`  : '') +
      (star ? `<span class="ps-star">${star.innerHTML}</span>`   : '');
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('preset-change', { detail: { name } }));
  }
  scheduleRender();
}

export function setStateValue(path, value) {
  const parts = path.split('.');
  let o = state;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
  scheduleRender();
}
