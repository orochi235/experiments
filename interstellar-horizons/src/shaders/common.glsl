// common.glsl — shared declarations and helpers included by every fragment shader
// #version 300 es must appear in the top-level shader file, not here.

precision highp float;
out vec4 fragColor;

const float PI  = 3.14159265358979;
const float TAU = 6.28318530717958;

uniform vec2  uResolution;

// Atmosphere
uniform float uT;
uniform float uAlbedo;
uniform float uOzone;
uniform float uAlt;

// Strip-only
uniform float uViewElDeg;
uniform float uHourStart;
uniform float uHourEnd;
uniform float uLat;
uniform float uDoy;

// Dome-only
uniform int uProjection;   // 0=fisheye, 1=equirect, 2=sunfacing

// Stars
const int MAX_STARS = 4;
uniform int   uNStars;
uniform float uStarElev[MAX_STARS];
uniform float uStarAzOff[MAX_STARS];
uniform vec3  uStarColor[MAX_STARS];
uniform float uStarIntensity[MAX_STARS];
uniform float uStarHourOffset[MAX_STARS];

// Atmosphere physics (mutated by presets)
uniform float uEarthR;
uniform float uAtmoR;
uniform float uHR;
uniform float uHM;
uniform vec3  uBetaR;
uniform float uBetaM;
uniform float uSunIntensity;

// Scatter tweak
uniform float uScatterHueShift;
uniform float uScatterSatBoost;

// Style
uniform float uHueShift, uSaturation, uVibrance, uExposure,
              uContrast, uWarmth, uTwilightGlow, uNightTint;

// Ground color (per-preset, set via uniform)
uniform vec3 uGroundColor;
#define GROUND_COLOR uGroundColor

// ============================================================
// SPECTRAL RENDERING
// ============================================================
// The ray-marched models (rayleigh, nishita, ozone, hosek) scatter per
// wavelength bin instead of per RGB channel: NSPEC bins across the visible
// range, integrated against the CIE 1931 color-matching functions and lit
// by each star's actual Planck spectrum. βR(λ) per bin arrives via uniform,
// fit through the preset's three RGB anchor values so each world keeps its
// authored scattering signature (JS side, uniforms.js).

const int   NSPEC   = 16;
const float SPEC_L0 = 380.0;   // nm
const float SPEC_DL = 21.25;   // nm per bin → 380..720

uniform float uBetaRSpec[NSPEC];   // Rayleigh β(λ), includes atmoDensity
uniform float uBetaO3Spec[NSPEC];  // ozone absorption σ(λ)
uniform float uStarTemp[MAX_STARS];
uniform vec3  uWBRef;              // white-balance reference (divides RGB)

// Set by the main() star loop before each modelColor call, so spectral
// models can pick the right star's Planck spectrum.
int gStarIndex = 0;

float specLambda(int b) { return SPEC_L0 + (float(b) + 0.5) * SPEC_DL; }

// Piecewise Gaussian used by the Wyman–Sloan–Shirley CMF fits.
float wssG(float x, float mu, float s1, float s2) {
  float t = (x - mu) / (x < mu ? s1 : s2);
  return exp(-0.5 * t * t);
}

// CIE 1931 2° color-matching functions (Wyman, Sloan, Shirley 2013 fit).
vec3 cmf(float l) {
  float xb = 1.056 * wssG(l, 599.8, 37.9, 31.0)
           + 0.362 * wssG(l, 442.0, 16.0, 26.7)
           - 0.065 * wssG(l, 501.1, 20.4, 26.2);
  float yb = 0.821 * wssG(l, 568.8, 46.9, 40.5)
           + 0.286 * wssG(l, 530.9, 16.3, 31.1);
  float zb = 1.217 * wssG(l, 437.0, 11.8, 36.0)
           + 0.681 * wssG(l, 459.0, 26.0, 13.8);
  return vec3(xb, yb, zb);
}

// Planck spectral radiance, arbitrary scale (normalized in spectralToRGB).
// λ in nm; c2 = hc/k = 14388 μm·K.
float planck(float l, float T) {
  float lum = l * 1e-3;
  float x = 14388.0 / (lum * max(T, 100.0));
  float l5 = lum * lum * lum * lum * lum;
  return 1.0 / (l5 * (exp(x) - 1.0));
}

// XYZ → linear sRGB (same primaries the rest of the pipeline works in;
// uGamut converts onward to the output space inside toneMap).
const mat3 XYZ_TO_SRGB = mat3(
   3.2406, -0.9689,  0.0557,
  -1.5372,  1.8758, -0.2040,
  -0.4986,  0.0415,  1.0570
);

// Integrate per-bin scattered radiance, lit by a Planck spectrum at T,
// against the CMFs. The spectrum is luminance-normalized (Σ S·ȳ = 1) so
// overall sky brightness matches the old white-sun convention, and the
// result is white-balance-divided like uStarColor used to be.
vec3 spectralToRGB(float spec[NSPEC], float T) {
  float w[NSPEC];
  float ynorm = 0.0;
  for (int b = 0; b < NSPEC; b++) {
    float l = specLambda(b);
    w[b] = planck(l, T);
    ynorm += w[b] * cmf(l).y;
  }
  vec3 xyz = vec3(0.0);
  for (int b = 0; b < NSPEC; b++) {
    xyz += spec[b] * w[b] * cmf(specLambda(b));
  }
  xyz /= max(ynorm, 1e-9);
  return (XYZ_TO_SRGB * xyz) / uWBRef;
}

// ============================================================
// UTILITIES
// ============================================================

// CIE Yxy -> linear RGB (sRGB D65 matrix)
// Returns values in linear light (not 0-255).
vec3 YxyToRGB(float Y, float x, float y) {
  if (y < 1e-6) return vec3(0.0);
  float X = x * Y / y;
  float Z = (1.0 - x - y) * Y / y;
  float r =  3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  float g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  float b =  0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  return vec3(r, g, b);
}

// Working-space (linear sRGB primaries) → output-space linear RGB.
// Identity when the canvas is sRGB; the linear sRGB→P3 / sRGB→Rec.2020
// matrix when the buffer is tagged wide-gamut. Applied in linear light,
// before any clamp, so out-of-sRGB-gamut colors survive into the wider gamut.
uniform mat3 uGamut;
// Output transfer curve: 0 = sRGB piecewise (sRGB and Display P3 share it),
// 1 = BT.2020 OETF (4.5x linear toe, α·x^0.45 − (α−1) above β).
uniform int uOETF;

// Reinhard tone mapping + output encoding. Input: linear light. Output: 0-255.
vec3 toneMap(vec3 rgb, float exposure) {
  vec3 c = uGamut * (rgb * exposure);
  // Reinhard per-channel
  c = c / (1.0 + c);
  vec3 enc;
  if (uOETF == 1) {
    // BT.2020 (α = 1.09929682680944, β = 0.018053968510807)
    vec3 lo = 4.5 * c;
    vec3 hi = 1.09929682680944 * pow(max(c, vec3(0.0)), vec3(0.45)) - 0.09929682680944;
    enc = mix(lo, hi, vec3(greaterThan(c, vec3(0.018053968510807))));
  } else {
    // sRGB piecewise gamma
    vec3 lo = 12.92 * c;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    enc = mix(lo, hi, vec3(greaterThan(c, vec3(0.0031308))));
  }
  return clamp(enc, 0.0, 1.0) * 255.0;
}

// ============================================================
// COLOR MANIPULATION (post-process)
// ============================================================

// Input: RGB in 0-255. Output: HSL each in 0-1.
vec3 rgbToHsl(vec3 c) {
  float r = c.r / 255.0;
  float g = c.g / 255.0;
  float b = c.b / 255.0;
  float maxC = max(max(r, g), b);
  float minC = min(min(r, g), b);
  float l = (maxC + minC) / 2.0;
  float h, s;
  if (maxC == minC) {
    h = 0.0;
    s = 0.0;
  } else {
    float d = maxC - minC;
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == r)      h = ((g - b) / d + (g < b ? 6.0 : 0.0)) / 6.0;
    else if (maxC == g) h = ((b - r) / d + 2.0) / 6.0;
    else                h = ((r - g) / d + 4.0) / 6.0;
  }
  return vec3(h, s, l);
}

// Inner hue helper used by hslToRgb
float hue2rgb(float p, float q, float t) {
  float tt = t;
  if (tt < 0.0) tt += 1.0;
  if (tt > 1.0) tt -= 1.0;
  if (tt < 1.0 / 6.0) return p + (q - p) * 6.0 * tt;
  if (tt < 1.0 / 2.0) return q;
  if (tt < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - tt) * 6.0;
  return p;
}

// Input: HSL each in 0-1 (h wraps). Output: RGB in 0-255.
vec3 hslToRgb(vec3 hsl) {
  float h = fract(hsl.x);   // ensure [0,1)
  float s = hsl.y;
  float l = hsl.z;
  if (s == 0.0) return vec3(l * 255.0);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  float r = hue2rgb(p, q, h + 1.0 / 3.0);
  float g = hue2rgb(p, q, h);
  float b = hue2rgb(p, q, h - 1.0 / 3.0);
  return vec3(r, g, b) * 255.0;
}

// ============================================================
// STYLE APPLICATION
// ============================================================

// Apply post-process style to a 0-255 RGB color.
// Style parameters come from uniforms (uHueShift, uSaturation, etc.).
vec3 applyStyle(vec3 rgb, float primarySunElev) {
  float r = rgb.r;
  float g = rgb.g;
  float b = rgb.b;

  // Exposure (applied before other ops)
  float expMul = pow(2.0, uExposure);
  r *= expMul; g *= expMul; b *= expMul;

  // Warmth: shift color temperature
  if (uWarmth != 0.0) {
    float w = uWarmth;
    r *= 1.0 + w * 0.15;
    g *= 1.0 + w * 0.05;
    b *= 1.0 - w * 0.2;
  }

  // Twilight glow: boost near sunrise/sunset
  float deg6  = radians(6.0);
  float deg15 = radians(15.0);
  float deg2  = radians(2.0);
  float deg10 = radians(10.0);

  if (uTwilightGlow != 1.0 && primarySunElev > -deg6 && primarySunElev < deg15) {
    float proximity = 1.0 - abs(primarySunElev) / deg15;
    float boost = 1.0 + (uTwilightGlow - 1.0) * proximity * proximity;
    r *= 1.0 + (boost - 1.0) * 1.2;
    g *= 1.0 + (boost - 1.0) * 0.6;
    b *= 1.0 + (boost - 1.0) * 0.3;
  }

  // Night tint: add subtle blue-purple to dark areas
  if (uNightTint > 0.0 && primarySunElev < deg2) {
    float darkness = clamp((deg2 - primarySunElev) / deg10, 0.0, 1.0);
    float lum = (r + g + b) / 3.0;
    float tintStrength = uNightTint * darkness * (1.0 - lum / 255.0) * 0.5;
    r += 15.0 * tintStrength;
    g +=  5.0 * tintStrength;
    b += 40.0 * tintStrength;
  }

  // Clamp before HSL conversion
  r = clamp(r, 0.0, 255.0);
  g = clamp(g, 0.0, 255.0);
  b = clamp(b, 0.0, 255.0);

  // Convert to HSL for hue/sat/vibrance
  vec3 hsl = rgbToHsl(vec3(r, g, b));
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  // Hue shift
  h += uHueShift / 360.0;

  // Saturation
  s *= uSaturation;

  // Vibrance (boosts low-saturation colors more)
  if (uVibrance != 0.0) {
    float vibranceBoost = uVibrance * (1.0 - s) * 0.8;
    s = clamp(s + vibranceBoost, 0.0, 1.0);
  }

  s = clamp(s, 0.0, 1.0);

  vec3 out_rgb = hslToRgb(vec3(h, s, l));
  r = out_rgb.r; g = out_rgb.g; b = out_rgb.b;

  // Contrast (around midpoint 128)
  r = clamp((r - 128.0) * uContrast + 128.0, 0.0, 255.0);
  g = clamp((g - 128.0) * uContrast + 128.0, 0.0, 255.0);
  b = clamp((b - 128.0) * uContrast + 128.0, 0.0, 255.0);

  return vec3(r, g, b);
}

// ============================================================
// GEOMETRY HELPERS
// ============================================================

// Scattering angle γ between view direction and sun direction.
// sunElevRad: sun elevation in radians; viewElDeg/viewAzDeg: view in degrees.
float scatteringAngle(float sunElevRad, float viewElDeg, float viewAzDeg) {
  float ve = radians(viewElDeg);
  float va = radians(viewAzDeg);
  float cosG = sin(sunElevRad) * sin(ve) +
               cos(sunElevRad) * cos(ve) * cos(va);
  return acos(clamp(cosG, -1.0, 1.0));
}

// Sun elevation in radians from latitude (uLat), day-of-year (uDoy), and hour.
float sunElevationAt(float hour) {
  float decl = 23.4393 * sin(TAU * (284.0 + uDoy) / 365.0);
  float declR = radians(decl);
  float latR  = radians(uLat);
  float ha    = radians((hour - 12.0) * 15.0);
  return asin(sin(latR) * sin(declR) + cos(latR) * cos(declR) * cos(ha));
}

// Map fragment pixel to (viewAz, viewEl) in degrees.
// Returns false if the pixel is outside the visible sky (e.g. outside fisheye disc
// or below the horizon in equirect/sunfacing). On false, outputs are set to 0.
// uProjection: 0=fisheye, 1=equirect, 2=sunfacing.
bool pixelToViewAzEl(vec2 px, vec2 dims, out float viewAz, out float viewEl) {
  viewAz = 0.0;
  viewEl = 0.0;
  // gl_FragCoord.y has origin at the bottom — flip so top of canvas = sky-up.
  float yTop = dims.y - px.y;

  if (uProjection == 0) {
    // Fisheye: circular disc maps full hemisphere
    float cx = dims.x / 2.0;
    float cy = dims.y / 2.0;
    float dx = (px.x - cx) / cx;   // -1..1
    float dy = (yTop  - cy) / cy;  // -1..1, +y = up on screen
    float r  = sqrt(dx * dx + dy * dy);
    if (r > 1.0) return false;
    viewEl = (1.0 - r) * 90.0;
    viewAz = atan(dx, -dy) * 180.0 / PI;
    return true;
  }

  if (uProjection == 1) {
    // Equirect: full 360° az. viewEl can be negative (below horizon → ground).
    viewAz = (px.x / dims.x) * 360.0 - 180.0;
    viewEl = 90.0 - (yTop / dims.y) * 100.0;
    return true;
  }

  if (uProjection == 2) {
    // Sun-facing: ±90° az. viewEl can be negative.
    viewAz = (px.x / dims.x) * 180.0 - 90.0;
    viewEl = 90.0 - (yTop / dims.y) * 100.0;
    return true;
  }

  return false;
}

// Directionally-lit ground shading. Brighter on the sun-facing side, dimmer
// when the sun is low, fades toward atmospheric haze near horizon. All
// inputs in degrees / radians as labeled.
vec3 shadeGround(float viewAzDeg, float viewElDeg) {
  float sunElev = uStarElev[0];           // radians
  float sunAzDeg = uStarAzOff[0];         // degrees, relative to primary
  // Directional component: 1 facing the sun, 0 facing away
  float azDiff = radians(viewAzDeg - sunAzDeg);
  float dirLight = cos(azDiff) * 0.5 + 0.5;
  // Ambient from sun elevation (sin gives Lambertian-like falloff)
  float ambient = clamp(sin(sunElev), 0.0, 1.0) * 0.7 + 0.15;
  // Depth: 0 at horizon, 1 at -10° (deeper looking down)
  float depth = clamp(-viewElDeg / 10.0, 0.0, 1.0);
  vec3 lit = uGroundColor * (0.35 + 0.65 * ambient * dirLight);
  // Atmospheric haze near horizon: bias toward primary star tint
  vec3 hazeTint = uStarColor[0] * 255.0 * 0.3;
  lit = mix(hazeTint + lit * 0.7, lit, depth);
  // Subtle darkening at maximum depth
  lit = mix(lit, lit * 0.7, depth * 0.4);
  return clamp(lit, 0.0, 255.0);
}

// Apply per-scatter hue shift and saturation boost (operates in 0-255 RGB space).
vec3 applyScatterTweak(vec3 rgb) {
  if (uScatterHueShift == 0.0 && uScatterSatBoost == 1.0) return rgb;
  vec3 hsl = rgbToHsl(clamp(rgb, 0.0, 255.0));
  hsl.x = fract(hsl.x + uScatterHueShift / 360.0);
  hsl.y = clamp(hsl.y * uScatterSatBoost, 0.0, 1.0);
  return hslToRgb(hsl);
}

// ============================================================
// STRIP HELPER
// ============================================================

// Map the current fragment's x coordinate to a solar hour in [uHourStart, uHourEnd].
float fragHour() {
  return mix(uHourStart, uHourEnd, gl_FragCoord.x / uResolution.x);
}
