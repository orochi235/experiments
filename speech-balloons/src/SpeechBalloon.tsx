import { Fragment, useEffect, useId, useMemo } from 'react';
import type { DesignState, FillMode, ParamBag, RuntimeState, ShadingItem, TailShape } from './types';
import {
  bareBaseMaxBevel,
  buildBaseSampler,
  composeBodyPoints,
  attachmentS,
  angleToS,
  pointedTailOffsetAt,
  buildBubbles,
  buildCloudPuffs,
  buildLightning,
  buildZigzagLightningPolyline,
  buildTaperedPolygon,
  spikesOffsetAt,
  lobesOffsetAt,
  wobbleOffsetAt,
  jitterOffsetAt,
  type BaseSampler,
  type PerimeterPoint,
} from './geometry';
import {
  unionPolygons,
  polygonsToSvgPath,
  circleToPolygon,
  offsetClosedPolygon,
  type Polygon,
} from './clipping';
interface Props {
  design: DesignState;
  runtime: RuntimeState;
  zoom?: number;
  onShadingItems?: (items: ShadingItem[]) => void;
  highlightedShadingId?: string | null;
}

// --- Text measurement (avoids a double-render bbox roundtrip) -------------

let measureCanvas: HTMLCanvasElement | null = null;
function measureTextWidth(text: string, fontPx: number, fontFamily: string): number {
  if (typeof document === 'undefined') return text.length * fontPx * 0.55;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * fontPx * 0.55;
  ctx.font = `${fontPx}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

// baseWidth from `baseAngle` (degrees of arc subtended at body center):
//   baseWidth = 2 × bodyRef × sin(deg/2)
// bodyRef is the body's shorter dimension. Angle, not multiplier, so the
// same value reads as the "same fatness" across body sizes.
function tailDims(
  params: ParamBag,
  _shape: TailShape,
  bodyW: number,
  bodyH: number,
): { length: number; baseWidth: number } {
  const size = (params.size as number) ?? (params.length as number) ?? 60;
  const deg = (params.baseAngle as number) ?? 12;
  const bodyRef = Math.min(bodyW, bodyH);
  const baseWidth = 2 * bodyRef * Math.sin(Math.max(0, deg) * Math.PI / 360);
  return { length: size, baseWidth };
}

// --- Color mixing (used by the aqua paint-server mode) ------------------

type RGB = [number, number, number];
function parseHex(hex: string): RGB {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}
function mixCss(a: RGB, b: RGB, t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r} ${g} ${bl})`;
}
// --- Multi-light dome shading ---------------------------------------------

export type PerimeterSampler = (angle: number) => {
  x: number;
  y: number;
  nx: number;
  ny: number;
};

export interface LitArc {
  start: number; // radians
  end: number;   // radians
}

// User-edited height profile h(x) where x = 0 at the rim and x = 1 at the
// medial axis. Single primitive that drives every shading mode (dome / BRDF
// Lambertian, specular hot-spot placement, rim/Fresnel, billboard heightmap).
export type ContourFn = (x: number) => number;

function lightDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el)];
}

// Surface tilt θ(r) of the body of revolution at normalized radius r ∈ [0,1]
// (r=0 = medial axis / dome apex, r=1 = rim). The dome's shape is defined by
// the user's contour curve h(x) where x = 1 − r (x=0 at the rim, x=1 at the
// medial axis). Physically, dz/dr = −dh/dx and dz/dr = −cot(θ), so
//   cot(θ) = dh/dx  ⇒  θ = atan2(1, dh/dx).
// Slope is clamped ≥ 0: a contour that dips toward center would give tilt
// > π/2 (normal pointing downward), which is unphysical for our dome model;
// treat the dip as a flat plateau locally.
export function contourTilt(
  rNorm: number,
  contour: ContourFn,
  eps = 0.01,
): number {
  const r = Math.min(1, Math.max(0, rNorm));
  const xMid = 1 - r;
  const xHi = Math.min(1, xMid + eps);
  const xLo = Math.max(0, xMid - eps);
  const dx = xHi - xLo;
  if (dx <= 0) return Math.PI / 2;
  const slope = Math.max(0, (contour(xHi) - contour(xLo)) / dx);
  return Math.atan2(1, slope);
}

// Sample the perimeter at `samples` angles and return the contiguous arcs
// where the lifted 3D normal N3 = (nx·cos θ, ny·cos θ, sin θ) has a
// positive dot product with the light direction L. θ here is the rim
// tilt (the tilt at r=1); interior tilts only matter for the gradient
// sampler downstream.
export function computeLitArcs(
  sampler: PerimeterSampler,
  azimuthDeg: number,
  elevationDeg: number,
  samples: number = 240,
  rimTiltRad: number = 0,
): LitArc[] {
  const L = lightDirection(azimuthDeg, elevationDeg);
  const cosT = Math.cos(rimTiltRad);
  const sinT = Math.sin(rimTiltRad);
  const lit: boolean[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    const p = sampler(a);
    const Lxy = p.nx * L[0] + p.ny * L[1];
    const NdotL = cosT * Lxy + sinT * L[2];
    lit[i] = NdotL > 1e-9;
  }
  if (lit.every((x) => x)) return [{ start: 0, end: 2 * Math.PI }];
  if (lit.every((x) => !x)) return [];
  const firstFalse = lit.indexOf(false);
  const rot = [...lit.slice(firstFalse), ...lit.slice(0, firstFalse)];
  const arcs: LitArc[] = [];
  let i = 0;
  while (i < samples) {
    while (i < samples && !rot[i]) i++;
    if (i >= samples) break;
    const runStart = i;
    while (i < samples && rot[i]) i++;
    const runEnd = i;
    arcs.push({
      start: (((runStart + firstFalse) % samples) / samples) * 2 * Math.PI,
      end: (((runEnd + firstFalse) % samples) / samples) * 2 * Math.PI,
    });
  }
  return arcs;
}

// Centroid → arc wedge path per lit arc; SVG-d for use as a clipPath.
export function buildLightWedgePath(
  sampler: PerimeterSampler,
  arcs: readonly LitArc[],
  centroid: readonly [number, number],
  arcResolutionRad: number = Math.PI / 60,
): string {
  const parts: string[] = [];
  for (const a of arcs) {
    const span = (a.end - a.start + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(span / arcResolutionRad));
    let d = `M ${centroid[0]} ${centroid[1]}`;
    for (let i = 0; i <= steps; i++) {
      const t = a.start + (span * i) / steps;
      const p = sampler(t);
      d += ` L ${p.x} ${p.y}`;
    }
    d += ' Z';
    parts.push(d);
  }
  return parts.join(' ');
}

// Estimate the perimeter arc-length spanned by `angleSampler` between
// centroid-radial angles a0 and a1, by summing chord distances across
// 8 intermediate samples. Returns `N+1` evenly-spaced α boundaries with
// `N = clamp(ceil(arcLen / targetPxPerSlice), min, max)`.
// _centroid is unused here (the sampler already returns world-space points)
// but is kept in the signature for symmetry with buildLightWedgePath and
// for future callers that may need to derive radial info from centroid.
export function subdivideArc(
  angleSampler: PerimeterSampler,
  a0: number,
  a1: number,
  _centroid: readonly [number, number],
  targetPxPerSlice = 8,
  min = 4,
  max = 32,
): number[] {
  const PROBE = 8;
  let prev = angleSampler(a0);
  let arcLen = 0;
  for (let i = 1; i <= PROBE; i++) {
    const a = a0 + ((a1 - a0) * i) / PROBE;
    const p = angleSampler(a);
    arcLen += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const N = Math.min(max, Math.max(min, Math.ceil(arcLen / Math.max(1e-6, targetPxPerSlice))));
  const out: number[] = new Array(N + 1);
  for (let i = 0; i <= N; i++) out[i] = a0 + ((a1 - a0) * i) / N;
  return out;
}

// Pie-wedge SVG-d for a single angular slice on the body silhouette:
// centroid → arc(a0, a1) → centroid. Step density determined by
// `arcResolutionRad` so curved silhouettes don't visibly polygonize.
export function buildSliceWedgePath(
  angleSampler: PerimeterSampler,
  a0: number,
  a1: number,
  centroid: readonly [number, number],
  arcResolutionRad: number = Math.PI / 60,
): string {
  const span = a1 - a0;
  const steps = Math.max(2, Math.ceil(Math.abs(span) / arcResolutionRad));
  let d = `M ${centroid[0]} ${centroid[1]}`;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (span * i) / steps;
    const p = angleSampler(a);
    d += ` L ${p.x} ${p.y}`;
  }
  d += ' Z';
  return d;
}

export interface LightStopInput {
  azimuthDeg: number;
  elevationDeg: number;
  rLit: number;             // centroid→perimeter distance along the lit direction
  rFar: number;             // centroid→perimeter distance along the opposite direction
  contour: ContourFn;       // height profile, x=0 (rim) → x=1 (medial axis)
  samples?: number;         // default 16
}

export interface GradientStop {
  offset: number;
  opacity: number;
}

// Sample the per-light brightness along the gradient axis (s ∈ [0,1] going
// lit-rim → centroid → far-rim). The centroid sits at s_centroid =
// rLit/(rLit+rFar), so the lit and far halves can have different physical
// lengths — this is how non-square bodies get a faithful gradient. Tilt at
// each sample is derived from the contour curve's slope (see contourTilt).
export function sampleLightStops(input: LightStopInput): GradientStop[] {
  const SAMPLES = input.samples ?? 16;
  const azRad = (input.azimuthDeg * Math.PI) / 180;
  const elRad = (input.elevationDeg * Math.PI) / 180;
  const cosAz = Math.cos(azRad);
  const sinAz = Math.sin(azRad);
  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);
  const Lx = cosAz * cosEl;
  const Ly = sinAz * cosEl;
  const Lz = sinEl;

  const rLit = Math.max(1e-6, input.rLit);
  const rFar = Math.max(1e-6, input.rFar);
  const sCentroid = rLit / (rLit + rFar);

  const out: GradientStop[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES;
    const litSide = s <= sCentroid;
    const r = litSide
      ? 1 - s / sCentroid                                    // 1 at lit rim, 0 at centroid
      : (s - sCentroid) / Math.max(1e-6, 1 - sCentroid);     // 0 at centroid, 1 at far rim
    const tilt = contourTilt(r, input.contour);
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const sgn = litSide ? 1 : -1;
    const N3x = sgn * cosAz * cosTilt;
    const N3y = sgn * sinAz * cosTilt;
    const N3z = sinTilt;
    const phys = Math.max(0, N3x * Lx + N3y * Ly + N3z * Lz);
    out.push({ offset: s, opacity: phys });
  }
  return out;
}

export interface SliceStopInput {
  /** In-plane radial direction (centroid → rim) of this slice. */
  axisAngleRad: number;
  lightAzimuthDeg: number;
  lightElevationDeg: number;
  lightIntensity: number;
  contour: ContourFn;
  samples?: number;
}

// Per-slice brightness stops along a half-axis (s=0 centroid, s=1 rim) for a
// single sub-wedge. The in-plane normal points radially outward along
// `axisAngleRad`, so the gradient is correct for the slice's own direction
// rather than the light's azimuth — this is what kills the wedge seams.
// Tilt is read off the user's contour curve via contourTilt.
export function sampleSliceStops(input: SliceStopInput): GradientStop[] {
  const SAMPLES = input.samples ?? 16;
  const azRad = (input.lightAzimuthDeg * Math.PI) / 180;
  const elRad = (input.lightElevationDeg * Math.PI) / 180;
  const Lx = Math.cos(azRad) * Math.cos(elRad);
  const Ly = Math.sin(azRad) * Math.cos(elRad);
  const Lz = Math.sin(elRad);

  const cosA = Math.cos(input.axisAngleRad);
  const sinA = Math.sin(input.axisAngleRad);

  const out: GradientStop[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES;
    const r = s;                                           // 0 = centroid, 1 = rim
    const tilt = contourTilt(r, input.contour);
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const N3x = cosA * cosTilt;
    const N3y = sinA * cosTilt;
    const N3z = sinTilt;
    const phys = Math.max(0, N3x * Lx + N3y * Ly + N3z * Lz);
    out.push({ offset: s, opacity: input.lightIntensity * phys });
  }
  return out;
}

// Rotate an attach-point's outward normal by `outAngle` degrees in-plane.
// Bubbles / lightning don't deform the body silhouette, so they don't go
// through pointedTailOffsetAt (which applies its own outAngle). Their
// chain direction is derived from the attach normal, so we rotate it here.
function rotateAttachByOutAngle(p: PerimeterPoint, outAngleDeg: number): PerimeterPoint {
  if (!outAngleDeg) return p;
  const r = (outAngleDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x, y: p.y, nx: p.nx * c - p.ny * s, ny: p.nx * s + p.ny * c };
}

// Axis-aligned bounding box of the base sampler's perimeter — i.e. the
// bare body silhouette before any tail/spike/lobe/cloud effects deform
// it. Sampling around totalLen avoids depending on the cooked
// `bodyPolygon`, which bakes pointed/wavy tails into the silhouette.
export function bareBaseBBox(sampler: BaseSampler): { x: number; y: number; w: number; h: number } {
  const N = 96;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    const p = sampler.perimeterAt((i / N) * sampler.totalLen);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Min/max distance from the bare-base bbox centroid to the perimeter,
// sampled across 36 angles. Used by the contour-editor bevel-ridge band:
// on non-circular bodies the bevel ridge sits at different x = bw/R for
// different directions, so the band spans [bw/Rmax, bw/Rmin].
export function bareBaseRadiusRange(sampler: BaseSampler): { Rmin: number; Rmax: number } {
  const bb = bareBaseBBox(sampler);
  const cx = bb.x + bb.w / 2;
  const cy = bb.y + bb.h / 2;
  const N = 36;
  let Rmin = Infinity;
  let Rmax = 0;
  for (let i = 0; i < N; i++) {
    const angleDeg = (i / N) * 360;
    const sc = angleToS(angleDeg, sampler, cx, cy);
    const p = sampler.perimeterAt(sc);
    const r = Math.hypot(p.x - cx, p.y - cy);
    if (r < Rmin) Rmin = r;
    if (r > Rmax) Rmax = r;
  }
  if (!isFinite(Rmin)) return { Rmin: 0, Rmax: 0 };
  return { Rmin, Rmax };
}

// --- BRDF (per-light × per-term) shading ---------------------------------
// Architecture: docs/superpowers/notes/2026-06-03-per-light-region-shading.md.
// For each light L and each BRDF term T ∈ {Diffuse, Specular, Rim}, paint one
// region (clip-path) with the gradient that captures T's intensity over that
// region. Ambient = the solid base body fill underneath. Layers composite via
// `mix-blend-mode: screen`, so additively in screen space.

// Body-of-revolution Blinn-Phong: the surface tilt at which the dome's normal
// aligns with the half-vector H = normalize(L + V) for viewer V = (0, 0, 1).
// We only need L's elevation: H's in-plane direction is L's in-plane direction
// (so the spot sits on the light azimuth), and H's tilt above the plane is
// atan((Lz + 1) / |L_xy|). An in-plane light gives a vertical H (tilt = π/2).
export function halfVectorTilt(elevationDeg: number): number {
  const el = (elevationDeg * Math.PI) / 180;
  const Lxy = Math.cos(el);
  const Lz = Math.sin(el);
  if (Lxy < 1e-9) return Math.PI / 2;
  return Math.atan2(Lz + 1, Lxy);
}

// Scan r ∈ [0, 1] for the value whose `contourTilt(r)` best matches a target
// tilt. The contour-derived tilt isn't guaranteed monotone (user can draw any
// shape), so a brute-force min-error scan beats bisection in robustness; the
// inner cost is cheap (constant work per step) and only runs once per light.
export function findRForTilt(targetTilt: number, contour: ContourFn): number {
  const SAMPLES = 64;
  let bestR = 0;
  let bestErr = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const r = i / SAMPLES;
    const err = Math.abs(contourTilt(r, contour) - targetTilt);
    if (err < bestErr) {
      bestErr = err;
      bestR = r;
    }
  }
  return bestR;
}

// Specular falloff sampled along the radial of a radialGradient anchored at
// the hot spot. Falloff curve mimics Blinn-Phong cos^n with the gradient
// radius corresponding to the angular width of the highlight: bright at the
// center, smooth roll-off to zero at offset=1. `specPower` is the Phong-style
// shininess (higher = tighter).
export function sampleSpecularStops(specPower: number, samples = 16): GradientStop[] {
  const k = Math.max(0.5, specPower / 6);
  const out: GradientStop[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    out.push({ offset: t, opacity: Math.pow(Math.max(0, 1 - t), k) });
  }
  return out;
}

// Fresnel/rim stops along a radial from centroid (offset 0) to rim (offset 1).
// Intensity = (1 - |N · V|)^rimPower with V=(0,0,1) and |N · V| = sin(tilt(r)).
// Strongest near the rim where the contour's slope is steep (low tilt, normal
// near in-plane), decaying to zero on plateau regions where the normal points
// straight at the viewer.
export function sampleRimStops(
  contour: ContourFn,
  rimPower: number,
  samples = 24,
): GradientStop[] {
  const k = Math.max(0.5, rimPower);
  const out: GradientStop[] = [];
  for (let i = 0; i <= samples; i++) {
    const r = i / samples;
    const tilt = contourTilt(r, contour);
    const fresnel = Math.pow(Math.max(0, 1 - Math.sin(tilt)), k);
    out.push({ offset: r, opacity: fresnel });
  }
  return out;
}

// --- Heightmap ------------------------------------------------------------
// Billboard (orthographic, V=(0,0,1)) elevation of the body — literally the
// user's contour curve sampled per-pixel. With the contour-driven model the
// curve IS the height profile h(x) where x = 1 − r (x=0 rim, x=1 medial
// axis), so the heightmap is just `h(1 − r)` clipped to [0, 1]. Same primitive
// the dome/BRDF Lambertian reads via contourTilt — no separate parameter
// universe to drift out of sync.

export function domeHeight(rNorm: number, contour: ContourFn): number {
  const r = Math.min(1, Math.max(0, rNorm));
  return Math.max(0, contour(1 - r));
}

// --- Component -----------------------------------------------------------

export function SpeechBalloon({
  design,
  runtime,
  zoom: zoomProp,
  onShadingItems,
  highlightedShadingId,
}: Props) {
  // Body dimensions: either design-time width/height or fit-to-content.
  const { W, H } = useMemo(() => {
    if (!runtime.fitToContent) return { W: design.width, H: design.height };
    const lines = (runtime.text || ' ').split('\n');
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, measureTextWidth(line || ' ', runtime.fontSize, runtime.fontFamily));
    const lineHeight = runtime.fontSize * 1.1;
    const textH = lineHeight * lines.length + runtime.fontSize * 0.1;
    // Baseline breathing room added on top of the user's padX/padY so the
    // text never visually touches the body edge even at pad sliders = 0.
    const basePadX = 12;
    const basePadY = 10;
    return {
      W: Math.max(40, Math.ceil(widest + 2 * (design.padX + basePadX))),
      H: Math.max(30, Math.ceil(textH + 2 * (design.padY + basePadY))),
    };
  }, [runtime.fitToContent, runtime.text, runtime.fontFamily, runtime.fontSize, design.width, design.height, design.padX, design.padY]);

  // Split effects by kind. Multiple tails allowed.
  // NOTE: these four lookups are not useMemo'd, unlike spikes/lobes/wobble/jitter/cloud
  // below. Each call returns a new reference per render, busting downstream useMemos
  // (resolvedTails → bodyAndBubblesPolys → bodyPath / domeLayers / etc.). It's
  // tolerable today, but anything heavy added downstream — like the old bevel-ring
  // 31×-polygon-offset loop — will fire on every state change. Wrap in useMemo before
  // adding more expensive geometry.
  const fillEffect = design.effects.find((e) => e.kind === 'fill');
  const tailEffects = design.effects.filter((e) => e.kind === 'tail');
  const strokeEffect = design.effects.find((e) => e.kind === 'stroke');
  const shadowEffect = design.effects.find((e) => e.kind === 'shadow');

  const sampler: BaseSampler = useMemo(
    () => buildBaseSampler(design.base, design.baseParams, W, H),
    [design.base, design.baseParams, W, H],
  );

  // Shear: skew about the body's x-center, baked into the body samples
  // before the (classic) tail offset, so the body shears but tails don't.
  const pointTransform = useMemo(() => {
    if (!design.shear) return undefined;
    const k = Math.tan((design.shear * Math.PI) / 180);
    const cy = H / 2;
    return (x: number, y: number) => ({ x: x + k * (cy - y), y });
  }, [design.shear, H]);

  // For each tail effect, resolve its attachment point and shape.
  interface ResolvedTail {
    id: number;
    shape: TailShape;
    attach: PerimeterPoint;
    params: ParamBag;
  }
  const resolvedTails: ResolvedTail[] = useMemo(() => {
    return tailEffects.map((eff) => {
      const angle = (eff.params.angle as number) ?? 115;
      const sc = attachmentS(angle, sampler, W, H);
      const attach = sampler.perimeterAt(sc);
      // Translate the tail along the outward normal so bubbles / lightning can
      // start with a visible gap from the body (or root inside it for radial < 0).
      const radial = (eff.params.radial as number) ?? 0;
      const shifted: PerimeterPoint = {
        x: attach.x + attach.nx * radial,
        y: attach.y + attach.ny * radial,
        nx: attach.nx,
        ny: attach.ny,
      };
      // Apply the lean transform to the attachment point so tails sit on the leaned body.
      const attachLeaned = pointTransform
        ? { ...shifted, ...pointTransform(shifted.x, shifted.y) }
        : shifted;
      return {
        id: eff.id,
        shape: ((eff.params.shape as TailShape) ?? 'pointed') as TailShape,
        attach: attachLeaned,
        params: eff.params,
      };
    });
  }, [tailEffects, sampler, W, H, pointTransform]);

  const spikesEffects = useMemo(
    () => design.effects.filter((e) => e.kind === 'spikes'),
    [design.effects],
  );
  const lobesEffects = useMemo(
    () => design.effects.filter((e) => e.kind === 'lobes'),
    [design.effects],
  );
  const wobbleEffects = useMemo(
    () => design.effects.filter((e) => e.kind === 'wobble'),
    [design.effects],
  );
  const jitterEffects = useMemo(
    () => design.effects.filter((e) => e.kind === 'jitter'),
    [design.effects],
  );
  const cloudEffects = useMemo(
    () => design.effects.filter((e) => e.kind === 'cloud'),
    [design.effects],
  );

  // Body silhouette polygon — includes pointed-tail offsets and spike
  // sunburst offsets baked into the perimeter via composeBodyPoints.
  // Spikes are isolated from tail attach regions: at perimeter samples
  // inside any tail's halfBase arc, the spike offset returns zero so
  // the tail's bump geometry isn't disturbed by overlapping spikes.
  const bodyPolygon = useMemo<Polygon>(() => {
    const offsets: Array<(s: number) => { dx: number; dy: number }> = [];
    const tailRanges: Array<{ sc: number; halfBase: number }> = [];
    const denseRanges: Array<{ sc: number; halfWidth: number; samples: number }> = [];
    for (const eff of tailEffects) {
      const shape = ((eff.params.shape as TailShape) ?? 'pointed') as TailShape;
      const angle = (eff.params.angle as number) ?? 115;
      const sc = attachmentS(angle, sampler, W, H);
      const dims = tailDims(eff.params, shape, W, H);
      // Track the attach region for every tail shape — classic uses its
      // halfBase directly, bubbles/lightning use baseWidth as a buffer
      // so spikes don't poke out of their attach footprint either.
      // `wavy` is a pointed-flavored bump with sinusoidal spine wave —
      // use the same halfBase / dense-sample / offset machinery.
      const pointedLike = shape === 'pointed' || shape === 'wavy';
      const halfBase = pointedLike
        ? dims.baseWidth / 2
        : Math.max(2, dims.baseWidth);
      tailRanges.push({ sc, halfBase });
      if (pointedLike) {
        // Resolve the arc edges densely regardless of how few uniform body
        // samples land inside this thin range.
        denseRanges.push({ sc, halfWidth: halfBase, samples: 96 });
      }
      if (!pointedLike) continue;
      const cfg = {
        sc,
        halfBase: dims.baseWidth / 2,
        length: dims.length,
        arc: (eff.params.arc as number) ?? 0,
        radial: (eff.params.radial as number) ?? 0,
        outAngle: (eff.params.outAngle as number) ?? 0,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
        waveFreq: shape === 'wavy' ? ((eff.params.waveFreq as number) ?? 2) : undefined,
        waveAmp: shape === 'wavy' ? ((eff.params.waveAmp as number) ?? 0.3) : undefined,
      };
      offsets.push((s) => pointedTailOffsetAt(s, cfg));
    }
    const isInTailRange = (s: number): boolean => {
      const tl = sampler.totalLen;
      for (const r of tailRanges) {
        let ds = s - r.sc;
        if (ds > tl / 2) ds -= tl;
        if (ds < -tl / 2) ds += tl;
        if (Math.abs(ds) <= r.halfBase) return true;
      }
      return false;
    };
    for (const eff of spikesEffects) {
      const cfg = {
        spikeWidth: (eff.params.spikeWidth as number) ?? 6,
        spacing: (eff.params.spacing as number) ?? 4,
        length: (eff.params.length as number) ?? 18,
        taper: (eff.params.taper as number) ?? 1,
        vertScale: (eff.params.vertScale as number) ?? 1.4,
        horzScale: (eff.params.horzScale as number) ?? 1,
        diagonalScale: (eff.params.diagonalScale as number) ?? 0.5,
        irregularity: (eff.params.irregularity as number) ?? 0,
        cornerCompensation: (eff.params.cornerCompensation as number) ?? 1,
        phase: (eff.params.phase as number) ?? 0,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
      };
      offsets.push((s) => {
        if (isInTailRange(s)) return { dx: 0, dy: 0 };
        return spikesOffsetAt(s, cfg);
      });
    }
    for (const eff of lobesEffects) {
      const cfg = {
        count: (eff.params.count as number) ?? 10,
        depth: (eff.params.depth as number) ?? 12,
        phase: (eff.params.phase as number) ?? 0,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
      };
      offsets.push((s) => {
        if (isInTailRange(s)) return { dx: 0, dy: 0 };
        return lobesOffsetAt(s, cfg);
      });
    }
    for (const eff of wobbleEffects) {
      const cfg = {
        frequency: (eff.params.frequency as number) ?? 3,
        amplitude: (eff.params.amplitude as number) ?? 8,
        phase: (eff.params.phase as number) ?? 0,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
      };
      offsets.push((s) => {
        if (isInTailRange(s)) return { dx: 0, dy: 0 };
        return wobbleOffsetAt(s, cfg);
      });
    }
    for (const eff of jitterEffects) {
      const cfg = {
        amount: (eff.params.amount as number) ?? 6,
        density: (eff.params.density as number) ?? 12,
        seed: (eff.params.seed as number) ?? 7,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
      };
      offsets.push((s) => {
        if (isInTailRange(s)) return { dx: 0, dy: 0 };
        return jitterOffsetAt(s, cfg);
      });
    }
    return composeBodyPoints(sampler, offsets, pointTransform, denseRanges);
  }, [tailEffects, spikesEffects, lobesEffects, wobbleEffects, jitterEffects, sampler, W, H, pointTransform]);

  // Polygons after bubble-union — kept as polygons so per-heightmap-mode rasterizers can offset them.
  // Lightning ribbon polygons. Built here BEFORE bodyAndBubblesPolys so
  // the union step can fold them into the silhouette the same way bubble
  // circles get folded in. The polyline's first vertex is tucked inward
  // along the body's inward normal by ~30% of the base width so the
  // polygon's base overlaps the body silhouette — the union then merges
  // them flush regardless of the first segment's angular direction.
  const lightningRibbons = useMemo(() => {
    const out: Array<{ polys: Polygon[]; d: string }> = [];
    for (const rt of resolvedTails) {
      if (rt.shape !== 'lightning') continue;
      const dims = tailDims(rt.params, 'lightning', W, H);
      const style = (rt.params.lightningStyle as string) ?? 'jagged';
      const arc = (rt.params.arc as number) ?? 0;
      const jaggedness = (rt.params.jaggedness as number) ?? 0.45;
      const baseW = Math.max(1, dims.baseWidth);
      const widthTaper = (rt.params.widthTaper as number) ?? 1;
      const tipWidth = Math.max(0, Math.min(0.8, (rt.params.tipWidth as number) ?? 0));
      const tuck = baseW * 0.35;
      const aimed = rotateAttachByOutAngle(rt.attach, (rt.params.outAngle as number) ?? 0);
      const tuckedAttach: PerimeterPoint = {
        x: aimed.x - aimed.nx * tuck,
        y: aimed.y - aimed.ny * tuck,
        nx: aimed.nx,
        ny: aimed.ny,
      };
      const effectiveLength = dims.length + tuck;
      const zigs = (rt.params.zigs as number) ?? 2;
      const pts = style === 'zigzag'
        ? buildZigzagLightningPolyline(tuckedAttach, effectiveLength, jaggedness, arc, zigs)
        : buildLightning(
            tuckedAttach,
            effectiveLength,
            (rt.params.segments as number) ?? 5,
            jaggedness,
            (rt.params.seed as number) ?? 7,
            arc,
          );
      // Width at vertex i: linear param t ∈ [1, tipWidth], shaped by the
      // `widthTaper` exponent — 1 = linear, >1 = fatter base / faster
      // tip drop-off, <1 = gentler taper.
      const ribbon = [buildTaperedPolygon(pts, (i, n) => {
        const u = i / Math.max(1, n - 1);
        const shaped = Math.pow(1 - u, widthTaper);
        return baseW * (tipWidth + (1 - tipWidth) * shaped);
      })];
      out.push({ polys: ribbon, d: polygonsToSvgPath(ribbon) });
    }
    return out;
  }, [resolvedTails]);

  const bodyAndBubblesPolys = useMemo<Polygon[]>(() => {
    const polys: Polygon[] = [bodyPolygon];
    for (const rt of resolvedTails) {
      if (rt.shape !== 'bubbles') continue;
      const dims = tailDims(rt.params, 'bubbles', W, H);
      // Bubbles size from explicit diameter (px) — largest bubble = the
      // one attached to the body. Others fall off by `taper`.
      const startRadius = ((rt.params.bubbleDiameter as number) ?? 30) / 2;
      const bubbles = buildBubbles(
        rotateAttachByOutAngle(rt.attach, (rt.params.outAngle as number) ?? 0),
        (rt.params.count as number) ?? 3,
        startRadius,
        (rt.params.taper as number) ?? 0.7,
        (rt.params.gap as number) ?? 0.15,
        dims.length,
        (rt.params.arc as number) ?? 0,
      );
      for (const b of bubbles) polys.push(circleToPolygon(b.cx, b.cy, b.r));
    }
    // Fold lightning ribbons into the silhouette so they share the
    // body's fill, stroke, dome lighting, and plateau geometry.
    for (const r of lightningRibbons) {
      for (const poly of r.polys) polys.push(poly);
    }
    // Cloud-puff morph effects: union N small ovals around the body so
    // the silhouette ends up as overlapping lobes — for thought-bubble
    // and cloud-callout shapes built on top of any base.
    for (const eff of cloudEffects) {
      const puffs = buildCloudPuffs({
        density: (eff.params.density as number) ?? 3,
        puffSize: (eff.params.puffSize as number) ?? 18,
        sizeJitter: (eff.params.sizeJitter as number) ?? 0.5,
        posJitter: (eff.params.posJitter as number) ?? 0.5,
        seed: (eff.params.seed as number) ?? 11,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
      });
      for (const p of puffs) polys.push(circleToPolygon(p.cx, p.cy, p.r));
    }
    return polys.length === 1 ? [bodyPolygon] : unionPolygons(polys);
  }, [bodyPolygon, resolvedTails, lightningRibbons, cloudEffects, sampler]);

  const bodyPath = useMemo(() => polygonsToSvgPath(bodyAndBubblesPolys), [bodyAndBubblesPolys]);

  // Body silhouette, with lightning ribbons unioned in but NOT bubbles. Used by
  // aqua mode so the body's gradient flows continuously through any lightning
  // tails (one piece of mylar) while bubbles — which are physically separate
  // floaty objects — still get their own bbox-anchored gradient.
  const bodyOnlyPath = useMemo(() => {
    if (lightningRibbons.length === 0) return polygonsToSvgPath([bodyPolygon]);
    const polys: Polygon[] = [bodyPolygon];
    for (const r of lightningRibbons) for (const p of r.polys) polys.push(p);
    return polygonsToSvgPath(unionPolygons(polys));
  }, [bodyPolygon, lightningRibbons]);

  // Flat list of bubbles from every bubble-shaped tail.
  const allBubbles = useMemo(() => {
    const out: Array<{ cx: number; cy: number; r: number }> = [];
    for (const rt of resolvedTails) {
      if (rt.shape !== 'bubbles') continue;
      const dims = tailDims(rt.params, 'bubbles', W, H);
      const startRadius = ((rt.params.bubbleDiameter as number) ?? 30) / 2;
      const bubbles = buildBubbles(
        rotateAttachByOutAngle(rt.attach, (rt.params.outAngle as number) ?? 0),
        (rt.params.count as number) ?? 3,
        startRadius,
        (rt.params.taper as number) ?? 0.7,
        (rt.params.gap as number) ?? 0.15,
        dims.length,
        (rt.params.arc as number) ?? 0,
      );
      out.push(...bubbles);
    }
    return out;
  }, [resolvedTails]);

  // Lightning tails: inflate the open polyline by baseWidth/2 to get a filled
  // ribbon (rounded ends). Each becomes its own polygon-set whose SVG path is
  // derived once.
  const strokeW = strokeEffect ? ((strokeEffect.params.width as number) ?? 0) : 0;
  const strokeColor = strokeEffect ? ((strokeEffect.params.color as string) ?? 'none') : 'none';
  const hasShadow = !!shadowEffect;

  // Padding for the viewBox so tails / spikes / shadows / strokes don't
  // get clipped. Body apparent size stays constant — only the SVG's outer
  // pixel dimensions grow when reach grows; zoom multiplies on top.
  const reach = useMemo(() => {
    let max = 60;
    for (const eff of tailEffects) {
      const shape = (eff.params.shape as string) ?? 'pointed';
      const size = (eff.params.size as number) ?? (eff.params.length as number) ?? 50;
      max = Math.max(max, size);
      // Bubbles chain length isn't governed by `size` — it's the sum of
      // bubble diameters + gaps, count many. Estimate so the viewBox
      // padding accommodates the full chain.
      if (shape === 'bubbles') {
        const diam = (eff.params.bubbleDiameter as number) ?? 30;
        const count = (eff.params.count as number) ?? 3;
        const gap = (eff.params.gap as number) ?? 0.15;
        max = Math.max(max, count * diam * (1 + gap));
      }
    }
    for (const eff of design.effects) {
      if (eff.kind === 'spikes') {
        max = Math.max(max, (eff.params.length as number) ?? 18);
      } else if (eff.kind === 'lobes') {
        max = Math.max(max, (eff.params.depth as number) ?? 12);
      } else if (eff.kind === 'wobble') {
        max = Math.max(max, (eff.params.amplitude as number) ?? 8);
      } else if (eff.kind === 'jitter') {
        max = Math.max(max, (eff.params.amount as number) ?? 6);
      }
    }
    return max + 30;
  }, [tailEffects, design.effects]);

  const uid = useId().replace(/:/g, '');
  const idPrefix = `sb-${uid}`;
  const shadowId = `${idPrefix}-shadow`;
  const aquaBodyId = `${idPrefix}-aqua-body`;
  const aquaGlossId = `${idPrefix}-aqua-gloss`;

  // Resolve fill params from the effect's ParamBag, with sensible defaults
  // for missing keys.
  const fillRender = useMemo(() => {
    const p = fillEffect?.params ?? {};
    const rawMode = (p.mode as string) ?? 'dome';
    const mode: FillMode =
      rawMode === 'aqua' ? 'aqua' : rawMode === 'brdf' ? 'brdf' : 'dome';
    const base = (p.base as string) ?? '#ffffff';
    const contour = Array.isArray(p.contour) ? (p.contour as number[]) : [0, 1, 1, 1];
    return {
      mode,
      base,
      contour,
      amount: (p.amount as number) ?? 0.6,
      shadowColor: (p.shadowColor as string) ?? '#000000',
      highlightColor: (p.highlightColor as string) ?? '#ffffff',
      lightAzimuth: (p.lightAzimuth as number) ?? 270,
      lightElevation: (p.lightElevation as number) ?? 55,
      bevelWidth: (p.bevelWidth as number) ?? 22,
      domeGloss: (p.domeGloss as number) ?? 0.35,
      specStrength: (p.specStrength as number) ?? 0.5,
      specSize: (p.specSize as number) ?? 18,
      // BRDF-only knobs
      specPower: (p.specPower as number) ?? 32,
      rimStrength: (p.rimStrength as number) ?? 0.4,
      rimPower: (p.rimPower as number) ?? 3,
      // Aqua-only params
      lightAngle: (p.lightAngle as number) ?? 270,
      glossStrength: (p.glossStrength as number) ?? 0.55,
      rimContrast: (p.rimContrast as number) ?? 0.4,
      highlightTint: (p.highlightTint as string) ?? '#ffffff',
      shadowTint: (p.shadowTint as string) ?? '#0a1020',
    };
  }, [fillEffect]);

  // Pre-compute the aqua paint-server geometry: gradient direction in
  // objectBoundingBox coordinates + the five color stops mixed from base/tints.
  const aquaPaint = useMemo(() => {
    if (fillRender.mode !== 'aqua') return null;
    const rad = (fillRender.lightAngle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // (x1, y1) at the highlight side; (x2, y2) at the shadow side. Both in
    // bbox-relative 0..1 coords so each shape rotates its own gradient identically.
    const x1 = 0.5 + 0.5 * dx;
    const y1 = 0.5 + 0.5 * dy;
    const x2 = 0.5 - 0.5 * dx;
    const y2 = 0.5 - 0.5 * dy;

    const base = parseHex(fillRender.base);
    const hi = parseHex(fillRender.highlightTint);
    const sh = parseHex(fillRender.shadowTint);
    const rim = fillRender.rimContrast;
    // 5-stop body gradient: bright on the light side → base in the middle →
    // shadow on the dark side. Stop positions tuned for the aqua look.
    const bodyStops: Array<[number, string]> = [
      [0.0, mixCss(base, hi, 0.7)],
      [0.3, mixCss(base, hi, 0.18)],
      [0.55, mixCss(base, base, 0)], // pure base
      [0.85, mixCss(base, sh, rim * 0.7)],
      [1.0, mixCss(base, sh, rim)],
    ];
    return { x1, y1, x2, y2, bodyStops };
  }, [fillRender.mode, fillRender.lightAngle, fillRender.base, fillRender.highlightTint, fillRender.shadowTint, fillRender.rimContrast]);

  // Multi-light dome. Two lights for v1: a key light from the user-controlled
  // azimuth/elevation and a hardcoded fill from the opposite side. Each
  // light's lit perimeter arc is clipped, a linear gradient along its
  // azimuth fills that wedge, and they composite additively below.
  // TODO: expose lights as a customizable list per fill effect.
  const domeLights = useMemo(() => {
    const keyAz = fillRender.lightAzimuth;
    const keyEl = fillRender.lightElevation;
    return [
      { az: keyAz, el: keyEl, intensity: 1.0 },
      { az: (keyAz + 180) % 360, el: 25, intensity: 0.35 },
    ];
  }, [fillRender.lightAzimuth, fillRender.lightElevation]);

  // Wrap the existing arc-length sampler in an angle-keyed one so the dome
  // helpers can ask for the perimeter point along a ray from centroid.
  const angleSampler = useMemo<PerimeterSampler>(() => {
    return (angle: number) => {
      const sc = attachmentS((angle * 180) / Math.PI, sampler, W / 2, H / 2);
      const p = sampler.perimeterAt(sc);
      return { x: p.x, y: p.y, nx: p.nx, ny: p.ny };
    };
  }, [sampler, W, H]);

  // Single contour function shared by every shading and debug memo. The
  // dome's tilt curve, the BRDF terms, and the heightmap all derive from this
  // one primitive — no separate parameters for rim tilt / crown height /
  // bevel curve. The user sculpts the height profile directly.
  const contour = useMemo<ContourFn>(() => {
    const flat = fillRender.contour;
    const cpts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      cpts.push({ x: flat[i]!, y: flat[i + 1]! });
    }
    cpts.sort((a, b) => a.x - b.x);
    return (x) => {
      if (cpts.length === 0) return 0;
      if (x <= cpts[0]!.x) return cpts[0]!.y;
      if (x >= cpts[cpts.length - 1]!.x) return cpts[cpts.length - 1]!.y;
      let i = 0;
      while (i < cpts.length - 1 && cpts[i + 1]!.x < x) i++;
      const a = cpts[i]!;
      const b = cpts[i + 1]!;
      const u = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * u;
    };
  }, [fillRender.contour]);

  // Rim tilt is whatever the contour curve produces at r=1; this seeds the
  // computeLitArcs threshold (it tests whether the lifted 3D rim normal
  // catches the light) so the lit half-arc still tracks the dome's shape.
  const rimTiltRad = useMemo(() => contourTilt(1, contour), [contour]);

  const domeLayers = useMemo(() => {
    if (fillRender.mode !== 'dome') return [];
    const bb = bareBaseBBox(sampler);
    if (bb.w <= 0 || bb.h <= 0) return [];
    const centroid: [number, number] = [bb.x + bb.w / 2, bb.y + bb.h / 2];

    const out: Array<{
      clipD: string;
      cx: number; cy: number; r: number;
      intensity: number;
      stops: GradientStop[];
    }> = [];

    for (const light of domeLights) {
      const arcs = computeLitArcs(angleSampler, light.az, light.el, 240, rimTiltRad);
      for (const arc of arcs) {
        // computeLitArcs may return wrapped arcs (end < start). Normalize.
        let a0 = arc.start;
        let a1 = arc.end;
        if (a1 <= a0) a1 += 2 * Math.PI;
        const boundaries = subdivideArc(angleSampler, a0, a1, centroid, 4, 4, 96);
        for (let k = 0; k + 1 < boundaries.length; k++) {
          const aStart = boundaries[k]!;
          const aEnd = boundaries[k + 1]!;
          const aMid = (aStart + aEnd) / 2;
          const rimPoint = angleSampler(aMid);
          const rLocal = Math.hypot(rimPoint.x - centroid[0], rimPoint.y - centroid[1]);
          if (rLocal < 1e-6) continue;
          const clipD = buildSliceWedgePath(angleSampler, aStart, aEnd, centroid);
          const stops = sampleSliceStops({
            axisAngleRad: aMid,
            lightAzimuthDeg: light.az,
            lightElevationDeg: light.el,
            lightIntensity: light.intensity,
            contour,
          });
          out.push({
            clipD,
            cx: centroid[0],
            cy: centroid[1],
            r: rLocal,
            intensity: 1, // already folded into per-stop opacity
            stops,
          });
        }
      }
    }

    return out;
  }, [
    fillRender.mode,
    contour,
    rimTiltRad,
    sampler,
    angleSampler,
    domeLights,
  ]);

  // BRDF mode: one path per (light × term). Far fewer gradient primitives
  // than the dome's N-slice loop — at most 3 per light (Diffuse + Specular +
  // Rim) on top of the solid base body fill that stands in for Ambient.
  type BrdfLayer = {
    key: string;
    clipD: string;
    gradient:
      | { type: 'linear'; x1: number; y1: number; x2: number; y2: number }
      | { type: 'radial'; cx: number; cy: number; r: number };
    stops: GradientStop[];
    color: string;
    scale: number;
  };

  const brdfLayers = useMemo<BrdfLayer[]>(() => {
    if (fillRender.mode !== 'brdf') return [];
    const bb = bareBaseBBox(sampler);
    if (bb.w <= 0 || bb.h <= 0) return [];
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;

    const out: BrdfLayer[] = [];
    for (let li = 0; li < domeLights.length; li++) {
      const light = domeLights[li]!;
      const arcs = computeLitArcs(angleSampler, light.az, light.el, 240, rimTiltRad);
      if (arcs.length === 0) continue;
      const litWedgeD = buildLightWedgePath(angleSampler, arcs, [cx, cy]);

      // Lit-rim and far-rim points along the light azimuth for axis-aligned
      // gradients; the centroid sits between them at s = rLit/(rLit + rFar).
      const azRad = (light.az * Math.PI) / 180;
      const litRim = angleSampler(azRad);
      const farRim = angleSampler(azRad + Math.PI);
      const rLit = Math.hypot(litRim.x - cx, litRim.y - cy);
      const rFar = Math.hypot(farRim.x - cx, farRim.y - cy);

      // Diffuse: linearGradient along the light axis. Stops come from
      // sampleLightStops (Lambertian over the contour-derived tilt curve);
      // the wedge clip bounds the paint to the lit hemisphere — and since
      // N·L = 0 at the terminator, that hard edge is zero by construction.
      out.push({
        key: `${li}-d`,
        clipD: litWedgeD,
        gradient: { type: 'linear', x1: litRim.x, y1: litRim.y, x2: farRim.x, y2: farRim.y },
        stops: sampleLightStops({
          azimuthDeg: light.az,
          elevationDeg: light.el,
          rLit,
          rFar,
          contour,
        }),
        color: fillRender.highlightColor,
        scale: fillRender.amount * light.intensity,
      });

      // Specular: find r where contour-derived tilt matches the half-vector's
      // elevation (Blinn-Phong peak), then anchor a small radialGradient
      // there. The hot spot sits on the light-azimuth radial at
      // distance r_spec · rLit from the centroid.
      if (fillRender.specStrength > 0) {
        const targetTilt = halfVectorTilt(light.el);
        const rSpec = findRForTilt(targetTilt, contour);
        const hotX = cx + rSpec * (litRim.x - cx);
        const hotY = cy + rSpec * (litRim.y - cy);
        out.push({
          key: `${li}-s`,
          clipD: litWedgeD,
          gradient: { type: 'radial', cx: hotX, cy: hotY, r: Math.max(2, fillRender.specSize) },
          stops: sampleSpecularStops(fillRender.specPower),
          color: fillRender.highlightColor,
          scale: fillRender.amount * light.intensity * fillRender.specStrength,
        });
      }

      // Rim/Fresnel: radialGradient centered at centroid with radius = rLit,
      // stops peaked where the contour's slope is steep — that's where the
      // surface normal is nearest in-plane and (1 − sin(tilt))^k spikes. The
      // lit-wedge clip restricts the paint to the lit side, so the rim only
      // appears where light actually grazes the silhouette.
      if (fillRender.rimStrength > 0) {
        out.push({
          key: `${li}-r`,
          clipD: litWedgeD,
          gradient: { type: 'radial', cx, cy, r: rLit },
          stops: sampleRimStops(contour, fillRender.rimPower),
          color: fillRender.highlightColor,
          scale: fillRender.amount * light.intensity * fillRender.rimStrength,
        });
      }
    }
    return out;
  }, [
    fillRender.mode,
    contour,
    rimTiltRad,
    fillRender.amount,
    fillRender.highlightColor,
    fillRender.specStrength,
    fillRender.specSize,
    fillRender.specPower,
    fillRender.rimStrength,
    fillRender.rimPower,
    sampler,
    angleSampler,
    domeLights,
  ]);

  // Heightmap debug overlay: rasterize the body's billboard-viewed elevation
  // z(x, y) into a canvas, encode as a grayscale data URL, and hand back
  // placement metadata. Black = rim (z = 0), white = the highest centroid
  // sample. With the contour-driven model, z(x, y) is literally the contour
  // curve sampled at r_norm = 1 − d/dMax (d = distance from perimeter, dMax =
  // medial-axis depth) — a direct visualization of the same primitive the
  // dome/BRDF shading reads via contourTilt.
  const heightmapImage = useMemo(() => {
    if (!runtime.heightmapDebug) return null;
    if (typeof document === 'undefined') return null;
    const bb = bareBaseBBox(sampler);
    if (bb.w <= 0 || bb.h <= 0) return null;

    // Perimeter polyline: closed loop of segments around the body silhouette.
    // Per-pixel we compute (a) point-in-polygon to decide inside, and (b) the
    // minimum distance to any perimeter segment. That distance is what
    // parameterizes the dome — the body-of-revolution model is replaced with
    // a body-of-OFFSETS model so the bevel band hugs the actual silhouette
    // instead of stretching radially out from the centroid (which on a
    // rounded-rect produces the blob you saw at the corners).
    const PERIM_N = 192;
    const perimX = new Float32Array(PERIM_N);
    const perimY = new Float32Array(PERIM_N);
    for (let i = 0; i < PERIM_N; i++) {
      const p = sampler.perimeterAt((i / PERIM_N) * sampler.totalLen);
      perimX[i] = p.x;
      perimY[i] = p.y;
    }

    // dMax = depth of the medial axis (deepest inscribed offset). Used to
    // normalize per-pixel perimeter distance into r ∈ [0, 1] before sampling
    // the contour. No bevel-width split — the contour curve carries that.
    const dMax = Math.max(1e-6, bareBaseMaxBevel(sampler));

    const PAD = 2;
    const W = Math.max(1, Math.ceil(bb.w) + 2 * PAD);
    const H = Math.max(1, Math.ceil(bb.h) + 2 * PAD);
    const x0 = bb.x - PAD;
    const y0 = bb.y - PAD;

    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(W, H);
    const data = img.data;

    const heightField = new Float32Array(W * H);
    const insideMask = new Uint8Array(W * H);
    let hMax = 0;
    for (let py = 0; py < H; py++) {
      const wy = y0 + py + 0.5;
      for (let px = 0; px < W; px++) {
        const wx = x0 + px + 0.5;
        // Distance to perimeter (min over all segments) + horizontal ray-cast
        // crossing parity for the inside test, fused into one perimeter pass.
        let dMinSq = Infinity;
        let crossings = 0;
        let ax = perimX[PERIM_N - 1]!;
        let ay = perimY[PERIM_N - 1]!;
        for (let k = 0; k < PERIM_N; k++) {
          const bx = perimX[k]!;
          const by = perimY[k]!;
          const dx = bx - ax;
          const dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          let t = 0;
          if (lenSq > 1e-12) {
            t = ((wx - ax) * dx + (wy - ay) * dy) / lenSq;
            if (t < 0) t = 0; else if (t > 1) t = 1;
          }
          const qx = ax + t * dx;
          const qy = ay + t * dy;
          const ex = wx - qx;
          const ey = wy - qy;
          const dsq = ex * ex + ey * ey;
          if (dsq < dMinSq) dMinSq = dsq;
          // Ray-cast (horizontal ray going +x from pixel).
          if ((ay > wy) !== (by > wy)) {
            const xCross = ax + (wy - ay) * (bx - ax) / (by - ay);
            if (wx < xCross) crossings++;
          }
          ax = bx;
          ay = by;
        }
        if ((crossings & 1) === 0) continue; // outside body
        const d = Math.sqrt(dMinSq);
        const rNorm = Math.min(1, Math.max(0, 1 - d / dMax));
        const h = domeHeight(rNorm, contour);
        const i = py * W + px;
        heightField[i] = h;
        insideMask[i] = 1;
        if (h > hMax) hMax = h;
      }
    }
    const norm = hMax > 1e-9 ? 1 / hMax : 0;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!insideMask[i]) {
        data[o + 3] = 0;
        continue;
      }
      const v = Math.min(255, Math.max(0, Math.round(heightField[i]! * norm * 255)));
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { href: cv.toDataURL('image/png'), x: x0, y: y0, w: W, h: H };
  }, [
    runtime.heightmapDebug,
    contour,
    sampler,
  ]);

  // Debug overlay geometry. Body silhouette in red, bevel band inner
  // boundary (geometrically-correct clipper miter inset) in yellow,
  // plus light azimuth rays from the centroid.
  const domeDebug = useMemo(() => {
    if (!runtime.domeDebug) return null;
    if (fillRender.mode !== 'dome' && fillRender.mode !== 'brdf') return null;
    const bb = bareBaseBBox(sampler);
    if (bb.w <= 0 || bb.h <= 0) return null;
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const bw = fillRender.bevelWidth;

    const N = 192;
    const body: Polygon = [];
    const bodyPts: string[] = [];
    for (let i = 0; i < N; i++) {
      const p = sampler.perimeterAt((i / N) * sampler.totalLen);
      body.push({ x: p.x, y: p.y });
      bodyPts.push(`${p.x},${p.y}`);
    }

    // Geometrically correct inward offset (sharp corners stay sharp,
    // rounded corners stay round, concavity overshoot disappears).
    const insetPolys = bw > 0 ? offsetClosedPolygon(body, -bw, 'miter') : [body];
    const bevelPath = polygonsToSvgPath(insetPolys);

    // Medial axis approximation: clipper's deepest non-empty inset on the
    // body. The 0.98 safety in bareBaseMaxBevel gives this a couple of px
    // of natural thickness so it renders as a line, not a degenerate path.
    const maxBw = bareBaseMaxBevel(sampler);
    const medialPolys = maxBw > 0 ? offsetClosedPolygon(body, -maxBw, 'miter') : [];
    const medialPath = polygonsToSvgPath(medialPolys);

    // Inner medial axis: same trick, but applied to the bevel-inset polygon
    // instead of the body. Sits on top of the outer one (same location on
    // most shapes, but thinner because it's the medial of a smaller polygon).
    let innerMedialPath = '';
    if (insetPolys.length > 0) {
      const inner = insetPolys[0]!;
      let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
      for (const p of inner) {
        if (p.x < mnX) mnX = p.x;
        if (p.y < mnY) mnY = p.y;
        if (p.x > mxX) mxX = p.x;
        if (p.y > mxY) mxY = p.y;
      }
      let lo = 0;
      let hi = Math.max(1, Math.max(mxX - mnX, mxY - mnY) / 2);
      // Tight precision: we want a near-degenerate sliver so the stroked
      // contour reads as a thin centerline rather than a filled ribbon.
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (offsetClosedPolygon(inner, -mid, 'miter').length === 0) hi = mid;
        else lo = mid;
        if (hi - lo < 0.02) break;
      }
      const innerMaxBw = Math.max(0, lo - 0.005);
      if (innerMaxBw > 0) {
        innerMedialPath = polygonsToSvgPath(offsetClosedPolygon(inner, -innerMaxBw, 'miter'));
      }
    }

    // Per-light overlay data:
    //   - lit-rim point (where the centroid → azimuth ray hits the perimeter):
    //     also the bright end of the BRDF diffuse linearGradient,
    //   - far-rim point (opposite side): the dark end of that same axis,
    //   - specular hot spot (BRDF only): scanned r where contourTilt(r)
    //     matches the half-vector elevation, placed on the azimuth radial.
    const isBrdf = fillRender.mode === 'brdf';
    const lights = domeLights.map((l) => {
      const azRad = (l.az * Math.PI) / 180;
      const litRim = angleSampler(azRad);
      const farRim = angleSampler(azRad + Math.PI);
      let hot: { x: number; y: number; r: number } | null = null;
      if (isBrdf && fillRender.specStrength > 0) {
        const targetTilt = halfVectorTilt(l.el);
        const rSpec = findRForTilt(targetTilt, contour);
        hot = {
          x: cx + rSpec * (litRim.x - cx),
          y: cy + rSpec * (litRim.y - cy),
          r: Math.max(2, fillRender.specSize),
        };
      }
      return {
        x2: litRim.x,
        y2: litRim.y,
        farX: farRim.x,
        farY: farRim.y,
        hot,
        intensity: l.intensity,
      };
    });
    return {
      cx,
      cy,
      isBrdf,
      bodyRingPoints: bodyPts.join(' '),
      bevelPath,
      medialPath,
      innerMedialPath,
      lights,
    };
  }, [
    runtime.domeDebug,
    fillRender.mode,
    fillRender.bevelWidth,
    fillRender.specStrength,
    fillRender.specSize,
    contour,
    sampler,
    angleSampler,
    domeLights,
  ]);

  const zoom = Math.max(0.1, zoomProp ?? 1.2);
  const pxW = (W + 2 * reach) * zoom;
  const pxH = (H + 2 * reach) * zoom;

  // Render-time registry of shading elements. Each tagged JSX element calls
  // `pushShading` to add itself; after this render the array is published to
  // the parent via onShadingItems. Recreated every render so it always
  // reflects the current mode/light/effect set.
  const shadingItems: ShadingItem[] = [];
  const pushShading = (item: ShadingItem): string => {
    shadingItems.push(item);
    return item.id;
  };
  const pulseIf = (id: string): string | undefined =>
    highlightedShadingId === id ? 'shading-pulse' : undefined;

  // Publish after each render. useEffect's dep on a joined id list avoids
  // re-firing when the (always-new) array reference changes but the item set
  // hasn't.
  const shadingItemsKey = shadingItems.map((s) => s.id).join('|');
  useEffect(() => {
    onShadingItems?.(shadingItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadingItemsKey, onShadingItems]);

  return (
    <svg
      viewBox={`${-reach} ${-reach} ${W + 2 * reach} ${H + 2 * reach}`}
      width={pxW}
      height={pxH}
      style={{
        // Canvas fill behind the balloon at 70% alpha so the CMY nebula
        // bleeds through. Re-parsed from the hex `design.bg` on every
        // render — cheap.
        background: (() => {
          const rgb = parseHex(design.bg);
          return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.7)`;
        })(),
        borderRadius: 8,
        display: 'block',
      }}
    >
      <defs>
        {hasShadow && (
          <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation={(shadowEffect!.params.blur as number) ?? 10} />
            <feOffset
              dx={(shadowEffect!.params.dx as number) ?? 4}
              dy={(shadowEffect!.params.dy as number) ?? 8}
              result="off"
            />
            <feComponentTransfer in="off" result="dropshadow">
              <feFuncA type="linear" slope={(shadowEffect!.params.opacity as number) ?? 0.4} />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="dropshadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
        {/* Aqua paint servers: a 5-stop body linear gradient + a soft gloss
            overlay, both anchored per-shape via objectBoundingBox so each
            bubble gets its own dome-ish look without filter machinery. */}
        {aquaPaint && (
          <>
            <linearGradient
              id={aquaBodyId}
              gradientUnits="objectBoundingBox"
              x1={aquaPaint.x1}
              y1={aquaPaint.y1}
              x2={aquaPaint.x2}
              y2={aquaPaint.y2}
            >
              {aquaPaint.bodyStops.map(([offset, color]) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </linearGradient>
            <linearGradient
              id={aquaGlossId}
              gradientUnits="objectBoundingBox"
              x1={aquaPaint.x1}
              y1={aquaPaint.y1}
              x2={aquaPaint.x2}
              y2={aquaPaint.y2}
            >
              <stop offset="0" stopColor={fillRender.highlightTint} stopOpacity={fillRender.glossStrength} />
              <stop offset="0.35" stopColor={fillRender.highlightTint} stopOpacity={fillRender.glossStrength * 0.35} />
              <stop offset="0.55" stopColor={fillRender.highlightTint} stopOpacity="0" />
            </linearGradient>
          </>
        )}
      </defs>

      {/* Body group — silhouette + bubble/lightning tails share the same fill,
          stroke, and drop-shadow filter. */}
      <g filter={hasShadow ? `url(#${shadowId})` : undefined}>
        {fillRender.mode === 'aqua' && (
          // Aqua: per-shape paint servers, no filter. Body and each bubble get
          // their own bbox-anchored gradient + gloss so the "centroid" of each
          // sub-shape's highlight lands inside it instead of being averaged
          // across the unioned silhouette.
          <>
            <path
              d={bodyOnlyPath}
              fill={`url(#${aquaBodyId})`}
              data-shading-id={pushShading({ id: 'aqua.body', label: 'Aqua body gradient', group: 'aqua' })}
              className={pulseIf('aqua.body')}
            />
            {fillRender.glossStrength > 0 && (
              <path
                d={bodyOnlyPath}
                fill={`url(#${aquaGlossId})`}
                data-shading-id={pushShading({ id: 'aqua.gloss', label: 'Aqua gloss', group: 'aqua' })}
                className={pulseIf('aqua.gloss')}
              />
            )}
            {allBubbles.map((b, i) => (
              <g key={i}>
                <circle
                  cx={b.cx} cy={b.cy} r={b.r}
                  fill={`url(#${aquaBodyId})`}
                  data-shading-id={pushShading({ id: `aqua.bubble-${i}.body`, label: `Bubble ${i + 1} body`, group: 'aqua' })}
                  className={pulseIf(`aqua.bubble-${i}.body`)}
                />
                {fillRender.glossStrength > 0 && (
                  <circle
                    cx={b.cx} cy={b.cy} r={b.r}
                    fill={`url(#${aquaGlossId})`}
                    data-shading-id={pushShading({ id: `aqua.bubble-${i}.gloss`, label: `Bubble ${i + 1} gloss`, group: 'aqua' })}
                    className={pulseIf(`aqua.bubble-${i}.gloss`)}
                  />
                )}
              </g>
            ))}
          </>
        )}
        {fillRender.mode === 'dome' && (
          // Dome: solid base color + N additive light layers, each clipped
          // to its lit region (centroid-to-perimeter wedge across the lit
          // arc) and painted with a radial gradient from centroid out to the
          // slice's rim. Plateau emerges naturally where every light's wedge covers it.
          <>
            {domeLayers.length > 0 && (
              <>
                <defs>
                  {domeLayers.map((layer, i) => (
                    <Fragment key={i}>
                      <clipPath id={`${idPrefix}-dome-clip-${i}`}>
                        <path d={layer.clipD} />
                      </clipPath>
                      <radialGradient
                        id={`${idPrefix}-dome-grad-${i}`}
                        gradientUnits="userSpaceOnUse"
                        cx={layer.cx} cy={layer.cy} r={layer.r}
                        fx={layer.cx} fy={layer.cy}
                      >
                        {layer.stops.map((s, j) => (
                          <stop
                            key={j}
                            offset={s.offset}
                            stopColor={fillRender.highlightColor}
                            stopOpacity={fillRender.amount * layer.intensity * s.opacity}
                          />
                        ))}
                      </radialGradient>
                    </Fragment>
                  ))}
                </defs>
                <path
                  d={bodyPath}
                  fill={fillRender.base}
                  data-shading-id={pushShading({ id: 'body', label: 'Body fill', group: 'body' })}
                  className={pulseIf('body')}
                />
                <g style={{ mixBlendMode: 'screen', isolation: 'isolate' }}>
                  {domeLayers.map((_, i) => {
                    const id = `dome.light-${i}`;
                    const label = i === 0 ? 'Key light' : i === 1 ? 'Fill light' : `Light ${i + 1}`;
                    return (
                      <path
                        key={i}
                        d={bodyPath}
                        fill={`url(#${idPrefix}-dome-grad-${i})`}
                        clipPath={`url(#${idPrefix}-dome-clip-${i})`}
                        data-shading-id={pushShading({ id, label, group: 'dome' })}
                        className={pulseIf(id)}
                      />
                    );
                  })}
                </g>
              </>
            )}
          </>
        )}
        {fillRender.mode === 'brdf' && (
          // BRDF: solid base body (ambient) + one painted region per
          // (light × term). Each region has the gradient shape best matched
          // to its term — linear along the light axis for Diffuse,
          // radial at the hot spot for Specular, radial centroid→rim for Rim.
          // Stacked additively via `mix-blend-mode: screen`.
          <>
            <path
              d={bodyPath}
              fill={fillRender.base}
              data-shading-id={pushShading({ id: 'body', label: 'Body fill', group: 'body' })}
              className={pulseIf('body')}
            />
            {brdfLayers.length > 0 && (
              <>
                <defs>
                  {brdfLayers.map((layer) => (
                    <Fragment key={layer.key}>
                      <clipPath id={`${idPrefix}-brdf-clip-${layer.key}`}>
                        <path d={layer.clipD} />
                      </clipPath>
                      {layer.gradient.type === 'linear' ? (
                        <linearGradient
                          id={`${idPrefix}-brdf-grad-${layer.key}`}
                          gradientUnits="userSpaceOnUse"
                          x1={layer.gradient.x1} y1={layer.gradient.y1}
                          x2={layer.gradient.x2} y2={layer.gradient.y2}
                        >
                          {layer.stops.map((s, j) => (
                            <stop
                              key={j}
                              offset={s.offset}
                              stopColor={layer.color}
                              stopOpacity={Math.min(1, Math.max(0, layer.scale * s.opacity))}
                            />
                          ))}
                        </linearGradient>
                      ) : (
                        <radialGradient
                          id={`${idPrefix}-brdf-grad-${layer.key}`}
                          gradientUnits="userSpaceOnUse"
                          cx={layer.gradient.cx} cy={layer.gradient.cy} r={layer.gradient.r}
                          fx={layer.gradient.cx} fy={layer.gradient.cy}
                        >
                          {layer.stops.map((s, j) => (
                            <stop
                              key={j}
                              offset={s.offset}
                              stopColor={layer.color}
                              stopOpacity={Math.min(1, Math.max(0, layer.scale * s.opacity))}
                            />
                          ))}
                        </radialGradient>
                      )}
                    </Fragment>
                  ))}
                </defs>
                <g style={{ mixBlendMode: 'screen', isolation: 'isolate' }}>
                  {brdfLayers.map((layer) => {
                    const id = `brdf.${layer.key}`;
                    return (
                      <path
                        key={layer.key}
                        d={bodyPath}
                        fill={`url(#${idPrefix}-brdf-grad-${layer.key})`}
                        clipPath={`url(#${idPrefix}-brdf-clip-${layer.key})`}
                        data-shading-id={pushShading({ id, label: layer.key, group: 'brdf' })}
                        className={pulseIf(id)}
                      />
                    );
                  })}
                </g>
              </>
            )}
          </>
        )}

        {/* Outline last so it sits on top of the lit fill. */}
        {strokeW > 0 && (
          <path d={bodyPath} fill="none" stroke={strokeColor} strokeWidth={strokeW} strokeLinejoin="round" />
        )}
        {heightmapImage && (
          // Billboard heightmap overlay: covers the body silhouette with the
          // grayscale elevation field derived from the same bevel curve the
          // dome/BRDF modes shade against. Sits above the fill but below the
          // line-art debug overlay, and clips to the body silhouette so it
          // doesn't bleed into tails / lightning / bubbles (which aren't part
          // of the body-of-revolution model).
          <>
            <defs>
              <clipPath id={`${idPrefix}-hm-clip`}>
                <path d={bodyPath} />
              </clipPath>
            </defs>
            <image
              href={heightmapImage.href}
              x={heightmapImage.x}
              y={heightmapImage.y}
              width={heightmapImage.w}
              height={heightmapImage.h}
              preserveAspectRatio="none"
              clipPath={`url(#${idPrefix}-hm-clip)`}
              style={{ imageRendering: 'pixelated', pointerEvents: 'none' }}
            />
          </>
        )}
        {domeDebug && (
          <g style={{ pointerEvents: 'none' }}>
            <polygon
              points={domeDebug.bodyRingPoints}
              fill="none" stroke="#ff3030" strokeWidth={1.5} opacity={0.9}
            />
            <path
              d={domeDebug.bevelPath}
              fill="none"
              stroke="#ffcc00"
              strokeWidth={1}
              strokeOpacity={0.9}
            />
            {domeDebug.lights.map((l, i) => (
              <Fragment key={i}>
                {/* Centroid → lit-rim: the bright end of the diffuse axis. */}
                <line
                  x1={domeDebug.cx} y1={domeDebug.cy}
                  x2={l.x2} y2={l.y2}
                  stroke="#32cd32" strokeWidth={1.5} opacity={0.4 + 0.6 * l.intensity}
                />
                {domeDebug.isBrdf && (
                  <>
                    {/* Centroid → far-rim: dim half of the BRDF diffuse axis. */}
                    <line
                      x1={domeDebug.cx} y1={domeDebug.cy}
                      x2={l.farX} y2={l.farY}
                      stroke="#32cd32" strokeWidth={1} strokeDasharray="4 3"
                      opacity={0.25 + 0.35 * l.intensity}
                    />
                    {l.hot && (
                      <>
                        {/* Specular hot spot center + falloff radius. */}
                        <circle
                          cx={l.hot.x} cy={l.hot.y} r={l.hot.r}
                          fill="none" stroke="#00e5ff" strokeWidth={1}
                          strokeDasharray="3 2" opacity={0.7}
                        />
                        <circle cx={l.hot.x} cy={l.hot.y} r={2.5} fill="#00e5ff" />
                      </>
                    )}
                  </>
                )}
              </Fragment>
            ))}
            <path
              d={domeDebug.medialPath}
              fill="#ff3030"
              stroke="none"
              opacity={0.9}
            />
            {domeDebug.innerMedialPath && (
              <path
                d={domeDebug.innerMedialPath}
                fill="#ffcc00"
                stroke="#ffcc00"
                strokeWidth={0.5}
                opacity={0.95}
              />
            )}
            <circle cx={domeDebug.cx} cy={domeDebug.cy} r={4} fill="#ff3030" />
          </g>
        )}
      </g>

      {(() => {
        const lines = (runtime.text || '').split('\n');
        const lineHeight = runtime.fontSize * 1.1;
        const blockHeight = (lines.length - 1) * lineHeight;
        const firstY = H / 2 - blockHeight / 2;
        // One <text> per line — more robust than <tspan dy> with
        // dominant-baseline central, which some browsers collapse.
        return lines.map((line, i) => (
          <text
            key={i}
            x={W / 2}
            y={firstY + i * lineHeight}
            textAnchor="middle"
            dominantBaseline="central"
            fill={design.textColor}
            style={{
              fontFamily: runtime.fontFamily,
              fontSize: runtime.fontSize,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {line || ' '}
          </text>
        ));
      })()}
    </svg>
  );
}
