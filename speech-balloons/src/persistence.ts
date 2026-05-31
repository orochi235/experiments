import type { LabSnapshot } from './types';
import { BASE_CONTROLS, EFFECT_CONTROLS, defaultParams } from './controls';

// Bump on schema changes — stale entries get dropped silently.
export const LAB_STORAGE_KEY = 'speech-balloon-lab-v12';

export function initialSnapshot(): LabSnapshot {
  return {
    runtime: {
      fontFamily: 'Bangers, system-ui, sans-serif',
      fontSize: 28,
      text: 'Hello!',
      fitToContent: false,
      zoom: 1.2,
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
    // Default new fields on load so old snapshots keep working.
    if (parsed.runtime.zoom === undefined) parsed.runtime.zoom = 1.2;
    // Migrate: rename shape 'classic' → 'pointed' (renamed in UI and code).
    for (const eff of parsed.design?.effects ?? []) {
      if (eff.kind === 'tail' && eff.params.shape === 'classic') eff.params.shape = 'pointed';
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
