// sRGB hex ↔ OKLCH. Reference: Björn Ottosson's OKLab conversion constants.

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; }

export function hexToOklch(hex) {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToSrgb({ L, C, h }) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(linearToSrgb);
}

export function oklchToHex(c) {
  const to255 = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  return '#' + oklchToSrgb(c).map(v => to255(v).toString(16).padStart(2, '0')).join('');
}

// Largest in-gamut chroma at (L, h): per-channel clipping shifts hue, so
// out-of-gamut colors reduce chroma (hue and lightness held) instead.
function fitChroma({ L, C, h }) {
  const fits = (c) => oklchToSrgb({ L, C: c, h }).every(v => v >= -1e-4 && v <= 1 + 1e-4);
  if (fits(C)) return C;
  let lo = 0, hi = C;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// Map `hex`'s relationship to `baseHex` onto `newBaseHex`.
export function remapColor(hex, baseHex, newBaseHex) {
  const c = hexToOklch(hex), b = hexToOklch(baseHex), n = hexToOklch(newBaseHex);
  // Below this chroma the base is effectively gray and its per-shade hue and
  // chroma variation is quantization noise (the neutral asset base #9ba19d
  // has C ≈ 0.009): keep the new base's hue, scale chroma with lightness.
  const baseIsGray = b.C < 2e-2;
  const rL = b.L > 1e-6 ? c.L / b.L : 1;
  const L = Math.min(1, Math.max(0, n.L * rL));
  const C = baseIsGray ? n.C * rL : n.C * (c.C / b.C);
  const h = baseIsGray ? n.h : n.h + (c.h - b.h);
  return oklchToHex({ L, C: fitChroma({ L, C, h }), h });
}
