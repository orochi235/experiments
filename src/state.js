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
  const preset = PRESETS[name];
  state.scatterTweak = preset?.scatterTweak || null;
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
