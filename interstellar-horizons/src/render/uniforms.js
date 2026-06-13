import { u } from './gl.js';
import { EARTH_R, ATMO_R, HR, HM, BETA_R, BETA_M, SUN_INTENSITY } from '../stars.js';

// Gamut matrices, column-major for GL. Working space is linear sRGB
// (BT.709 primaries, D65); each entry converts to the target's primaries.
const GAMUTS = {
  srgb: {
    mat: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    oetf: 0,
  },
  p3: {
    // linear sRGB → linear Display P3 (shares the sRGB transfer curve)
    mat: new Float32Array([
      0.8224621, 0.0331941, 0.0170827,
      0.1775380, 0.9668058, 0.0723974,
      0.0,       0.0,       0.9105199,
    ]),
    oetf: 0,
  },
  rec2020: {
    // linear sRGB/BT.709 → linear BT.2020 (uses the BT.2020 OETF)
    mat: new Float32Array([
      0.6274040, 0.0690970, 0.0163916,
      0.3292820, 0.9195400, 0.0880132,
      0.0433136, 0.0113612, 0.8955950,
    ]),
    oetf: 1,
  },
};

// Authored 0-255 sRGB color → 0-255 in the target space, gamma-aware. Used
// for preset ground colors, which bypass toneMap (and therefore uGamut) but
// still land in a wide-gamut-tagged buffer — without this they'd be
// reinterpreted as wide-gamut values and oversaturate.
function convertAuthoredColor(c, gamut) {
  const dec = v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const encSRGB = v =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const enc2020 = v =>
    v < 0.018053968510807 ? 4.5 * v : 1.09929682680944 * Math.pow(v, 0.45) - 0.09929682680944;
  const enc = gamut.oetf === 1 ? enc2020 : encSRGB;
  const lin = [dec(c[0]), dec(c[1]), dec(c[2])];
  const m = gamut.mat; // column-major
  return [0, 1, 2].map(row => {
    const v = m[row] * lin[0] + m[3 + row] * lin[1] + m[6 + row] * lin[2];
    return enc(Math.max(0, Math.min(1, v))) * 255;
  });
}

// Set every "shared" uniform from current state. Per-panel uniforms (uResolution,
// uProjection, uViewElDeg, uHourStart/End, etc.) are set separately by the caller
// after this returns.
export function setSharedUniforms(gl, prog, state) {
  gl.useProgram(prog);

  // Atmosphere
  gl.uniform1f(u(gl, prog, 'uT'), state.T);
  gl.uniform1f(u(gl, prog, 'uAlbedo'), state.albedo);
  gl.uniform1f(u(gl, prog, 'uOzone'), state.ozone);
  gl.uniform1f(u(gl, prog, 'uAlt'), state.alt);
  gl.uniform1f(u(gl, prog, 'uLat'), state.lat);
  gl.uniform1f(u(gl, prog, 'uDoy'), state.doy);

  // Atmosphere physics (mutated by applyPresetPhysics → reflected in stars.js exports)
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

  // White-balance reference: divide every star's RGB by this color so the
  // chosen illuminant reads as neutral white.
  //   physical → no division (raw blackbody)
  //   adapted  → Sol (5778 K) becomes white — eye-adapted to local sun
  //   d65      → D65 (6504 K, standard daylight illuminant) becomes white
  // Refs are precomputed values from blackbodyRGB().
  const REF = {
    physical: [1, 1, 1],
    adapted:  [1.0, 0.8805083522703855, 0.8280576651790191],
    d65:      [1.0, 0.9459627329192546, 0.9939689578713969],
  };
  const ref = REF[state.whiteBalance] ?? REF.physical;
  for (let i = 0; i < n; i++) {
    const s = state.stars[i];
    elev[i] = s._elev ?? 0;
    azOff[i] = s._azOff ?? 0;
    color[i*3]     = s.color[0] / ref[0];
    color[i*3 + 1] = s.color[1] / ref[1];
    color[i*3 + 2] = s.color[2] / ref[2];
    intensity[i] = s.intensity;
    hourOff[i]   = s.hourOffset;
  }
  gl.uniform1fv(u(gl, prog, 'uStarElev'), elev);
  gl.uniform1fv(u(gl, prog, 'uStarAzOff'), azOff);
  gl.uniform3fv(u(gl, prog, 'uStarColor'), color);
  gl.uniform1fv(u(gl, prog, 'uStarIntensity'), intensity);
  gl.uniform1fv(u(gl, prog, 'uStarHourOffset'), hourOff);

  // Scatter tweak (from preset.scatterTweak, stored in state)
  const tweak = state.scatterTweak;
  gl.uniform1f(u(gl, prog, 'uScatterHueShift'), tweak?.hueShift ?? 0);
  gl.uniform1f(u(gl, prog, 'uScatterSatBoost'), tweak?.satBoost ?? 1);

  // Output gamut: working space is always linear sRGB; toneMap converts
  // through this matrix (and encodes with this OETF) as its final step.
  const gamut = GAMUTS[state.colorSpace] ?? GAMUTS.srgb;
  gl.uniformMatrix3fv(u(gl, prog, 'uGamut'), false, gamut.mat);
  gl.uniform1i(u(gl, prog, 'uOETF'), gamut.oetf);

  // Ground color (per-preset, with optional user override)
  const gc = state.groundOverride || state.groundColor || [26, 26, 31];
  gl.uniform3fv(u(gl, prog, 'uGroundColor'),
    new Float32Array(gamut === GAMUTS.srgb ? gc : convertAuthoredColor(gc, gamut)));
}
