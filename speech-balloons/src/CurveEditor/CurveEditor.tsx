import { useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { type Point } from './catmullRom';
import { sampleByInterpolation, type InterpolationMode } from './interpolation';
import { hitTestCurve, modelToPlot, plotToModel, type ModelRange } from './geometry';
import s from './CurveEditor.module.css';

export interface ControlPoint {
  x: number;
  y: number;
}

export type CurveDomain = '1d' | '2d';
export type EndpointMode = 'free' | 'pinned-x' | 'pinned-both';
export type AddPointMode = 'click-curve' | 'click-empty' | 'never';

export interface GridSettings {
  /** Number of evenly-spaced internal grid lines per axis (excluding the
   *  edges). Applied to both x and y. Default 3. */
  divisions?: number;
  /** Stroke color override. When omitted, uses `var(--curve-grid)`. */
  color?: string;
}

export interface AxesSettings {
  /** Stroke color override. When omitted, uses `var(--curve-axis)`. */
  color?: string;
}

export interface FillSettings {
  /** Which side of the curve gets filled — `'below'` shades the region
   *  between the curve and the bottom edge of the plot; `'above'` shades
   *  between the curve and the top edge. Required (no default — the
   *  whole point is to pick a side). */
  side: 'below' | 'above';
  /** Fill color override. When omitted, uses `var(--curve-fill)`
   *  (translucent accent). */
  color?: string;
}

export interface CurveEditorProps {
  /** Anchor points; caller-owned. */
  value: readonly ControlPoint[];
  /** Fires every frame during drag with the live in-flight value. */
  onChange: (next: ControlPoint[]) => void;
  /** Fires once per discrete user action (drag-end, add, delete) with
   *  the new value and the value at gesture start. Wire history here. */
  onChangeCommit?: (next: ControlPoint[], prev: readonly ControlPoint[]) => void;
  /** 1D function (monotonic in x) or 2D path. Default '2d'. */
  domain?: CurveDomain;
  /** Interpolation algorithm. All options are interpolating (the curve
   *  passes through every anchor); they differ in tangent computation
   *  and parameterization. Default `'catmull-rom'` (centripetal). */
  interpolation?: InterpolationMode;
  /** Endpoint constraint mode. Default 'free'. */
  endpoints?: EndpointMode;
  /** Model-space x range. Default [0, 1]. */
  xRange?: readonly [number, number];
  /** Model-space y range. Default [0, 1]. */
  yRange?: readonly [number, number];
  /** Plot width in CSS pixels. */
  width: number;
  /** Plot height in CSS pixels. */
  height: number;
  /** Background grid configuration. `false` / `null` / omitted → no grid.
   *  Pass `{}` for default grid (3 divisions per axis) or a populated
   *  GridSettings to customize. */
  grid?: GridSettings | false | null;
  /** Axis line configuration. `false` / `null` → no axes. Omitted →
   *  default-styled axes (on). Pass an AxesSettings to customize. */
  axes?: AxesSettings | false | null;
  /** Shade the region under or over the curve. The algorithm closes the
   *  polyline back along the bottom (`below`) or top (`above`) edge of
   *  the plot — works cleanly for x-monotonic curves; produces visually
   *  reasonable but potentially overlapping fills for curves that loop
   *  back on themselves. Works in either domain. `false` / `null` /
   *  omitted = no fill. */
  fill?: FillSettings | false | null;
  /** When true, vertex handles that aren't interactive (currently:
   *  pinned endpoints) are hidden entirely. Useful when an endpoint is
   *  fixed by design and shouldn't draw user attention. Interactive
   *  handles always render. Default false. */
  hideNonInteractive?: boolean;
  /** Constrain the curve to a class of shapes regardless of the
   *  caller's `interpolation` / `domain` settings.
   *
   *  - `'none'` (default): no enforcement. Interpolation can overshoot,
   *    fold back, exceed bounds — whatever the chosen algorithm does.
   *  - `'function'`: the result is guaranteed to be a function
   *    y = f(x) within the visible plot bounds. Enforced by (a)
   *    clamping each anchor's x to be strictly between its neighbors'
   *    x values during drag, (b) overriding `interpolation` with
   *    `'monotone'` regardless of caller (the only algo guaranteed
   *    not to overshoot y or fold x), and (c) the existing
   *    canvas-bounds clamp on y.
   *
   *  In `'function'` mode the `domain` and `interpolation` props are
   *  effectively shadowed — caller's choices for those still flow
   *  through but the constraint logic supersedes them where they
   *  conflict. */
  constrain?: 'none' | 'function';
  /** Minimum allowed control-point count. When `value.length <=
   *  minPoints`, user-initiated deletion (shift-click on an interior
   *  anchor) is refused. Doesn't mutate `value` if the caller starts
   *  outside the range — that's the caller's responsibility. */
  minPoints?: number;
  /** Maximum allowed control-point count. When `value.length >=
   *  maxPoints`, user-initiated insertion (click-curve or click-empty)
   *  is refused. */
  maxPoints?: number;
  /** How new anchors are added. Default 'click-curve'. */
  addPointMode?: AddPointMode;
  /** Extra class on the root SVG element. */
  className?: string;
  /** Inline style on the root SVG element. */
  style?: CSSProperties;
}

const SAMPLES_PER_SEGMENT = 16;

export function CurveEditor(props: CurveEditorProps) {
  const {
    value, width, height,
    onChange, onChangeCommit,
    domain = '2d',
    endpoints = 'free',
    addPointMode = 'click-curve',
    xRange = [0, 1],
    yRange = [0, 1],
    className,
    style,
  } = props;

  const modelRange: ModelRange = useMemo(
    () => ({ xMin: xRange[0], xMax: xRange[1], yMin: yRange[0], yMax: yRange[1] }),
    [xRange, yRange],
  );

  const plotSize = useMemo(() => ({ width, height }), [width, height]);

  // Project anchors to plot space for both rendering and (later) hit testing.
  const plotAnchors: Point[] = useMemo(
    () => value.map((a) => modelToPlot(a, modelRange, plotSize)),
    [value, modelRange, plotSize],
  );

  // Sample the curve once in MODEL space and project to plot space.
  // Shared by the curve `<path>` and (when fill is configured) the
  // fill region — avoids two sampling passes.
  // When `constrain='function'`, the only safe interpolation is
  // 'monotone' (Fritsch-Carlson) — it's the only algo guaranteed not
  // to overshoot y or backtrack in x within a segment. Override the
  // caller's preference.
  const constrain = props.constrain ?? 'none';
  const interpolation = constrain === 'function'
    ? 'monotone'
    : (props.interpolation ?? 'catmull-rom');
  const plotSamples = useMemo((): Point[] => {
    if (value.length < 2) return [];
    return sampleByInterpolation(value, SAMPLES_PER_SEGMENT, interpolation)
      .map((p) => modelToPlot(p, modelRange, plotSize));
  }, [value, modelRange, plotSize, interpolation]);

  const pathD = useMemo(() => {
    if (plotSamples.length === 0) return '';
    const parts: string[] = [`M${plotSamples[0].x.toFixed(2)},${plotSamples[0].y.toFixed(2)}`];
    for (let i = 1; i < plotSamples.length; i++) {
      parts.push(`L${plotSamples[i].x.toFixed(2)},${plotSamples[i].y.toFixed(2)}`);
    }
    return parts.join('');
  }, [plotSamples]);

  // Fill path: closed polygon between the curve and the chosen edge.
  // Only meaningful in 1D mode (the "below" / "above" question needs a
  // function). In 2D mode, returns null.
  const fillD = useMemo((): string | null => {
    if (!props.fill || plotSamples.length === 0) return null;
    const closingY = props.fill.side === 'below' ? height : 0;
    const first = plotSamples[0];
    const last = plotSamples[plotSamples.length - 1];
    const parts: string[] = [`M${first.x.toFixed(2)},${first.y.toFixed(2)}`];
    for (let i = 1; i < plotSamples.length; i++) {
      parts.push(`L${plotSamples[i].x.toFixed(2)},${plotSamples[i].y.toFixed(2)}`);
    }
    parts.push(`L${last.x.toFixed(2)},${closingY.toFixed(2)}`);
    parts.push(`L${first.x.toFixed(2)},${closingY.toFixed(2)}`);
    parts.push('Z');
    return parts.join('');
  }, [props.fill, plotSamples, height]);

  // ── Drag state ─────────────────────────────────────────────────────────
  // `startValue` is the array shape the drag handler indexes into —
  // for an in-progress click-curve insert, this is the POST-insertion
  // shape so `next[index]` writes to the newly-inserted anchor, not a
  // stale slot. `commitPrev` is what onChangeCommit's `prev` callback
  // arg should receive — for click-curve insert, that's the PRE-insert
  // value so consumers see a clean "added one point" diff. For plain
  // anchor drags they're equal (and commitPrev is omitted).
  interface DragState {
    index: number;
    pointerId: number;
    startValue: readonly ControlPoint[];
    /** Optional override for the `prev` arg passed to onChangeCommit
     *  on release. When undefined, the commit uses startValue. Set
     *  during click-curve insertion so the commit reports the
     *  pre-insertion array as prev. */
    commitPrev?: readonly ControlPoint[];
    lastNext: ControlPoint[];
  }
  const dragRef = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeDragIndex, setActiveDragIndex] = useState<number | null>(null);

  // Refs to break the useCallback dependency cycle between the three
  // window-level handlers (each one needs to remove the others on cleanup).
  const onWindowMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onWindowUpRef = useRef<(e: PointerEvent) => void>(() => {});
  const onWindowCancelRef = useRef<(e: PointerEvent) => void>(() => {});

  // Stable outer handlers — same function identity across renders.
  // They delegate to refs that point at the latest per-render handler.
  // Without this, `removeEventListener` would receive a different function
  // value than `addEventListener` did (because the per-render inner handlers
  // get reassigned every render), silently leaking listeners on each
  // controlled re-render during a drag.
  const stableMoveHandler = useRef((e: PointerEvent) => {
    onWindowMoveRef.current(e);
  }).current;
  const stableUpHandler = useRef((e: PointerEvent) => {
    onWindowUpRef.current(e);
  }).current;
  const stableCancelHandler = useRef((e: PointerEvent) => {
    onWindowCancelRef.current(e);
  }).current;

  const pointerToModel = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const plot: Point = { x: clientX - left, y: clientY - top };
    return plotToModel(plot, modelRange, plotSize);
  }, [modelRange, plotSize]);

  const cleanupDrag = useCallback(() => {
    window.removeEventListener('pointermove', stableMoveHandler);
    window.removeEventListener('pointerup', stableUpHandler);
    window.removeEventListener('pointercancel', stableCancelHandler);
    dragRef.current = null;
  }, [stableMoveHandler, stableUpHandler, stableCancelHandler]);

  onWindowMoveRef.current = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const m = pointerToModel(e.clientX, e.clientY);
    const next = d.startValue.map((p) => ({ ...p }));
    let nx = m.x;
    let ny = m.y;

    const isEndpoint = d.index === 0 || d.index === next.length - 1;

    if (endpoints === 'pinned-both' && isEndpoint) {
      nx = d.index === 0 ? modelRange.xMin : modelRange.xMax;
      ny = d.index === 0 ? modelRange.yMin : modelRange.yMax;
    } else if (endpoints === 'pinned-x' && isEndpoint) {
      nx = d.index === 0 ? modelRange.xMin : modelRange.xMax;
    } else if (constrain === 'function' || domain === '1d') {
      // Both modes constrain x to between neighbors. `function` mode
      // requires STRICT monotonicity (an epsilon gap so two anchors
      // never share an x); plain 1D allows equal x.
      const epsilon = constrain === 'function'
        ? (modelRange.xMax - modelRange.xMin) / 1000
        : 0;
      const left = d.index > 0 ? next[d.index - 1].x + epsilon : -Infinity;
      const right = d.index < next.length - 1 ? next[d.index + 1].x - epsilon : Infinity;
      nx = Math.max(left, Math.min(right, nx));
    }

    // Clamp to model range so vertices never leave the visible plot.
    nx = Math.max(modelRange.xMin, Math.min(modelRange.xMax, nx));
    ny = Math.max(modelRange.yMin, Math.min(modelRange.yMax, ny));

    next[d.index] = { x: nx, y: ny };
    d.lastNext = next;
    onChange(next);
  };

  onWindowUpRef.current = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (onChangeCommit) onChangeCommit(d.lastNext, d.commitPrev ?? d.startValue);
    setActiveDragIndex(null);
    cleanupDrag();
  };

  onWindowCancelRef.current = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // Restore pre-drag value; no commit.
    onChange(d.startValue.map((p) => ({ ...p })));
    setActiveDragIndex(null);
    cleanupDrag();
  };

  const isPinnedEndpoint = useCallback((index: number): boolean => {
    if (endpoints === 'free') return false;
    return index === 0 || index === value.length - 1;
  }, [endpoints, value.length]);

  const onPointerDownAnchor = useCallback((index: number, e: ReactPointerEvent<SVGElement>) => {
    e.stopPropagation();
    // Shift+click → delete.
    if (e.shiftKey) {
      if (isPinnedEndpoint(index)) return;
      // Refuse if we'd drop below the configured minimum.
      if (props.minPoints !== undefined && value.length <= props.minPoints) return;
      const next = value.filter((_, i) => i !== index);
      onChange(next);
      if (onChangeCommit) onChangeCommit(next, value);
      return;
    }
    setActiveDragIndex(index);
    dragRef.current = {
      index,
      pointerId: e.pointerId,
      startValue: value,
      lastNext: value.map((p) => ({ ...p })),
    };
    window.addEventListener('pointermove', stableMoveHandler);
    window.addEventListener('pointerup', stableUpHandler);
    window.addEventListener('pointercancel', stableCancelHandler);
  }, [value, onChange, onChangeCommit, isPinnedEndpoint, props.minPoints, stableMoveHandler, stableUpHandler, stableCancelHandler]);

  const segmentSamples = useMemo((): Point[][] => {
    if (value.length < 2) return [];
    const out: Point[][] = [];
    const all = sampleByInterpolation(value, SAMPLES_PER_SEGMENT, interpolation);
    for (let i = 0; i < value.length - 1; i++) {
      const start = i * SAMPLES_PER_SEGMENT;
      const end = start + SAMPLES_PER_SEGMENT;
      const slice = all.slice(start, end + 1);
      out.push(slice.map((p) => modelToPlot(p, modelRange, plotSize)));
    }
    return out;
  }, [value, modelRange, plotSize, interpolation]);

  const onSvgPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (addPointMode === 'never') return;
    // Refuse if we'd exceed the configured maximum.
    if (props.maxPoints !== undefined && value.length >= props.maxPoints) return;
    const target = e.target as SVGElement;
    if (target.tagName === 'circle') return;

    const rect = svgRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const plotPt: Point = { x: e.clientX - left, y: e.clientY - top };
    const modelPt = plotToModel(plotPt, modelRange, plotSize);

    if (addPointMode === 'click-curve') {
      const hit = hitTestCurve(segmentSamples, plotPt, 8);
      if (!hit) return;
      const insertIndex = hit.segIdx + 1;
      const next = [...value.slice(0, insertIndex), modelPt, ...value.slice(insertIndex)];
      onChange(next);
      // Begin a drag on the new anchor — commit fires on pointerup with the
      // final position so the user can slide the insertion precisely.
      setActiveDragIndex(insertIndex);
      dragRef.current = {
        index: insertIndex,
        pointerId: e.pointerId,
        startValue: next,        // post-insertion shape so move-handler index aligns
        commitPrev: value,       // pre-insertion is what `prev` in onChangeCommit should be
        lastNext: next,
      };
      window.addEventListener('pointermove', stableMoveHandler);
      window.addEventListener('pointerup', stableUpHandler);
      window.addEventListener('pointercancel', stableCancelHandler);
      return;
    }

    // 'click-empty'
    let insertIndex = value.length;
    if (domain === '1d') {
      for (let i = 0; i < value.length; i++) {
        if (value[i].x > modelPt.x) { insertIndex = i; break; }
      }
    }
    const next = [...value.slice(0, insertIndex), modelPt, ...value.slice(insertIndex)];
    onChange(next);
    if (onChangeCommit) onChangeCommit(next, value);
  }, [addPointMode, value, modelRange, plotSize, segmentSamples, domain, props.maxPoints, onChange, onChangeCommit, stableMoveHandler, stableUpHandler, stableCancelHandler]);

  const cls = [s.root, className].filter(Boolean).join(' ');

  return (
    <svg
      ref={svgRef}
      className={cls}
      style={style}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      onPointerDown={onSvgPointerDown}
    >
      {props.grid && (() => {
        const divisions = props.grid.divisions ?? 3;
        const stroke = props.grid.color;
        // Evenly-spaced internal divisions, excluding the edges (which
        // belong to the axes). For divisions=3, fractions are 1/4, 2/4, 3/4.
        const fractions: number[] = [];
        for (let i = 1; i <= divisions; i++) fractions.push(i / (divisions + 1));
        return (
          <g>
            {fractions.map((f) => (
              <line
                key={`gx-${f}`}
                data-curve-element="grid"
                className={s.grid}
                stroke={stroke}
                x1={f * width} x2={f * width}
                y1={0} y2={height}
              />
            ))}
            {fractions.map((f) => (
              <line
                key={`gy-${f}`}
                data-curve-element="grid"
                className={s.grid}
                stroke={stroke}
                x1={0} x2={width}
                y1={f * height} y2={f * height}
              />
            ))}
          </g>
        );
      })()}
      {props.axes !== false && props.axes !== null && (() => {
        const stroke = props.axes?.color;
        return (
          <g>
            <line
              data-curve-element="axis"
              className={s.axis}
              stroke={stroke}
              x1={0} x2={width}
              y1={height} y2={height}
            />
            <line
              data-curve-element="axis"
              className={s.axis}
              stroke={stroke}
              x1={0} x2={0}
              y1={0} y2={height}
            />
          </g>
        );
      })()}
      {fillD && (
        <path
          data-curve-element="fill"
          className={s.fill}
          d={fillD}
          fill={props.fill && props.fill !== null ? props.fill.color : undefined}
        />
      )}
      {pathD && (
        <path
          className={s.curve}
          d={pathD}
          fill="none"
        />
      )}
      {plotAnchors.map((a, i) => {
        const pinned = isPinnedEndpoint(i);
        // An anchor is non-interactive when it's a pinned endpoint
        // whose movement is fully constrained by the endpoints mode.
        if (pinned && props.hideNonInteractive) return null;
        const active = activeDragIndex === i;
        const isEndpoint = i === 0 || i === value.length - 1;
        const anchorCls = [
          s.anchor,
          isEndpoint && s.endpoint,
          pinned && s.pinned,
          active && s.active,
        ].filter(Boolean).join(' ');
        // Endpoints render as diamonds (rotated squares) so they read
        // as a distinct handle category from interior circles.
        if (isEndpoint) {
          const half = 4 + 1; // slightly bigger than circle r=4 so diamonds read at similar visual weight
          return (
            <rect
              key={i}
              className={anchorCls}
              x={a.x - half}
              y={a.y - half}
              width={half * 2}
              height={half * 2}
              transform={`rotate(45 ${a.x} ${a.y})`}
              data-anchor-index={i}
              onPointerDown={(e) => onPointerDownAnchor(i, e)}
            />
          );
        }
        return (
          <circle
            key={i}
            className={anchorCls}
            cx={a.x}
            cy={a.y}
            r={4}
            data-anchor-index={i}
            onPointerDown={(e) => onPointerDownAnchor(i, e)}
          />
        );
      })}
    </svg>
  );
}
