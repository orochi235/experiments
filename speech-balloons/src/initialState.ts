import { BASE_CONTROLS, EFFECT_CONTROLS, defaultParams } from './controls';
import type { DesignState, EffectInstance, RuntimeState } from './types';
import { defaultLights } from './lightRig';

export function initialDesign(): DesignState {
  return {
    base: 'rectangle',
    baseParams: defaultParams(BASE_CONTROLS.rectangle),
    effects: initialEffects(),
    lights: defaultLights(),
    width: 280,
    height: 140,
    padX: 24,
    padY: 18,
    shear: 0,
    textColor: '#161921',
    bg: '#0f1320',
    nextId: 4,
  };
}

export function initialRuntime(): RuntimeState {
  return {
    fontFamily: 'Bangers, system-ui, sans-serif',
    fontSize: 28,
    text: 'Hello!',
    fitToContent: false,
  };
}

function initialEffects(): EffectInstance[] {
  return [
    { id: 1, kind: 'fill',   params: defaultParams(EFFECT_CONTROLS.fill) },
    { id: 2, kind: 'tail',   params: defaultParams(EFFECT_CONTROLS.tail) },
    { id: 3, kind: 'shadow', params: defaultParams(EFFECT_CONTROLS.shadow) },
  ];
}
