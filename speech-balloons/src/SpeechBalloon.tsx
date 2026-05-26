import { useId, useMemo } from 'react';
import type { DesignState, ParamBag, RuntimeState, TailProjection, TailShape } from './types';
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
  polygonsToSvgPath,
  circleToPolygon,
  type Polygon,
} from './clipping';

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

  const baseColor = (fillEffect?.params.base as string) ?? '#ffffff';

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
      </defs>

      {/* Body group — silhouette + bubble/lightning tails share the same fill,
          stroke, and drop-shadow filter. */}
      <g filter={hasShadow ? `url(#${shadowId})` : undefined}>
        <path d={bodyPath} fill={baseColor} />

        {/* Lightning tails — filled ribbons (clipper-inflated polylines) with
            the same fill and stroke as the body. */}
        {lightningPaths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill={baseColor}
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
