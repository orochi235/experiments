import { useMemo, useState } from 'react';
import { PointPlotter, type ControlPoint } from './PointPlotter';
import { angleToS, buildBaseSampler } from './geometry';
import type { BalloonBase, ParamBag } from './types';

// Color palette for indexed tails. Picked to read cleanly on the dark
// surface and to be perceptually distinct in close groupings.
const PALETTE = [
  '#fbbf24', // amber
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#34d399', // emerald
  '#a78bfa', // violet
  '#fb923c', // orange
  '#f87171', // red
  '#60a5fa', // blue
];

export function tailColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export interface MinimapTail {
  id: number;
  angle: number;     // degrees, 0 = east, 90 = south (SVG convention)
  length: number;    // user units (px)
  arc: number;       // -1..1 lateral bend
  outAngle: number;  // degrees, tip-angle offset from radial outward (-90..90)
  colorSlot: number; // palette index — sticky across removes
}

interface TailMinimapProps {
  width: number;
  height: number;
  bodyShape: BalloonBase;
  bodyW: number;
  bodyH: number;
  bodyParams: ParamBag;
  shear?: number; // degrees; positive = lean right
  tails: MinimapTail[];
  onUpdateTail: (id: number, updates: { angle?: number; length?: number; arc?: number; outAngle?: number }) => void;
  onCommitTail: (id: number) => void;
  onAddTail: (angle: number) => void;
  onRemoveTail: (id: number) => void;
}

export function TailMinimap(props: TailMinimapProps) {
  const {
    width, height, bodyShape, bodyW, bodyH, bodyParams, shear = 0, tails,
    onUpdateTail, onCommitTail, onAddTail, onRemoveTail,
  } = props;

  const cx = width / 2;
  const cy = height / 2;
  // Reserve ~40% radius for tail tips sticking out. Body uses the rest.
  const targetBodyHalf = Math.min(width, height) * 0.28;
  const scale = targetBodyHalf / Math.max(bodyW / 2, bodyH / 2);
  const scaledW = bodyW * scale;
  const scaledH = bodyH * scale;
  const offsetX = cx - scaledW / 2;
  const offsetY = cy - scaledH / 2;

  // Shear coefficient: same formula as SpeechBalloon (positive = lean right).
  // Applied relative to the body center — x' = x + k*(cy_body - y).
  const shearK = Math.tan((shear * Math.PI) / 180);
  const bodyCenterY = offsetY + scaledH / 2;

  // Apply shear to a point in plot space.
  const applyShear = (x: number, y: number): { x: number; y: number } => ({
    x: x + shearK * (bodyCenterY - y),
    y,
  });

  // Build the real sampler at minimap scale so the body silhouette and
  // ray-perimeter intersections match the actual body shape — including
  // polygon corners and cloud lobes — instead of an approximate ellipse/rect.
  const sampler = useMemo(
    () => buildBaseSampler(bodyShape, bodyParams, scaledW, scaledH),
    [bodyShape, bodyParams, scaledW, scaledH],
  );

  // Plot-space perimeter point at angle θ (measured from body center),
  // with shear applied so it lands on the leaned silhouette.
  const perimeterAtAngle = (angle: number): { x: number; y: number; nx: number; ny: number } => {
    const s = angleToS(angle * 180 / Math.PI, sampler, scaledW / 2, scaledH / 2);
    const p = sampler.perimeterAt(s);
    const sheared = applyShear(offsetX + p.x, offsetY + p.y);
    return { x: sheared.x, y: sheared.y, nx: p.nx, ny: p.ny };
  };

  // Each tail contributes [base, tip] in plot coords (yRange flipped so
  // model space == SVG space, no y-axis sign mental load). The tip's outward
  // direction is the perimeter NORMAL at the attach point rotated by outAngle
  // — same basis SpeechBalloon uses via rotateAttachByOutAngle. For non-
  // elliptical bodies (rounded rect, cloud, polygon) the normal differs from
  // the radial, and using radial here causes the tip to visibly jump on
  // drag-end as the live (normal-basis) drag is replaced by the (radial)
  // derived position.
  const derivedPoints: ControlPoint[] = useMemo(() => {
    const out: ControlPoint[] = [];
    for (const t of tails) {
      const a = (t.angle * Math.PI) / 180;
      const b = perimeterAtAngle(a);
      const r = (t.outAngle * Math.PI) / 180;
      const cr = Math.cos(r);
      const sr = Math.sin(r);
      const ox = b.nx * cr - b.ny * sr;
      const oy = b.nx * sr + b.ny * cr;
      const px = -oy;
      const py = ox;
      const L = t.length * scale;
      const arcShift = t.arc * L;
      out.push({ x: b.x, y: b.y });
      out.push({ x: b.x + ox * L + px * arcShift, y: b.y + oy * L + py * arcShift });
    }
    return out;
  }, [tails, sampler, scale, offsetX, offsetY, scaledW, scaledH, shearK]);

  // While dragging, the PointPlotter is the source of truth for anchor
  // positions — if we let React re-derive positions from updated angle/length
  // params each frame, the anchor snaps back to the perimeter intersection
  // and conflicts with the in-flight drag, causing flicker. So we mirror
  // the live drag value into local state and present it to PointPlotter
  // as the controlled value; we still update tail params in parallel so
  // the rendered body shape follows the drag.
  const [liveDrag, setLiveDrag] = useState<ControlPoint[] | null>(null);
  const points = liveDrag && liveDrag.length === derivedPoints.length ? liveDrag : derivedPoints;

  const handleChange = (next: ControlPoint[]) => {
    if (next.length !== derivedPoints.length) return; // structural change → commit phase
    // Snap both anchors to where they will actually live on commit:
    //   - base rides the perimeter
    //   - tip lands at the position implied by (clamped outAngle, clamped
    //     length, current arc) — so the visual matches the rendered tail.
    const snapped: ControlPoint[] = next.slice();
    for (let i = 0; i < tails.length; i++) {
      const t = tails[i];
      const newBase = next[i * 2];
      const newTip = next[i * 2 + 1];
      const oldBase = points[i * 2];
      const oldTip = points[i * 2 + 1];
      const baseMoved = dist(newBase, oldBase) > 0.05;
      const tipMoved = dist(newTip, oldTip) > 0.05;
      if (baseMoved) {
        const a = Math.atan2(newBase.y - cy, newBase.x - cx);
        const proj = perimeterAtAngle(a);
        snapped[i * 2] = { x: proj.x, y: proj.y };
        onUpdateTail(t.id, { angle: normalizeDeg((a * 180) / Math.PI) });
        // Reproject the tip from the new base + current (outAngle, length, arc).
        // The rendered model uses the perimeter's outward NORMAL as the
        // tail's base direction (see rotateAttachByOutAngle in
        // SpeechBalloon.tsx) — for non-elliptical bodies this differs from
        // the radial direction. Use proj.nx/ny so the minimap stays faithful.
        const r = ((t.outAngle ?? 0) * Math.PI) / 180;
        const cr = Math.cos(r);
        const sr = Math.sin(r);
        const ox = proj.nx * cr - proj.ny * sr;
        const oy = proj.nx * sr + proj.ny * cr;
        const px = -oy;
        const py = ox;
        const L = (t.length ?? 60) * scale;
        const arcShift = (t.arc ?? 0) * L;
        snapped[i * 2 + 1] = {
          x: proj.x + ox * L + px * arcShift,
          y: proj.y + oy * L + py * arcShift,
        };
      } else if (tipMoved) {
        // Drag tip = keep attach fixed; recompute outAngle + length from the
        // vector (newTip - attach). The rendered tail's tip sits at
        //   normalAngle + outAngle + atan(arc)
        // from attach with magnitude L·sqrt(1 + arc²) (normalAngle =
        // atan2(ny, nx) of the perimeter normal — radial only on ellipses).
        const a = (t.angle * Math.PI) / 180;
        const b = perimeterAtAngle(a);
        const dx = newTip.x - b.x;
        const dy = newTip.y - b.y;
        const v = Math.hypot(dx, dy);
        if (v < 1) continue;
        const normalAngle = Math.atan2(b.ny, b.nx);
        const arcAng = Math.atan(t.arc);
        const tipDir = Math.atan2(dy, dx);
        let outAngle = ((tipDir - normalAngle - arcAng) * 180) / Math.PI;
        // Wrap to (-180, 180] then clamp to the slider's range.
        while (outAngle > 180) outAngle -= 360;
        while (outAngle <= -180) outAngle += 360;
        outAngle = Math.max(-90, Math.min(90, outAngle));
        const length = Math.max(8, v / (scale * Math.sqrt(1 + t.arc * t.arc)));
        // Reproject the tip onto the clamped (outAngle, length, arc) so the
        // visual handle doesn't drift past the slider clamps during drag.
        const r = (outAngle * Math.PI) / 180;
        const cr = Math.cos(r);
        const sr = Math.sin(r);
        const ox = b.nx * cr - b.ny * sr;
        const oy = b.nx * sr + b.ny * cr;
        const px = -oy;
        const py = ox;
        const L = length * scale;
        const arcShift = t.arc * L;
        snapped[i * 2 + 1] = {
          x: b.x + ox * L + px * arcShift,
          y: b.y + oy * L + py * arcShift,
        };
        onUpdateTail(t.id, { outAngle, length });
      }
    }
    setLiveDrag(snapped);
  };

  const handleCommit = (next: ControlPoint[], prev: readonly ControlPoint[]) => {
    // Drag ended (or structural change happened) — let derived positions
    // take over again; new design state will produce them on next render.
    setLiveDrag(null);
    if (next.length === prev.length) {
      // Just a drag — commit per affected tail (cheap; consumers can dedupe).
      for (let i = 0; i < tails.length; i++) {
        if (dist(next[i * 2], prev[i * 2]) > 0.05 || dist(next[i * 2 + 1], prev[i * 2 + 1]) > 0.05) {
          onCommitTail(tails[i].id);
        }
      }
      return;
    }
    if (next.length > prev.length) {
      const p = next[next.length - 1]; // 2D domain appends at end
      const a = Math.atan2(p.y - cy, p.x - cx);
      onAddTail(normalizeDeg((a * 180) / Math.PI));
      return;
    }
    // Delete: locate the prev index whose position no longer appears in next.
    let removedIdx = prev.length - 1;
    for (let i = 0; i < next.length; i++) {
      if (dist(prev[i], next[i]) > 0.05) { removedIdx = i; break; }
    }
    const tailIdx = Math.floor(removedIdx / 2);
    if (tails[tailIdx]) onRemoveTail(tails[tailIdx].id);
  };

  // Draw the real body silhouette from the sampler so polygon corners,
  // cloud lobes, and rectangle roundness all read accurately.
  // Apply the shear via SVG matrix: in sampler-local coords the transform is
  // x' = x + k*(H/2 - y) = x - k*y + k*H/2  →  matrix(1, 0, -k, 1, k*H/2, 0)
  const bodyShearMatrix = shearK !== 0
    ? `matrix(1,0,${(-shearK).toFixed(6)},1,${(shearK * scaledH / 2).toFixed(6)},0)`
    : undefined;
  const bodyDecoration = (
    <g transform={`translate(${offsetX} ${offsetY})`}>
      <path
        d={sampler.bodyPath}
        transform={bodyShearMatrix}
        fill="rgba(255,255,255,0.08)"
        stroke="rgba(255,255,255,0.32)"
        strokeWidth={1.5}
      />
    </g>
  );

  const spineLines = tails.map((t, i) => {
    const base = points[i * 2];
    const tip = points[i * 2 + 1];
    return (
      <line
        key={`spine-${t.id}`}
        x1={base.x} y1={base.y} x2={tip.x} y2={tip.y}
        stroke={tailColor(t.colorSlot)} strokeWidth={2} strokeOpacity={0.55} strokeLinecap="round"
      />
    );
  });

  return (
    <PointPlotter
      value={points}
      onChange={handleChange}
      onChangeCommit={handleCommit}
      width={width}
      height={height}
      xRange={[0, width]}
      yRange={[height, 0]}
      grid={false}
      axes={false}
      addPointMode="click-empty"
      maxPoints={PALETTE.length * 2}
      decorations={<>{bodyDecoration}{spineLines}</>}
      renderAnchor={({ index, cx: ax, cy: ay }) => {
        const tailIdx = Math.floor(index / 2);
        const t = tails[tailIdx];
        if (!t) return null;
        const isTip = index % 2 === 1;
        const color = tailColor(t.colorSlot);
        const r = isTip ? 7 : 9;
        return (
          <g
            style={{ cursor: 'grab' }}
            onContextMenu={(e) => {
              // Only intercept the native menu when the click hit an anchor —
              // empty-plot right-clicks should fall through to the browser.
              e.preventDefault();
              e.stopPropagation();
              onRemoveTail(t.id);
            }}
          >
            <circle cx={ax} cy={ay} r={r} fill={color} stroke="#1a1a2e" strokeWidth={1.5} />
            <text
              x={ax} y={ay} dy="0.32em" textAnchor="middle"
              fontSize={isTip ? 9 : 11}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={700} fill="#1a1a2e"
              pointerEvents="none"
            >
              {tailIdx + 1}
            </text>
          </g>
        );
      }}
    />
  );
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}
