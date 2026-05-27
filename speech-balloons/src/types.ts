export type BalloonBase = 'rectangle' | 'oval';
export type EffectKind = 'fill' | 'tail' | 'stroke' | 'shadow';
export type TailSide = 'bottom' | 'top' | 'left' | 'right';
export type TailProjection = 'radial' | 'side';
export type TailShape = 'classic' | 'bubbles' | 'lightning';
export type FillMode = 'aqua' | 'bevel-rings' | 'bevel-blur' | 'bevel-dt';

// Lab params: numbers, strings (color/select), booleans (toggles), and number arrays (curves).
export type ParamValue = number | string | boolean | number[];
export type ParamBag = Record<string, ParamValue>;

export interface EffectInstance {
  id: number;
  kind: EffectKind;
  params: ParamBag;
}

export interface RuntimeState {
  fontFamily: string;
  fontSize: number;
  text: string;
  fitToContent: boolean;
}

export interface DesignState {
  base: BalloonBase;
  baseParams: ParamBag;
  effects: EffectInstance[];
  width: number;
  height: number;
  padX: number; // used when fitToContent is on
  padY: number;
  lean: number; // italic-style skewX in degrees, -25..25
  textColor: string;
  bg: string;
}

export interface LabSnapshot {
  runtime: RuntimeState;
  design: DesignState;
  nextId: number;
}
