export type BalloonBase = 'rectangle' | 'oval';
export type EffectKind = 'fill' | 'tail' | 'spikes' | 'stroke' | 'shadow';
export type TailShape = 'classic' | 'bubbles' | 'lightning';
export type FillMode = 'aqua' | 'bevel' | 'dome';
export type ShadingMode = 'multiply' | 'mix' | 'lightness';

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
