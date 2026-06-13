// Dome rendering: (px, py) → (viewAz, viewEl) per projection mode →
// modelColor with per-star sun elev and az offset → blend → style.

void main() {
  float viewAz, viewEl;
  bool inProj = pixelToViewAzEl(gl_FragCoord.xy, uResolution, viewAz, viewEl);
  if (!inProj) {
    // Fisheye corner (outside the disc) — use deep, unlit ground.
    fragColor = vec4(uGroundColor * 0.4 / 255.0, 1.0);
    return;
  }
  if (viewEl < 0.0) {
    // Below horizon — directionally-lit ground.
    fragColor = vec4(shadeGround(viewAz, viewEl) / 255.0, 1.0);
    return;
  }
  vec3 rgb = vec3(0.0);
  float primaryElev = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uNStars) break;
    float sElev = uStarElev[i];
    if (i == 0) primaryElev = sElev;
    gStarIndex = i;
    vec3 c = modelColor(sElev, uT, viewEl, viewAz - uStarAzOff[i],
                       uAlt, uAlbedo, uOzone);
#ifdef SPECTRAL_TINT
    // Spectral models already carry the star's Planck spectrum + white
    // balance — multiplying by uStarColor would double-tint.
    rgb += c * uStarIntensity[i];
#else
    rgb += c * uStarColor[i] * uStarIntensity[i];
#endif
  }
  rgb = applyScatterTweak(rgb);
  rgb = applyStyle(rgb, primaryElev);
  fragColor = vec4(clamp(rgb, 0.0, 255.0) / 255.0, 1.0);
}
