export type BalloonBase = 'rectangle' | 'oval' | 'polygon' | 'cloud';
export type EffectKind = 'fill' | 'tail' | 'spikes' | 'lobes' | 'wobble' | 'jitter' | 'cloud' | 'stroke' | 'shadow';
export type TailShape = 'pointed' | 'bubbles' | 'lightning' | 'wavy';
export type FillMode = 'aqua' | 'dome';

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
  domeDebug?: boolean;
}

export interface DesignState {
  base: BalloonBase;
  baseParams: ParamBag;
  effects: EffectInstance[];
  width: number;
  height: number;
  padX: number; // used when fitToContent is on
  padY: number;
  shear: number; // italic-style skewX in degrees, -25..25
  textColor: string;
  bg: string;
  nextId: number;
}
