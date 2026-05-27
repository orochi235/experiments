import { useId, useMemo } from 'react';
import type { DesignState, FillMode, ParamBag, RuntimeState, TailProjection, TailShape } from './types';
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
import { buildDistanceFieldImage } from './distanceTransform';

interface Props {
  design: DesignState;
  runtime: RuntimeState;
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

  // Polygons after bubble-union — kept as polygons so per-heightmap-mode rasterizers can offset them.
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

  // Body silhouette only (no bubbles unioned in). Used by aqua mode so each
  // bubble gets its own bbox-anchored gradient instead of inheriting the body's.
  const bodyOnlyPath = useMemo(() => polygonsToSvgPath([bodyPolygon]), [bodyPolygon]);

  // Flat list of bubbles from every bubble-shaped tail.
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
  const fillFilterId = `${idPrefix}-fill`;
  const aquaBodyId = `${idPrefix}-aqua-body`;
  const aquaGlossId = `${idPrefix}-aqua-gloss`;

  // Resolve fill params + sampled contour table for the lighting filter.
  const fillRender = useMemo(() => {
    const p = fillEffect?.params ?? {};
    const mode = (p.mode as FillMode) ?? 'bevel-rings';
    const base = (p.base as string) ?? '#ffffff';
    const contour = (p.contour as number[]) ?? [0, -0.05, 0.25, 0.4, 0.5, 0.78, 0.75, 0.95, 1, 1];
    const cPoints = contourToPoints(contour);

    // Sample the smooth Hermite curve at 33 evenly-spaced X positions; remap
    // signed Y in [-1, 1] to [0, 1] so feFuncA can use the result as a table.
    const N = 33;
    const table: string[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const y = Math.max(-1, Math.min(1, interpolateCurveY(cPoints, t)));
      table.push(((y + 1) / 2).toFixed(4));
    }

    return {
      mode,
      base,
      contourTable: table.join(' '),
      lightAzimuth: (p.lightAzimuth as number) ?? 135,
      lightElevation: (p.lightElevation as number) ?? 55,
      lightColor: (p.lightColor as string) ?? '#ffffff',
      surfaceScale: (p.surfaceScale as number) ?? 8,
      diffuse: (p.diffuse as number) ?? 1.0,
      specular: (p.specular as number) ?? 0.6,
      shininess: (p.shininess as number) ?? 30,
      specularColor: (p.specularColor as string) ?? '#ffffff',
      rings: Math.max(2, Math.round((p.rings as number) ?? 20)),
      smoothing: (p.smoothing as number) ?? 1.2,
      blur: (p.blur as number) ?? 14,
      dtResolution: Math.max(16, Math.round((p.dtResolution as number) ?? 256)),
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

  const ringsHeightmap = useMemo<{ dataUrl: string; x: number; y: number; w: number; h: number } | null>(() => {
    if (fillRender.mode !== 'bevel-rings') return null;
    const bb = polysBBox(bodyAndBubblesPolys);
    if (bb.w <= 0 || bb.h <= 0) return null;

    const rings = fillRender.rings;
    // Inset step: cap at half the shorter bbox dimension so the deepest inset
    // doesn't always collapse to empty. Each ring covers (i*step, (i+1)*step).
    const maxInset = Math.min(bb.w, bb.h) / 2;
    const step = maxInset / rings;

    // Painter's algorithm: draw outer-first, inner-last. The deepest ring's
    // brightness (closest to 255) wins where it overlaps. Grayscale = distance.
    const paths: string[] = [];
    for (let i = 0; i < rings; i++) {
      const inset = offsetClosedPolygons(bodyAndBubblesPolys, -i * step);
      if (inset.length === 0) break;
      const d = polygonsToSvgPath(inset);
      const v = Math.round(255 * (i / (rings - 1)));
      paths.push(`<path d="${d}" fill="rgb(${v},${v},${v})" transform="translate(${-bb.x},${-bb.y})" />`);
    }

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w}" height="${bb.h}" viewBox="0 0 ${bb.w} ${bb.h}">` +
      paths.join('') +
      `</svg>`;
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return { dataUrl, ...bb };
  }, [fillRender.mode, fillRender.rings, bodyAndBubblesPolys]);

  const dtHeightmap = useMemo<{ dataUrl: string; x: number; y: number; w: number; h: number } | null>(() => {
    if (fillRender.mode !== 'bevel-dt') return null;
    const bb = polysBBox(bodyAndBubblesPolys);
    if (bb.w <= 0 || bb.h <= 0) return null;
    const img = buildDistanceFieldImage(bodyPath, bb, fillRender.dtResolution);
    if (!img) return null;
    return { dataUrl: img.dataUrl, x: bb.x, y: bb.y, w: bb.w, h: bb.h };
  }, [fillRender.mode, fillRender.dtResolution, bodyPath, bodyAndBubblesPolys]);

  const baseColor = fillRender.base;

  return (
    <svg
      viewBox={`${-reach} ${-reach} ${W + 2 * reach} ${H + 2 * reach}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ background: design.bg, borderRadius: 8 }}
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
        <filter id={fillFilterId} x="-25%" y="-25%" width="150%" height="150%">
          {/* Step 1: heightmap source. bevel-blur = SourceAlpha blurred. */}
          {fillRender.mode === 'bevel-blur' && (
            <feGaussianBlur in="SourceAlpha" stdDeviation={fillRender.blur} result="heightmap" />
          )}
          {fillRender.mode === 'bevel-rings' && ringsHeightmap && (
            <>
              <feImage
                href={ringsHeightmap.dataUrl}
                x={ringsHeightmap.x}
                y={ringsHeightmap.y}
                width={ringsHeightmap.w}
                height={ringsHeightmap.h}
                preserveAspectRatio="none"
                result="ringsImage"
              />
              {/* Luminance → alpha: rings paint opaque grayscale, but feDiffuseLighting
                  reads alpha. Copy the average of RGB into A. */}
              <feColorMatrix
                in="ringsImage"
                type="matrix"
                values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0.333 0.333 0.333 0 0"
                result="ringsAlpha"
              />
              <feGaussianBlur in="ringsAlpha" stdDeviation={fillRender.smoothing} result="heightmap" />
            </>
          )}
          {fillRender.mode === 'bevel-dt' && dtHeightmap && (
            <feImage
              href={dtHeightmap.dataUrl}
              x={dtHeightmap.x}
              y={dtHeightmap.y}
              width={dtHeightmap.w}
              height={dtHeightmap.h}
              preserveAspectRatio="none"
              result="heightmap"
            />
          )}

          {/* Step 2: remap heightmap alpha through the contour curve. */}
          <feComponentTransfer in="heightmap" result="profiled">
            <feFuncA type="table" tableValues={fillRender.contourTable} />
          </feComponentTransfer>

          {/* Step 3: diffuse lighting from a distant light. */}
          <feDiffuseLighting
            in="profiled"
            surfaceScale={fillRender.surfaceScale}
            diffuseConstant={fillRender.diffuse}
            lightingColor={fillRender.lightColor}
            result="diffuse"
          >
            <feDistantLight azimuth={fillRender.lightAzimuth} elevation={fillRender.lightElevation} />
          </feDiffuseLighting>

          {/* Step 4: multiply diffuse light by the base color. */}
          <feFlood floodColor={fillRender.base} result="baseFlood" />
          <feComposite in="baseFlood" in2="SourceAlpha" operator="in" result="baseClipped" />
          <feBlend in="diffuse" in2="baseClipped" mode="multiply" result="litBase" />

          {/* Step 5: specular catch-light. */}
          <feSpecularLighting
            in="profiled"
            surfaceScale={fillRender.surfaceScale}
            specularConstant={fillRender.specular}
            specularExponent={fillRender.shininess}
            lightingColor={fillRender.specularColor}
            result="specular"
          >
            <feDistantLight azimuth={fillRender.lightAzimuth} elevation={fillRender.lightElevation} />
          </feSpecularLighting>
          <feComposite in="specular" in2="SourceAlpha" operator="in" result="specularClipped" />

          {/* Step 6: additive composite — diffuse-tinted base + specular highlight. */}
          <feComposite in="specularClipped" in2="litBase" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />

          {/* Step 7: final clip to silhouette. */}
          <feComposite in="lit" in2="SourceAlpha" operator="in" />
        </filter>

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
            {lightningPaths.map((d, i) => (
              <path
                key={`lt-${i}`}
                d={d}
                fill={`url(#${aquaBodyId})`}
                stroke={strokeW > 0 ? strokeColor : 'none'}
                strokeWidth={strokeW || 0}
                strokeLinejoin="round"
              />
            ))}
          </>
        ) : (
          <>
            <path d={bodyPath} fill={baseColor} filter={`url(#${fillFilterId})`} />

            {/* Lightning tails — filled ribbons (clipper-inflated polylines) with
                the same fill and stroke as the body. */}
            {lightningPaths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill={baseColor}
                filter={`url(#${fillFilterId})`}
                stroke={strokeW > 0 ? strokeColor : 'none'}
                strokeWidth={strokeW || 0}
                strokeLinejoin="round"
              />
            ))}
          </>
        )}

        {/* Outline last so it sits on top of the lit fill. */}
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
