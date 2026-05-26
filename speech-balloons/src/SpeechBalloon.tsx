import { useId, useMemo } from 'react';
import type { DesignState, EffectInstance, FillMode, ParamBag, RuntimeState, TailProjection, TailShape } from './types';
import {
  buildBaseSampler,
  composeBodyPoints,
  attachmentS,
  classicTailOffsetAt,
  buildBubbles,
  buildLightning,
  type BaseSampler,
  type PerimeterPoint,
} from './geometry';
import {
  unionPolygons,
  inflateOpenPolyline,
  offsetClosedPolygons,
  polygonsToSvgPath,
  circleToPolygon,
  type Polygon,
} from './clipping';

interface Props {
  design: DesignState;
  runtime: RuntimeState;
}

// --- Color utilities -----------------------------------------------------

interface RGB { r: number; g: number; b: number }
function parseHex(hex: string): RGB {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
function rgbToCss(c: RGB): string {
  return `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)})`;
}

// Abramowitz & Stegun 7.1.26 — used to figure out what fraction of the contour
// curve actually fits across the bevel width for a given Gaussian sigma.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y = 1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

// --- Contour curve helpers -----------------------------------------------

// Contour is stored as interleaved [x, y, x, y, …] points. The editor lets the
// user drag both axes, so X positions are arbitrary monotone values in [0, 1]
// and Y values are deltas in [-1, 1].
type CurvePoint = { x: number; y: number };
function contourToPoints(contour: number[]): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i + 1 < contour.length; i += 2) out.push({ x: contour[i], y: contour[i + 1] });
  return out;
}

// Cubic Hermite (Catmull-Rom-ish) interpolation: smooth curve through arbitrary
// (x, y) points with tangents derived from finite differences. Output is the
// smoothly-curving Y at any X in [0, 1].
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

// --- Fill paint server ---------------------------------------------------

interface FillRender {
  paint: string;             // primary SVG paint (gradient URL or solid color)
  glossPaint?: string;       // optional second overlay layer (used by aqua mode)
  defs: React.ReactNode;     // gradient defs to drop in <defs>
  innerShadow: number;
  innerHighlight: number;
}

function renderFill(effect: EffectInstance | undefined, idPrefix: string): FillRender {
  if (!effect) {
    return { paint: '#ffffff', defs: null, innerShadow: 0, innerHighlight: 0 };
  }
  const p = effect.params;
  const mode = (p.mode as FillMode) ?? 'radial';
  const base = (p.base as string) ?? '#ffffff';
  const innerShadow = (p.innerShadow as number) ?? 0;
  const innerHighlight = (p.innerHighlight as number) ?? 0;

  if (mode === 'solid') {
    return { paint: base, defs: null, innerShadow, innerHighlight };
  }

  if (mode === 'puffy') {
    // The shells themselves carry the gradient; the fallback paint is the base
    // color for elements that aren't shell-rendered (lightning ribbons, stroke).
    return { paint: base, defs: null, innerShadow, innerHighlight };
  }

  if (mode === 'aqua') {
    // Aqua: weasel button-lab recipe. Body = 5-stop vertical gradient with a
    // bright equator tint and a darker base. A second translucent-white layer
    // (the gloss reflection) sits on top covering the upper half. Each shape
    // gets the gradient anchored to its own bbox via objectBoundingBox.
    const splitY = (p.splitY as number) ?? 0.52;
    const glossStrength = (p.glossStrength as number) ?? 0.42;
    const glossFade = (p.glossFade as number) ?? 0.12;
    const bottomGlow = (p.bottomGlow as number) ?? 0.3;
    const highlight = parseHex((p.highlightTint as string) ?? '#ffffff');
    const shadow = parseHex((p.shadowTint as string) ?? '#000000');
    const baseRgb = parseHex(base);

    // Body gradient stops (matches weasel's 5-stop linear-gradient).
    const topColor = mix(baseRgb, highlight, 0.3);
    const upperColor = mix(baseRgb, highlight, 0.12);
    const equatorColor = mix(baseRgb, highlight, 0.18); // bright equator line
    const baseSolid = baseRgb;
    const bottomColor = mix(baseRgb, shadow, Math.min(1, bottomGlow));

    const upperOffset = Math.max(0, splitY - glossFade);
    const belowOffset = Math.min(1, splitY + glossFade * 1.6);

    const bodyId = `${idPrefix}-fill`;
    const glossId = `${idPrefix}-gloss`;
    const defs = (
      <>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor={rgbToCss(topColor)} />
          <stop offset={upperOffset} stopColor={rgbToCss(upperColor)} />
          <stop offset={splitY} stopColor={rgbToCss(equatorColor)} />
          <stop offset={belowOffset} stopColor={rgbToCss(baseSolid)} />
          <stop offset="1" stopColor={rgbToCss(bottomColor)} />
        </linearGradient>
        {/* Gloss overlay: white fading to transparent by the equator. The
            gradient spans (0..splitY) of the bbox, then the last (transparent)
            stop holds for any y > splitY. */}
        <linearGradient id={glossId} x1="0" y1="0" x2="0" y2={splitY} gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor={rgbToCss(highlight)} stopOpacity={glossStrength} />
          <stop offset="0.6" stopColor={rgbToCss(highlight)} stopOpacity={glossStrength * 0.28} />
          <stop offset="1" stopColor={rgbToCss(highlight)} stopOpacity="0" />
        </linearGradient>
      </>
    );
    return {
      paint: `url(#${bodyId})`,
      glossPaint: `url(#${glossId})`,
      defs,
      innerShadow,
      innerHighlight,
    };
  }

  // Radial gradient driven by the contour curve. Sample at 33 evenly-spaced
  // offsets using smooth Hermite interpolation so the rendered gradient is a
  // real curve (not a piecewise-linear polyline between the user's stops).
  const contour = (p.contour as number[]) ?? [0, 0.55, 0.25, 0.32, 0.5, 0, 0.75, -0.12, 1, -0.32];
  const points = contourToPoints(contour);
  const highlight = parseHex((p.highlightTint as string) ?? '#ffffff');
  const shadow = parseHex((p.shadowTint as string) ?? '#000000');
  const baseRgb = parseHex(base);
  const M = 33;
  const stops: Array<{ offset: number; color: string }> = [];
  for (let i = 0; i < M; i++) {
    const t = i / (M - 1);
    const delta = Math.max(-1, Math.min(1, interpolateCurveY(points, t)));
    const target = delta > 0 ? highlight : shadow;
    const amount = Math.min(1, Math.abs(delta));
    stops.push({ offset: t, color: rgbToCss(mix(baseRgb, target, amount)) });
  }
  const id = `${idPrefix}-fill`;
  const hx = (p.hx as number) ?? 0.3;
  const hy = (p.hy as number) ?? 0.22;
  const spread = (p.spread as number) ?? 0.95;
  const defs = (
    <radialGradient id={id} cx={hx} cy={hy} r={spread} fx={hx} fy={hy} gradientUnits="objectBoundingBox">
      {stops.map((s, i) => (
        <stop key={i} offset={s.offset} stopColor={s.color} />
      ))}
    </radialGradient>
  );
  return { paint: `url(#${id})`, defs, innerShadow, innerHighlight };
}

// --- Component -----------------------------------------------------------

export function SpeechBalloon({ design, runtime }: Props) {
  // Body dimensions: either design-time width/height or fit-to-content.
  const { W, H } = useMemo(() => {
    if (!runtime.fitToContent) return { W: design.width, H: design.height };
    const textW = measureTextWidth(runtime.text || ' ', runtime.fontSize, runtime.fontFamily);
    return {
      W: Math.max(40, Math.ceil(textW + 2 * design.padX)),
      H: Math.max(30, Math.ceil(runtime.fontSize * 1.2 + 2 * design.padY)),
    };
  }, [runtime.fitToContent, runtime.text, runtime.fontFamily, runtime.fontSize, design.width, design.height, design.padX, design.padY]);

  const sampler: BaseSampler = useMemo(
    () => buildBaseSampler(design.base, design.baseParams, W, H),
    [design.base, design.baseParams, W, H],
  );

  // Split effects by kind. Multiple tails allowed.
  const fillEffect = design.effects.find((e) => e.kind === 'fill');
  const tailEffects = design.effects.filter((e) => e.kind === 'tail');
  const strokeEffect = design.effects.find((e) => e.kind === 'stroke');
  const shadowEffect = design.effects.find((e) => e.kind === 'shadow');

  // Italic lean: skew about the body's x-center, baked into the body samples
  // before the (classic) tail offset, so the body leans but tails don't.
  const pointTransform = useMemo(() => {
    if (!design.lean) return undefined;
    const k = Math.tan((design.lean * Math.PI) / 180);
    const cy = H / 2;
    return (x: number, y: number) => ({ x: x + k * (cy - y), y });
  }, [design.lean, H]);

  // For each tail effect, resolve its attachment point and shape.
  interface ResolvedTail {
    id: number;
    shape: TailShape;
    attach: PerimeterPoint;
    params: ParamBag;
  }
  const resolvedTails: ResolvedTail[] = useMemo(() => {
    return tailEffects.map((eff) => {
      const projection = ((eff.params.projection as TailProjection) ?? 'radial') as TailProjection;
      const angle = (eff.params.angle as number) ?? 115;
      const sc = attachmentS(projection, angle, sampler, W, H, eff.params);
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
        shape: ((eff.params.shape as TailShape) ?? 'classic') as TailShape,
        attach: attachLeaned,
        params: eff.params,
      };
    });
  }, [tailEffects, sampler, W, H, pointTransform]);

  // Body silhouette polygon — includes any classic-tail offsets baked in.
  const bodyPolygon = useMemo<Polygon>(() => {
    const offsets: Array<(s: number) => { dx: number; dy: number }> = [];
    for (const eff of tailEffects) {
      const shape = ((eff.params.shape as TailShape) ?? 'classic') as TailShape;
      if (shape !== 'classic') continue;
      const projection = ((eff.params.projection as TailProjection) ?? 'radial') as TailProjection;
      const angle = (eff.params.angle as number) ?? 115;
      const sc = attachmentS(projection, angle, sampler, W, H, eff.params);
      const cfg = {
        sc,
        halfBase: ((eff.params.baseWidth as number) ?? 40) / 2,
        length: (eff.params.length as number) ?? 50,
        taper: (eff.params.taper as number) ?? 1,
        arc: (eff.params.arc as number) ?? 0,
        radial: (eff.params.radial as number) ?? 0,
        totalLen: sampler.totalLen,
        perimeterAt: sampler.perimeterAt,
      };
      offsets.push((s) => classicTailOffsetAt(s, cfg));
    }
    return composeBodyPoints(sampler, offsets, pointTransform);
  }, [tailEffects, sampler, W, H, pointTransform]);

  // Polygons after bubble-union — kept as polygons (not just a string) so the
  // puffy-fill shells can offset them directly.
  const bodyAndBubblesPolys = useMemo<Polygon[]>(() => {
    const polys: Polygon[] = [bodyPolygon];
    for (const rt of resolvedTails) {
      if (rt.shape !== 'bubbles') continue;
      const bubbles = buildBubbles(
        rt.attach,
        (rt.params.count as number) ?? 3,
        (rt.params.baseWidth as number) ?? 16,
        (rt.params.taper as number) ?? 0.7,
        (rt.params.gap as number) ?? 0.15,
        (rt.params.length as number) ?? 70,
        (rt.params.arc as number) ?? 0,
      );
      for (const b of bubbles) polys.push(circleToPolygon(b.cx, b.cy, b.r));
    }
    return polys.length === 1 ? [bodyPolygon] : unionPolygons(polys);
  }, [bodyPolygon, resolvedTails]);

  const bodyPath = useMemo(() => polygonsToSvgPath(bodyAndBubblesPolys), [bodyAndBubblesPolys]);

  // Same body as above, but only the body silhouette (NO bubbles unioned in).
  // Used by the 'raised' fill mode so each bubble is rendered separately and
  // gets its own bbox-scaled gradient + inset shading.
  const bodyOnlyPath = useMemo(() => polygonsToSvgPath([bodyPolygon]), [bodyPolygon]);

  // Flat list of all individual bubbles from every bubble-shaped tail.
  const allBubbles = useMemo(() => {
    const out: Array<{ cx: number; cy: number; r: number }> = [];
    for (const rt of resolvedTails) {
      if (rt.shape !== 'bubbles') continue;
      const bubbles = buildBubbles(
        rt.attach,
        (rt.params.count as number) ?? 3,
        (rt.params.baseWidth as number) ?? 16,
        (rt.params.taper as number) ?? 0.7,
        (rt.params.gap as number) ?? 0.15,
        (rt.params.length as number) ?? 70,
        (rt.params.arc as number) ?? 0,
      );
      out.push(...bubbles);
    }
    return out;
  }, [resolvedTails]);

  // Lightning tails: inflate the open polyline by baseWidth/2 to get a filled
  // ribbon (rounded ends). Each becomes its own path with the same fill paint.
  const lightningPaths = useMemo(() => {
    const out: string[] = [];
    for (const rt of resolvedTails) {
      if (rt.shape !== 'lightning') continue;
      const pts = buildLightning(
        rt.attach,
        (rt.params.length as number) ?? 80,
        (rt.params.segments as number) ?? 5,
        (rt.params.jaggedness as number) ?? 0.45,
        (rt.params.seed as number) ?? 7,
        (rt.params.arc as number) ?? 0,
      );
      const halfW = Math.max(0.5, ((rt.params.baseWidth as number) ?? 4) / 2);
      const ribbon = inflateOpenPolyline(pts, halfW, 'round', 'round');
      out.push(polygonsToSvgPath(ribbon));
    }
    return out;
  }, [resolvedTails]);

  const strokeW = strokeEffect ? ((strokeEffect.params.width as number) ?? 0) : 0;
  const strokeColor = strokeEffect ? ((strokeEffect.params.color as string) ?? 'none') : 'none';
  const hasShadow = !!shadowEffect;

  // Padding for the viewBox so tails / shadows / strokes don't get clipped.
  const reach = useMemo(() => {
    let max = 60;
    for (const eff of tailEffects) {
      max = Math.max(max, (eff.params.length as number) ?? 50);
    }
    return max + 30;
  }, [tailEffects]);

  const uid = useId().replace(/:/g, '');
  const idPrefix = `sb-${uid}`;
  const shadowId = `${idPrefix}-shadow`;
  const puffyId = `${idPrefix}-puffy`;

  const fill = renderFill(fillEffect, idPrefix);
  const fillMode: FillMode = (fillEffect?.params.mode as FillMode) ?? 'radial';
  const hasPuffy = fill.innerShadow > 0 || fill.innerHighlight > 0;
  const puffyFillId = `${idPrefix}-puffyfill`;
  const sculptedFillId = `${idPrefix}-sculptedfill`;
  const beveledFilterId = `${idPrefix}-beveledfill`;

  // Abramowitz & Stegun approximation of the error function (used below to
  // figure out how much of the contour curve actually shows across the bevel
  // width for a given blur sigma).
  // No-op outside the beveled filter; kept module-local for simplicity.
  // ----
  // Beveled mode: three concentric shapes.
  //   1. outer = bodyAndBubblesPolys                  (filled with border color)
  //   2. innerShape = outer inset by borderWidth       (gets the contour gradient)
  //   3. centerShape = inner inset by bevelWidth       (filled with base color)
  // Filter is applied to innerShape, NOT the bevel ring — so the contour curve
  // runs monotonically from rim (at heightmap 0 = innerShape's edge) to peak
  // (at heightmap 1 = innerShape's interior). The centerShape overlay then hides
  // the inner portion, leaving the rim→peak slope visible across the bevel width.
  const beveledParams = useMemo(() => {
    if (!fillEffect || fillEffect.params.mode !== 'beveled') return null;
    const p = fillEffect.params;
    const borderWidth = Math.max(0, (p.borderWidth as number) ?? 2);
    const bevelWidth = Math.max(1, (p.bevelWidth as number) ?? 14);
    const bevelSoftness = (p.bevelSoftness as number) ?? 0.5;
    const contour = (p.contour as number[]) ?? [0, 0.55, 0.25, 0.32, 0.5, 0, 0.75, -0.12, 1, -0.32];
    const baseRgb = parseHex((p.base as string) ?? '#ffffff');
    const highlightRgb = parseHex((p.highlightTint as string) ?? '#ffffff');
    const shadowRgb = parseHex((p.shadowTint as string) ?? '#000000');

    const innerShape = borderWidth > 0
      ? offsetClosedPolygons(bodyAndBubblesPolys, -borderWidth)
      : bodyAndBubblesPolys;
    if (innerShape.length === 0) return null;
    const centerShape = offsetClosedPolygons(innerShape, -bevelWidth);

    const cPoints = contourToPoints(contour);
    const N = 33;
    const colors: RGB[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const delta = Math.max(-1, Math.min(1, interpolateCurveY(cPoints, t)));
      const target = delta > 0 ? highlightRgb : shadowRgb;
      const amount = Math.min(1, Math.abs(delta));
      colors.push(mix(baseRgb, target, amount));
    }
    // Heightmap 0 (outer edge of bevel) → contour[end] (rim);
    // Heightmap 1 (deep interior, hidden by centerShape) → contour[0] (peak).
    const reversed = colors.slice().reverse();

    // Normalize the heightmap so the contour curve maps cleanly across the bevel:
    // a Gaussian blur of SourceAlpha is ~0.5 at the polygon edge and reaches
    // ~0.5 + 0.5·erf(bevelWidth / (σ·√2)) at the inner edge of the bevel.
    // Remap that visible range [0.5, alphaInner] → [0, 1] so the filter exposes
    // the *whole* curve across the bevel, and so the peak color (colors[0])
    // exactly matches the inner edge — then the centerShape overlay (also
    // colors[0]) blends seamlessly into the surface.
    const blurSigma = Math.max(0.5, bevelWidth * bevelSoftness);
    const alphaAtInner = 0.5 * (1 + erf(bevelWidth / (blurSigma * Math.SQRT2)));
    const remapSlope = 1 / Math.max(0.01, alphaAtInner - 0.5);
    const remapIntercept = -0.5 * remapSlope;

    return {
      innerShapePath: polygonsToSvgPath(innerShape),
      centerShapePath: polygonsToSvgPath(centerShape),
      borderColor: (p.borderColor as string) ?? '#161921',
      centerColor: rgbToCss(colors[0]),
      blur: blurSigma,
      remapSlope,
      remapIntercept,
      r: reversed.map((c) => (c.r / 255).toFixed(4)).join(' '),
      g: reversed.map((c) => (c.g / 255).toFixed(4)).join(' '),
      b: reversed.map((c) => (c.b / 255).toFixed(4)).join(' '),
    };
  }, [fillEffect, bodyAndBubblesPolys]);

  // Sculpted mode: treat the contour curve as a 3D cross-section profile.
  // Blur SourceAlpha → heightmap (0 at rim, 1 at center). Push that channel
  // into RGB. Apply the contour curve as feComponentTransfer table values to
  // remap heightmap-as-luminance to actual colors. Clip back to silhouette.
  const sculptedParams = useMemo(() => {
    if (!fillEffect || fillEffect.params.mode !== 'sculpted') return null;
    const p = fillEffect.params;
    const depth = (p.depth as number) ?? 0.45;
    const angle = (p.angle as number) ?? 230;
    const distance = (p.distance as number) ?? 0.5;
    const contour = (p.contour as number[]) ?? [0, 0.55, 0.25, 0.32, 0.5, 0, 0.75, -0.12, 1, -0.32];
    const cPoints = contourToPoints(contour);
    const baseRgb = parseHex((p.base as string) ?? '#ffffff');
    const highlightRgb = parseHex((p.highlightTint as string) ?? '#ffffff');
    const shadowRgb = parseHex((p.shadowTint as string) ?? '#000000');

    const minDim = Math.min(W, H);
    const blur = Math.max(2, depth * minDim * 0.34);
    const angleRad = (angle * Math.PI) / 180;
    const dx = Math.cos(angleRad) * distance * minDim * 0.4;
    const dy = Math.sin(angleRad) * distance * minDim * 0.4;

    // Sample the smooth Hermite curve at 33 evenly-spaced positions; SVG
    // interpolates linearly between them, so the dense resampling makes the
    // table values approximate the smooth curve closely.
    const N = 33;
    const colors: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const delta = Math.max(-1, Math.min(1, interpolateCurveY(cPoints, t)));
      const target = delta > 0 ? highlightRgb : shadowRgb;
      const amount = Math.min(1, Math.abs(delta));
      colors.push(mix(baseRgb, target, amount));
    }
    // Heightmap is 0 at rim, 1 at center; contour[0] is the highlight (center),
    // contour[end] is the rim. So reverse the colors so table input 0 → rim.
    const reversed = colors.slice().reverse();
    const r = reversed.map((c) => (c.r / 255).toFixed(4)).join(' ');
    const g = reversed.map((c) => (c.g / 255).toFixed(4)).join(' ');
    const b = reversed.map((c) => (c.b / 255).toFixed(4)).join(' ');
    return { blur, dx, dy, r, g, b };
  }, [fillEffect, W, H]);

  // Puffy fill: a SVG filter that smears the body's SourceAlpha into a soft
  // "distance from rim" field, then uses it as the alpha mask for highlight and
  // shadow color overlays. The result is a smooth 2D depth gradient that follows
  // the actual silhouette — no stacked geometry, just one filter pass per render.
  const puffyParams = useMemo(() => {
    if (!fillEffect || fillEffect.params.mode !== 'puffy') return null;
    const p = fillEffect.params;
    const angle = (p.angle as number) ?? 230;
    const distance = (p.distance as number) ?? 0.5;
    const depth = (p.depth as number) ?? 0.45;
    const highlightStrength = (p.highlight as number) ?? 0.55;
    const specularStrength = (p.specular as number) ?? 0.5;
    const shadowStrength = (p.shadow as number) ?? 0.45;
    const highlightColor = (p.highlightTint as string) ?? '#ffffff';
    const shadowColor = (p.shadowTint as string) ?? '#000000';

    const minDim = Math.min(W, H);
    // Diffuse blur: large, soft volume. Specular blur: ~1/3 of diffuse, sharper catch light.
    const diffuseBlur = Math.max(2, depth * minDim * 0.34);
    const specularBlur = Math.max(1, depth * minDim * 0.08);
    const angleRad = (angle * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    // Diffuse highlight sits closer to center; specular is shifted further out
    // toward the rim along the same angle (mimics a glossy catch light).
    const diffuseShift = distance * minDim * 0.35;
    const specularShift = distance * minDim * 0.55;
    return {
      diffuseBlur,
      specularBlur,
      diffuseDx: dirX * diffuseShift,
      diffuseDy: dirY * diffuseShift,
      specularDx: dirX * specularShift,
      specularDy: dirY * specularShift,
      highlightStrength,
      specularStrength,
      shadowStrength,
      highlightColor,
      shadowColor,
    };
  }, [fillEffect, W, H]);

  // Brainhouse-style inset shading. Scale to the body's smaller dimension so
  // big and small balloons get visually comparable rim definition.
  const minDim = Math.min(W, H);
  const sOffset = Math.max(1, minDim * 0.025) * fill.innerShadow + 1; // soft bottom shadow
  const sBlur = Math.max(2, minDim * 0.05) * fill.innerShadow + 1;
  const hOffset = 1 + fill.innerHighlight * 1.5; // sharp top highlight (≈1–2 px)

  return (
    <svg
      viewBox={`${-reach} ${-reach} ${W + 2 * reach} ${H + 2 * reach}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ background: design.bg, borderRadius: 8 }}
    >
      <defs>
        {fill.defs}
        {fillMode === 'puffy' && puffyParams && (
          // Shape-aware depth gradient. Three layers composited over the base color:
          //  1. SHADOW rim — on the side opposite the light
          //  2. DIFFUSE highlight — large soft glow shifted toward the light
          //  3. SPECULAR catch — smaller, sharper highlight further toward the rim
          //
          // The shadow uses (SourceAlpha − offset(blur)) to land a rim ring on the
          // dark side; the highlights use offset(blur) ∩ SourceAlpha to land smooth
          // glows that follow the actual silhouette.
          <filter id={puffyFillId} x="-25%" y="-25%" width="150%" height="150%" filterUnits="userSpaceOnUse">
            {/* Big blur for diffuse */}
            <feGaussianBlur in="SourceAlpha" stdDeviation={puffyParams.diffuseBlur} result="dBlur" />
            {/* DIFFUSE highlight */}
            <feOffset in="dBlur" dx={puffyParams.diffuseDx} dy={puffyParams.diffuseDy} result="dShift" />
            <feComposite in="dShift" in2="SourceAlpha" operator="in" result="dAlpha" />
            <feFlood floodColor={puffyParams.highlightColor} floodOpacity={puffyParams.highlightStrength} result="dCol" />
            <feComposite in="dCol" in2="dAlpha" operator="in" result="diffuseLayer" />
            {/* SHADOW rim (uses the diffuse blur, offset the other way) */}
            <feOffset in="dBlur" dx={-puffyParams.diffuseDx} dy={-puffyParams.diffuseDy} result="sShift" />
            <feComposite in="SourceAlpha" in2="sShift" operator="arithmetic" k2="1" k3="-1" result="sRing" />
            <feFlood floodColor={puffyParams.shadowColor} floodOpacity={puffyParams.shadowStrength} result="sCol" />
            <feComposite in="sCol" in2="sRing" operator="in" result="shadowLayer" />
            {/* Smaller blur for specular */}
            <feGaussianBlur in="SourceAlpha" stdDeviation={puffyParams.specularBlur} result="spBlur" />
            <feOffset in="spBlur" dx={puffyParams.specularDx} dy={puffyParams.specularDy} result="spShift" />
            <feComposite in="spShift" in2="SourceAlpha" operator="in" result="spAlpha" />
            <feFlood floodColor={puffyParams.highlightColor} floodOpacity={puffyParams.specularStrength} result="spCol" />
            <feComposite in="spCol" in2="spAlpha" operator="in" result="specularLayer" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="shadowLayer" />
              <feMergeNode in="diffuseLayer" />
              <feMergeNode in="specularLayer" />
            </feMerge>
          </filter>
        )}
        {fillMode === 'beveled' && beveledParams && (
          <filter id={beveledFilterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation={beveledParams.blur} result="heightmap" />
            {/* Normalize the heightmap so the visible bevel covers the full
                contour range — peak at the inner edge, rim at the outer edge. */}
            <feComponentTransfer in="heightmap" result="normalized">
              <feFuncA type="linear" slope={beveledParams.remapSlope} intercept={beveledParams.remapIntercept} />
            </feComponentTransfer>
            <feColorMatrix
              in="normalized"
              type="matrix"
              values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0"
              result="gray"
            />
            <feComponentTransfer in="gray" result="colored">
              <feFuncR type="table" tableValues={beveledParams.r} />
              <feFuncG type="table" tableValues={beveledParams.g} />
              <feFuncB type="table" tableValues={beveledParams.b} />
              <feFuncA type="table" tableValues="1 1" />
            </feComponentTransfer>
            <feComposite in="colored" in2="SourceAlpha" operator="in" />
          </filter>
        )}
        {fillMode === 'sculpted' && sculptedParams && (
          // Filter region anchored to the filtered element's own bbox by default,
          // so each shape (body / each bubble) gets its own independent sculpted dome.
          <filter id={sculptedFillId} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation={sculptedParams.blur} result="heightmap" />
            <feOffset in="heightmap" dx={sculptedParams.dx} dy={sculptedParams.dy} result="shifted" />
            {/* Copy alpha into all RGB channels so feComponentTransfer can remap it. */}
            <feColorMatrix
              in="shifted"
              type="matrix"
              values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0"
              result="gray"
            />
            {/* Map height (in alpha-as-luminance) → gradient colors via the contour curve. */}
            <feComponentTransfer in="gray" result="colored">
              <feFuncR type="table" tableValues={sculptedParams.r} />
              <feFuncG type="table" tableValues={sculptedParams.g} />
              <feFuncB type="table" tableValues={sculptedParams.b} />
              <feFuncA type="table" tableValues="1 1" />
            </feComponentTransfer>
            {/* Clip to the original silhouette so the gradient doesn't leak past the rim. */}
            <feComposite in="colored" in2="SourceAlpha" operator="in" />
          </filter>
        )}
        {hasPuffy && (
          <filter id={puffyId} x="-25%" y="-25%" width="150%" height="150%">
            {fill.innerShadow > 0 && (
              <>
                {/* Soft inset shadow concentrated at the bottom rim:
                    SourceAlpha - offsetUp(blur(SourceAlpha)) = bottom ring. */}
                <feGaussianBlur in="SourceAlpha" stdDeviation={sBlur} result="sBlur" />
                <feOffset in="sBlur" dx="0" dy={-sOffset} result="sOff" />
                <feComposite in="SourceAlpha" in2="sOff" operator="arithmetic" k2="1" k3="-1" result="sRing" />
                <feFlood floodColor="#000" floodOpacity={Math.min(1, 0.55 * fill.innerShadow)} result="sCol" />
                <feComposite in="sCol" in2="sRing" operator="in" result="shadowLayer" />
              </>
            )}
            {fill.innerHighlight > 0 && (
              <>
                {/* Sharp inset highlight at the top:
                    SourceAlpha - offsetDown(SourceAlpha) = top sliver. */}
                <feOffset in="SourceAlpha" dx="0" dy={hOffset} result="hOff" />
                <feComposite in="SourceAlpha" in2="hOff" operator="arithmetic" k2="1" k3="-1" result="hRing" />
                <feFlood floodColor="#fff" floodOpacity={Math.min(1, 0.85 * fill.innerHighlight)} result="hCol" />
                <feComposite in="hCol" in2="hRing" operator="in" result="highlightLayer" />
              </>
            )}
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              {fill.innerShadow > 0 && <feMergeNode in="shadowLayer" />}
              {fill.innerHighlight > 0 && <feMergeNode in="highlightLayer" />}
            </feMerge>
          </filter>
        )}
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
      </defs>

      {/* Body group — silhouette + bubble/lightning tails share the same fill,
          stroke, and drop-shadow filter. */}
      <g filter={hasShadow ? `url(#${shadowId})` : undefined}>
        {fillMode === 'puffy' && puffyParams ? (
          // Single filter pass over the unioned body silhouette.
          <path
            d={bodyPath}
            fill={(fillEffect?.params.base as string) ?? '#ffffff'}
            filter={`url(#${puffyFillId})`}
          />
        ) : fillMode === 'raised' || fillMode === 'aqua' ? (
          // Per-shape modes: each discrete shape (body, every bubble) is its own
          // path so the gradient (objectBoundingBox) anchors to each shape's
          // bbox, and the inset-shadow/top-highlight filter re-runs per shape.
          // Aqua additionally paints a gloss overlay layer on top of each shape.
          <>
            <path d={bodyOnlyPath} fill={fill.paint} filter={hasPuffy ? `url(#${puffyId})` : undefined} />
            {fill.glossPaint && <path d={bodyOnlyPath} fill={fill.glossPaint} />}
            {allBubbles.flatMap((b, i) => {
              const out: React.ReactNode[] = [
                <circle
                  key={`b-${i}`}
                  cx={b.cx}
                  cy={b.cy}
                  r={b.r}
                  fill={fill.paint}
                  filter={hasPuffy ? `url(#${puffyId})` : undefined}
                />,
              ];
              if (fill.glossPaint) {
                out.push(
                  <circle key={`g-${i}`} cx={b.cx} cy={b.cy} r={b.r} fill={fill.glossPaint} />,
                );
              }
              return out;
            })}
          </>
        ) : fillMode === 'beveled' && beveledParams ? (
          // Three concentric layers: border (full body), bevel ring (contour-driven
          // filter), center (solid base). Each subsequent path covers the inner
          // portion of the previous, leaving visible concentric bands.
          <>
            <path
              d={bodyPath}
              fill={beveledParams.borderColor}
              filter={hasPuffy ? `url(#${puffyId})` : undefined}
            />
            <path d={beveledParams.innerShapePath} fill="#000" filter={`url(#${beveledFilterId})`} />
            <path d={beveledParams.centerShapePath} fill={beveledParams.centerColor} />
          </>
        ) : fillMode === 'sculpted' && sculptedParams ? (
          // Sculpted mode: each discrete shape gets its own contour-driven dome.
          // The filter generates the gradient via the contour curve and the body's
          // own blurred SourceAlpha — iso-contours are inset copies of each shape.
          <>
            <path d={bodyOnlyPath} fill="#000" filter={`url(#${sculptedFillId})`} />
            {allBubbles.map((b, i) => (
              <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill="#000" filter={`url(#${sculptedFillId})`} />
            ))}
          </>
        ) : (
          <path d={bodyPath} fill={fill.paint} filter={hasPuffy ? `url(#${puffyId})` : undefined} />
        )}

        {/* Lightning tails — filled ribbons (clipper-inflated polylines) with
            the same fill paint and stroke as the body. */}
        {lightningPaths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill={fill.paint}
            stroke={strokeW > 0 ? strokeColor : 'none'}
            strokeWidth={strokeW || 0}
            strokeLinejoin="round"
          />
        ))}

        {/* Outline last so it sits on top of inset shading. */}
        {strokeW > 0 && (
          <path d={bodyPath} fill="none" stroke={strokeColor} strokeWidth={strokeW} strokeLinejoin="round" />
        )}
      </g>

      <text
        x={W / 2}
        y={H / 2}
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
        {runtime.text}
      </text>
    </svg>
  );
}
