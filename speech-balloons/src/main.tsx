import '@labkit/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SingletonExperimentProvider } from '@labkit/react/state';
import { localStorageAdapter } from '@labkit/react';
import { Lab } from './Lab';
import { initialDesign, initialRuntime } from './initialState';
import './styles.css';

const STORAGE_KEY = 'speech-balloon-lab-v12';
const NEW_WORKSPACES_KEY = `lk:${STORAGE_KEY}:workspaces`;

/**
 * One-shot migration: if a pre-labkit snapshot lives at the bare
 * STORAGE_KEY but the new workspaces key is empty, lift it into the
 * labkit-shaped single-workspace record so the user's saved design
 * survives the port.
 */
function migrateStorage() {
  try {
    if (localStorage.getItem(NEW_WORKSPACES_KEY)) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const old = JSON.parse(raw) as { runtime: unknown; design: unknown; nextId?: number };
    if (!old.runtime || !old.design) return;
    const design = old.design as Record<string, unknown>;
    if (typeof old.nextId === 'number' && design.nextId === undefined) {
      design.nextId = old.nextId;
    }
    // Also rename any tail effects with shape:'classic' to 'pointed'
    // (rename happened earlier in this port — keep existing snapshots working).
    const effects = design.effects as Array<{ kind?: string; params?: { shape?: string } }> | undefined;
    if (Array.isArray(effects)) {
      for (const e of effects) {
        if (e?.kind === 'tail' && e.params?.shape === 'classic') {
          e.params.shape = 'pointed';
        }
      }
    }
    const workspace = {
      id: 'balloon',
      instrumentName: '__singleton__',
      config: design,
      state: old.runtime,
      view: { zoom: 1, pan: { x: 0, y: 0 } },
    };
    localStorage.setItem(NEW_WORKSPACES_KEY, JSON.stringify([workspace]));
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* malformed snapshot — fall through to defaults */
  }
}

migrateStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SingletonExperimentProvider
      id="balloon"
      initialConfig={initialDesign()}
      initialState={initialRuntime()}
      storage={localStorageAdapter}
      storageKey={STORAGE_KEY}
    >
      <Lab />
    </SingletonExperimentProvider>
  </StrictMode>,
);
