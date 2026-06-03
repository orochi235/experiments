import { Fragment, useId, useMemo } from 'react';
import type { DesignState, FillMode, ParamBag, RuntimeState, TailShape } from './types';
import {
  buildBaseSampler,
  composeBodyPoints,
  attachmentS,
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
  type Polygon,
} from './clipping';
interface Props {
  design: DesignState;
  runtime: RuntimeState;
  zoom?: number;
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

function lightDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el)];
}

// Surface tilt θ(r) for the implicit body of revolution. r ∈ [0,1] where
// r=0 is the centroid and r=1 is the rim. θ is the angle the outward
// normal lifts above the SVG plane. See spec
// docs/superpowers/specs/2026-06-02-contour-driven-normal-tilt-design.md
export function domeSurfaceTilt(
  r: number,
  rimTiltRad: number,
  crownHeight: number,
  bwNorm: number,
): number {
  const bw = Math.min(1, Math.max(0, bwNorm));
  const crownTilt = rimTiltRad + (Math.PI / 2 - rimTiltRad) * crownHeight;
  const rBevel = 1 - bw;
  // rBevel === 0 when bwNorm === 1 — skip the bevel branch so the interior
  // ramp covers all of [0, 1].
  if (r >= rBevel && rBevel > 0) return rimTiltRad;
  const t = rBevel > 0 ? r / rBevel : r;
  return crownTilt + (rimTiltRad - crownTilt) * t;
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

export type ContourFn = (x: number) => number;

export interface LightStopInput {
  azimuthDeg: number;
  elevationDeg: number;
  rimTiltRad: number;
  crownHeight: number;
  bwNorm: number;          // bevelWidth / R, already clamped if caller wants
  contour: ContourFn;      // x=0 (rim) → x=1 (center); y is brightness multiplier
  samples?: number;        // default 16
}

export interface GradientStop {
  offset: number;
  opacity: number;
}

// Sample the per-light brightness along the gradient axis (s ∈ [0,1] going
// lit-rim → centroid → far-rim). For each sample, recover the radial
// position on the body of revolution, compute the 3D normal via
// domeSurfaceTilt, and multiply max(0, N3·L) by the painterly contour.
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

  const out: GradientStop[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const s = i / SAMPLES;
    const dNorm = 0.5 - s;                              // +1/2 at lit rim, −1/2 at far rim
    const r = Math.min(1, Math.abs(dNorm) * 2);
    const tilt = domeSurfaceTilt(r, input.rimTiltRad, input.crownHeight, input.bwNorm);
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const sgn = dNorm >= 0 ? 1 : -1;
    const N3x = sgn * cosAz * cosTilt;
    const N3y = sgn * sinAz * cosTilt;
    const N3z = sinTilt;
    const phys = Math.max(0, N3x * Lx + N3y * Ly + N3z * Lz);
    // Gradient s 0→0.5→1 maps to radial r=1→0→1. Contour x=0 is rim,
    // x=1 is centroid. So contour_x = 1 − r.
    const paint = Math.max(0, input.contour(1 - r));
    out.push({ offset: s, opacity: phys * paint });
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

// Axis-aligned bounding box of one or more polygons.
function polysBBox(polys: Polygon[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const pt of poly) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}


// --- Component -----------------------------------------------------------

export function SpeechBalloon({ design, runtime, zoom: zoomProp }: Props) {
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
    const mode: FillMode = rawMode === 'aqua' ? 'aqua' : 'dome';
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
      rimTilt: (p.rimTilt as number) ?? 0,
      crownHeight: (p.crownHeight as number) ?? 0,
      bevelWidth: (p.bevelWidth as number) ?? 22,
      domeGloss: (p.domeGloss as number) ?? 0.35,
      specStrength: (p.specStrength as number) ?? 0.5,
      specSize: (p.specSize as number) ?? 18,
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

  const domeLayers = useMemo(() => {
    if (fillRender.mode !== 'dome') return [];
    const bb = polysBBox([bodyPolygon]);
    if (bb.w <= 0 || bb.h <= 0) return [];
    const centroid: [number, number] = [bb.x + bb.w / 2, bb.y + bb.h / 2];
    const R = Math.max(bb.w, bb.h) / 2;
    const rimTiltRad = (fillRender.rimTilt * Math.PI) / 180;
    const bwNorm = R > 0 ? Math.min(1, fillRender.bevelWidth / R) : 0;

    // Build a linear-interp contour function once per render.
    const flatContour = fillRender.contour;
    const cpts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < flatContour.length; i += 2) {
      cpts.push({ x: flatContour[i]!, y: flatContour[i + 1]! });
    }
    cpts.sort((a, b) => a.x - b.x);
    const contour = (x: number): number => {
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

    return domeLights.map((light) => {
      const arcs = computeLitArcs(angleSampler, light.az, light.el, 240, rimTiltRad);
      const clipD = buildLightWedgePath(angleSampler, arcs, centroid);
      const azRad = (light.az * Math.PI) / 180;
      const cosAz = Math.cos(azRad);
      const sinAz = Math.sin(azRad);
      const stops = sampleLightStops({
        azimuthDeg: light.az,
        elevationDeg: light.el,
        rimTiltRad,
        crownHeight: fillRender.crownHeight,
        bwNorm,
        contour,
      });
      return {
        clipD,
        x1: centroid[0] + cosAz * R,
        y1: centroid[1] + sinAz * R,
        x2: centroid[0] - cosAz * R,
        y2: centroid[1] - sinAz * R,
        intensity: light.intensity,
        stops,
      };
    });
  }, [
    fillRender.mode,
    fillRender.rimTilt,
    fillRender.crownHeight,
    fillRender.bevelWidth,
    fillRender.contour,
    bodyPolygon,
    angleSampler,
    domeLights,
  ]);

  // Debug overlay geometry. Recomputes the same bbox/centroid/R/rBevel
  // that domeLayers uses, plus an axis line for each light. Cheap; only
  // built when the overlay is on. The shapes are layered ABOVE the dome
  // fill so the user can see where the math lands relative to the body.
  const domeDebug = useMemo(() => {
    if (!runtime.domeDebug || fillRender.mode !== 'dome') return null;
    const bb = polysBBox([bodyPolygon]);
    if (bb.w <= 0 || bb.h <= 0) return null;
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const R = Math.max(bb.w, bb.h) / 2;
    const bwNorm = R > 0 ? Math.min(1, fillRender.bevelWidth / R) : 0;
    const rBevelPx = (1 - bwNorm) * R;
    const lights = domeLights.map((l) => {
      const az = (l.az * Math.PI) / 180;
      return { x2: cx + Math.cos(az) * R, y2: cy + Math.sin(az) * R, intensity: l.intensity };
    });
    return { bb, cx, cy, R, rBevelPx, lights };
  }, [runtime.domeDebug, fillRender.mode, fillRender.bevelWidth, bodyPolygon, domeLights]);

  const zoom = Math.max(0.1, zoomProp ?? 1.2);
  const pxW = (W + 2 * reach) * zoom;
  const pxH = (H + 2 * reach) * zoom;
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
        {fillRender.mode === 'aqua' ? (
          // Aqua: per-shape paint servers, no filter. Body and each bubble get
          // their own bbox-anchored gradient + gloss so the "centroid" of each
          // sub-shape's highlight lands inside it instead of being averaged
          // across the unioned silhouette.
          <>
            <path d={bodyOnlyPath} fill={`url(#${aquaBodyId})`} />
            {fillRender.glossStrength > 0 && <path d={bodyOnlyPath} fill={`url(#${aquaGlossId})`} />}
            {allBubbles.map((b, i) => (
              <g key={i}>
                <circle cx={b.cx} cy={b.cy} r={b.r} fill={`url(#${aquaBodyId})`} />
                {fillRender.glossStrength > 0 && (
                  <circle cx={b.cx} cy={b.cy} r={b.r} fill={`url(#${aquaGlossId})`} />
                )}
              </g>
            ))}
          </>
        ) : (
          // Dome: solid base color + N additive light layers, each clipped
          // to its lit region (centroid-to-perimeter wedge across the lit
          // arc) and painted with a linear gradient along its azimuth.
          // Plateau emerges naturally where every light's wedge covers it.
          <>
            {domeLayers.length > 0 && (
              <>
                <defs>
                  {domeLayers.map((layer, i) => (
                    <Fragment key={i}>
                      <clipPath id={`${idPrefix}-dome-clip-${i}`}>
                        <path d={layer.clipD} />
                      </clipPath>
                      <linearGradient
                        id={`${idPrefix}-dome-grad-${i}`}
                        gradientUnits="userSpaceOnUse"
                        x1={layer.x1} y1={layer.y1}
                        x2={layer.x2} y2={layer.y2}
                      >
                        {layer.stops.map((s, j) => (
                          <stop
                            key={j}
                            offset={s.offset}
                            stopColor={fillRender.highlightColor}
                            stopOpacity={fillRender.amount * layer.intensity * s.opacity}
                          />
                        ))}
                      </linearGradient>
                    </Fragment>
                  ))}
                </defs>
                <path d={bodyPath} fill={fillRender.base} />
                <g style={{ mixBlendMode: 'screen', isolation: 'isolate' }}>
                  {domeLayers.map((_, i) => (
                    <path
                      key={i}
                      d={bodyPath}
                      fill={`url(#${idPrefix}-dome-grad-${i})`}
                      clipPath={`url(#${idPrefix}-dome-clip-${i})`}
                    />
                  ))}
                </g>
              </>
            )}
          </>
        )}

        {/* Outline last so it sits on top of the lit fill. */}
        {strokeW > 0 && (
          <path d={bodyPath} fill="none" stroke={strokeColor} strokeWidth={strokeW} strokeLinejoin="round" />
        )}
        {domeDebug && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={domeDebug.bb.x} y={domeDebug.bb.y}
              width={domeDebug.bb.w} height={domeDebug.bb.h}
              fill="none" stroke="#ff5050" strokeWidth={1} strokeDasharray="4 4" opacity={0.7}
            />
            <circle
              cx={domeDebug.cx} cy={domeDebug.cy} r={domeDebug.R}
              fill="none" stroke="#ff5050" strokeWidth={1} strokeDasharray="2 4" opacity={0.6}
            />
            <circle
              cx={domeDebug.cx} cy={domeDebug.cy} r={domeDebug.rBevelPx}
              fill="none" stroke="#ffd54a" strokeWidth={1.5} opacity={0.9}
            />
            {domeDebug.lights.map((l, i) => (
              <line
                key={i}
                x1={domeDebug.cx} y1={domeDebug.cy}
                x2={l.x2} y2={l.y2}
                stroke="#ffd54a" strokeWidth={1.5} opacity={0.4 + 0.6 * l.intensity}
              />
            ))}
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
