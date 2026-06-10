// Merged-stop shading for the analytic lit-bevel renderer. Each region's
// gradient stops carry the FINAL color: albedo ⊗ (ambient + Σ diffuse) + Σ
// specular, accumulated in linear RGB and emitted as sRGB hex. Lights are
// summed here rather than layered as translucent SVG paths because browser
// compositing happens in sRGB — summing in linear is the physically correct
// path (spec: 2026-06-09-analytic-lit-bevel-design.md).
import type { Region } from './bevelRegions';

export type ContourFn = (x: number) => number;

export interface LitBevelLight {
  az: number;        // degrees
  el: number;        // degrees
  intensity: number;
  color: string;     // hex
}

export interface LitBevelMaterial {
  base: string;          // albedo hex
  heightPx: number;      // contour height amplitude ("Bevel height")
  dMaxPx: number;        // lateral scale: x=1 spans dMaxPx pixels
  diffuse: number;       // diffuse gain
  specular: number;      // specular strength
  shininess: number;     // specular exponent
  specularColor: string;
  ambient: number;       // floor, 0..1
}

// Terms the shading panel can exclude. light-N indexes the lights array.
export type LitBevelTerm = 'ambient' | 'specular' | `light-${number}`;

export interface Stop { offset: number; color: string }

const srgbToLin = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [srgbToLin(v(0)), srgbToLin(v(2)), srgbToLin(v(4))];
}

export function linearToHex(rgb: readonly [number, number, number]): string {
  const ch = (c: number) =>
    Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255)
      .toString(16).padStart(2, '0');
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`;
}

function lightDir(azDeg: number, elDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el)];
}

// Contour slope dh/dx, clamped ≥ 0 to mirror contourTilt's plateau treatment.
function contourSlope(contour: ContourFn, x: number, eps = 0.01): number {
  const hi = Math.min(1, x + eps);
  const lo = Math.max(0, x - eps);
  if (hi <= lo) return 0;
  return Math.max(0, (contour(hi) - contour(lo)) / (hi - lo));
}

function shadeAt(
  x: number,
  region: Region,
  lights: LitBevelLight[],
  lightColors: ReadonlyArray<readonly [number, number, number]>,
  contour: ContourFn,
  m: LitBevelMaterial,
  albedo: readonly [number, number, number],
  specTint: readonly [number, number, number],
  exclude: ReadonlySet<LitBevelTerm>,
): [number, number, number] {
  const s = (contourSlope(contour, x) * m.heightPx) / m.dMaxPx;
  const inv = 1 / Math.hypot(s, 1);
  let dr = 0, dg = 0, db = 0;
  let sr = 0, sg = 0, sb = 0;

  for (let i = 0; i < lights.length; i++) {
    if (exclude.has(`light-${i}`)) continue;
    const light = lights[i]!;
    const L = lightDir(light.az, light.el);
    // Surface normal tilts toward the outward direction m̂ by slope s. For
    // strips/panels m̂ is the region azimuth; the blob is the symmetric fake
    // mode — each light sees the max angular response (m̂ aligned with L_xy).
    const mDotL = region.kind === 'blob'
      ? Math.hypot(L[0], L[1])
      : L[0] * Math.cos((region.azimuthDeg * Math.PI) / 180)
        + L[1] * Math.sin((region.azimuthDeg * Math.PI) / 180);
    const ndl = Math.max(0, (s * mDotL + L[2]) * inv);
    const lc = lightColors[i]!;
    const k = light.intensity * m.diffuse * ndl;
    dr += lc[0] * k; dg += lc[1] * k; db += lc[2] * k;

    if (!exclude.has('specular') && m.specular > 0) {
      // Half vector with the viewer straight overhead.
      const hLen = Math.hypot(L[0], L[1], L[2] + 1);
      const ndh = Math.max(0, (s * mDotL + L[2] + 1) / hLen * inv);
      const ks = light.intensity * m.specular * Math.pow(ndh, m.shininess);
      sr += lc[0] * specTint[0] * ks;
      sg += lc[1] * specTint[1] * ks;
      sb += lc[2] * specTint[2] * ks;
    }
  }

  const amb = exclude.has('ambient') ? 0 : m.ambient;
  return [
    Math.min(1, albedo[0] * (amb + dr) + sr),
    Math.min(1, albedo[1] * (amb + dg) + sg),
    Math.min(1, albedo[2] * (amb + db) + sb),
  ];
}

export function computeStops(
  region: Region,
  lights: LitBevelLight[],
  contour: ContourFn,
  material: LitBevelMaterial,
  exclude: ReadonlySet<LitBevelTerm> = new Set(),
  samples = 17,
): Stop[] {
  // Parse hex colors once per call, not once per sample.
  const albedo = hexToLinear(material.base);
  const specTint = hexToLinear(material.specularColor);
  const lightColors = lights.map(l => hexToLinear(l.color));

  if (region.frame.kind === 'solid') {
    const color = linearToHex(
      shadeAt(region.x1, region, lights, lightColors, contour, material, albedo, specTint, exclude),
    );
    return [{ offset: 0, color }, { offset: 1, color }];
  }
  const stops: Stop[] = [];
  for (let k = 0; k < samples; k++) {
    const u = k / (samples - 1);
    const x = region.x0 + (region.x1 - region.x0) * u;
    stops.push({
      offset: u,
      color: linearToHex(
        shadeAt(x, region, lights, lightColors, contour, material, albedo, specTint, exclude),
      ),
    });
  }
  return stops;
}
