/**
 * Thin wrapper around weasel-ui's CurveEditor that hides the curve and
 * presents a 2D point plotter. Re-implemented locally to avoid TypeScript
 * traversing weasel-ui source (which has unresolvable internal deps).
 *
 * Public API mirrors weasel-ui's PointPlotter exactly so this file can be
 * replaced with a direct re-export once weasel-ui ships pre-built dist.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  CurveEditor,
  type AnchorRenderProps,
  type ControlPoint,
  type CurveEditorProps,
} from '@weasel-js/labkit/weasel-ui';

export type { ControlPoint };

export interface PointPlotterProps {
  value: readonly ControlPoint[];
  onChange: (next: ControlPoint[]) => void;
  onChangeCommit?: (next: ControlPoint[], prev: readonly ControlPoint[]) => void;
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  width: number;
  height: number;
  grid?: false | null | Record<string, unknown>;
  axes?: false | null | Record<string, unknown>;
  minPoints?: number;
  maxPoints?: number;
  addPointMode?: 'click-empty' | 'never';
  history?: boolean;
  renderAnchor?: (info: AnchorRenderProps) => ReactNode;
  decorations?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** 2D point plotter — CurveEditor with the curve hidden. */
export function PointPlotter(props: PointPlotterProps) {
  const curveProps: CurveEditorProps = {
    ...props,
    addPointMode: props.addPointMode ?? 'click-empty',
    curve: false,
    fill: false,
    endpoints: 'free',
  };
  return <CurveEditor {...curveProps} />;
}
