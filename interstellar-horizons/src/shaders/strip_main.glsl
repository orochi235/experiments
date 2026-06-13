void main() {
  float hour = fragHour();
  vec3 rgb = vec3(0.0);
  float primaryElev = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uNStars) break;
    float sElev = sunElevationAt(hour + uStarHourOffset[i]);
    if (i == 0) primaryElev = sElev;
    gStarIndex = i;
    vec3 c = modelColor(sElev, uT, uViewElDeg, 0.0, uAlt, uAlbedo, uOzone);
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
