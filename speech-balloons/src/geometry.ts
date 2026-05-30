// Body+tail union pipeline lifted from the badge lab (weasel-ui Badge).
//
// A BaseSampler exposes the body silhouette as a path plus an `perimeterAt(s)`
// function returning {x, y, nx, ny} at arc length `s`. The classic tail is
// modeled as an "offset effect": at each perimeter sample, it contributes an
// additive {dx, dy} pushing the silhouette outward in a triangular bump
// centered on the attachment point. The final body+classic-tail is one closed
// path traced through ~720 displaced samples — so stroke / shadow can apply to
// a single shape. Bubbles and lightning are rendered as separate decorations
// that attach at the same perimeter point but don't deform the body silhouette.

import type { BalloonBase, ParamBag } from './types';

export interface PerimeterPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface BaseSampler {
  bodyPath: string;
  perimeterAt: (s: number) => PerimeterPoint;
  totalLen: number;
}

// --- Rounded rectangle ----------------------------------------------------

export function buildRoundedRect(boxW: number, boxH: number, radius: number): BaseSampler {
  const r = Math.max(0, Math.min(radius, Math.min(boxW, boxH) / 2));
  const topLen = Math.max(0, boxW - 2 * r);
  const sideLen = Math.max(0, boxH - 2 * r);
  const arcLen = (Math.PI * r) / 2;
  type Seg = { kind: string; len: number };
  const segs: Seg[] = [
    { kind: 'top', len: topLen },
    { kind: 'tr', len: arcLen },
    { kind: 'right', len: sideLen },
    { kind: 'br', len: arcLen },
    { kind: 'bot', len: topLen },
    { kind: 'bl', len: arcLen },
    { kind: 'left', len: sideLen },
    { kind: 'tl', len: arcLen },
  ];
  const cum = [0];
  for (const s of segs) cum.push(cum[cum.length - 1] + s.len);
  const totalLen = cum[cum.length - 1] || 1;

  const perimeterAt = (s: number): PerimeterPoint => {
    const sm = ((s % totalLen) + totalLen) % totalLen;
    let i = 0;
    while (i < segs.length - 1 && sm > cum[i + 1]) i++;
    const local = sm - cum[i];
    const t = segs[i].len > 0 ? local / segs[i].len : 0;
    switch (segs[i].kind) {
      case 'top':
        return { x: r + (boxW - 2 * r) * t, y: 0, nx: 0, ny: -1 };
      case 'tr': {
        const a = -Math.PI / 2 + (t * Math.PI) / 2;
        return { x: boxW - r + r * Math.cos(a), y: r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
      }
      case 'right':
        return { x: boxW, y: r + (boxH - 2 * r) * t, nx: 1, ny: 0 };
      case 'br': {
        const a = (t * Math.PI) / 2;
        return { x: boxW - r + r * Math.cos(a), y: boxH - r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
      }
      case 'bot':
        return { x: boxW - r - (boxW - 2 * r) * t, y: boxH, nx: 0, ny: 1 };
      case 'bl': {
        const a = Math.PI / 2 + (t * Math.PI) / 2;
        return { x: r + r * Math.cos(a), y: boxH - r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
      }
      case 'left':
        return { x: 0, y: boxH - r - (boxH - 2 * r) * t, nx: -1, ny: 0 };
      case 'tl': {
        const a = Math.PI + (t * Math.PI) / 2;
        return { x: r + r * Math.cos(a), y: r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
      }
    }
    return { x: 0, y: 0, nx: 0, ny: -1 };
  };

  const bodyPath =
    r > 0
      ? [
          `M ${r} 0`,
          `L ${boxW - r} 0`,
          `A ${r} ${r} 0 0 1 ${boxW} ${r}`,
          `L ${boxW} ${boxH - r}`,
          `A ${r} ${r} 0 0 1 ${boxW - r} ${boxH}`,
          `L ${r} ${boxH}`,
          `A ${r} ${r} 0 0 1 0 ${boxH - r}`,
          `L 0 ${r}`,
          `A ${r} ${r} 0 0 1 ${r} 0`,
          'Z',
        ].join(' ')
      : `M 0 0 L ${boxW} 0 L ${boxW} ${boxH} L 0 ${boxH} Z`;

  return { bodyPath, perimeterAt, totalLen };
}

// --- Ellipse / Oval -------------------------------------------------------

export function buildEllipse(boxW: number, boxH: number): BaseSampler {
  // Inscribe the ellipse in the box; oval-ness comes from the body's aspect
  // ratio, not a separate eccentricity param.
  const rx = boxW / 2;
  const ry = boxH / 2;
  const cx = boxW / 2;
  const cy = boxH / 2;

  const K = 512;
  const cum = new Float64Array(K + 1);
  let prevX = cx + rx;
  let prevY = cy;
  for (let i = 1; i <= K; i++) {
    const t = (i / K) * 2 * Math.PI;
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    cum[i] = cum[i - 1] + Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  const totalLen = cum[K] || 1;

  const perimeterAt = (sArg: number): PerimeterPoint => {
    const sm = ((sArg % totalLen) + totalLen) % totalLen;
    let lo = 0;
    let hi = K;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m] < sm) lo = m + 1;
      else hi = m;
    }
    const i = Math.max(1, lo);
    const seg = cum[i] - cum[i - 1] || 1;
    const frac = (sm - cum[i - 1]) / seg;
    const t = (((i - 1) + frac) / K) * 2 * Math.PI;
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    const gx = (x - cx) / (rx * rx);
    const gy = (y - cy) / (ry * ry);
    const gl = Math.hypot(gx, gy) || 1;
    return { x, y, nx: gx / gl, ny: gy / gl };
  };

  const bodyPath = `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`;
  return { bodyPath, perimeterAt, totalLen };
}

// --- Build sampler for a configured base ---------------------------------

export function buildBaseSampler(base: BalloonBase, params: ParamBag, boxW: number, boxH: number): BaseSampler {
  if (base === 'rectangle') {
    // `roundness` is a fraction (0..1) of half the shorter edge so the corner
    // shape stays consistent across body sizes and aspect ratios.
    const roundness = Math.max(0, Math.min(1, (params.roundness as number) ?? 0.5));
    const r = (Math.min(boxW, boxH) / 2) * roundness;
    return buildRoundedRect(boxW, boxH, r);
  }
  void params;
  return buildEllipse(boxW, boxH);
}

// --- Tail attachment: angle / side+position → arc length s ----------------

export function angleToS(angleDeg: number, sampler: BaseSampler, cx: number, cy: number): number {
  const θ = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(θ);
  const dy = Math.sin(θ);
  const K = 720;
  let bestS = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < K; i++) {
    const s = (i / K) * sampler.totalLen;
    const p = sampler.perimeterAt(s);
    const vx = p.x - cx;
    const vy = p.y - cy;
    const vl = Math.hypot(vx, vy) || 1;
    const dot = (vx * dx + vy * dy) / vl;
    if (dot > bestDot) {
      bestDot = dot;
      bestS = s;
    }
  }
  return bestS;
}

export function attachmentS(
  angleDeg: number,
  sampler: BaseSampler,
  boxW: number,
  boxH: number,
): number {
  return angleToS(angleDeg, sampler, boxW / 2, boxH / 2);
}

// --- Classic (triangular) tail as a perimeter offset ----------------------

export interface ClassicTailConfig {
  sc: number;
  halfBase: number;
  length: number;
  fillet: number; // 0 = sharp triangular tail; 1 = full tangent fillet at base
  arc: number;    // lateral bend of the tail spine, -1..1
  radial: number; // outward translation of the bump along the normal (px)
  totalLen: number;
  perimeterAt: (s: number) => PerimeterPoint;
}

export function classicTailOffsetAt(s: number, cfg: ClassicTailConfig): { dx: number; dy: number } {
  let ds = s - cfg.sc;
  if (ds > cfg.totalLen / 2) ds -= cfg.totalLen;
  if (ds < -cfg.totalLen / 2) ds += cfg.totalLen;
  if (Math.abs(ds) > cfg.halfBase) return { dx: 0, dy: 0 };
  const u = Math.abs(ds) / cfg.halfBase;
  // fillet rounds the concave (negative-space) corners where the tail
  // base meets the body. Piecewise: linear t = 1 − u over the central
  // bump region (which keeps the tip shape unaffected), then a cubic
  // Hermite fillet over the last `w` of the bump that approaches the
  // body tangentially. `w = f/(f+1)` maps the slider to a 0..1 fillet
  // zone width (so the slider can extend arbitrarily — w → 1 as f → ∞,
  // covering more of the bump with the fillet).
  const f = Math.max(0, cfg.fillet);
  const w = f / (f + 1);
  let t: number;
  if (u <= 1 - w || w <= 0) {
    t = 1 - u;
  } else {
    const tau = (u - (1 - w)) / w;
    t = w * (tau * tau * tau - tau * tau - tau + 1);
  }
  t = Math.max(0, t);
  const p = cfg.perimeterAt(cfg.sc);
  const perpX = -p.ny;
  const perpY = p.nx;
  const arcShift = cfg.arc * cfg.length * t * t;
  // Outward magnitude: the bump amplitude scales with t. `radial` extends
  // the TIP vertex outward (or pulls it inward) without affecting the rest
  // of the bump shape — i.e. radial scales with t so it vanishes at the
  // base (no pedestal) and is fully applied at the tip.
  const outward = (cfg.length + cfg.radial) * t;
  return {
    dx: p.nx * outward + perpX * arcShift,
    dy: p.ny * outward + perpY * arcShift,
  };
}

// --- Spikes (sunburst / starburst) effect --------------------------------
//
// Ported from the weasel badge lab's Spikes effect. Distributes N
// triangular spikes evenly around the body perimeter; per-spike length
// scales with the local axis (vert / horz / diagonal) so the sunburst
// looks balanced regardless of body aspect ratio. Curvature-based
// shortening (`cornerCompensation`) prevents spikes from visibly fanning
// out around tight corner arcs.

export interface SpikesConfig {
  spikeWidth: number;
  spacing: number;            // gap between adjacent bases (negative = overlap)
  length: number;
  taper: number;              // 1 = triangular; >1 sharper tip; <1 blunter
  vertScale: number;
  horzScale: number;
  diagonalScale: number;
  irregularity: number;
  cornerCompensation: number; // 0..1
  phase: number;              // 0..1 fraction of one spike step
  totalLen: number;
  perimeterAt: (s: number) => PerimeterPoint;
}

export function spikesOffsetAt(s: number, cfg: SpikesConfig): { dx: number; dy: number } {
  const spikeWidth = Math.max(0.5, cfg.spikeWidth);
  const halfBase = spikeWidth / 2;
  // Period (center-to-center) = base + spacing; clamp so heavy overlap
  // doesn't blow up the count to infinity.
  const period = Math.max(spikeWidth * 0.2, spikeWidth + cfg.spacing);
  const N = Math.max(3, Math.round(cfg.totalLen / period));
  const step = cfg.totalLen / N;
  const phaseOffset = cfg.phase * step;
  const sm = ((s % cfg.totalLen) + cfg.totalLen) % cfg.totalLen;
  // For negative spacing the spikes overlap; check neighbors and take the
  // winner (max profile height) — this gives clean dovetail merging.
  const overlap = Math.max(1, Math.ceil(halfBase / step) + 1);
  const baseIdx = Math.round((sm - phaseOffset) / step);
  const taper = Math.max(0.05, cfg.taper);
  let bestT = 0;
  let bestIdx = -1;
  for (let di = -overlap; di <= overlap; di++) {
    const idx = baseIdx + di;
    let sc = idx * step + phaseOffset;
    sc = ((sc % cfg.totalLen) + cfg.totalLen) % cfg.totalLen;
    let ds = sm - sc;
    if (ds > cfg.totalLen / 2) ds -= cfg.totalLen;
    if (ds < -cfg.totalLen / 2) ds += cfg.totalLen;
    if (Math.abs(ds) > halfBase) continue;
    const u = Math.abs(ds) / halfBase;
    const t = Math.pow(1 - u, taper);
    if (t > bestT) {
      bestT = t;
      bestIdx = idx;
    }
  }
  if (bestT <= 0 || bestIdx < 0) return { dx: 0, dy: 0 };
  const sc = ((bestIdx * step + phaseOffset) % cfg.totalLen + cfg.totalLen) % cfg.totalLen;
  const pCenter = cfg.perimeterAt(sc);
  const dirX = pCenter.nx;
  const dirY = pCenter.ny;
  const nxAbs = Math.abs(pCenter.nx);
  const nyAbs = Math.abs(pCenter.ny);
  const d = Math.min(1, 2 * nxAbs * nyAbs);
  const axisScale = nyAbs > nxAbs ? cfg.vertScale : cfg.horzScale;
  const scale = axisScale * (1 - d) + cfg.diagonalScale * d;
  const irrMult = 1 + cfg.irregularity * 0.5 * Math.sin(bestIdx * 1.73 + 0.7);
  const eps = Math.max(step * 0.5, halfBase);
  const SAMPLES = 5;
  let kappa = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const u2 = (k + 0.5) / SAMPLES;
    const sA = sc - eps + u2 * 2 * eps - eps / SAMPLES;
    const sB = sc - eps + u2 * 2 * eps + eps / SAMPLES;
    const pA = cfg.perimeterAt(sA);
    const pB = cfg.perimeterAt(sB);
    kappa += Math.hypot(pB.nx - pA.nx, pB.ny - pA.ny) / (sB - sA);
  }
  kappa /= SAMPLES;
  const baseLen = cfg.length * scale * irrMult * bestT;
  const comp = Math.max(0, Math.min(cfg.cornerCompensation, 1));
  const lenCss = Math.max(0, baseLen / (1 + comp * kappa * baseLen));
  return { dx: dirX * lenCss, dy: dirY * lenCss };
}

// --- Compose final body silhouette ----------------------------------------

const COMPOSE_SAMPLES = 720;

export function composeBodyPoints(
  sampler: BaseSampler,
  offsets: Array<(s: number) => { dx: number; dy: number }>,
  pointTransform?: (x: number, y: number) => { x: number; y: number },
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < COMPOSE_SAMPLES; i++) {
    const s = (i / COMPOSE_SAMPLES) * sampler.totalLen;
    const p = sampler.perimeterAt(s);
    const base = pointTransform ? pointTransform(p.x, p.y) : { x: p.x, y: p.y };
    let dx = 0;
    let dy = 0;
    for (const off of offsets) {
      const o = off(s);
      dx += o.dx;
      dy += o.dy;
    }
    out.push({ x: base.x + dx, y: base.y + dy });
  }
  return out;
}

export function composeBody(
  sampler: BaseSampler,
  offsets: Array<(s: number) => { dx: number; dy: number }>,
  pointTransform?: (x: number, y: number) => { x: number; y: number },
): string {
  if (offsets.length === 0 && !pointTransform) return sampler.bodyPath;
  const pts = composeBodyPoints(sampler, offsets, pointTransform);
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    d += (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }
  return d + ' Z';
}

// --- Bubbles ------------------------------------------------------------

export interface Bubble {
  cx: number;
  cy: number;
  r: number;
}

export function buildBubbles(
  attachPoint: PerimeterPoint,
  count: number,
  startSize: number,
  falloff: number,
  gapFrac: number,
  reach: number,
  arc: number,
): Bubble[] {
  const out: Bubble[] = [];
  const dirX = attachPoint.nx;
  const dirY = attachPoint.ny;
  const perpX = -dirY;
  const perpY = dirX;
  const cnt = Math.max(1, Math.floor(count));
  let size = startSize;
  // First bubble center sits just outside the body by half its diameter plus the gap.
  let dist = startSize + gapFrac * startSize;
  for (let i = 0; i < cnt; i++) {
    const progress = reach > 0 ? Math.min(1, dist / reach) : 0;
    const arcShift = arc * reach * progress * progress;
    const cx = attachPoint.x + dirX * dist + perpX * arcShift;
    const cy = attachPoint.y + dirY * dist + perpY * arcShift;
    out.push({ cx, cy, r: size });
    const nextSize = size * falloff;
    dist += size + nextSize + gapFrac * (size + nextSize);
    size = nextSize;
    if (dist > reach + startSize) break;
  }
  return out;
}

// --- Lightning -----------------------------------------------------------

// Deterministic pseudo-random in [0,1) keyed by integer seed + index.
function prng(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function buildLightning(
  attachPoint: PerimeterPoint,
  length: number,
  segments: number,
  jaggedness: number,
  seed: number,
  arc: number,
): { x: number; y: number }[] {
  const segs = Math.max(2, Math.floor(segments));
  const dirX = attachPoint.nx;
  const dirY = attachPoint.ny;
  const perpX = -dirY;
  const perpY = dirX;
  const startX = attachPoint.x;
  const startY = attachPoint.y;
  // Arc bends the bolt's endpoint laterally — midpoints follow that bent centerline.
  const endX = attachPoint.x + dirX * length + perpX * arc * length;
  const endY = attachPoint.y + dirY * length + perpY * arc * length;
  const pts: { x: number; y: number }[] = [{ x: startX, y: startY }];
  const segLen = length / segs;
  const maxDeflect = segLen * 0.9 * jaggedness;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const bx = startX + (endX - startX) * t;
    const by = startY + (endY - startY) * t;
    const r = prng(seed, i) * 2 - 1;
    const sign = i % 2 === 0 ? 1 : -1;
    const off = sign * (0.5 + 0.5 * Math.abs(r)) * maxDeflect;
    pts.push({ x: bx + perpX * off, y: by + perpY * off });
  }
  pts.push({ x: endX, y: endY });
  return pts;
}

// Comic-book Z-bolt polyline with N alternating kinks between attach and
// tip. `zigs` is the number of mid-kinks; jaggedness controls the lateral
// offset amplitude; arc bends the overall axis laterally.
export function buildZigzagLightningPolyline(
  attachPoint: PerimeterPoint,
  length: number,
  jaggedness: number,
  arc: number,
  zigs: number,
): { x: number; y: number }[] {
  const dirX = attachPoint.nx;
  const dirY = attachPoint.ny;
  const perpX = -dirY;
  const perpY = dirX;
  const startX = attachPoint.x;
  const startY = attachPoint.y;
  const endX = startX + dirX * length + perpX * arc * length;
  const endY = startY + dirY * length + perpY * arc * length;
  const offset = length * 0.32 * (0.4 + jaggedness);
  const n = Math.max(1, Math.floor(zigs));
  const out: { x: number; y: number }[] = [{ x: startX, y: startY }];
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const cx = startX + (endX - startX) * t;
    const cy = startY + (endY - startY) * t;
    const sign = i % 2 === 0 ? 1 : -1;
    out.push({ x: cx + perpX * offset * sign, y: cy + perpY * offset * sign });
  }
  out.push({ x: endX, y: endY });
  return out;
}

// Build a tapered closed polygon by sweeping the perpendicular bisector
// at each polyline vertex by half the local width. Width per vertex
// comes from `widthFn(i, n)`. The last vertex collapses to a point so
// the tip is sharp. Use this instead of clipper inflation when you want
// linear taper and miter joins.
export function buildTaperedPolygon(
  pts: { x: number; y: number }[],
  widthFn: (i: number, n: number) => number,
): { x: number; y: number }[] {
  const n = pts.length;
  if (n < 2) return [];
  const perps: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    let tx = 0;
    let ty = 0;
    if (i > 0) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        tx += dx / len;
        ty += dy / len;
      }
    }
    if (i < n - 1) {
      const dx = pts[i + 1].x - pts[i].x;
      const dy = pts[i + 1].y - pts[i].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        tx += dx / len;
        ty += dy / len;
      }
    }
    const tlen = Math.sqrt(tx * tx + ty * ty);
    if (tlen > 0) {
      tx /= tlen;
      ty /= tlen;
    }
    perps.push({ x: -ty, y: tx });
  }
  const widths: number[] = [];
  for (let i = 0; i < n; i++) widths.push(Math.max(0, widthFn(i, n)));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    out.push({ x: pts[i].x + perps[i].x * widths[i] / 2, y: pts[i].y + perps[i].y * widths[i] / 2 });
  }
  out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
  for (let i = n - 2; i >= 0; i--) {
    out.push({ x: pts[i].x - perps[i].x * widths[i] / 2, y: pts[i].y - perps[i].y * widths[i] / 2 });
  }
  return out;
}
