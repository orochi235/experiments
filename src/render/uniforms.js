import { u } from './gl.js';
import { EARTH_R, ATMO_R, HR, HM, BETA_R, BETA_M, SUN_INTENSITY } from '../stars.js';

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
  for (let i = 0; i < n; i++) {
    const s = state.stars[i];
    elev[i] = s._elev ?? 0;
    azOff[i] = s._azOff ?? 0;
    color[i*3]     = s.color[0];
    color[i*3 + 1] = s.color[1];
    color[i*3 + 2] = s.color[2];
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

  // Ground color (per-preset, with optional user override)
  const gc = state.groundOverride || state.groundColor || [26, 26, 31];
  gl.uniform3fv(u(gl, prog, 'uGroundColor'), new Float32Array(gc));
}
