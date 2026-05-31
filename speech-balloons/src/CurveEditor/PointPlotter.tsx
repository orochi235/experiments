import type { CSSProperties, ReactNode } from 'react';
import {
  CurveEditor,
  type AnchorRenderProps,
  type AxesSettings,
  type ControlPoint,
  type CurveEditorProps,
  type GridSettings,
} from './CurveEditor';

export interface PointPlotterProps {
  value: readonly ControlPoint[];
  onChange: (next: ControlPoint[]) => void;
  onChangeCommit?: (next: ControlPoint[], prev: readonly ControlPoint[]) => void;
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  width: number;
  height: number;
  grid?: GridSettings | false | null;
  axes?: AxesSettings | false | null;
  minPoints?: number;
  maxPoints?: number;
  addPointMode?: 'click-empty' | 'never';
  renderAnchor?: (info: AnchorRenderProps) => ReactNode;
  decorations?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** 2D point plotter — a CurveEditor with the curve hidden. Inherits drag
 *  and click-empty insert from CurveEditor. */
export function PointPlotter(props: PointPlotterProps) {
  const curveProps: CurveEditorProps = {
    ...props,
    addPointMode: props.addPointMode ?? 'click-empty',
    fill: false,
    endpoints: 'free',
    hideCurve: true,
  };
  return <CurveEditor {...curveProps} />;
}
