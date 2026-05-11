// cie.glsl — CIE Standard Clear Sky (Type 12)
// Depends on: common.glsl

vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  // CIE Clear doesn't use alt, albedo, or ozone.

  if (sunElev < radians(-6.0)) return vec3(0.0);

  float sunTheta  = PI / 2.0 - sunElev;
  float viewTheta = PI / 2.0 - radians(viewElDeg);
  float gamma     = scatteringAngle(sunElev, viewElDeg, viewAzDeg);

  // CIE Type 12 parameters (Clear sky, polluted)
  const float a = -1.0, b = -0.32, c = 10.0, d = -3.0, e = 0.45;

  // Gradation: φ(θ) = 1 + a·exp(b/cosθ)
  float phiView = 1.0 + a * exp(b / (cos(viewTheta) + 0.01));
  float phiSun  = 1.0 + a * exp(b / (cos(sunTheta)  + 0.01));

  // Indicatrix: f(γ) = 1 + c·(exp(d·γ) − exp(d·π/2)) + e·cos²γ
  float fGamma = 1.0 + c * (exp(d * gamma)      - exp(d * PI / 2.0)) + e * cos(gamma) * cos(gamma);
  float fSun   = 1.0 + c * (exp(d * sunTheta)   - exp(d * PI / 2.0)) + e * cos(sunTheta) * cos(sunTheta);

  float L  = phiView * fGamma;
  float Lz = phiSun  * fSun;
  L = max(0.0, L / Lz);

  // Scale luminance with sun elevation
  float sunScale = clamp(sin(sunElev) * 1.5, 0.0, 1.0);
  float Y = L * sunScale * 2.5;

  // Approximate daylight chromaticity from correlated color temperature.
  // CCT varies: ~15000 K at zenith midday → ~3000 K near horizon/sunset.
  float elevFactor = clamp(sunElev / radians(60.0), 0.0, 1.0);
  float viewFactor = clamp(radians(viewElDeg) / radians(90.0), 0.3, 1.0);
  float cct = mix(3500.0, 12000.0 + 3000.0 * viewFactor, elevFactor * viewFactor);

  // Hernandez-Andres approximation for daylight chromaticity
  float x;
  if (cct <= 7000.0) {
    x = -4.6070e9 / (cct * cct * cct)
      +  2.9678e6 / (cct * cct)
      +  0.09911e3 / cct
      +  0.244063;
  } else {
    x = -2.0064e9 / (cct * cct * cct)
      +  1.9018e6 / (cct * cct)
      +  0.24748e3 / cct
      +  0.237040;
  }
  float y = -3.0 * x * x + 2.87 * x - 0.275;

  float twilightFade = clamp((sunElev + radians(6.0)) / radians(6.0), 0.0, 1.0);
  vec3 rgb = YxyToRGB(Y * twilightFade, x, y);
  return toneMap(rgb, 0.15);
}
