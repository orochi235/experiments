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

import type { BalloonBase, ParamBag, TailProjection, TailSide } from './types';

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
    const r = (params.radius as number) ?? 24;
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

export function sideAndPositionToS(
  side: TailSide,
  position: number,
  sampler: BaseSampler,
  boxW: number,
  boxH: number,
): number {
  let ax = 0;
  let ay = 0;
  switch (side) {
    case 'top':    ax = boxW * position; ay = -boxH;       break;
    case 'bottom': ax = boxW * position; ay = boxH * 2;    break;
    case 'left':   ax = -boxW;           ay = boxH * position; break;
    case 'right':  ax = boxW * 2;        ay = boxH * position; break;
  }
  const K = 720;
  let bestS = 0;
  let bestD = Infinity;
  for (let i = 0; i < K; i++) {
    const s = (i / K) * sampler.totalLen;
    const p = sampler.perimeterAt(s);
    const d = Math.hypot(p.x - ax, p.y - ay);
    if (d < bestD) {
      bestD = d;
      bestS = s;
    }
  }
  return bestS;
}

export function attachmentS(
  projection: TailProjection,
  angleDeg: number,
  sampler: BaseSampler,
  boxW: number,
  boxH: number,
  tailParams: ParamBag,
): number {
  const baseSc =
    projection === 'side'
      ? sideAndPositionToS(
          (tailParams.side as TailSide) ?? 'bottom',
          (tailParams.position as number) ?? 0.3,
          sampler,
          boxW,
          boxH,
        )
      : angleToS(angleDeg, sampler, boxW / 2, boxH / 2);
  // Common-param: shift the attachment along the perimeter by `offset`.
  // ±1 corresponds to roughly 10% of the perimeter so values feel responsive
  // on small balloons without saturating on large ones.
  const offset = (tailParams.offset as number) ?? 0;
  return baseSc + offset * sampler.totalLen * 0.1;
}

// --- Classic (triangular) tail as a perimeter offset ----------------------

export interface ClassicTailConfig {
  sc: number;
  halfBase: number;
  length: number;
  taper: number;
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
  const t = Math.max(0, 1 - Math.pow(u, cfg.taper));
  const p = cfg.perimeterAt(cfg.sc);
  const perpX = -p.ny;
  const perpY = p.nx;
  const arcShift = cfg.arc * cfg.length * t * t;
  // Outward magnitude: bump (length*t) + a constant radial lift that pushes the
  // whole tail away from the body. For radial > 0 this creates a "pedestal"
  // between body and tail tip; for radial < 0 the tail roots inside the body.
  const outward = cfg.length * t + cfg.radial;
  return {
    dx: p.nx * outward + perpX * arcShift,
    dy: p.ny * outward + perpY * arcShift,
  };
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
