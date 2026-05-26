import type { LabSnapshot } from './types';
import { BASE_CONTROLS, EFFECT_CONTROLS, defaultParams } from './controls';

// Bump on schema changes — stale entries get dropped silently.
export const LAB_STORAGE_KEY = 'speech-balloon-lab-v5';

export function initialSnapshot(): LabSnapshot {
  return {
    runtime: {
      fontFamily: 'Comic Neue, system-ui, sans-serif',
      fontSize: 28,
      text: 'Hello!',
      fitToContent: false,
    },
    design: {
      base: 'rectangle',
      baseParams: defaultParams(BASE_CONTROLS.rectangle),
      // Default preset: a fill, one classic tail aimed at the lower right, and a soft
      // drop shadow. No default stroke — add one via the right-panel effects list.
      effects: [
        { id: 1, kind: 'fill',   params: defaultParams(EFFECT_CONTROLS.fill) },
        { id: 2, kind: 'tail',   params: defaultParams(EFFECT_CONTROLS.tail) },
        { id: 3, kind: 'shadow', params: defaultParams(EFFECT_CONTROLS.shadow) },
      ],
      width: 280,
      height: 140,
      padX: 24,
      padY: 18,
      lean: 0,
      textColor: '#161921',
      bg: '#0f1320',
    },
    nextId: 4,
  };
}

export function loadSnapshot(): LabSnapshot {
  try {
    const raw = localStorage.getItem(LAB_STORAGE_KEY);
    if (!raw) return initialSnapshot();
    const parsed = JSON.parse(raw) as LabSnapshot;
    if (!parsed.runtime || !parsed.design) return initialSnapshot();
    // Forward-compat: contour was Y-only `number[5]`; migrate to interleaved [x, y, …].
    for (const eff of parsed.design.effects ?? []) {
      if (eff.kind === 'fill' && Array.isArray(eff.params?.contour)) {
        const arr = eff.params.contour as number[];
        if (arr.length === 5) {
          const out: number[] = [];
          for (let i = 0; i < arr.length; i++) out.push(i / (arr.length - 1), arr[i]);
          eff.params.contour = out;
        }
      }
    }
    return parsed;
  } catch {
    return initialSnapshot();
  }
}

export function saveSnapshot(snap: LabSnapshot) {
  try {
    localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota / disabled storage */
  }
}
