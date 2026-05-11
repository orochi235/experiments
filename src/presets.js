// Ported from sky-color/sky-models.html lines 1463–1574, 1928–1967

import { setAtmosphere, blackbodyRGB } from './stars.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Ground colors are 0-255 RGB. Loosely informed by each world's canonical
// surface tone — Mars rust, Hoth ice, Tatooine sand, etc.
export const PRESETS = {
  earth: {
    planetR: 6371e3, atmoR: 6471e3, hr: 8000, hm: 1200,
    betaR: [5.5e-6, 13.0e-6, 22.4e-6], betaM: 21e-6, sunIntensity: 20,
    atmoDensity: 1, sunDist: 1, stars: [{temp: 5778, intensity: 1}],
    turbidity: 3, ozone: 1, albedo: 0.3, scatterTweak: null,
    groundColor: [80, 95, 60],
  },
  mars: {
    planetR: 3390e3, atmoR: 3500e3, hr: 11000, hm: 2000,
    betaR: [19.918e-6, 13.57e-6, 5.75e-6], betaM: 40e-6, sunIntensity: 12,
    atmoDensity: 0.006, sunDist: 1.52, stars: [{temp: 5778, intensity: 1}],
    turbidity: 8, ozone: 0, albedo: 0.25, scatterTweak: null,
    groundColor: [140, 80, 45],
  },
  venus: {
    planetR: 6052e3, atmoR: 6300e3, hr: 15000, hm: 3000,
    betaR: [8e-6, 10e-6, 11e-6], betaM: 80e-6, sunIntensity: 8,
    atmoDensity: 90, sunDist: 0.72, stars: [{temp: 5778, intensity: 1}],
    turbidity: 10, ozone: 0, albedo: 0.7, scatterTweak: null,
    groundColor: [170, 130, 65],
  },
  titan: {
    planetR: 2575e3, atmoR: 2775e3, hr: 20000, hm: 5000,
    betaR: [6e-6, 9e-6, 5e-6], betaM: 100e-6, sunIntensity: 4,
    atmoDensity: 1.5, sunDist: 9.5, stars: [{temp: 5778, intensity: 1}],
    turbidity: 10, ozone: 0, albedo: 0.2, scatterTweak: null,
    groundColor: [150, 110, 70],
  },
  jupiter: {
    planetR: 69911e3, atmoR: 70411e3, hr: 27000, hm: 4000,
    betaR: [3e-6, 7e-6, 15e-6], betaM: 50e-6, sunIntensity: 6,
    atmoDensity: 3, sunDist: 5.2, stars: [{temp: 5778, intensity: 1}],
    turbidity: 5, ozone: 0, albedo: 0.5, scatterTweak: null,
    groundColor: [180, 150, 110],
  },
  saturn: {
    planetR: 58232e3, atmoR: 58832e3, hr: 36000, hm: 5000,
    betaR: [5e-6, 10e-6, 14e-6], betaM: 40e-6, sunIntensity: 4,
    atmoDensity: 2.5, sunDist: 9.5, stars: [{temp: 5778, intensity: 1}],
    turbidity: 4, ozone: 0, albedo: 0.47, scatterTweak: null,
    groundColor: [200, 180, 140],
  },
  arrakis: {
    planetR: 6200e3, atmoR: 6280e3, hr: 7000, hm: 1500,
    betaR: [15e-6, 10e-6, 4e-6], betaM: 60e-6, sunIntensity: 22,
    atmoDensity: 0.8, sunDist: 1.1, stars: [{temp: 5800, intensity: 1}],
    turbidity: 9, ozone: 0.3, albedo: 0.4, scatterTweak: null,
    groundColor: [200, 170, 90],
  },
  vulcan: {
    planetR: 7500e3, atmoR: 7580e3, hr: 6500, hm: 1000,
    betaR: [12e-6, 9e-6, 5e-6], betaM: 30e-6, sunIntensity: 18,
    atmoDensity: 0.6, sunDist: 0.8, stars: [{temp: 5000, intensity: 1}],
    turbidity: 4, ozone: 0.5, albedo: 0.2, scatterTweak: null,
    groundColor: [160, 70, 45],
  },
  krypton: {
    planetR: 8000e3, atmoR: 8120e3, hr: 9000, hm: 1500,
    betaR: [14e-6, 8e-6, 4e-6], betaM: 35e-6, sunIntensity: 14,
    atmoDensity: 1.2, sunDist: 0.6, stars: [{temp: 3800, intensity: 1}],
    turbidity: 5, ozone: 0.8, albedo: 0.3, scatterTweak: null,
    groundColor: [140, 50, 60],
  },
  pandora: {
    planetR: 5800e3, atmoR: 5950e3, hr: 10000, hm: 2000,
    betaR: [4e-6, 8e-6, 22e-6], betaM: 15e-6, sunIntensity: 25,
    atmoDensity: 1.2, sunDist: 0.9, stars: [{temp: 8500, intensity: 1}],
    turbidity: 2, ozone: 1.5, albedo: 0.15, scatterTweak: null,
    groundColor: [60, 130, 130],
  },
  tatooine: {
    planetR: 6100e3, atmoR: 6190e3, hr: 7500, hm: 1100,
    betaR: [10e-6, 11e-6, 8e-6], betaM: 45e-6, sunIntensity: 24,
    atmoDensity: 0.9, sunDist: 1.0,
    stars: [{temp: 5778, intensity: 0.6}, {temp: 4900, intensity: 0.4}],
    // Star Wars canon: twin suns are tight in every iconic shot.
    // ~0.5h offset → ~7° apart in the sky — about a hand's-width at arm's-length.
    hourOffsets: [0, -0.5],
    turbidity: 7, ozone: 0.2, albedo: 0.35, scatterTweak: null,
    groundColor: [210, 175, 110],
  },
  hoth: {
    planetR: 6400e3, atmoR: 6490e3, hr: 8500, hm: 1400,
    betaR: [4e-6, 11e-6, 24e-6], betaM: 12e-6, sunIntensity: 22,
    atmoDensity: 0.85, sunDist: 1.3, stars: [{temp: 9000, intensity: 1}],
    turbidity: 2, ozone: 1.2, albedo: 0.85, scatterTweak: null,
    groundColor: [220, 230, 240],
  },
  qonos: {
    planetR: 7200e3, atmoR: 7320e3, hr: 9000, hm: 1800,
    betaR: [4e-6, 18e-6, 6e-6], betaM: 35e-6, sunIntensity: 16,
    atmoDensity: 1.3, sunDist: 0.95, stars: [{temp: 4600, intensity: 1}],
    turbidity: 6, ozone: 0.6, albedo: 0.25,
    scatterTweak: {hueShift: 85, satBoost: 1.3},
    groundColor: [70, 100, 60],
  },
  namek: {
    planetR: 6000e3, atmoR: 6120e3, hr: 8500, hm: 1600,
    betaR: [3.5e-6, 20e-6, 5e-6], betaM: 25e-6, sunIntensity: 20,
    atmoDensity: 1.1, sunDist: 0.9,
    stars: [{temp: 5600, intensity: 0.4}, {temp: 5400, intensity: 0.3}, {temp: 5200, intensity: 0.3}],
    // Dragon Ball: three suns, all visible together but distinct.
    // Spread to roughly evenly arc across the daytime sky.
    hourOffsets: [0, -2.5, 2.0],
    turbidity: 3, ozone: 0.8, albedo: 0.2,
    scatterTweak: {hueShift: 100, satBoost: 1.2},
    groundColor: [110, 180, 90],
  },
  gallifrey: {
    planetR: 6800e3, atmoR: 6920e3, hr: 8000, hm: 1300,
    betaR: [14e-6, 10e-6, 5e-6], betaM: 30e-6, sunIntensity: 22,
    atmoDensity: 1.0, sunDist: 0.85,
    stars: [{temp: 5500, intensity: 0.55}, {temp: 4500, intensity: 0.45}],
    // Doctor Who canon: two suns visible together in Gallifrey skies, with the
    // smaller orange companion trailing the primary.
    hourOffsets: [0, -1.5],
    turbidity: 4, ozone: 0.7, albedo: 0.3, scatterTweak: null,
    groundColor: [180, 100, 50],
  },
  vormir: {
    planetR: 5500e3, atmoR: 5620e3, hr: 7500, hm: 1400,
    betaR: [10e-6, 5e-6, 18e-6], betaM: 30e-6, sunIntensity: 14,
    atmoDensity: 1.1, sunDist: 1.2,
    stars: [{temp: 4500, intensity: 0.6}, {temp: 3200, intensity: 0.4}],
    // MCU: Vormir's twin suns hang together in the Soul-Stone sky shots.
    // Smaller (cooler) M-dwarf companion close to the primary.
    hourOffsets: [0, -1.8],
    turbidity: 5, ozone: 0.4, albedo: 0.2,
    scatterTweak: {hueShift: -60, satBoost: 1.4},
    groundColor: [110, 95, 110],
  },
  thessia: {
    planetR: 6500e3, atmoR: 6630e3, hr: 9000, hm: 1600,
    betaR: [8e-6, 5e-6, 20e-6], betaM: 20e-6, sunIntensity: 24,
    atmoDensity: 1.15, sunDist: 0.85, stars: [{temp: 6500, intensity: 1}],
    turbidity: 3, ozone: 1.0, albedo: 0.2,
    scatterTweak: {hueShift: -45, satBoost: 1.3},
    groundColor: [60, 100, 150],
  },
  romulus: {
    // Romulan homeworld — orbits a K-type star (Eta Eridani-ish in some canon).
    // Sky pushed toward green via scatterTweak; forested surface.
    planetR: 6500e3, atmoR: 6620e3, hr: 8200, hm: 1300,
    betaR: [6e-6, 14e-6, 18e-6], betaM: 22e-6, sunIntensity: 18,
    atmoDensity: 1.05, sunDist: 0.9, stars: [{temp: 4900, intensity: 1}],
    turbidity: 4, ozone: 0.9, albedo: 0.3,
    scatterTweak: {hueShift: 60, satBoost: 1.2},
    groundColor: [70, 110, 80],
  },
  mustafar: {
    // Volcanic hell — thick ash/sulfur aerosols dominate, so Mie is huge
    // and Rayleigh is shifted toward red. Surface is dark basalt with lava.
    planetR: 6200e3, atmoR: 6300e3, hr: 6500, hm: 800,
    betaR: [22e-6, 8e-6, 3e-6], betaM: 200e-6, sunIntensity: 18,
    atmoDensity: 1.5, sunDist: 1.0, stars: [{temp: 5500, intensity: 1}],
    turbidity: 10, ozone: 0.1, albedo: 0.1,
    scatterTweak: {hueShift: -10, satBoost: 1.4},
    groundColor: [80, 30, 20],
  },
  bespin: {
    // Cloud City — looking "down" from a gas giant's cloud deck. K-type star.
    // Warm orange-pink atmosphere; ground = deeper orange-tan cloud layer.
    planetR: 60000e3, atmoR: 60500e3, hr: 25000, hm: 3500,
    betaR: [12e-6, 8e-6, 4e-6], betaM: 60e-6, sunIntensity: 8,
    atmoDensity: 1.8, sunDist: 3.2, stars: [{temp: 4400, intensity: 1}],
    turbidity: 6, ozone: 0, albedo: 0.55,
    scatterTweak: {hueShift: -20, satBoost: 1.3},
    groundColor: [180, 140, 90],
  },
  solaris: {
    // Lem's ocean planet beneath a red-dwarf + blue-giant binary.
    // Wide separation: the two stars are visible at very different sky positions.
    planetR: 6300e3, atmoR: 6420e3, hr: 8500, hm: 1500,
    betaR: [5e-6, 12e-6, 22e-6], betaM: 25e-6, sunIntensity: 22,
    atmoDensity: 1.0, sunDist: 1.0,
    stars: [{temp: 3100, intensity: 0.45}, {temp: 12000, intensity: 0.55}],
    hourOffsets: [0, -3.5],   // wide-binary — the giant trails far behind the dwarf
    turbidity: 4, ozone: 1.1, albedo: 0.15, scatterTweak: null,
    groundColor: [40, 60, 90],
  },
  trantor: {
    // Asimov's metropolis-planet — surface is metal/concrete under a hazy,
    // urban-polluted yellow-brown atmosphere. Standard G-type star.
    planetR: 6400e3, atmoR: 6520e3, hr: 9000, hm: 1100,
    betaR: [9e-6, 11e-6, 14e-6], betaM: 70e-6, sunIntensity: 20,
    atmoDensity: 1.4, sunDist: 1.0, stars: [{temp: 5778, intensity: 1}],
    turbidity: 9, ozone: 0.5, albedo: 0.35,
    scatterTweak: {hueShift: 30, satBoost: 0.85},
    groundColor: [110, 105, 100],
  },
};

// Cheap approximation of the noon-zenith sky color for a preset, used to tint
// the preset-button backgrounds without having to actually render the shader.
// The idea: at zenith with the sun overhead, what we see is mainly Rayleigh
// scattering of starlight, so sky ∝ starlight × per-channel β_R. We then
// apply the preset's scatterTweak (hue shift + sat boost) in HSL space to
// mirror what the real shader does in postprocess.
function _rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else               h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function _hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}
function _hsl2rgb(h, s, l) {
  if (s === 0) return [l*255, l*255, l*255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    _hue2rgb(p, q, h + 1/3) * 255,
    _hue2rgb(p, q, h)       * 255,
    _hue2rgb(p, q, h - 1/3) * 255,
  ];
}

// Multiple representative samples across a noon sky, used to seed a multi-stop
// gradient on each preset button. Returns 5 RGB triplets covering:
//   zenith (cool, far-from-sun) — near-sun (bright, warm tint) — mid-sky —
//   horizon haze (warmer, dimmer) — ground.
// Each is a CHEAP approximation, not a real shader render.
export function approxPresetPalette(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) return null;
  const br = preset.betaR;
  const mb = Math.max(...br);
  const scatter = br.map(v => v / mb);

  // Stellar tint (intensity-weighted blackbody)
  let r = 0, g = 0, b = 0, w = 0;
  for (const s of preset.stars) {
    const c = blackbodyRGB(s.temp);
    r += c[0] * s.intensity;
    g += c[1] * s.intensity;
    b += c[2] * s.intensity;
    w += s.intensity;
  }
  if (w > 0) { r /= w; g /= w; b /= w; }
  const star = [r, g, b];

  // Base sky at zenith: star × per-channel Rayleigh scatter
  const baseSky = scatter.map((s, i) => star[i] * s * 255 * 1.6);

  // Apply scatterTweak via HSL on the base sky
  let zenith = baseSky.slice();
  if (preset.scatterTweak) {
    const [h, s, l] = _rgb2hsl(zenith[0], zenith[1], zenith[2]);
    const nh = ((h + preset.scatterTweak.hueShift / 360) % 1 + 1) % 1;
    const ns = Math.max(0, Math.min(1, s * preset.scatterTweak.satBoost));
    zenith = _hsl2rgb(nh, ns, l);
  }

  // Variations:
  // - Far-sky: a touch dimmer/cooler than zenith
  // - Near-sun: brighter and biased toward star tint (Mie around the sun)
  // - Mid: average of zenith and ground-haze
  // - Horizon haze: blend zenith with star tint, dimmer
  // - Ground: preset's ground color
  const dim = c => c.map(v => Math.max(0, v * 0.8));
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
  const lighten = (c, k) => c.map(v => Math.min(255, v * k));
  const starRGB255 = star.map(v => v * 255);

  const farSky = dim(zenith);
  const nearSun = lighten(mix(zenith, starRGB255, 0.55), 1.15);
  const midSky = mix(zenith, farSky, 0.5);
  const horizonHaze = mix(zenith, starRGB255.map(v => v * 0.7), 0.55);
  const ground = preset.groundColor || [50, 50, 50];

  return { farSky, zenith, nearSun, midSky, horizonHaze, ground };
}

export function approxSkyColor(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) return [120, 140, 180];
  // Per-channel Rayleigh scattering, normalized so max = 1
  const br = preset.betaR;
  const mb = Math.max(...br);
  const scatter = br.map(v => v / mb);
  // Stellar tint (weighted blackbody average across the preset's stars)
  let r = 0, g = 0, b = 0, w = 0;
  for (const s of preset.stars) {
    const c = blackbodyRGB(s.temp);
    r += c[0] * s.intensity;
    g += c[1] * s.intensity;
    b += c[2] * s.intensity;
    w += s.intensity;
  }
  if (w > 0) { r /= w; g /= w; b /= w; }
  // Sky color = starlight × scatter, lifted to 0-255 and brightened a bit so
  // the swatches read on a dark page background.
  let sR = r * scatter[0] * 255;
  let sG = g * scatter[1] * 255;
  let sB = b * scatter[2] * 255;
  // Apply scatterTweak via HSL (mirrors the shader's applyScatterTweak)
  if (preset.scatterTweak) {
    const [h, s, l] = _rgb2hsl(sR, sG, sB);
    const newH = ((h + preset.scatterTweak.hueShift / 360) % 1 + 1) % 1;
    const newS = Math.max(0, Math.min(1, s * preset.scatterTweak.satBoost));
    [sR, sG, sB] = _hsl2rgb(newH, newS, l);
  }
  // Boost brightness for swatch readability
  const lift = 1.6;
  return [
    Math.min(255, sR * lift),
    Math.min(255, sG * lift),
    Math.min(255, sB * lift),
  ];
}

export function applyPresetPhysics(presetName, atmoDensity, sunDist, stellarTemp) {
  const preset = PRESETS[presetName];

  setAtmosphere({
    earthR: preset.planetR,
    atmoR: preset.atmoR,
    hr: preset.hr,
    hm: preset.hm,
    betaR: preset.betaR.map(v => v * atmoDensity),
    betaM: preset.betaM * atmoDensity,
    // Sun intensity scales with inverse square of distance
    sunIntensity: preset.sunIntensity / (sunDist * sunDist),
  });

  // Per-star hour offsets: use the preset's own array if provided, otherwise
  // fall back to the original lazy [0, -0.6, 0.5] triplet.
  const defaultOffsets = [0, -0.6, 0.5];
  const offsets = preset.hourOffsets || defaultOffsets;

  // Compute temperature offset from slider vs preset default
  let presetAvgTemp = 0;
  for (const s of preset.stars) presetAvgTemp += s.temp * s.intensity;
  const tempDelta = stellarTemp - presetAvgTemp;

  const activeStars = preset.stars.map((star, i) => {
    const adjustedTemp = clamp(star.temp + tempDelta, 2500, 12000);
    const c = blackbodyRGB(adjustedTemp);
    return {
      temp: adjustedTemp,
      intensity: star.intensity,
      hourOffset: offsets[i] || 0,
      color: c
    };
  });

  // Blended stellar color
  let r = 0, g = 0, b = 0;
  for (const s of activeStars) {
    r += s.color[0] * s.intensity;
    g += s.color[1] * s.intensity;
    b += s.color[2] * s.intensity;
  }
  const mx = Math.max(r, g, b, 1e-6);
  const stellarColor = [r/mx, g/mx, b/mx];

  return { activeStars, stellarColor, groundColor: preset.groundColor || [26, 26, 31] };
}
