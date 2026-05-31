import { useId, useMemo } from 'react';
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
import { computeMatPlateau } from './plateauMat';
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

// --- Contour curve helpers -----------------------------------------------

// Contour is stored as interleaved [x, y, x, y, …] points.
type CurvePoint = { x: number; y: number };
function contourToPoints(contour: number[]): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i + 1 < contour.length; i += 2) out.push({ x: contour[i], y: contour[i + 1] });
  return out;
}

// Cubic Hermite (Catmull-Rom-ish) interpolation: smooth curve through arbitrary
// (x, y) points with tangents derived from finite differences.
function interpolateCurveY(points: CurvePoint[], x: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n === 1) return points[0].y;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[n - 1].x) return points[n - 1].y;
  let i = 0;
  while (i < n - 1 && points[i + 1].x < x) i++;
  const p0 = points[i];
  const p1 = points[i + 1];
  const m0 =
    i === 0
      ? (points[1].y - points[0].y) / Math.max(1e-3, points[1].x - points[0].x)
      : (points[i + 1].y - points[i - 1].y) / Math.max(1e-3, points[i + 1].x - points[i - 1].x);
  const m1 =
    i + 1 === n - 1
      ? (points[n - 1].y - points[n - 2].y) / Math.max(1e-3, points[n - 1].x - points[n - 2].x)
      : (points[i + 2].y - points[i].y) / Math.max(1e-3, points[i + 2].x - points[i].x);
  const h = p1.x - p0.x;
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0.y + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * p1.y + (t3 - t2) * h * m1;
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

// Auto outer-corner roundness so the corner-ray (centroid → bbox corner
// direction) distance from centroid to the OUTER rounded-rect boundary
// equals the corresponding distance to the INNER rounded-rect boundary
// plus bevelWidth. The inner shape is the rectangle inset by bw on each
// edge with the body's base roundness. Binary search numerically (no
// closed form because both r and the direction interact through the
// corner-arc circle equation).
function autoOuterRoundness(W: number, H: number, baseR: number, bw: number): number {
  const W_in = W - 2 * bw;
  const H_in = H - 2 * bw;
  if (W_in <= 0 || H_in <= 0) return baseR;
  // Use the outer's corner-ray direction (toward the geometric corner of
  // the outer bbox), shared by both shapes for the ray-cast.
  const D = Math.sqrt(W * W + H * H);
  const dx = W / D;
  const dy = H / D;
  // Inner corner-arc exit distance along d.
  const r_in = (Math.min(W_in, H_in) / 2) * baseR;
  const cx_in = W_in / 2 - r_in;
  const cy_in = H_in / 2 - r_in;
  const B_in = -2 * (dx * cx_in + dy * cy_in);
  const C_in = cx_in * cx_in + cy_in * cy_in - r_in * r_in;
  const disc_in = B_in * B_in - 4 * C_in;
  if (disc_in < 0) return baseR;
  const t_inner = (-B_in + Math.sqrt(disc_in)) / 2;
  const t_target = t_inner + bw;
  // Binary search r_o ∈ [0, min(W,H)/2]. Larger r_o → more rounded outer
  // corner → smaller t_outer. So if computed t > target, r_o needs to
  // grow.
  let lo = 0;
  let hi = Math.min(W, H) / 2;
  for (let i = 0; i < 60; i++) {
    const r_o = (lo + hi) / 2;
    const cx_out = W / 2 - r_o;
    const cy_out = H / 2 - r_o;
    const B_out = -2 * (dx * cx_out + dy * cy_out);
    const C_out = cx_out * cx_out + cy_out * cy_out - r_o * r_o;
    const disc_out = B_out * B_out - 4 * C_out;
    if (disc_out < 0) {
      // ray misses the arc → r_o too small (ray exits via a straight
      // edge before reaching the corner curve). Need larger r_o.
      lo = r_o;
      continue;
    }
    const t_outer = (-B_out + Math.sqrt(disc_out)) / 2;
    if (t_outer > t_target) lo = r_o;
    else hi = r_o;
  }
  const r_o = (lo + hi) / 2;
  const halfShort = Math.min(W, H) / 2;
  if (halfShort <= 0) return baseR;
  return Math.max(0, Math.min(1, r_o / halfShort));
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
  // (resolvedTails → bodyAndBubblesPolys → bodyPath / computeMatPlateau / etc.). It's
  // tolerable today, but anything heavy added downstream — like the old bevel-ring
  // 31×-polygon-offset loop — will fire on every state change. Wrap in useMemo before
  // adding more expensive geometry.
  const fillEffect = design.effects.find((e) => e.kind === 'fill');
  const tailEffects = design.effects.filter((e) => e.kind === 'tail');
  const strokeEffect = design.effects.find((e) => e.kind === 'stroke');
  const shadowEffect = design.effects.find((e) => e.kind === 'shadow');

  // Outer body's effective sampler params. In dome mode on a rectangle
  // body, the outer corner roundness is auto-computed so the corner-ray
  // distance from centroid to the outer boundary exceeds the distance
  // to the inner boundary by exactly bevelWidth (matching the uniform
  // bw inset that already holds at edge midpoints).
  const effectiveBaseParams = useMemo<ParamBag>(() => {
    if (design.base !== 'rectangle') return design.baseParams;
    const mode = (fillEffect?.params.mode as string) ?? 'dome';
    if (mode !== 'dome') return design.baseParams;
    const baseR = (design.baseParams.roundness as number) ?? 0.5;
    const bw = (fillEffect?.params.bevelWidth as number) ?? 22;
    const autoR = autoOuterRoundness(W, H, baseR, bw);
    if (autoR === baseR) return design.baseParams;
    return { ...design.baseParams, roundness: autoR };
  }, [design.base, design.baseParams, fillEffect, W, H]);

  const sampler: BaseSampler = useMemo(
    () => buildBaseSampler(design.base, effectiveBaseParams, W, H),
    [design.base, effectiveBaseParams, W, H],
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
    const contour = Array.isArray(p.contour) ? (p.contour as number[]) : [0, -0.5, 0.5, 0, 1, 0.5];
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

  // Dome mode: a single linear gradient overlay applied to the silhouette,
  // with stops computed by sampling the cross-section profile across one pass
  // along the light azimuth. No clipper insets, no rings, no bands. The
  // gradient axis crosses the silhouette's bbox along the azimuth direction;
  // bevelWidth (in user units) decides how much of that axis is rim ramp
  // (sampling the contour curve from t=0..1) vs flat plateau (constant t=1).
  // Stops are semi-transparent tints in lightColor / shadowColor so the base
  // color underneath shows through.

  const buildDomeOverlay = (polys: Polygon[], innerPolys: Polygon[]): {
    basePath: string;
    overlayPath: string;
    // MAT-eroded plateau region (silhouette inset by bevelWidth).
    plateauPath: string;
    // Uniform fill color for the plateau interior. The plateau's surface
    // normal is straight up, so N·L = sin(elevation) regardless of
    // azimuth — sampled into a single fill color so the plateau reads as
    // a true flat top against the directional rim.
    plateauColor: string;
    stops: Array<{ offset: number; color: string; alpha: number }>;
    gradX1: number; gradY1: number; gradX2: number; gradY2: number;
    glossStops: Array<{ offset: number; alpha: number }>;
    specCx: number; specCy: number; specR: number; specAlpha: number;
  } | null => {
    if (polys.length === 0) return null;
    const bb = polysBBox(polys);
    if (bb.w <= 0 || bb.h <= 0) return null;
    const cPoints = contourToPoints(fillRender.contour);

    // Azimuth in math convention; SVG y is flipped so 90° = visual up.
    const az = (fillRender.lightAzimuth * Math.PI) / 180;
    const el = (fillRender.lightElevation * Math.PI) / 180;
    const dx = Math.cos(az);
    const dy = -Math.sin(az);

    // Project the silhouette's bbox corners onto the azimuth axis to find
    // the lit-most and shadow-most extent (rather than using the bbox
    // diagonal, which would over-extend the gradient on rotated lights).
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const corners: Array<[number, number]> = [
      [bb.x, bb.y], [bb.x + bb.w, bb.y],
      [bb.x, bb.y + bb.h], [bb.x + bb.w, bb.y + bb.h],
    ];
    let minProj = Infinity, maxProj = -Infinity;
    for (const [x, y] of corners) {
      const proj = (x - cx) * dx + (y - cy) * dy;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
    // Lit side at maxProj end of axis, shadow at minProj.
    const litX = cx + dx * maxProj;
    const litY = cy + dy * maxProj;
    const shaX = cx + dx * minProj;
    const shaY = cy + dy * minProj;

    // bevelWidth in user units mapped to a fraction of the gradient axis.
    // Capped at 0.49 so we always have a sliver of plateau in the middle.
    const totalExtent = maxProj - minProj;
    const bevelFrac = totalExtent > 0
      ? Math.max(0.005, Math.min(0.49, fillRender.bevelWidth / totalExtent))
      : 0.25;

    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    const amount = fillRender.amount;

    const stopColor = (b: number) => (b >= 0 ? fillRender.highlightColor : fillRender.shadowColor);
    const stopAlpha = (b: number) => Math.max(0, Math.min(1, Math.abs(b) * amount));

    // Sample N+1 stops across the gradient. Each stop's (t, sign) is mapped
    // from s by bevelFrac: rim bands at the ends ramp t from 0→1; the
    // plateau in the middle holds t=1.
    const N = 32;
    const stops: Array<{ offset: number; color: string; alpha: number }> = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      let t: number;
      let sign: number;
      if (s < bevelFrac) {
        t = s / bevelFrac;       // 0 at lit edge → 1 at end of lit rim
        sign = 1;
      } else if (s > 1 - bevelFrac) {
        t = (1 - s) / bevelFrac; // 1 at start of shadow rim → 0 at shadow edge
        sign = -1;
      } else {
        // Plateau: t pinned at 1. Sign transitions smoothly across the
        // plateau so the directional component fades through zero.
        t = 1;
        const plateauHalfSpan = 0.5 - bevelFrac;
        sign = plateauHalfSpan > 0 ? (0.5 - s) / plateauHalfSpan : 0;
      }
      const eps = 0.02;
      const tA = Math.max(0, t - eps);
      const tB = Math.min(1, t + eps);
      const slope = (interpolateCurveY(cPoints, tB) - interpolateCurveY(cPoints, tA)) / Math.max(1e-3, tB - tA);
      const norm = Math.sqrt(1 + slope * slope);
      // Outward normal in (radial-out, vert) = (slope, 1)/norm. Project light
      // onto the same plane: horizontal = sign × cosEl, vert = sinEl.
      const b = (sign * slope * cosEl + sinEl) / norm;
      stops.push({ offset: s, color: stopColor(b), alpha: stopAlpha(b) });
    }

    // ── Gloss overlay ───────────────────────────────────────────────────
    // A soft light-tint gradient biased to the lit half. Conceptually a
    // diffuse Lambert wash from the same 3D light, but rendered as a single
    // linear gradient with peak alpha tied to domeGloss and falloff biased
    // toward the shadow side. Width scales with elevation: at el=90° the
    // gloss spreads broadly (top-down lit cap); at el=0° it concentrates on
    // the lit rim.
    const glossPeak = fillRender.domeGloss;
    // Gloss reach: a fraction of the axis from the lit end that the gloss
    // covers. Wider for high elevation (broad top-lit cap), narrower for
    // grazing light (concentrated lit-side highlight).
    const glossReach = 0.25 + 0.4 * sinEl;
    const glossStops: Array<{ offset: number; alpha: number }> = [
      { offset: 0, alpha: glossPeak },
      { offset: glossReach * 0.6, alpha: glossPeak * 0.35 },
      { offset: glossReach, alpha: 0 },
      { offset: 1, alpha: 0 },
    ];

    // ── Specular spot ───────────────────────────────────────────────────
    // Phong-style narrow highlight at the reflection point. For an
    // orthographic view V=(0,0,1), the half-angle vector H lies in the
    // plane of L and V. Its horizontal projection along azimuth has
    // magnitude cosEl / |L + V|; its vertical component is (sinEl + 1) /
    // |L + V|. The dome surface position whose normal best matches H is
    // where slope_normalized's horizontal component equals H_horiz. We
    // approximate by placing the spot a fraction of bevelWidth in from the
    // lit edge along the azimuth axis, modulated by sinEl so high light
    // raises the spot toward the plateau center.
    const specT = bevelFrac * 0.6 + (0.5 - bevelFrac * 0.6) * sinEl;
    const specAxisFrac = specT; // s along gradient axis (0 = lit, 1 = shadow)
    const specCx = litX + (shaX - litX) * specAxisFrac;
    const specCy = litY + (shaY - litY) * specAxisFrac;
    // Brightness at the spec point, used to dim/intensify it depending on
    // how aligned the surface there is with H. At specT we're at t≈1
    // (plateau), slope≈0, so the highlight relies almost entirely on
    // ambient + the cosEl-modulated horizontal of L.
    const specBrightness = sinEl + (1 - sinEl) * Math.max(0, cosEl);
    const specAlpha = Math.max(0, Math.min(1, specBrightness * fillRender.specStrength));
    const specR = Math.max(2, fillRender.specSize);

    const plateauPath = innerPolys.length > 0 ? polygonsToSvgPath(innerPolys) : '';

    // Plateau lit color: flat top has surface normal straight up, so
    // N·L = sin(elevation) for any azimuth. The contour curve at t=1
    // adds a baseline brightness modifier on top. Combined, the plateau
    // reads as a uniform color slightly lighter or darker than base.
    const profilePeak = Math.max(-1, Math.min(1, interpolateCurveY(cPoints, 1)));
    const plateauB = Math.max(-1, Math.min(1, sinEl + profilePeak * 0.5));
    const baseRgb = parseHex(fillRender.base);
    const tintRgb = parseHex(plateauB >= 0 ? fillRender.highlightColor : fillRender.shadowColor);
    const plateauAlpha = Math.max(0, Math.min(1, Math.abs(plateauB) * amount));
    const plateauColor = `rgb(${Math.round(baseRgb[0] + (tintRgb[0] - baseRgb[0]) * plateauAlpha)} ${Math.round(baseRgb[1] + (tintRgb[1] - baseRgb[1]) * plateauAlpha)} ${Math.round(baseRgb[2] + (tintRgb[2] - baseRgb[2]) * plateauAlpha)})`;

    return {
      basePath: polygonsToSvgPath(polys),
      overlayPath: polygonsToSvgPath(polys),
      plateauPath,
      plateauColor,
      stops,
      gradX1: litX, gradY1: litY, gradX2: shaX, gradY2: shaY,
      glossStops,
      specCx, specCy, specR, specAlpha,
    };
  };

  const bodyDome = useMemo(() => {
    if (fillRender.mode !== 'dome') return null;
    // Plateau computed by clipper polygon erosion (MAT-equivalent for
    // polygons): every plateau point is at distance ≥ bevelWidth from
    // the outer silhouette boundary. Convex source corners become arcs
    // of radius bevelWidth; concave corners stay sharp; regions thinner
    // than 2·bevelWidth vanish.
    const inner = computeMatPlateau(bodyAndBubblesPolys, fillRender.bevelWidth);
    return buildDomeOverlay(bodyAndBubblesPolys, inner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fillRender.mode, fillRender.contour, fillRender.amount, fillRender.bevelWidth,
    fillRender.lightAzimuth, fillRender.lightElevation, fillRender.highlightColor, fillRender.shadowColor,
    fillRender.domeGloss, fillRender.specStrength, fillRender.specSize,
    bodyAndBubblesPolys,
  ]);

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
          // Dome: solid base color + one partially-transparent linear gradient
          // overlay across the silhouette. Stops are computed from the profile
          // curve and bevelWidth; gradient axis runs along the light azimuth.
          <>
            {bodyDome && (
              <>
                <defs>
                  <linearGradient
                    id={`${idPrefix}-dome-body`}
                    gradientUnits="userSpaceOnUse"
                    x1={bodyDome.gradX1} y1={bodyDome.gradY1}
                    x2={bodyDome.gradX2} y2={bodyDome.gradY2}
                  >
                    {bodyDome.stops.map((s, j) => (
                      <stop key={j} offset={s.offset} stopColor={s.color} stopOpacity={s.alpha} />
                    ))}
                  </linearGradient>
                  <linearGradient
                    id={`${idPrefix}-dome-gloss`}
                    gradientUnits="userSpaceOnUse"
                    x1={bodyDome.gradX1} y1={bodyDome.gradY1}
                    x2={bodyDome.gradX2} y2={bodyDome.gradY2}
                  >
                    {bodyDome.glossStops.map((s, j) => (
                      <stop key={j} offset={s.offset} stopColor={fillRender.highlightColor} stopOpacity={s.alpha} />
                    ))}
                  </linearGradient>
                  <radialGradient
                    id={`${idPrefix}-dome-spec`}
                    gradientUnits="userSpaceOnUse"
                    cx={bodyDome.specCx} cy={bodyDome.specCy}
                    r={bodyDome.specR}
                    fx={bodyDome.specCx} fy={bodyDome.specCy}
                  >
                    <stop offset="0" stopColor={fillRender.highlightColor} stopOpacity={bodyDome.specAlpha} />
                    <stop offset="0.5" stopColor={fillRender.highlightColor} stopOpacity={bodyDome.specAlpha * 0.4} />
                    <stop offset="1" stopColor={fillRender.highlightColor} stopOpacity="0" />
                  </radialGradient>
                </defs>
                <path d={bodyDome.basePath} fill={fillRender.base} />
                <path d={bodyDome.overlayPath} fill={`url(#${idPrefix}-dome-body)`} />
                {fillRender.domeGloss > 0 && (
                  <path d={bodyDome.overlayPath} fill={`url(#${idPrefix}-dome-gloss)`} />
                )}
                {fillRender.specStrength > 0 && (
                  <path d={bodyDome.overlayPath} fill={`url(#${idPrefix}-dome-spec)`} />
                )}
                {/* Debug: filled plateau region with translucent yellow so
                    the shape pops against the blue dome — easy to spot
                    shape mismatches while iterating. */}
                {bodyDome.plateauPath && (
                  <path
                    d={bodyDome.plateauPath}
                    fill={bodyDome.plateauColor}
                    pointerEvents="none"
                  />
                )}
              </>
            )}

          </>
        )}

        {/* Outline last so it sits on top of the lit fill. */}
        {strokeW > 0 && (
          <path d={bodyPath} fill="none" stroke={strokeColor} strokeWidth={strokeW} strokeLinejoin="round" />
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
