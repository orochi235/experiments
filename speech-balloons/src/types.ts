export type BalloonBase = 'rectangle' | 'oval' | 'polygon' | 'cloud';
export type EffectKind = 'fill' | 'tail' | 'spikes' | 'lobes' | 'wobble' | 'jitter' | 'cloud' | 'stroke' | 'shadow';
export type TailShape = 'pointed' | 'bubbles' | 'lightning' | 'wavy';
export type FillMode = 'aqua' | 'dome' | 'brdf' | 'lit-bevel';
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
  heightmapDebug?: boolean;
  // Shading-layer ids the user has hidden via the panel checkboxes. The
  // renderer emits a <style> rule that sets [data-shading-id="X"] { display: none }
  // for each entry, so the contributor is suppressed without changing
  // the registry the panel reads from.
  hiddenShadingIds?: string[];
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

export type ShadingGroup =
  | 'body'       // base body fill
  | 'dome'       // per-light dome wedges (dome mode)
  | 'brdf'       // Lambertian / specular / rim/Fresnel (BRDF mode)
  | 'aqua'       // aqua-mode body gradient + gloss
  | 'bevel'      // bevel inset path / lit-bevel surface regions
  | 'lit-bevel'; // lit-bevel light terms (ambient / per-light / specular)

export interface ShadingItem {
  id: string;
  label: string;
  group: ShadingGroup;
}
