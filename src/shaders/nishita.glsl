// nishita.glsl — Nishita sky model
// Depends on: common.glsl

const float EARTH_R      = 6371000.0;
const float ATMO_R       = 6471000.0;
const float HR           = 8000.0;
const float HM           = 1200.0;
const vec3  BETA_R       = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float BETA_M       = 21e-6;
const float SUN_INTENSITY = 20.0;

// Returns vec2(tFar, tFar) on hit (ray exits sphere at tFar >= 0).
// Returns vec2(-1.0) if no intersection.
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
  // mieScale hardcoded to 1.0 (Task 13 handles mieScale=0 variant separately)
  float mieScale = 1.0;

  if (sunElev < radians(-8.0)) return vec3(0.0);

  const int numSamples      = 24;
  const int numSamplesLight = 8;

  float mieCoeff = BETA_M * (T / 3.0) * mieScale;

  // Observer position
  float observerH = EARTH_R + alt;
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
  vec2 tHit = raySphereIntersect(ro, viewDir, ATMO_R);
  if (tHit.x < 0.0) return vec3(0.0);
  float tMax = tHit.x;

  float ds = tMax / float(numSamples);

  vec3  totalR      = vec3(0.0);
  float opticalDepthR = 0.0;
  float opticalDepthM = 0.0;

  for (int i = 0; i < numSamples; i++) {
    float t  = (float(i) + 0.5) * ds;
    vec3  p  = ro + viewDir * t;
    float height = length(p) - EARTH_R;

    if (height < 0.0) break; // hit ground

    float hr = exp(-height / HR) * ds;
    float hm = exp(-height / HM) * ds;
    opticalDepthR += hr;
    opticalDepthM += hm;

    // Sun ray from this sample point
    vec2 tSunHit = raySphereIntersect(p, sunDir, ATMO_R);
    if (tSunHit.x < 0.0) continue;
    float tSun = tSunHit.x;

    float dsSun     = tSun / float(numSamplesLight);
    float odR_sun   = 0.0;
    float odM_sun   = 0.0;
    bool  hitGround = false;

    for (int j = 0; j < numSamplesLight; j++) {
      float ts = (float(j) + 0.5) * dsSun;
      vec3  s  = p + sunDir * ts;
      float sh = length(s) - EARTH_R;
      if (sh < 0.0) { hitGround = true; break; }
      odR_sun += exp(-sh / HR) * dsSun;
      odM_sun += exp(-sh / HM) * dsSun;
    }
    if (hitGround) continue;

    // Rayleigh phase: 3/(16π)(1+cos²γ)
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + cosViewSun * cosViewSun);

    // Mie phase: Henyey-Greenstein, g=0.76
    float g      = 0.76;
    float phaseM = 3.0 / (8.0 * PI) *
                   ((1.0 - g * g) * (1.0 + cosViewSun * cosViewSun)) /
                   ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosViewSun, 1.5));

    // Per-channel accumulation (Rayleigh is wavelength-dependent; Mie is not)
    vec3 tau  = BETA_R * (opticalDepthR + odR_sun) +
                mieCoeff * 1.1 * (opticalDepthM + odM_sun);
    vec3 attn = exp(-tau);

    totalR += attn * (BETA_R * hr * phaseR + mieCoeff * hm * phaseM);
  }

  // Twilight boost: indirect illumination during twilight
  float twilightBoost = sunElev < 0.0 ? exp(sunElev * 4.0) * 0.3 : 0.0;

  vec3 rgb = (totalR + twilightBoost * 0.001) * SUN_INTENSITY;
  return toneMap(rgb, 1.0);
}
