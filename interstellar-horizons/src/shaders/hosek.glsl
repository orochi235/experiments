// hosek.glsl — Hosek sky model
// Depends on: common.glsl

// Ray-sphere intersection. Sphere centered at origin, radius r.
// Returns the positive (far) t, or -1 if no intersection.
float raySphereIntersect(vec3 ro, vec3 rd, float r) {
  float b = 2.0 * dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float disc = b * b - 4.0 * c;
  if (disc < 0.0) return -1.0;
  return (-b + sqrt(disc)) / 2.0;
}

// Build view direction from azimuth/elevation in degrees.
vec3 viewDirFromAzEl(float azDeg, float elDeg) {
  float az = radians(azDeg);
  float el = radians(elDeg);
  float ce = cos(el);
  return vec3(ce * sin(az), sin(el), ce * cos(az));
}

vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  // alt and ozone are not used by this model.

  if (sunElev < radians(-8.0)) return vec3(0.0);

  const int   NUM_SAMPLES       = 24;
  const int   NUM_SAMPLES_LIGHT = 8;
  const float g = 0.76;

  float mieCoeff = uBetaM * (T / 3.0);

  float observerH = uEarthR + alt;
  vec3  ro        = vec3(0.0, observerH, 0.0);

  vec3  viewDir = viewDirFromAzEl(viewAzDeg, max(viewElDeg, 0.0));
  vec3  sunDir  = vec3(0.0, sin(sunElev), cos(sunElev));

  float cosViewSun = dot(viewDir, sunDir);

  float tMax = raySphereIntersect(ro, viewDir, uAtmoR);
  if (tMax < 0.0) return vec3(0.0);

  float ds = tMax / float(NUM_SAMPLES);
  vec3  totalR       = vec3(0.0);
  float opticalDepthR = 0.0;
  float opticalDepthM = 0.0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    float t  = (float(i) + 0.5) * ds;
    vec3  p  = ro + viewDir * t;
    float height = length(p) - uEarthR;

    if (height < 0.0) break;

    float hr = exp(-height / uHR) * ds;
    float hm = exp(-height / uHM) * ds;
    opticalDepthR += hr;
    opticalDepthM += hm;

    float tSun = raySphereIntersect(p, sunDir, uAtmoR);
    if (tSun < 0.0) continue;

    float dsSun  = tSun / float(NUM_SAMPLES_LIGHT);
    float odR_sun = 0.0;
    float odM_sun = 0.0;
    bool  hitGround = false;

    for (int j = 0; j < NUM_SAMPLES_LIGHT; j++) {
      float ts = (float(j) + 0.5) * dsSun;
      vec3  s  = p + sunDir * ts;
      float sh = length(s) - uEarthR;
      if (sh < 0.0) { hitGround = true; break; }
      odR_sun += exp(-sh / uHR) * dsSun;
      odM_sun += exp(-sh / uHM) * dsSun;
    }
    if (hitGround) continue;

    // Cornette-Shanks phase function (improved Mie)
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + cosViewSun * cosViewSun);
    float cs_num = 3.0 * (1.0 - g * g) * (1.0 + cosViewSun * cosViewSun);
    float cs_den = (8.0 * PI) * (2.0 + g * g) *
                   pow(1.0 + g * g - 2.0 * g * cosViewSun, 1.5);
    float phaseM = cs_num / cs_den;

    // Per-channel accumulation (BETA_R is vec3 for R,G,B)
    vec3 tau = uBetaR * (opticalDepthR + odR_sun) +
               mieCoeff * 1.1 * (opticalDepthM + odM_sun);
    vec3 attn = exp(-tau);

    vec3 scatter = uBetaR * hr * phaseR + mieCoeff * hm * phaseM;
    totalR += attn * scatter;

    // Multiple scattering approximation (order-2, isotropic)
    vec3 ms = scatter * 0.075 * (1.0 + albedo * 0.5);
    totalR += attn * ms;
  }

  // Ground albedo contribution: sunlight hitting ground, reflecting upward
  if (sunElev > 0.0) {
    float tGround = raySphereIntersect(ro, sunDir, uAtmoR);
    if (tGround > 0.0) {
      float dsG   = tGround / float(NUM_SAMPLES_LIGHT);
      float odR_g = 0.0;
      float odM_g = 0.0;
      for (int j = 0; j < NUM_SAMPLES_LIGHT; j++) {
        float ts = (float(j) + 0.5) * dsG;
        float h  = sqrt((ro.y + sunDir.y * ts) * (ro.y + sunDir.y * ts)) - uEarthR;
        if (h >= 0.0) {
          odR_g += exp(-max(0.0, h) / uHR) * dsG;
          odM_g += exp(-max(0.0, h) / uHM) * dsG;
        }
      }
      vec3 tauG       = uBetaR * odR_g + mieCoeff * 1.1 * odM_g;
      vec3 groundIrrad = exp(-tauG) * sin(sunElev);
      totalR += albedo * groundIrrad * 0.015 * exp(-uBetaR * opticalDepthR);
    }
  }

  // Twilight contribution
  float twilightBoost = sunElev < 0.0 ? exp(sunElev * 4.0) * 0.3 : 0.0;
  vec3  rgb = (totalR + twilightBoost * 0.001) * uSunIntensity;
  return toneMap(rgb, 1.0);
}
