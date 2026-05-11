// Ported from sky-color/sky-models.html lines 1463–1574, 1928–1967

import { setAtmosphere, blackbodyRGB } from './stars.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const PRESETS = {
  earth: {
    planetR: 6371e3, atmoR: 6471e3, hr: 8000, hm: 1200,
    betaR: [5.5e-6, 13.0e-6, 22.4e-6], betaM: 21e-6, sunIntensity: 20,
    atmoDensity: 1, sunDist: 1, stars: [{temp: 5778, intensity: 1}],
    turbidity: 3, ozone: 1, albedo: 0.3, scatterTweak: null
  },
  mars: {
    planetR: 3390e3, atmoR: 3500e3, hr: 11000, hm: 2000,
    betaR: [19.918e-6, 13.57e-6, 5.75e-6], betaM: 40e-6, sunIntensity: 12,
    atmoDensity: 0.006, sunDist: 1.52, stars: [{temp: 5778, intensity: 1}],
    turbidity: 8, ozone: 0, albedo: 0.25, scatterTweak: null
  },
  venus: {
    planetR: 6052e3, atmoR: 6300e3, hr: 15000, hm: 3000,
    betaR: [8e-6, 10e-6, 11e-6], betaM: 80e-6, sunIntensity: 8,
    atmoDensity: 90, sunDist: 0.72, stars: [{temp: 5778, intensity: 1}],
    turbidity: 10, ozone: 0, albedo: 0.7, scatterTweak: null
  },
  titan: {
    planetR: 2575e3, atmoR: 2775e3, hr: 20000, hm: 5000,
    betaR: [6e-6, 9e-6, 5e-6], betaM: 100e-6, sunIntensity: 4,
    atmoDensity: 1.5, sunDist: 9.5, stars: [{temp: 5778, intensity: 1}],
    turbidity: 10, ozone: 0, albedo: 0.2, scatterTweak: null
  },
  jupiter: {
    planetR: 69911e3, atmoR: 70411e3, hr: 27000, hm: 4000,
    betaR: [3e-6, 7e-6, 15e-6], betaM: 50e-6, sunIntensity: 6,
    atmoDensity: 3, sunDist: 5.2, stars: [{temp: 5778, intensity: 1}],
    turbidity: 5, ozone: 0, albedo: 0.5, scatterTweak: null
  },
  saturn: {
    planetR: 58232e3, atmoR: 58832e3, hr: 36000, hm: 5000,
    betaR: [5e-6, 10e-6, 14e-6], betaM: 40e-6, sunIntensity: 4,
    atmoDensity: 2.5, sunDist: 9.5, stars: [{temp: 5778, intensity: 1}],
    turbidity: 4, ozone: 0, albedo: 0.47, scatterTweak: null
  },
  arrakis: {
    planetR: 6200e3, atmoR: 6280e3, hr: 7000, hm: 1500,
    betaR: [15e-6, 10e-6, 4e-6], betaM: 60e-6, sunIntensity: 22,
    atmoDensity: 0.8, sunDist: 1.1, stars: [{temp: 5800, intensity: 1}],
    turbidity: 9, ozone: 0.3, albedo: 0.4, scatterTweak: null
  },
  vulcan: {
    planetR: 7500e3, atmoR: 7580e3, hr: 6500, hm: 1000,
    betaR: [12e-6, 9e-6, 5e-6], betaM: 30e-6, sunIntensity: 18,
    atmoDensity: 0.6, sunDist: 0.8, stars: [{temp: 5000, intensity: 1}],
    turbidity: 4, ozone: 0.5, albedo: 0.2, scatterTweak: null
  },
  krypton: {
    planetR: 8000e3, atmoR: 8120e3, hr: 9000, hm: 1500,
    betaR: [14e-6, 8e-6, 4e-6], betaM: 35e-6, sunIntensity: 14,
    atmoDensity: 1.2, sunDist: 0.6, stars: [{temp: 3800, intensity: 1}],
    turbidity: 5, ozone: 0.8, albedo: 0.3, scatterTweak: null
  },
  pandora: {
    planetR: 5800e3, atmoR: 5950e3, hr: 10000, hm: 2000,
    betaR: [4e-6, 8e-6, 22e-6], betaM: 15e-6, sunIntensity: 25,
    atmoDensity: 1.2, sunDist: 0.9, stars: [{temp: 8500, intensity: 1}],
    turbidity: 2, ozone: 1.5, albedo: 0.15, scatterTweak: null
  },
  tatooine: {
    planetR: 6100e3, atmoR: 6190e3, hr: 7500, hm: 1100,
    betaR: [10e-6, 11e-6, 8e-6], betaM: 45e-6, sunIntensity: 24,
    atmoDensity: 0.9, sunDist: 1.0,
    stars: [{temp: 5778, intensity: 0.6}, {temp: 4900, intensity: 0.4}],
    turbidity: 7, ozone: 0.2, albedo: 0.35, scatterTweak: null
  },
  hoth: {
    planetR: 6400e3, atmoR: 6490e3, hr: 8500, hm: 1400,
    betaR: [4e-6, 11e-6, 24e-6], betaM: 12e-6, sunIntensity: 22,
    atmoDensity: 0.85, sunDist: 1.3, stars: [{temp: 9000, intensity: 1}],
    turbidity: 2, ozone: 1.2, albedo: 0.85, scatterTweak: null
  },
  qonos: {
    planetR: 7200e3, atmoR: 7320e3, hr: 9000, hm: 1800,
    betaR: [4e-6, 18e-6, 6e-6], betaM: 35e-6, sunIntensity: 16,
    atmoDensity: 1.3, sunDist: 0.95, stars: [{temp: 4600, intensity: 1}],
    turbidity: 6, ozone: 0.6, albedo: 0.25,
    scatterTweak: {hueShift: 85, satBoost: 1.3}
  },
  namek: {
    planetR: 6000e3, atmoR: 6120e3, hr: 8500, hm: 1600,
    betaR: [3.5e-6, 20e-6, 5e-6], betaM: 25e-6, sunIntensity: 20,
    atmoDensity: 1.1, sunDist: 0.9,
    stars: [{temp: 5600, intensity: 0.4}, {temp: 5400, intensity: 0.3}, {temp: 5200, intensity: 0.3}],
    turbidity: 3, ozone: 0.8, albedo: 0.2,
    scatterTweak: {hueShift: 100, satBoost: 1.2}
  },
  gallifrey: {
    planetR: 6800e3, atmoR: 6920e3, hr: 8000, hm: 1300,
    betaR: [14e-6, 10e-6, 5e-6], betaM: 30e-6, sunIntensity: 22,
    atmoDensity: 1.0, sunDist: 0.85,
    stars: [{temp: 5500, intensity: 0.55}, {temp: 4500, intensity: 0.45}],
    turbidity: 4, ozone: 0.7, albedo: 0.3, scatterTweak: null
  },
  vormir: {
    planetR: 5500e3, atmoR: 5620e3, hr: 7500, hm: 1400,
    betaR: [10e-6, 5e-6, 18e-6], betaM: 30e-6, sunIntensity: 14,
    atmoDensity: 1.1, sunDist: 1.2,
    stars: [{temp: 4500, intensity: 0.6}, {temp: 3200, intensity: 0.4}],
    turbidity: 5, ozone: 0.4, albedo: 0.2,
    scatterTweak: {hueShift: -60, satBoost: 1.4}
  },
  thessia: {
    planetR: 6500e3, atmoR: 6630e3, hr: 9000, hm: 1600,
    betaR: [8e-6, 5e-6, 20e-6], betaM: 20e-6, sunIntensity: 24,
    atmoDensity: 1.15, sunDist: 0.85, stars: [{temp: 6500, intensity: 1}],
    turbidity: 3, ozone: 1.0, albedo: 0.2,
    scatterTweak: {hueShift: -45, satBoost: 1.3}
  },
};

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

  // Build per-star data for multi-star rendering
  // Hour offsets spread secondary stars slightly apart in the sky
  const offsets = [0, -0.6, 0.5]; // primary, secondary, tertiary

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

  return { activeStars, stellarColor };
}
