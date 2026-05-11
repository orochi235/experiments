// Dome rendering: (px, py) → (viewAz, viewEl) per projection mode →
// modelColor with per-star sun elev and az offset → blend → style.

void main() {
  float viewAz, viewEl;
  bool inside = pixelToViewAzEl(gl_FragCoord.xy, uResolution, viewAz, viewEl);
  if (!inside) {
    fragColor = vec4(GROUND_COLOR / 255.0, 1.0);
    return;
  }
  vec3 rgb = vec3(0.0);
  float primaryElev = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uNStars) break;
    float sElev = uStarElev[i];
    if (i == 0) primaryElev = sElev;
    vec3 c = modelColor(sElev, uT, viewEl, viewAz - uStarAzOff[i],
                       uAlt, uAlbedo, uOzone);
    rgb += c * uStarColor[i] * uStarIntensity[i];
  }
  rgb = applyScatterTweak(rgb);
  rgb = applyStyle(rgb, primaryElev);
  fragColor = vec4(clamp(rgb, 0.0, 255.0) / 255.0, 1.0);
}
