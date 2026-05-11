// Ported from sky-color/sky-models.html lines 1169–1220, 1415–1421, 1432–1458

const PI = Math.PI, TAU = 2 * PI;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// View direction vector from azimuth+elevation (degrees).
// Coordinates match the existing sky models: sun lives at +z meridian.
// x: east (perpendicular to sun meridian), y: up, z: toward sun horizontally.
// viewAz = 0 → in sun's vertical plane (same as legacy hardcoded viewDir).
export function viewDirFromAzEl(azDeg, elDeg) {
  const az = azDeg * PI / 180;
  const el = elDeg * PI / 180;
  const ce = Math.cos(el);
  return [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)];
}

// Scattering angle γ between view and sun directions, both in radians.
// sunAz is assumed = 0 throughout this lab.
export function scatteringAngle(sunElevRad, viewElDeg, viewAzDeg) {
  const ve = viewElDeg * PI / 180;
  const va = viewAzDeg * PI / 180;
  const cosG = Math.sin(sunElevRad) * Math.sin(ve) +
               Math.cos(sunElevRad) * Math.cos(ve) * Math.cos(va);
  return Math.acos(clamp(cosG, -1, 1));
}

// Sun elevation in radians given latitude (deg), day of year, hour (local solar time)
export function sunElevation(latDeg, doy, hour) {
  const deg = a => a * PI / 180;
  const decl = 23.4393 * Math.sin(TAU * (284 + doy) / 365);
  const declR = deg(decl);
  const latR = deg(latDeg);
  const ha = deg((hour - 12) * 15);
  return Math.asin(Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(ha));
}

// Sun [elevation, azimuth] in radians. Azimuth is south=0, west=+, east=−.
// Used by the dome view to place secondary stars at their actual sky angles.
export function sunPos(latDeg, doy, hour) {
  const deg = a => a * PI / 180;
  const declR = deg(23.4393 * Math.sin(TAU * (284 + doy) / 365));
  const latR = deg(latDeg);
  const ha = deg((hour - 12) * 15);
  const sinAlt = Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(ha);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const az = Math.atan2(-Math.cos(declR) * Math.sin(ha),
                        Math.sin(declR) * Math.cos(latR) - Math.cos(declR) * Math.sin(latR) * Math.cos(ha));
  return [alt, az];
}

// Shortest signed difference between two angles in radians, result in (-π, π].
export function angleDiffRad(a, b) {
  return ((a - b + PI) % TAU + TAU) % TAU - PI;
}

// Atmosphere constants (mutable via setAtmosphere)
export let EARTH_R = 6371e3;
export let ATMO_R = 6471e3;
export let HR = 8000;     // Rayleigh scale height
export let HM = 1200;     // Mie scale height
export let BETA_R = [5.5e-6, 13.0e-6, 22.4e-6]; // Rayleigh scattering at sea level (RGB)
export let BETA_M = 21e-6; // Mie scattering at sea level
export let SUN_INTENSITY = 20;

export function setAtmosphere({ earthR, atmoR, hr, hm, betaR, betaM, sunIntensity }) {
  if (earthR != null) EARTH_R = earthR;
  if (atmoR != null) ATMO_R = atmoR;
  if (hr != null) HR = hr;
  if (hm != null) HM = hm;
  if (betaR != null) BETA_R = betaR;
  if (betaM != null) BETA_M = betaM;
  if (sunIntensity != null) SUN_INTENSITY = sunIntensity;
}

export function blackbodyRGB(tempK) {
  // Attempt CIE 1931 2-degree observer approximation for sRGB
  // Using Planckian locus fit by Kim et al.
  const t = tempK;
  let x, y;
  if (t <= 4000) {
    x = -0.2661239e9/(t*t*t) - 0.2343589e6/(t*t) + 0.8776956e3/t + 0.179910;
  } else {
    x = -3.0258469e9/(t*t*t) + 2.1070379e6/(t*t) + 0.2226347e3/t + 0.240390;
  }
  if (t <= 2222) {
    y = -1.1063814*x*x*x - 1.34811020*x*x + 2.18555832*x - 0.20219683;
  } else if (t <= 4000) {
    y = -0.9549476*x*x*x - 1.37418593*x*x + 2.09137015*x - 0.16748867;
  } else {
    y = 3.0817580*x*x*x - 5.87338670*x*x + 3.75112997*x - 0.37001483;
  }
  // Convert xyY (Y=1) to linear RGB
  if (y < 1e-6) return [1, 1, 1];
  const Y = 1, X = x / y, Z = (1 - x - y) / y;
  let r =  3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b =  0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  // Normalize so max channel = 1
  const mx = Math.max(r, g, b, 1e-6);
  return [Math.max(0, r/mx), Math.max(0, g/mx), Math.max(0, b/mx)];
}
