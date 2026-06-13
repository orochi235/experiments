// ozone.glsl — Nishita sky model with ozone absorption
// Depends on: common.glsl
// Spectral: scatters per wavelength bin lit by the star's Planck spectrum;
// the main() star loop must not re-tint with uStarColor. Ozone absorption
// σ(λ) arrives per-bin via uBetaO3Spec (Chappuis-band curve fit through the
// original RGB cross-sections in uniforms.js).
#define SPECTRAL_TINT

const float OZONE_PEAK  = 25000.0;  // peak altitude (m)
const float OZONE_SCALE = 15000.0;  // scale width (m)

// Returns tFar >= 0 on hit, -1 on miss.
vec2 raySphereIntersect(vec3 ro, vec3 rd, float r) {
  float b    = 2.0 * dot(ro, rd);
  float c    = dot(ro, ro) - r * r;
  float disc = b * b - 4.0 * c;
  if (disc < 0.0) return vec2(-1.0);
  float tFar = (-b + sqrt(disc)) / 2.0;
  return vec2(tFar, tFar);
}

vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  if (sunElev < radians(-8.0)) return vec3(0.0);

  const int numSamples      = 24;
  const int numSamplesLight = 8;

  float mieCoeff = uBetaM * (T / 3.0);

  // Observer position
  float observerH = uEarthR + alt;
  vec3  ro        = vec3(0.0, observerH, 0.0);

  // View direction from azimuth and elevation
  float viewElRad = radians(max(viewElDeg, 0.0));
  float viewAzRad = radians(viewAzDeg);
  float ce        = cos(viewElRad);
  vec3  viewDir   = vec3(ce * sin(viewAzRad), sin(viewElRad), ce * cos(viewAzRad));

  // Sun direction (azimuth = 0)
  vec3 sunDir = vec3(0.0, sin(sunElev), cos(sunElev));

  // Angle between view and sun
  float cosViewSun = dot(viewDir, sunDir);

  // Ray march: find exit distance through atmosphere
  vec2 tHit = raySphereIntersect(ro, viewDir, uAtmoR);
  if (tHit.x < 0.0) return vec3(0.0);
  float tMax = tHit.x;

  float ds = tMax / float(numSamples);

  float totalSpec[NSPEC];
  for (int b = 0; b < NSPEC; b++) totalSpec[b] = 0.0;
  float opticalDepthR = 0.0;
  float opticalDepthM = 0.0;
  float opticalDepthO = 0.0;   // scalar ozone density depth; σ(λ) applied per bin

  for (int i = 0; i < numSamples; i++) {
    float t      = (float(i) + 0.5) * ds;
    vec3  p      = ro + viewDir * t;
    float height = length(p) - uEarthR;

    if (height < 0.0) break; // hit ground

    float hr = exp(-height / uHR) * ds;
    float hm = exp(-height / uHM) * ds;

    // Ozone density: double-exponential centered at OZONE_PEAK
    float ho = exp(-2.0 * abs(height - OZONE_PEAK) / OZONE_SCALE) * ozone * ds;

    opticalDepthR += hr;
    opticalDepthM += hm;
    opticalDepthO += ho;

    // Sun ray from this sample point
    vec2 tSunHit = raySphereIntersect(p, sunDir, uAtmoR);
    if (tSunHit.x < 0.0) continue;
    float tSun = tSunHit.x;

    float dsSun     = tSun / float(numSamplesLight);
    float odR_sun   = 0.0;
    float odM_sun   = 0.0;
    float odO_sun   = 0.0;
    bool  hitGround = false;

    for (int j = 0; j < numSamplesLight; j++) {
      float ts = (float(j) + 0.5) * dsSun;
      vec3  s  = p + sunDir * ts;
      float sh = length(s) - uEarthR;
      if (sh < 0.0) { hitGround = true; break; }
      odR_sun += exp(-sh / uHR) * dsSun;
      odM_sun += exp(-sh / uHM) * dsSun;
      odO_sun += exp(-2.0 * abs(sh - OZONE_PEAK) / OZONE_SCALE) * ozone * dsSun;
    }
    if (hitGround) continue;

    // Rayleigh phase: 3/(16π)(1+cos²γ)
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + cosViewSun * cosViewSun);

    // Mie phase: Henyey-Greenstein, g=0.76
    float g      = 0.76;
    float phaseM = 3.0 / (8.0 * PI) *
                   ((1.0 - g * g) * (1.0 + cosViewSun * cosViewSun)) /
                   ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosViewSun, 1.5));

    // Per-bin accumulation including ozone optical depth
    float odR    = opticalDepthR + odR_sun;
    float odO    = opticalDepthO + odO_sun;
    float tauMie = mieCoeff * 1.1 * (opticalDepthM + odM_sun);
    float mieS   = mieCoeff * hm * phaseM;
    for (int b = 0; b < NSPEC; b++) {
      float beta = uBetaRSpec[b];
      float tau  = beta * odR + tauMie + uBetaO3Spec[b] * odO;
      totalSpec[b] += exp(-tau) * (beta * hr * phaseR + mieS);
    }
  }

  // Twilight boost: indirect illumination during twilight
  float twilightBoost = sunElev < 0.0 ? exp(sunElev * 4.0) * 0.3 : 0.0;

  vec3 rgb = (spectralToRGB(totalSpec, uStarTemp[gStarIndex]) +
              twilightBoost * 0.001) * uSunIntensity;
  return toneMap(rgb, 1.0);
}
