// preetham.glsl — Preetham sky model
// Depends on: common.glsl (YxyToRGB, toneMap, scatteringAngle, PI)

// Perez distribution function.
// Coefficients A..E are passed directly as floats (no struct).
float perez(float A, float B, float C, float D, float E, float theta, float gamma) {
  float cosG = cos(gamma);
  return (1.0 + A * exp(B / (cos(theta) + 0.01))) *
         (1.0 + C * exp(D * gamma) + E * cosG * cosG);
}

// modelColor — Preetham sky radiance at a given view direction.
// sunElev: sun elevation in radians
// T: turbidity
// viewElDeg: view elevation in degrees (clamped to >= 0 inside)
// viewAzDeg: view azimuth in degrees
// alt, albedo, ozone: unused by this model (Preetham doesn't support them)
// Returns RGB in 0..255 range (tone-mapped + gamma).
vec3 modelColor(float sunElev, float T, float viewElDeg, float viewAzDeg,
                float alt, float albedo, float ozone) {
  // Deep twilight: return black
  if (sunElev < radians(-6.0)) return vec3(0.0);

  float sunTheta = PI / 2.0 - sunElev; // sun zenith angle
  float T2 = T * T;
  float st  = clamp(sunTheta, 0.0, PI / 2.0 - 0.01);
  float st2 = st * st;
  float st3 = st2 * st;

  // Zenith luminance (kcd/m²)
  float chi = (4.0 / 9.0 - T / 120.0) * (PI - 2.0 * st);
  float Yz = (4.0453 * T - 4.9710) * tan(chi) - 0.2155 * T + 2.4192;
  Yz = max(0.0, Yz);

  // Zenith chromaticity
  float xz = ( 0.00166 * st3 - 0.00375 * st2 + 0.00209 * st) * T2 +
             (-0.02903 * st3 + 0.06377 * st2 - 0.03202 * st + 0.00394) * T +
             ( 0.11693 * st3 - 0.21196 * st2 + 0.06052 * st + 0.25886);
  float yz = ( 0.00275 * st3 - 0.00610 * st2 + 0.00317 * st) * T2 +
             (-0.04214 * st3 + 0.08970 * st2 - 0.04153 * st + 0.00516) * T +
             ( 0.15346 * st3 - 0.26756 * st2 + 0.06670 * st + 0.26688);

  // Perez coefficients for Y, x, y
  float pYA =  0.1787 * T - 1.4630;
  float pYB = -0.3554 * T + 0.4275;
  float pYC = -0.0227 * T + 5.3251;
  float pYD =  0.1206 * T - 2.5771;
  float pYE = -0.0670 * T + 0.3703;

  float pxA = -0.0193 * T - 0.2592;
  float pxB = -0.0665 * T + 0.0008;
  float pxC = -0.0004 * T + 0.2125;
  float pxD = -0.0641 * T - 0.8989;
  float pxE = -0.0033 * T + 0.0452;

  float pyA = -0.0167 * T - 0.2608;
  float pyB = -0.0950 * T + 0.0092;
  float pyC = -0.0079 * T + 0.2102;
  float pyD = -0.0441 * T - 1.6537;
  float pyE = -0.0109 * T + 0.0529;

  // View direction
  float viewElClamped = max(viewElDeg, 0.0);
  float viewTheta = PI / 2.0 - radians(viewElClamped);
  float gamma = scatteringAngle(sunElev, viewElClamped, viewAzDeg);

  // Sky color = zenith value * F(viewTheta, gamma) / F(0, sunTheta)
  float fRatioY = perez(pYA, pYB, pYC, pYD, pYE, viewTheta, gamma) /
                  perez(pYA, pYB, pYC, pYD, pYE, 0.0,       st);
  float fRatioX = perez(pxA, pxB, pxC, pxD, pxE, viewTheta, gamma) /
                  perez(pxA, pxB, pxC, pxD, pxE, 0.0,       st);
  float fRatioYc= perez(pyA, pyB, pyC, pyD, pyE, viewTheta, gamma) /
                  perez(pyA, pyB, pyC, pyD, pyE, 0.0,       st);

  float Y = max(0.0, Yz * fRatioY);
  float x = xz * fRatioX;
  float y = yz * fRatioYc;

  // Twilight fade
  float twilightFade = clamp((sunElev + radians(6.0)) / radians(6.0), 0.0, 1.0);
  vec3 rgb = YxyToRGB(Y * twilightFade, x, y);
  return toneMap(rgb, 0.04);
}
