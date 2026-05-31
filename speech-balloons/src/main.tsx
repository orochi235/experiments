// Weasel-theme tokens are required by weasel-ui's CurveEditor (and other
// passthrough components). @labkit/react's bundled styles.css doesn't include
// them, so the consumer pulls them in directly. Path resolved by vite via the
// weasel monorepo's alias generator (see vite.config.ts → weaselAliases).
import '@orochi235/weasel-theme/tokens.css';
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
    if (localStorage.getItem(NEW_WORKSPACES_KEY)) {
      // Already using labkit workspaces — apply field-rename migrations in place.
      migrateWorkspaces();
      return;
    }
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
    // Migrate design.lean → design.shear.
    if (typeof design.lean === 'number' && design.shear === undefined) {
      design.shear = design.lean;
      delete design.lean;
    }
    const oldRuntime = old.runtime as Record<string, unknown>;
    const oldZoom = typeof oldRuntime.zoom === 'number' ? oldRuntime.zoom : 1.2;
    const workspace = {
      id: 'balloon',
      instrumentName: '__singleton__',
      config: design,
      state: old.runtime,
      view: { zoom: oldZoom, pan: { x: 0, y: 0 } },
    };
    localStorage.setItem(NEW_WORKSPACES_KEY, JSON.stringify([workspace]));
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* malformed snapshot — fall through to defaults */
  }
}

/**
 * In-place migrations on the labkit workspace JSON already stored.
 * Runs when the new workspaces key already exists (i.e. already ported).
 */
function migrateWorkspaces() {
  try {
    const raw = localStorage.getItem(NEW_WORKSPACES_KEY);
    if (!raw) return;
    const workspaces = JSON.parse(raw) as Array<{ config?: Record<string, unknown> }>;
    let dirty = false;
    for (const ws of workspaces) {
      const config = ws.config;
      if (!config) continue;
      // design.lean → design.shear
      if (typeof config.lean === 'number' && config.shear === undefined) {
        config.shear = config.lean;
        delete config.lean;
        dirty = true;
      }
    }
    if (dirty) {
      localStorage.setItem(NEW_WORKSPACES_KEY, JSON.stringify(workspaces));
    }
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
