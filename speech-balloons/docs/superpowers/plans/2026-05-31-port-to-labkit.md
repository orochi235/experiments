# Port speech-balloons to @labkit/react — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move speech-balloons off its bespoke UI/state/undo stack onto `@labkit/react`, adding to labkit only what's genuinely missing and passing through what already exists in weasel-ui.

**Architecture:** Two repos. Phase A lands new primitives in `~/src/labkit` (PropertyGroup, LayerStack, CurveField, SingletonExperimentProvider, weasel-ui passthroughs). Phase B cuts speech-balloons over to the new surface. The consumer (speech-balloons) depends on labkit via `file:../../labkit`, so phases are sequential within a working tree but don't require an npm publish.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Storybook 8, Biome, Less (labkit), CSS (speech-balloons). Labkit uses tsup for the lib build. Weasel-ui is consumed via local file path.

**Companion spec:** [`docs/superpowers/specs/2026-05-31-port-to-labkit-design.md`](../specs/2026-05-31-port-to-labkit-design.md)

---

## File Structure

### New in labkit (`~/src/labkit/`)
- `src/ui/properties/PropertyGroup.tsx` — header-with-`hideWhen` subpanel grouping
- `src/ui/properties/PropertyGroup.less`
- `src/ui/properties/PropertyGroup.test.tsx`
- `src/ui/properties/PropertyGroup.stories.tsx`
- `src/ui/properties/CurveField.tsx` — wraps weasel-ui CurveEditor + readouts + flip button
- `src/ui/properties/CurveField.less`
- `src/ui/properties/CurveField.test.tsx`
- `src/ui/properties/CurveField.stories.tsx`
- `src/ui/layers/LayerStack.tsx` — expandable layer-card stack with drop-hint reorder
- `src/ui/layers/LayerStack.less`
- `src/ui/layers/LayerStack.test.tsx`
- `src/ui/layers/LayerStack.stories.tsx`
- `src/ui/layers/index.ts`
- `src/passthrough/weasel-ui.ts` — re-export bundle from `@orochi235/weasel-ui`
- `src/state/SingletonExperiment.tsx` — one-workspace provider
- `src/state/SingletonExperiment.test.tsx`

### Modified in labkit
- `package.json` — add `@orochi235/weasel-ui` file dep, add `./weasel-ui` and `./ui/layers` entries to `exports`
- `tsup.config.ts` — add `passthrough/weasel-ui/index` and `ui/layers/index` entries
- `src/styles.less` — `@import` the new component .less files
- `src/state/index.ts` — export `SingletonExperimentProvider`
- `src/ui/properties/index.ts` — export `PropertyGroup`, `CurveField`
- `src/index.ts` — re-export the new pieces
- `docs/AGENTS.md` — table entries for new components

### Modified in speech-balloons (`~/src/experiments/speech-balloons/`)
- `package.json` — add `@labkit/react` file dep
- `src/main.tsx` — import labkit styles
- `src/Lab.tsx` — large reduction; replace local components with labkit imports
- `src/controls.ts` — minor: keep `LabControl` shape but the consumer renderer changes
- `src/styles.css` — trim to balloon-specific; switch local classnames to `sb-*` prefix
- Delete `src/persistence.ts`
- Delete `src/CurveEditor/` directory

---

## Phase A — Labkit additions

All Phase A tasks happen in `~/src/labkit`. Tests run with `npm test` (vitest); lint with `npm run lint`; storybook with `npm run storybook`.

### Task A0: Add `@orochi235/weasel-ui` as a labkit dependency

**Files:**
- Modify: `~/src/labkit/package.json`

- [ ] **Step 1: Add file dep**

Edit `~/src/labkit/package.json`. Under `"dependencies"`, add (in alphabetical order):

```json
"@orochi235/weasel-ui": "file:../weasel/packages/weasel-ui"
```

Also add the transitive `@orochi235/weasel-modes`:

```json
"@orochi235/weasel-modes": "file:../weasel/packages/weasel-modes"
```

- [ ] **Step 2: Install**

```bash
cd ~/src/labkit && npm install
```

Expected: install succeeds. `node_modules/@orochi235/weasel-ui` is a symlink into `~/src/weasel/packages/weasel-ui`.

- [ ] **Step 3: Smoke-test the import**

Create a throwaway test file to confirm the import resolves at type level:

```bash
cd ~/src/labkit && cat > /tmp/labkit-smoke.ts <<'EOF'
import { formatNumber, CurveEditor, useReorderDragList } from '@orochi235/weasel-ui';
const _formatted: string = formatNumber(-3.14);
type _C = typeof CurveEditor;
type _U = typeof useReorderDragList;
EOF
npx tsc --noEmit --project tsconfig.lib.json /tmp/labkit-smoke.ts 2>&1 | head -20
rm /tmp/labkit-smoke.ts
```

Expected: no errors. If `tsc` complains about JSX or `--isolatedModules`, ignore those — only "cannot find module" failures matter.

- [ ] **Step 4: Commit**

```bash
cd ~/src/labkit && git add package.json package-lock.json
git commit -m "feat(labkit): add @orochi235/weasel-ui as dependency

Pulls in CurveEditor, useReorderDragList, formatNumber, and other UI
primitives so labkit can pass them through to consumers without
re-implementing them."
```

---

### Task A1: Passthrough module for weasel-ui

**Files:**
- Create: `~/src/labkit/src/passthrough/weasel-ui.ts`
- Modify: `~/src/labkit/tsup.config.ts`
- Modify: `~/src/labkit/package.json` (exports)
- Test: `~/src/labkit/src/passthrough/weasel-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `~/src/labkit/src/passthrough/weasel-ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CurveEditor,
  formatNumber,
  MINUS_SIGN,
  oklchToHex,
  paintGradientTrack,
  useReorderDragList,
} from './weasel-ui';

describe('weasel-ui passthrough', () => {
  it('re-exports formatNumber with MINUS_SIGN convention', () => {
    expect(formatNumber(-3.14)).toBe(`${MINUS_SIGN}3.14`);
  });

  it('re-exports CurveEditor as a React component', () => {
    expect(typeof CurveEditor).toBe('function');
  });

  it('re-exports the hook and helpers', () => {
    expect(typeof useReorderDragList).toBe('function');
    expect(typeof paintGradientTrack).toBe('function');
    expect(typeof oklchToHex).toBe('function');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
cd ~/src/labkit && npx vitest run src/passthrough/weasel-ui.test.ts 2>&1 | tail -20
```

Expected: FAIL — module `./weasel-ui` not found.

- [ ] **Step 3: Implement the passthrough**

Create `~/src/labkit/src/passthrough/weasel-ui.ts`:

```ts
/**
 * Re-exports of UI primitives from `@orochi235/weasel-ui` so consumers
 * import them through `@labkit/react/weasel-ui` rather than depending
 * on the weasel-ui package directly. Lets labkit swap implementations
 * in the future without consumer churn.
 */
export {
  CurveEditor,
  type CurveEditorProps,
  type ControlPoint,
  type CurveDomain,
  type EndpointMode,
  type AddPointMode,
  type FillSettings,
  type InterpolationMode,
} from '@orochi235/weasel-ui';
export {
  useReorderDragList,
  type LayerListItem,
  type UseReorderDragListOptions,
  type ReorderDragState,
  type ReorderDragHandlers,
} from '@orochi235/weasel-ui';
export { formatNumber, MINUS_SIGN } from '@orochi235/weasel-ui';
export { paintGradientTrack, type GradientTrackOpts } from '@orochi235/weasel-ui';
export {
  oklchToHex,
  chromaAt,
  type ChromaCurve,
  type ChromaCurvePoint,
} from '@orochi235/weasel-ui';
```

- [ ] **Step 4: Run test, see it pass**

```bash
cd ~/src/labkit && npx vitest run src/passthrough/weasel-ui.test.ts 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 5: Wire build output**

Edit `~/src/labkit/tsup.config.ts`. Add to `entry`:

```ts
'passthrough/weasel-ui': 'src/passthrough/weasel-ui.ts',
```

Add `@orochi235/weasel-ui` and `@orochi235/weasel-modes` to `external`:

```ts
external: ['react', 'react-dom', '@orochi235/weasel-ui', '@orochi235/weasel-modes'],
```

- [ ] **Step 6: Wire package exports**

Edit `~/src/labkit/package.json` — add inside `"exports"` (between `./state` and `./styles.css`):

```json
"./weasel-ui": {
  "types": "./dist/passthrough/weasel-ui.d.ts",
  "import": "./dist/passthrough/weasel-ui.js"
}
```

- [ ] **Step 7: Verify build produces the entry**

```bash
cd ~/src/labkit && npm run build 2>&1 | tail -30
ls dist/passthrough/weasel-ui.* 2>&1
```

Expected: `dist/passthrough/weasel-ui.js` and `.d.ts` exist.

- [ ] **Step 8: Commit**

```bash
cd ~/src/labkit && git add src/passthrough package.json tsup.config.ts
git commit -m "feat(labkit): passthrough exports for weasel-ui primitives

New entry @labkit/react/weasel-ui re-exports CurveEditor, useReorderDragList,
formatNumber, paintGradientTrack, and oklch helpers from weasel-ui. Consumers
import one labkit subpath instead of taking a direct dep on weasel-ui."
```

---

### Task A2: PropertyGroup component

**Files:**
- Create: `~/src/labkit/src/ui/properties/PropertyGroup.tsx`
- Create: `~/src/labkit/src/ui/properties/PropertyGroup.less`
- Test: `~/src/labkit/src/ui/properties/PropertyGroup.test.tsx`
- Story: `~/src/labkit/src/ui/properties/PropertyGroup.stories.tsx`
- Modify: `~/src/labkit/src/ui/properties/index.ts`
- Modify: `~/src/labkit/src/styles.less`

- [ ] **Step 1: Write failing test**

Create `~/src/labkit/src/ui/properties/PropertyGroup.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PropertyGroup } from './PropertyGroup';

describe('PropertyGroup', () => {
  it('renders title and children', () => {
    render(
      <PropertyGroup title="Aqua">
        <div>child</div>
      </PropertyGroup>,
    );
    expect(screen.getByText('Aqua')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('renders nothing when hidden is true', () => {
    const { container } = render(
      <PropertyGroup title="Bevel" hidden>
        <div>child</div>
      </PropertyGroup>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('applies subpanel class', () => {
    const { container } = render(
      <PropertyGroup title="Dome">
        <div>x</div>
      </PropertyGroup>,
    );
    expect(container.firstChild).toHaveClass('lk-property-group');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
cd ~/src/labkit && npx vitest run src/ui/properties/PropertyGroup.test.tsx 2>&1 | tail -10
```

Expected: FAIL — module `./PropertyGroup` not found.

- [ ] **Step 3: Implement PropertyGroup**

Create `~/src/labkit/src/ui/properties/PropertyGroup.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface PropertyGroupProps {
  /** Title rendered between two rules at the top of the group. */
  title: ReactNode;
  /** When true the group renders nothing — useful for conditional sections. */
  hidden?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Visually-bordered group inside a PropertyList. Use to scope a set of
 * related rows under a heading (e.g. "Aqua", "Bevel", "Dome" sections
 * inside a fill effect's controls).
 */
export function PropertyGroup({
  title,
  hidden,
  children,
  className,
}: PropertyGroupProps) {
  if (hidden) return null;
  const cls = className ? `lk-property-group ${className}` : 'lk-property-group';
  return (
    <div className={cls}>
      <h3 className="lk-property-group__title">
        <hr aria-hidden="true" />
        <span>{title}</span>
        <hr aria-hidden="true" />
      </h3>
      <div className="lk-property-group__body">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

Create `~/src/labkit/src/ui/properties/PropertyGroup.less`:

```less
.lk-property-group {
  grid-column: 1 / -1;
  background: var(--lk-bg-sunken, rgba(0, 0, 0, 0.18));
  border-radius: var(--lk-radius-md, 8px);
  padding: 10px 12px 12px;
}

.lk-property-group__title {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
  font-family: var(--lk-font-display);
  font-weight: var(--lk-font-weight-light, 300);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lk-text-dim);
}

.lk-property-group__title hr {
  border: 0;
  border-top: 1px solid var(--lk-border);
  margin: 0;
}

.lk-property-group__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
  row-gap: 10px;
  align-items: start;
}

.lk-property-group__body > :not(.lk-property-row--color) {
  grid-column: 1 / -1;
}
```

Edit `~/src/labkit/src/styles.less` — append:

```less
@import './ui/properties/PropertyGroup.less';
```

- [ ] **Step 5: Export from index**

Edit `~/src/labkit/src/ui/properties/index.ts` — add:

```ts
export { PropertyGroup, type PropertyGroupProps } from './PropertyGroup';
```

- [ ] **Step 6: Run test, see it pass**

```bash
cd ~/src/labkit && npx vitest run src/ui/properties/PropertyGroup.test.tsx 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 7: Write Storybook story**

Create `~/src/labkit/src/ui/properties/PropertyGroup.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { PropertyGroup } from './PropertyGroup';
import { PropertyList, PropertyPanel, SliderRow } from './PropertyPanel';

const meta: Meta<typeof PropertyGroup> = {
  title: 'UI/Properties/PropertyGroup',
  component: PropertyGroup,
};
export default meta;

export const Basic: StoryObj<typeof PropertyGroup> = {
  render: () => (
    <PropertyPanel title="Fill">
      <PropertyList>
        <SliderRow label="Amount" value={0.6} min={0} max={1} step={0.02} onChange={() => {}} />
        <PropertyGroup title="Aqua">
          <SliderRow label="Light angle" value={270} min={0} max={359} step={1} unit="°" onChange={() => {}} />
          <SliderRow label="Gloss" value={0.55} min={0} max={1} step={0.02} onChange={() => {}} />
        </PropertyGroup>
        <PropertyGroup title="Bevel" hidden>
          <SliderRow label="Rings" value={32} min={4} max={96} step={1} onChange={() => {}} />
        </PropertyGroup>
      </PropertyList>
    </PropertyPanel>
  ),
};
```

- [ ] **Step 8: Verify lint passes**

```bash
cd ~/src/labkit && npm run lint 2>&1 | tail -20
```

Expected: no errors. The `check-class-prefix.ts` script enforces `lk-` prefix.

- [ ] **Step 9: Commit**

```bash
cd ~/src/labkit && git add src/ui/properties/PropertyGroup.* src/ui/properties/index.ts src/styles.less
git commit -m "feat(labkit): PropertyGroup component for subpanel grouping

Subpanel-style grouping inside a PropertyList. Renders a titled card
with a hidden toggle so consumers can conditionally show/hide a group
based on another field's value."
```

---

### Task A3: SingletonExperimentProvider

**Files:**
- Create: `~/src/labkit/src/state/SingletonExperiment.tsx`
- Test: `~/src/labkit/src/state/SingletonExperiment.test.tsx`
- Modify: `~/src/labkit/src/state/index.ts`

- [ ] **Step 1: Write failing test**

Create `~/src/labkit/src/state/SingletonExperiment.test.tsx`:

```tsx
import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './adapters';
import { SingletonExperimentProvider } from './SingletonExperiment';
import { useExperimentState } from './useExperimentState';

interface Config { width: number; bg: string }
interface State { zoom: number }

describe('SingletonExperimentProvider', () => {
  it('exposes config and state via useExperimentState', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SingletonExperimentProvider<State, Config>
        id="test"
        initialConfig={{ width: 100, bg: '#000' }}
        initialState={{ zoom: 1 }}
        storage={createMemoryAdapter()}
        storageKey="test"
      >
        {children}
      </SingletonExperimentProvider>
    );
    const { result } = renderHook(() => useExperimentState<State, Config>(), { wrapper });
    expect(result.current.config).toEqual({ width: 100, bg: '#000' });
    expect(result.current.state).toEqual({ zoom: 1 });
  });

  it('persists config changes to storage', () => {
    const storage = createMemoryAdapter();
    const Probe = () => {
      const h = useExperimentState<State, Config>();
      return (
        <button type="button" onClick={() => h.setConfig('width', 200)}>
          go
        </button>
      );
    };
    const { getByText } = render(
      <SingletonExperimentProvider<State, Config>
        id="test"
        initialConfig={{ width: 100, bg: '#000' }}
        initialState={{ zoom: 1 }}
        storage={storage}
        storageKey="test"
      >
        <Probe />
      </SingletonExperimentProvider>,
    );
    act(() => {
      getByText('go').click();
    });
    // storage.read may return null synchronously if the underlying store
    // flushes on a microtask — give it one tick to settle.
    const raw = storage.read('test:workspaces');
    expect(raw).toBeTruthy();
    expect(raw).toContain('"width":200');
  });

  it('rehydrates from storage on mount', () => {
    const storage = createMemoryAdapter();
    storage.write(
      'test:workspaces',
      JSON.stringify([
        {
          id: 'test',
          instrumentName: '__singleton__',
          config: { width: 999, bg: '#fff' },
          state: { zoom: 2 },
          view: { zoom: 1, pan: { x: 0, y: 0 } },
        },
      ]),
    );
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SingletonExperimentProvider<State, Config>
        id="test"
        initialConfig={{ width: 100, bg: '#000' }}
        initialState={{ zoom: 1 }}
        storage={storage}
        storageKey="test"
      >
        {children}
      </SingletonExperimentProvider>
    );
    const { result } = renderHook(() => useExperimentState<State, Config>(), { wrapper });
    expect(result.current.config).toEqual({ width: 999, bg: '#fff' });
    expect(result.current.state).toEqual({ zoom: 2 });
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
cd ~/src/labkit && npx vitest run src/state/SingletonExperiment.test.tsx 2>&1 | tail -10
```

Expected: FAIL — module `./SingletonExperiment` not found.

- [ ] **Step 3: Implement the provider**

Create `~/src/labkit/src/state/SingletonExperiment.tsx`:

```tsx
import { type ReactNode, useRef } from 'react';
import { LabStoreProvider, WorkspaceIdProvider } from './context';
import { createLabStore, type LabStore } from './store';
import type { StorageAdapter } from './types';

const SINGLETON_INSTRUMENT = '__singleton__';

export interface SingletonExperimentProviderProps<TS, TC> {
  /** Stable id for the synthetic workspace; also doubles as the
   *  WorkspaceIdContext value. */
  id: string;
  initialConfig: TC;
  initialState: TS;
  storage: StorageAdapter;
  storageKey: string;
  children: ReactNode;
}

/**
 * One-workspace `<Lab>` substitute for single-screen experiments. Mounts
 * a `LabStoreProvider` + `WorkspaceIdProvider` with one synthetic
 * workspace, so `useExperimentState` works without going through the
 * full `<Lab instruments={...}>` runtime.
 */
export function SingletonExperimentProvider<TS, TC>({
  id,
  initialConfig,
  initialState,
  storage,
  storageKey,
  children,
}: SingletonExperimentProviderProps<TS, TC>) {
  const storeRef = useRef<LabStore | null>(null);
  if (storeRef.current === null) {
    const store = createLabStore({ storageKey, storage });
    if (!store.getState().workspaces.some((w) => w.id === id)) {
      store.getState().addWorkspace({
        id,
        instrumentName: SINGLETON_INSTRUMENT,
        config: initialConfig,
        state: initialState,
        view: { zoom: 1, pan: { x: 0, y: 0 } },
      });
    }
    storeRef.current = store;
  }
  return (
    <LabStoreProvider store={storeRef.current}>
      <WorkspaceIdProvider workspaceId={id}>{children}</WorkspaceIdProvider>
    </LabStoreProvider>
  );
}
```

- [ ] **Step 4: Export from state index**

Edit `~/src/labkit/src/state/index.ts` — append:

```ts
export {
  SingletonExperimentProvider,
  type SingletonExperimentProviderProps,
} from './SingletonExperiment';
```

- [ ] **Step 5: Run test, see it pass**

```bash
cd ~/src/labkit && npx vitest run src/state/SingletonExperiment.test.tsx 2>&1 | tail -10
```

Expected: 3 passed. If the "persists" test fails because of debounced flushing, inspect `src/state/store.ts:scheduleFlush` for the debounce window and either use `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)` in the test, or `await waitFor(...)`.

- [ ] **Step 6: Commit**

```bash
cd ~/src/labkit && git add src/state/SingletonExperiment.* src/state/index.ts
git commit -m "feat(labkit): SingletonExperimentProvider for one-screen labs

Wraps createLabStore + LabStoreProvider + WorkspaceIdProvider with a
synthetic single workspace, so useExperimentState works without the
full <Lab instruments={...}> runtime. Lets single-screen labs adopt
labkit state/undo/persistence without the workspace abstraction."
```

---

### Task A4: CurveField component

**Files:**
- Create: `~/src/labkit/src/ui/properties/CurveField.tsx`
- Create: `~/src/labkit/src/ui/properties/CurveField.less`
- Test: `~/src/labkit/src/ui/properties/CurveField.test.tsx`
- Story: `~/src/labkit/src/ui/properties/CurveField.stories.tsx`
- Modify: `~/src/labkit/src/ui/properties/index.ts`
- Modify: `~/src/labkit/src/styles.less`

- [ ] **Step 1: Write failing test**

Create `~/src/labkit/src/ui/properties/CurveField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurveField } from './CurveField';

describe('CurveField', () => {
  it('renders one readout per stop', () => {
    render(
      <CurveField
        values={[0, -1, 0.5, 0.5, 1, 0.7]}
        min={-1}
        max={1}
        step={0.02}
        width={200}
        height={110}
        onChange={() => {}}
      />,
    );
    const readouts = screen.getAllByTestId('lk-curve-field__readout');
    expect(readouts).toHaveLength(3);
    expect(readouts[0]).toHaveTextContent('−1');
    expect(readouts[2]).toHaveTextContent('0.7');
  });

  it('flip button mirrors x → 1-x and resorts', () => {
    const onChange = vi.fn();
    render(
      <CurveField
        values={[0, -1, 0.3, 0.4, 1, 0.7]}
        min={-1}
        max={1}
        step={0.02}
        width={200}
        height={110}
        onChange={onChange}
      />,
    );
    screen.getByRole('button', { name: /flip horizontally/i }).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    // After flip: (0,-1) → (1,-1), (0.3,0.4) → (0.7,0.4), (1,0.7) → (0,0.7).
    // Sort by x ascending: (0,0.7), (0.7,0.4), (1,-1).
    expect(onChange.mock.calls[0][0]).toEqual([0, 0.7, 0.7, 0.4, 1, -1]);
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
cd ~/src/labkit && npx vitest run src/ui/properties/CurveField.test.tsx 2>&1 | tail -10
```

Expected: FAIL — module `./CurveField` not found.

- [ ] **Step 3: Implement CurveField**

Create `~/src/labkit/src/ui/properties/CurveField.tsx`:

```tsx
import { useCallback, useMemo } from 'react';
import { CurveEditor, type ControlPoint } from '../../passthrough/weasel-ui';
import { formatNumber } from '../../passthrough/weasel-ui';

export interface CurveFieldProps {
  /** Flat [x0, y0, x1, y1, …] — matches how curve-as-array configs
   *  serialize in JSON snapshots. */
  values: number[];
  min: number;
  max: number;
  step: number;
  /** Plot width in CSS px. Caller sizes (typically uses a ResizeObserver). */
  width: number;
  /** Plot height in CSS px. Default 110. */
  height?: number;
  onChange: (next: number[]) => void;
}

/**
 * A function-domain (y = f(x), x ∈ [0,1]) curve editor with per-stop
 * numeric readouts and a flip-horizontally button. Wraps weasel-ui's
 * `CurveEditor`; consumers wanting the raw editor (2D paths,
 * custom anchors) should import it from `@labkit/react/weasel-ui`.
 */
export function CurveField({ values, min, max, step, width, height = 110, onChange }: CurveFieldProps) {
  const points: ControlPoint[] = useMemo(() => {
    const out: ControlPoint[] = [];
    for (let i = 0; i + 1 < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
    return out;
  }, [values]);

  const handleChange = useCallback(
    (next: ControlPoint[]) => {
      const flat: number[] = new Array(next.length * 2);
      for (let i = 0; i < next.length; i++) {
        const ySnap = Math.round(next[i].y / step) * step;
        const y = Math.max(min, Math.min(max, ySnap));
        flat[i * 2] = next[i].x;
        flat[i * 2 + 1] = y;
      }
      onChange(flat);
    },
    [onChange, min, max, step],
  );

  const handleFlip = useCallback(() => {
    const flipped: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < values.length; i += 2) {
      flipped.push({ x: 1 - values[i], y: values[i + 1] });
    }
    flipped.sort((a, b) => a.x - b.x);
    const out: number[] = [];
    for (const p of flipped) out.push(p.x, p.y);
    onChange(out);
  }, [values, onChange]);

  const readoutDigits = step < 1 ? 2 : 0;

  return (
    <div className="lk-curve-field">
      <div className="lk-curve-field__plot">
        <CurveEditor
          value={points}
          onChange={handleChange}
          domain="1d"
          constrain="function"
          xRange={[0, 1]}
          yRange={[min, max]}
          width={width}
          height={height}
          endpoints="pinned-x"
          addPointMode="click-curve"
          minPoints={2}
          grid={{}}
          history={false}
        />
      </div>
      <div className="lk-curve-field__readouts">
        {points.map((p, i) => (
          <em key={i} className="lk-curve-field__readout" data-testid="lk-curve-field__readout">
            {formatNumber(p.y, { minimumFractionDigits: readoutDigits, maximumFractionDigits: readoutDigits })}
          </em>
        ))}
      </div>
      <button type="button" className="lk-curve-field__flip" onClick={handleFlip}>
        Flip horizontally
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

Create `~/src/labkit/src/ui/properties/CurveField.less`:

```less
.lk-curve-field {
  display: grid;
  gap: 6px;
  grid-column: 1 / -1;
}

.lk-curve-field__plot {
  width: 100%;
}

.lk-curve-field__readouts {
  display: flex;
  justify-content: space-between;
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  color: var(--lk-text-dim);
}

.lk-curve-field__readout {
  font-style: normal;
}

.lk-curve-field__flip {
  justify-self: start;
  background: transparent;
  border: 1px solid var(--lk-border);
  border-radius: var(--lk-radius-sm, 6px);
  color: var(--lk-text);
  padding: 4px 10px;
  font-size: 0.78rem;
  cursor: pointer;
}

.lk-curve-field__flip:hover {
  background: var(--lk-bg-elevated);
}
```

Append to `~/src/labkit/src/styles.less`:

```less
@import './ui/properties/CurveField.less';
```

- [ ] **Step 5: Export from index**

Edit `~/src/labkit/src/ui/properties/index.ts` — add:

```ts
export { CurveField, type CurveFieldProps } from './CurveField';
```

- [ ] **Step 6: Run test, see it pass**

```bash
cd ~/src/labkit && npx vitest run src/ui/properties/CurveField.test.tsx 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 7: Storybook story**

Create `~/src/labkit/src/ui/properties/CurveField.stories.tsx`:

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CurveField } from './CurveField';

const meta: Meta<typeof CurveField> = {
  title: 'UI/Properties/CurveField',
  component: CurveField,
};
export default meta;

export const DomeContour: StoryObj<typeof CurveField> = {
  render: () => {
    const [v, setV] = useState<number[]>([0, -1, 0.5, 0.5, 1, 0.7]);
    return (
      <div style={{ width: 280 }}>
        <CurveField values={v} min={-1} max={1} step={0.02} width={280} onChange={setV} />
      </div>
    );
  },
};
```

- [ ] **Step 8: Lint + commit**

```bash
cd ~/src/labkit && npm run lint 2>&1 | tail -10
git add src/ui/properties/CurveField.* src/ui/properties/index.ts src/styles.less
git commit -m "feat(labkit): CurveField — function-domain curve editor

Wraps weasel-ui CurveEditor for the common 1D y=f(x) case used in lab
contour controls. Provides per-stop numeric readouts and a flip-horizontally
button. For 2D paths or custom anchor renderers, import CurveEditor
directly from @labkit/react/weasel-ui."
```

---

### Task A5: LayerStack component

This is the largest piece. Speech-balloons' EffectCard does a lot — drag handle, expand/collapse, primary-select hoist, accent color, index badge, remove button, custom body. The labkit version keeps the same surface area but consumes weasel-ui's `useReorderDragList` for pointer math.

**Files:**
- Create: `~/src/labkit/src/ui/layers/LayerStack.tsx`
- Create: `~/src/labkit/src/ui/layers/LayerStack.less`
- Create: `~/src/labkit/src/ui/layers/index.ts`
- Test: `~/src/labkit/src/ui/layers/LayerStack.test.tsx`
- Story: `~/src/labkit/src/ui/layers/LayerStack.stories.tsx`
- Modify: `~/src/labkit/src/styles.less`
- Modify: `~/src/labkit/tsup.config.ts`
- Modify: `~/src/labkit/package.json` (exports)

- [ ] **Step 1: Write failing test**

Create `~/src/labkit/src/ui/layers/LayerStack.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayerStack, type LayerStackItem } from './LayerStack';

const items: LayerStackItem[] = [
  { id: 1, kind: 'fill', primaryValue: 'aqua', primaryOptions: ['aqua', 'bevel', 'dome'] },
  { id: 2, kind: 'tail', accent: '#f44', badge: '1' },
  { id: 3, kind: 'shadow' },
];

describe('LayerStack', () => {
  it('renders header + add buttons + each item', () => {
    render(
      <LayerStack
        title="Fill"
        items={items}
        paletteKinds={['fill', 'tail', 'shadow']}
        onAdd={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        onPrimaryChange={() => {}}
        renderBody={(item) => <div>body-{item.id}</div>}
      />,
    );
    expect(screen.getByText('Fill')).toBeInTheDocument();
    // Palette buttons: one per kind, prefixed with "+ "
    for (const k of ['fill', 'tail', 'shadow']) {
      expect(screen.getByRole('button', { name: new RegExp(`add ${k}`, 'i') })).toBeInTheDocument();
    }
    // Each item card present
    expect(screen.getAllByTestId(/lk-layer-card-/)).toHaveLength(3);
  });

  it('clicking a palette button calls onAdd with that kind', () => {
    const onAdd = vi.fn();
    render(
      <LayerStack
        title="Fill"
        items={items}
        paletteKinds={['fill', 'tail']}
        onAdd={onAdd}
        onRemove={() => {}}
        onReorder={() => {}}
        onPrimaryChange={() => {}}
        renderBody={() => null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add tail/i }));
    expect(onAdd).toHaveBeenCalledWith('tail');
  });

  it('clicking the remove button calls onRemove with that id', () => {
    const onRemove = vi.fn();
    render(
      <LayerStack
        title="Fill"
        items={items}
        paletteKinds={[]}
        onAdd={() => {}}
        onRemove={onRemove}
        onReorder={() => {}}
        onPrimaryChange={() => {}}
        renderBody={() => null}
      />,
    );
    const removes = screen.getAllByRole('button', { name: /remove layer/i });
    fireEvent.click(removes[1]);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it('shows empty state when items is empty', () => {
    render(
      <LayerStack
        title="Empty"
        items={[]}
        paletteKinds={['fill']}
        onAdd={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        onPrimaryChange={() => {}}
        renderBody={() => null}
      />,
    );
    expect(screen.getByText(/no layers/i)).toBeInTheDocument();
  });

  it('changing the primary select calls onPrimaryChange', () => {
    const onPrimaryChange = vi.fn();
    render(
      <LayerStack
        title="Fill"
        items={items}
        paletteKinds={[]}
        onAdd={() => {}}
        onRemove={() => {}}
        onReorder={() => {}}
        onPrimaryChange={onPrimaryChange}
        renderBody={() => null}
      />,
    );
    const sel = screen.getByLabelText(/primary select for layer 1/i) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'bevel' } });
    expect(onPrimaryChange).toHaveBeenCalledWith(1, 'bevel');
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
cd ~/src/labkit && npx vitest run src/ui/layers/LayerStack.test.tsx 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement LayerStack**

Create `~/src/labkit/src/ui/layers/LayerStack.tsx`:

```tsx
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useReorderDragList } from '../../passthrough/weasel-ui';

export interface LayerStackItem {
  /** Stable id used for keys, onRemove, onReorder. Numeric to match
   *  common id-from-nextId conventions; string ids also work. */
  id: number | string;
  /** Short kind label rendered in the header when no primary select
   *  is hoisted (e.g. "shadow", "stroke"). */
  kind: string;
  /** When present, hoist this select into the card header so the user
   *  can switch mode/shape without expanding. */
  primaryValue?: string;
  primaryOptions?: string[];
  /** Accent CSS color used as the left border / index-badge fill. */
  accent?: string;
  /** Optional badge text rendered before the primary control
   *  (e.g. tail index "1", "2", "3"). When omitted a drag handle
   *  glyph renders in its place. */
  badge?: string;
  /** Initial expanded state. Defaults to true for newly-added items. */
  defaultExpanded?: boolean;
}

export interface LayerStackProps {
  title: string;
  items: LayerStackItem[];
  /** Kinds the user can add via the header palette. */
  paletteKinds: string[];
  onAdd: (kind: string) => void;
  onRemove: (id: number | string) => void;
  onReorder: (orderedIds: Array<number | string>) => void;
  onPrimaryChange: (id: number | string, nextValue: string) => void;
  /** Render the body controls for each item. */
  renderBody: (item: LayerStackItem) => ReactNode;
  /** Hide the title + palette row (used when an outer wrap renders its
   *  own head — see speech-balloons Tails panel). */
  hideHead?: boolean;
}

export function LayerStack({
  title,
  items,
  paletteKinds,
  onAdd,
  onRemove,
  onReorder,
  onPrimaryChange,
  renderBody,
  hideHead,
}: LayerStackProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number | string>>(
    () => new Set(items.filter((i) => i.defaultExpanded !== false).map((i) => i.id)),
  );

  const dragItems = items.map((it) => ({ id: String(it.id), label: it.kind }));
  const drag = useReorderDragList({
    items: dragItems,
    selectedIds: [],
    onReorder: (ids, targetIndex) => {
      const orig = items.map((i) => i.id);
      const moving = new Set(ids);
      const remaining = orig.filter((id) => !moving.has(String(id)));
      const movedIds = items
        .map((i) => i.id)
        .filter((id) => moving.has(String(id)));
      const out = [...remaining];
      out.splice(targetIndex, 0, ...movedIds);
      onReorder(out);
    },
  });

  const toggleExpanded = (id: number | string) => {
    setExpandedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  return (
    <div className="lk-layer-stack">
      {!hideHead && (
        <div className="lk-layer-stack__head">
          <h2 className="lk-layer-stack__title">{title}</h2>
          <div className="lk-layer-stack__palette">
            {paletteKinds.map((k) => (
              <button
                key={k}
                type="button"
                className="lk-layer-stack__add"
                onClick={() => onAdd(k)}
                aria-label={`Add ${k}`}
              >
                + {k}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="lk-layer-stack__list" {...drag.containerProps}>
        {items.map((item, i) => {
          const expanded = expandedIds.has(item.id);
          const draggedId = drag.state.draggedIds?.[0];
          const isDragging = draggedId === String(item.id);
          const showHintBefore = drag.state.targetIndex === i && draggedId !== String(item.id);
          const showHintAfter = drag.state.targetIndex === items.length && i === items.length - 1;
          const cardCls = [
            'lk-layer-card',
            expanded ? 'is-expanded' : 'is-collapsed',
            isDragging ? 'is-dragging' : '',
            item.accent ? 'has-accent' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const cardStyle = item.accent
            ? ({ '--lk-layer-card-accent': item.accent } as CSSProperties)
            : undefined;
          const { onPointerDown } = drag.rowProps(String(item.id), i);
          return (
            <div key={item.id} className="lk-layer-card-wrap">
              {showHintBefore && <div className="lk-layer-stack__drop-hint" />}
              <div
                className={cardCls}
                data-testid={`lk-layer-card-${item.id}`}
                style={cardStyle}
              >
                <div className="lk-layer-card__head">
                  <button
                    type="button"
                    className="lk-layer-card__handle"
                    aria-label={`Drag to reorder layer ${item.id}`}
                    onPointerDown={onPointerDown}
                    onClick={() => toggleExpanded(item.id)}
                  >
                    {item.badge ?? <DragHandleGlyph />}
                  </button>
                  {item.primaryValue !== undefined && item.primaryOptions ? (
                    <select
                      className="lk-layer-card__primary"
                      value={item.primaryValue}
                      aria-label={`Primary select for layer ${item.id}`}
                      onChange={(e) => onPrimaryChange(item.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.primaryOptions.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="lk-layer-card__kind">{item.kind}</span>
                  )}
                  <button
                    type="button"
                    className="lk-layer-card__remove"
                    aria-label="Remove layer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(item.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
                {expanded && <div className="lk-layer-card__body">{renderBody(item)}</div>}
              </div>
              {showHintAfter && <div className="lk-layer-stack__drop-hint" />}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="lk-layer-stack__empty">No layers — add one above.</div>
        )}
      </div>
    </div>
  );
}

function DragHandleGlyph() {
  return (
    <svg width="12" height="16" viewBox="0 0 8 16" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="3" r="1.1" />
      <circle cx="6" cy="3" r="1.1" />
      <circle cx="2" cy="8" r="1.1" />
      <circle cx="6" cy="8" r="1.1" />
      <circle cx="2" cy="13" r="1.1" />
      <circle cx="6" cy="13" r="1.1" />
    </svg>
  );
}
```

- [ ] **Step 4: Add styles**

Create `~/src/labkit/src/ui/layers/LayerStack.less`:

```less
.lk-layer-stack {
  display: grid;
  gap: 8px;
}

.lk-layer-stack__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lk-layer-stack__title {
  margin: 0;
  font-family: var(--lk-font-display);
  font-weight: var(--lk-font-weight-light, 300);
  font-size: 1rem;
  color: var(--lk-text);
}

.lk-layer-stack__palette {
  display: flex;
  gap: 4px;
}

.lk-layer-stack__add {
  background: transparent;
  border: 1px dashed var(--lk-border);
  border-radius: var(--lk-radius-sm, 6px);
  padding: 2px 8px;
  font-size: 0.78rem;
  color: var(--lk-text-dim);
  cursor: pointer;
}

.lk-layer-stack__add:hover {
  background: var(--lk-bg-elevated);
  color: var(--lk-text);
}

.lk-layer-stack__list {
  display: grid;
  gap: 6px;
}

.lk-layer-stack__drop-hint {
  height: 2px;
  background: var(--lk-accent, #6cf);
  border-radius: 1px;
}

.lk-layer-stack__empty {
  color: var(--lk-text-dim);
  font-size: 0.85rem;
  padding: 8px;
  text-align: center;
}

.lk-layer-card {
  background: var(--lk-bg-elevated);
  border: 1px solid var(--lk-border);
  border-radius: var(--lk-radius-md, 8px);
  overflow: hidden;
}

.lk-layer-card.has-accent {
  border-left: 3px solid var(--lk-layer-card-accent);
}

.lk-layer-card.is-dragging {
  opacity: 0.5;
}

.lk-layer-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
}

.lk-layer-card__handle {
  background: transparent;
  border: 0;
  color: var(--lk-text-dim);
  padding: 2px 4px;
  cursor: grab;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  border-radius: var(--lk-radius-sm, 6px);
  font-weight: 600;
  font-size: 0.85rem;
}

.lk-layer-card.has-accent .lk-layer-card__handle {
  background: var(--lk-layer-card-accent);
  color: white;
}

.lk-layer-card__handle:active {
  cursor: grabbing;
}

.lk-layer-card__kind,
.lk-layer-card__primary {
  flex: 1;
  font-size: 0.9rem;
}

.lk-layer-card__primary {
  background: transparent;
  border: 0;
  color: var(--lk-text);
}

.lk-layer-card__remove {
  background: transparent;
  border: 0;
  color: var(--lk-text-dim);
  font-size: 1rem;
  cursor: pointer;
  padding: 2px 6px;
}

.lk-layer-card__remove:hover {
  color: var(--lk-text);
}

.lk-layer-card__body {
  padding: 8px;
  border-top: 1px solid var(--lk-border);
}
```

- [ ] **Step 5: Index file**

Create `~/src/labkit/src/ui/layers/index.ts`:

```ts
export { LayerStack, type LayerStackProps, type LayerStackItem } from './LayerStack';
```

- [ ] **Step 6: Wire styles, build entry, and package export**

Append to `~/src/labkit/src/styles.less`:

```less
@import './ui/layers/LayerStack.less';
```

Edit `~/src/labkit/tsup.config.ts` `entry`:

```ts
'ui/layers/index': 'src/ui/layers/index.ts',
```

Edit `~/src/labkit/package.json` `exports` — add:

```json
"./ui/layers": {
  "types": "./dist/ui/layers/index.d.ts",
  "import": "./dist/ui/layers/index.js"
}
```

- [ ] **Step 7: Run test, see it pass**

```bash
cd ~/src/labkit && npx vitest run src/ui/layers/LayerStack.test.tsx 2>&1 | tail -15
```

Expected: 5 passed.

- [ ] **Step 8: Storybook story**

Create `~/src/labkit/src/ui/layers/LayerStack.stories.tsx`:

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { LayerStack, type LayerStackItem } from './LayerStack';

const meta: Meta<typeof LayerStack> = {
  title: 'UI/Layers/LayerStack',
  component: LayerStack,
};
export default meta;

const seed: LayerStackItem[] = [
  { id: 1, kind: 'fill', primaryValue: 'dome', primaryOptions: ['aqua', 'bevel', 'dome'] },
  { id: 2, kind: 'tail', accent: '#f55', badge: '1' },
  { id: 3, kind: 'shadow' },
];

export const Basic: StoryObj<typeof LayerStack> = {
  render: () => {
    const [items, setItems] = useState(seed);
    let next = 4;
    return (
      <div style={{ width: 320 }}>
        <LayerStack
          title="Layers"
          items={items}
          paletteKinds={['fill', 'tail', 'shadow']}
          onAdd={(kind) => setItems([...items, { id: next++, kind }])}
          onRemove={(id) => setItems(items.filter((i) => i.id !== id))}
          onReorder={(ids) => {
            const byId = new Map(items.map((i) => [i.id, i]));
            setItems(ids.map((id) => byId.get(id)!).filter(Boolean));
          }}
          onPrimaryChange={(id, value) =>
            setItems(items.map((i) => (i.id === id ? { ...i, primaryValue: value } : i)))
          }
          renderBody={(item) => <div style={{ color: '#888' }}>body for {item.kind}</div>}
        />
      </div>
    );
  },
};
```

- [ ] **Step 9: Lint + build verify + commit**

```bash
cd ~/src/labkit && npm run lint && npm run build 2>&1 | tail -10
git add src/ui/layers package.json tsup.config.ts src/styles.less
git commit -m "feat(labkit): LayerStack — draggable expandable layer cards

Expandable cards with drop-hint reorder, palette '+' buttons, optional
primary-select hoist, optional accent color, optional index badge,
custom body slot. Built on weasel-ui useReorderDragList.

Distinct from <LayerList>: that's checkbox+reorder for visibility
toggling; this is full effect-stack UI for additive layered configs."
```

---

### Task A6: Top-level barrel re-exports

**Files:**
- Modify: `~/src/labkit/src/index.ts`

- [ ] **Step 1: Add re-exports for new layers package**

Edit `~/src/labkit/src/index.ts` — add:

```ts
export * from './ui/layers';
```

Note that `./ui/properties` is already re-exported by `export * from './ui/properties'` at line `export * from './ui/properties';`, so PropertyGroup and CurveField are automatically picked up.

- [ ] **Step 2: Run barrel test**

```bash
cd ~/src/labkit && npx vitest run src/index.barrel.test.ts 2>&1 | tail -20
```

Expected: passes. If a barrel test asserts on the export set, add the new symbols there.

- [ ] **Step 3: Commit**

```bash
cd ~/src/labkit && git add src/index.ts
git commit -m "feat(labkit): re-export LayerStack from package root"
```

---

### Task A7: Update labkit AGENTS docs

**Files:**
- Modify: `~/src/labkit/docs/AGENTS.md`

- [ ] **Step 1: Add table entries**

Edit `~/src/labkit/docs/AGENTS.md`. Append a new section at the bottom, before the "Conventions" section:

```markdown
### Plan 6 — Property UI extensions

| Concept | Source |
|---|---|
| `<PropertyGroup>` (subpanel grouping with `hidden`) | `src/ui/properties/PropertyGroup.tsx` |
| `<CurveField>` (1D y=f(x) curve editor) | `src/ui/properties/CurveField.tsx` |
| `<LayerStack>` (expandable layer cards w/ drop-hint reorder) | `src/ui/layers/LayerStack.tsx` |
| `<SingletonExperimentProvider>` (one-workspace state runtime) | `src/state/SingletonExperiment.tsx` |
| Weasel-ui passthroughs (`CurveEditor`, `useReorderDragList`, `formatNumber`, …) | `src/passthrough/weasel-ui.ts` (exported as `@labkit/react/weasel-ui`) |
```

- [ ] **Step 2: Commit**

```bash
cd ~/src/labkit && git add docs/AGENTS.md
git commit -m "docs(labkit): list new property/layer/state additions in AGENTS"
```

---

## Phase B — Speech-balloons cutover

All Phase B tasks happen in `~/src/experiments/speech-balloons`. Tests run with `npm test` (vitest). There is no storybook here. Visual verification uses the dev server (`npm run dev`) and the PNG snapshots in the repo root.

Before starting Phase B, confirm Phase A is committed and `~/src/labkit/dist/` is up to date (`cd ~/src/labkit && npm run build`).

### Task B1: Add @labkit/react dep, import styles, no behavior change

**Files:**
- Modify: `~/src/experiments/speech-balloons/package.json`
- Modify: `~/src/experiments/speech-balloons/src/main.tsx`

- [ ] **Step 1: Add file dep**

Edit `~/src/experiments/speech-balloons/package.json`. Under `"dependencies"`, add:

```json
"@labkit/react": "file:../../labkit"
```

- [ ] **Step 2: Install**

```bash
cd ~/src/experiments/speech-balloons && npm install
```

Expected: install succeeds.

- [ ] **Step 3: Import labkit styles**

Edit `~/src/experiments/speech-balloons/src/main.tsx` — add at the top:

```ts
import '@labkit/react/styles.css';
```

- [ ] **Step 4: Verify build + dev still works**

```bash
cd ~/src/experiments/speech-balloons && npm run build 2>&1 | tail -10
```

Expected: build succeeds. Lab renders identically — no labkit components consumed yet, only its styles loaded (which may add some token CSS vars at root scope; should be visually inert).

- [ ] **Step 5: Commit**

```bash
cd ~/src/experiments/speech-balloons && git add package.json package-lock.json src/main.tsx
git commit -m "speech-balloons: depend on @labkit/react, import styles

Establishes the file dep into ../../labkit. No component swaps yet.
Loads labkit's CSS tokens at root so subsequent swaps inherit
--lk-* variables without re-declaring them."
```

---

### Task B2: Swap SliderField, ColorField, ControlList → labkit equivalents

**Files:**
- Modify: `~/src/experiments/speech-balloons/src/Lab.tsx`

- [ ] **Step 1: Replace renderControl + ControlList with labkit imports**

Edit `~/src/experiments/speech-balloons/src/Lab.tsx`. At the top imports, add:

```ts
import {
  PropertyList,
  PropertyPanel,
  PropertyGroup,
  SliderRow,
  ColorRow,
  SelectRow,
  CheckboxRow,
} from '@labkit/react';
```

Locate `function renderControl(...)` (around line 1040) and `function ControlList(...)` (around line 1124). Replace them with this single new `ControlList` implementation:

```tsx
function ControlList({ controls, params, onChange, bodyW, bodyH }: ControlListProps) {
  type Group = { header: string | null; hidden?: boolean; items: LabControl[] };
  const groups: Group[] = [{ header: null, items: [] }];
  for (const c of controls) {
    if (c.kind === 'header') {
      groups.push({ header: c.label, hidden: c.hideWhen?.(params), items: [] });
    } else {
      groups[groups.length - 1].items.push(c);
    }
  }
  return (
    <>
      {groups.map((g, gi) => {
        const visible = g.items.filter((c) => !c.hideWhen || !c.hideWhen(params));
        if (visible.length === 0) return null;
        const rows = visible.map((c) => renderRow(c, params, onChange, bodyW, bodyH));
        if (g.header === null) return rows;
        return (
          <PropertyGroup key={`grp-${gi}`} title={g.header} hidden={g.hidden}>
            {rows}
          </PropertyGroup>
        );
      })}
    </>
  );
}

function renderRow(
  c: LabControl,
  params: ParamBag,
  onChange: (key: string, value: ParamValue) => void,
  bodyW?: number,
  bodyH?: number,
): React.ReactNode {
  if (c.kind === 'header') return null;
  const label = c.label ?? c.key;
  const value = params[c.key];
  if (c.kind === 'range') {
    const dynMax = c.maxFn && bodyW !== undefined && bodyH !== undefined
      ? c.maxFn({ W: bodyW, H: bodyH })
      : c.max;
    const clampedValue = Math.min(Number(value ?? c.default), dynMax);
    return (
      <SliderRow
        key={c.key}
        label={label}
        value={clampedValue}
        min={c.min}
        max={dynMax}
        step={c.step}
        format={c.format}
        unit={c.unit === '°' ? <sup>°</sup> : c.unit}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  }
  if (c.kind === 'select') {
    return (
      <SelectRow
        key={c.key}
        label={label}
        value={String(value ?? c.default)}
        options={c.options.map((o) => ({ value: o, label: o }))}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  }
  if (c.kind === 'color') {
    const cur = String(value ?? c.default);
    const alphaSupported = c.alpha === true;
    const { rgb, alpha } = splitColor(cur);
    return (
      <ColorRow
        key={c.key}
        label={label}
        value={rgb}
        alpha={alphaSupported ? alpha : 1}
        alphaDisabled={!alphaSupported}
        onChange={(nextRgb, nextAlpha) =>
          onChange(c.key, combineColor(nextRgb, alphaSupported ? nextAlpha : 1))
        }
      />
    );
  }
  if (c.kind === 'toggle') {
    return (
      <CheckboxRow
        key={c.key}
        label={label}
        value={Boolean(value ?? c.default)}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  }
  if (c.kind === 'curve') {
    const arr = Array.isArray(value) ? (value as number[]) : c.defaults;
    return (
      <CurveBlock
        key={c.key}
        label={c.label}
        values={arr}
        min={c.min}
        max={c.max}
        step={c.step}
        onChange={(vals) => onChange(c.key, vals)}
      />
    );
  }
  // text fallthrough
  return (
    <SliderRow
      key={c.key}
      label={label}
      value={Number(value ?? 0)}
      min={0}
      max={1}
      step={0.01}
      onChange={() => {}}
    />
  );
}
```

Note: `SliderRow.onChange` is `(next: number) => void` — labkit handles the en-dash and editable readout internally via its `EditableReadout`. The local `SliderField` and `ColorField` definitions (lines ~875–1202) are now dead code; delete them.

Also delete the local `Section` helper if it's only used for header-style grouping (PropertyGroup now does that work). Sections wrapping the Body panel (lines 423–484) should be replaced by `<PropertyPanel>` + `<PropertyList>` wrapping the body controls. Concretely, find the Body `<Section headerNode=…>` block in the left aside and rewrite it:

```tsx
<PropertyPanel title="Body">
  <PropertyList>
    <SelectRow
      label="Shape"
      value={design.base}
      options={BASE_KINDS.map((b) => ({ value: b, label: b }))}
      onChange={(v) => setBase(v as BalloonBase)}
    />
    <ControlList controls={BASE_CONTROLS[design.base]} params={design.baseParams} onChange={updateBaseParam} />
    {runtime.fitToContent ? (
      <>
        <SliderRow label="Pad X" value={design.padX} min={4} max={80} step={1} unit="px"
          onChange={(v) => setDesign((d) => ({ ...d, padX: v }))} />
        <SliderRow label="Pad Y" value={design.padY} min={4} max={60} step={1} unit="px"
          onChange={(v) => setDesign((d) => ({ ...d, padY: v }))} />
      </>
    ) : (
      <>
        <SliderRow label="Width" value={design.width} min={60} max={500} step={2} unit="px"
          onChange={(v) => setDesign((d) => {
            const ar = d.width / d.height;
            return { ...d, width: v, height: Math.max(20, Math.round(v / ar)) };
          })} />
        <SliderRow label="Height" value={design.height} min={20} max={500} step={2} unit="px"
          onChange={(v) => setDesign((d) => ({ ...d, height: v }))} />
      </>
    )}
    <SliderRow label="Italic lean" value={design.lean} min={-25} max={25} step={0.5} unit={<sup>°</sup>}
      onChange={(v) => setDesign((d) => ({ ...d, lean: v }))} />
    <ColorRow
      label="Text color"
      value={splitColor(design.textColor).rgb}
      alpha={splitColor(design.textColor).alpha}
      onChange={(rgb, a) => setDesign((d) => ({ ...d, textColor: combineColor(rgb, a) }))}
    />
  </PropertyList>
</PropertyPanel>
```

Confirm `splitColor` and `combineColor` (lines ~1157–1167) stay — they're still used.

Replace the toolbar `SliderField` (line ~369) and `ColorField` (line ~396) with `SliderRow` and `ColorRow` too, using the same prop shape.

- [ ] **Step 2: Verify tests still pass**

```bash
cd ~/src/experiments/speech-balloons && npm test 2>&1 | tail -15
```

Expected: passes (geometry tests are untouched; no UI tests exist yet).

- [ ] **Step 3: Visual check against snapshots**

```bash
cd ~/src/experiments/speech-balloons && npm run dev &
```

Open the dev URL, exercise: every slider's readout, en-dash on negative values (e.g. Italic lean = −25°), `°`/`px` units, every color field (text color, base, etc.), the alpha gate on bg / textColor, subpanel headers (Fill → Aqua/Bevel/Dome), conditional visibility (switching fill `mode` hides/shows the right group). Compare to `bubbles-current.png`, `pivot-multiply-balloon.png`, `mat-plateau.png`.

Kill the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/Lab.tsx
git commit -m "speech-balloons: swap local fields for @labkit/react PropertyPanel

Replaces local SliderField, ColorField, Section, ControlList, renderControl
with labkit's PropertyPanel/PropertyList/PropertyGroup/SliderRow/ColorRow/
SelectRow/CheckboxRow. Conditional-visibility (hideWhen) and dynamic-max
(maxFn) wired through. ~350 LOC removed from Lab.tsx."
```

---

### Task B3: Swap local LayerStack/EffectCard → labkit LayerStack

**Files:**
- Modify: `~/src/experiments/speech-balloons/src/Lab.tsx`

- [ ] **Step 1: Replace local LayerStack with labkit consumption**

Edit `~/src/experiments/speech-balloons/src/Lab.tsx`. Add import:

```ts
import { LayerStack as KitLayerStack, type LayerStackItem } from '@labkit/react';
```

Locate the local `LayerStack` (lines 611–708) and `EffectCard` (lines 727–860) functions. Replace ALL three current `<LayerStack>` call sites (Morph, Fill, Tails) with calls to `KitLayerStack`. Example for the Tails panel:

```tsx
{(() => {
  const items: LayerStackItem[] = rightEffects.map((eff) => {
    const allControls = EFFECT_CONTROLS[eff.kind];
    const firstNonHeader = allControls.find((c) => c.kind !== 'header');
    const primary = firstNonHeader && firstNonHeader.kind === 'select' ? firstNonHeader : null;
    return {
      id: eff.id,
      kind: eff.kind,
      primaryValue: primary ? String(eff.params[primary.key] ?? primary.default) : undefined,
      primaryOptions: primary ? primary.options : undefined,
      accent: eff.kind === 'tail' ? tailColor(tailColorSlotById.get(eff.id) ?? 0) : undefined,
      badge: eff.kind === 'tail' ? String((tailIndexById.get(eff.id) ?? 0) + 1) : undefined,
    };
  });
  const orderedReorder = (ids: Array<number | string>) => {
    // Apply only to the Tails subset; other effects keep their order.
    setDesign((d) => {
      const moved = ids as number[];
      const otherEffects = d.effects.filter((e) => !RIGHT_PANEL_EFFECTS.includes(e.kind));
      const byId = new Map(d.effects.map((e) => [e.id, e]));
      const nextTails = moved.map((id) => byId.get(id)!).filter(Boolean);
      return { ...d, effects: [...otherEffects, ...nextTails] };
    });
  };
  return (
    <KitLayerStack
      title="Tails"
      hideHead
      items={items}
      paletteKinds={RIGHT_PANEL_EFFECTS}
      onAdd={(k) => addEffect(k as EffectKind)}
      onRemove={(id) => removeEffect(id as number)}
      onReorder={orderedReorder}
      onPrimaryChange={(id, value) => {
        const eff = rightEffects.find((e) => e.id === id);
        const primaryKey = eff && EFFECT_CONTROLS[eff.kind].find((c) => c.kind !== 'header' && c.kind === 'select');
        if (primaryKey && 'key' in primaryKey) updateEffectParam(id as number, primaryKey.key, value);
      }}
      renderBody={(item) => {
        const eff = rightEffects.find((e) => e.id === item.id)!;
        const allControls = EFFECT_CONTROLS[eff.kind];
        const firstNonHeader = allControls.find((c) => c.kind !== 'header');
        const primary = firstNonHeader && firstNonHeader.kind === 'select' ? firstNonHeader : null;
        const bodyControls = primary
          ? allControls.filter((c) => !('key' in c) || c.key !== primary.key)
          : allControls;
        return (
          <ControlList
            controls={bodyControls}
            params={eff.params}
            onChange={(k, v) => updateEffectParam(eff.id, k, v)}
          />
        );
      }}
    />
  );
})()}
```

Repeat the pattern for the Morph and Fill stacks, dropping the tail-specific `accent`/`badge` (return `undefined` for those fields). Reorder handler for Morph/Fill keeps the same subset-only behavior — only reorder within that kind set.

After all three call sites are switched, delete the local `LayerStack`, `LayerStackHead`, `EffectCard`, and `DragHandleIcon` functions (lines 595–860 and 1204–1215 respectively).

- [ ] **Step 2: Visual check**

```bash
cd ~/src/experiments/speech-balloons && npm run dev &
```

Confirm:
- Each layer card expands/collapses on click.
- Dragging the handle reorders within the same panel, with the drop-hint line showing.
- Tail cards show the colored numeric badge (1, 2, 3) and the same accent on the left border.
- Removing a tail decrements the next-tail-up's index correctly.
- Adding a layer via "+" buttons in the panel header works.

Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/Lab.tsx
git commit -m "speech-balloons: swap local LayerStack/EffectCard for @labkit/react LayerStack

Removes ~265 LOC of bespoke card/drag/drop-hint code. Tail accent
color + index badge preserved via LayerStackItem.accent + .badge."
```

---

### Task B4: Swap CurveField + delete local CurveEditor

**Files:**
- Modify: `~/src/experiments/speech-balloons/src/Lab.tsx`
- Delete: `~/src/experiments/speech-balloons/src/CurveEditor/`

- [ ] **Step 1: Use labkit CurveField**

Edit `~/src/experiments/speech-balloons/src/Lab.tsx`. Replace the local `CurveField` function (lines 952–1031) and the `CurveBlock` reference. Import:

```ts
import { CurveField as KitCurveField } from '@labkit/react';
```

Define a small wrapper to keep the ResizeObserver-driven width measurement:

```tsx
interface CurveBlockProps {
  label?: string;
  values: number[];
  min: number;
  max: number;
  step: number;
  onChange: (vals: number[]) => void;
}
function CurveBlock({ label, values, min, max, step, onChange }: CurveBlockProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div className="sb-curve-block" ref={wrapRef}>
      {label && <h3 className="sb-curve-label">{label}</h3>}
      {width > 0 && (
        <KitCurveField values={values} min={min} max={max} step={step} width={width} onChange={onChange} />
      )}
    </div>
  );
}
```

The `curve-label` and `curve-block` CSS classes get the `sb-` prefix (renamed from labkit-style to indicate they're SB-local).

- [ ] **Step 2: Delete local CurveEditor directory**

```bash
cd ~/src/experiments/speech-balloons && rm -rf src/CurveEditor
```

Verify no remaining imports:

```bash
grep -rn "from './CurveEditor" src/ 2>&1
```

Expected: no output.

- [ ] **Step 3: Update CSS class names in styles.css**

In `~/src/experiments/speech-balloons/src/styles.css`, find `.curve-block`, `.curve-label`, `.curve-editor-host`, `.curve-readouts`, `.curve-stop-readout`, `.curve-flip-btn` — rename `curve-block` to `sb-curve-block` and `curve-label` to `sb-curve-label`; delete the other four (now handled by labkit).

- [ ] **Step 4: Test + dev check**

```bash
cd ~/src/experiments/speech-balloons && npm test 2>&1 | tail -10
npm run dev &
```

Confirm: contour curve editor renders for fill (mode=bevel or dome), drag/add/delete behave, flip button works.

- [ ] **Step 5: Commit**

```bash
git add -A src/Lab.tsx src/styles.css
git rm -r src/CurveEditor
git commit -m "speech-balloons: swap local CurveEditor for @labkit/react CurveField

Drops 612 LOC (local CurveEditor + PointPlotter + CurveField wrapper).
Width-tracking wrapper kept locally since CurveField takes width as a
prop; the ResizeObserver is the consumer's job."
```

---

### Task B5: Adopt SingletonExperimentProvider + labkit undo

**Files:**
- Modify: `~/src/experiments/speech-balloons/src/Lab.tsx`
- Modify: `~/src/experiments/speech-balloons/src/main.tsx`
- Delete: `~/src/experiments/speech-balloons/src/persistence.ts`
- Create: `~/src/experiments/speech-balloons/src/useUndoShortcut.ts`

- [ ] **Step 1: Local `useUndoShortcut` hook**

Create `~/src/experiments/speech-balloons/src/useUndoShortcut.ts`:

```ts
import { useEffect } from 'react';

export function useUndoShortcut({ undo, redo }: { undo: () => void; redo: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
}
```

- [ ] **Step 2: Restructure main.tsx to mount SingletonExperimentProvider (with storage migration)**

Edit `~/src/experiments/speech-balloons/src/main.tsx`:

```tsx
import '@labkit/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SingletonExperimentProvider, localStorageAdapter } from '@labkit/react';
import { Lab } from './Lab';
import { initialDesign, initialRuntime } from './initialState';
import './styles.css';

const STORAGE_KEY = 'speech-balloon-lab-v12';
const NEW_WORKSPACES_KEY = `${STORAGE_KEY}:workspaces`;

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
```

Create `~/src/experiments/speech-balloons/src/initialState.ts` carved out of the old `persistence.ts`:

```ts
import { BASE_CONTROLS, EFFECT_CONTROLS, defaultParams } from './controls';
import type { DesignState, RuntimeState } from './types';

export function initialDesign(): DesignState & { effects: typeof initialEffects; nextId: number } {
  return {
    base: 'rectangle',
    baseParams: defaultParams(BASE_CONTROLS.rectangle),
    effects: initialEffects(),
    width: 280,
    height: 140,
    padX: 24,
    padY: 18,
    lean: 0,
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
    zoom: 1.2,
  };
}

function initialEffects() {
  return [
    { id: 1, kind: 'fill' as const,   params: defaultParams(EFFECT_CONTROLS.fill) },
    { id: 2, kind: 'tail' as const,   params: defaultParams(EFFECT_CONTROLS.tail) },
    { id: 3, kind: 'shadow' as const, params: defaultParams(EFFECT_CONTROLS.shadow) },
  ];
}
```

Update `~/src/experiments/speech-balloons/src/types.ts` to fold `nextId` into `DesignState` (so it's part of the persisted `config`):

```ts
export interface DesignState {
  base: BalloonBase;
  baseParams: ParamBag;
  effects: EffectInstance[];
  width: number;
  height: number;
  padX: number;
  padY: number;
  lean: number;
  textColor: string;
  bg: string;
  nextId: number;
}
```

Delete `LabSnapshot` (unused after the cut). `RuntimeState` is unchanged.

- [ ] **Step 3: Refactor Lab.tsx to consume useExperimentState**

In `~/src/experiments/speech-balloons/src/Lab.tsx`:

Replace the imports:

```ts
import { useExperimentState, useLabStore } from '@labkit/react';
import { pushSnapshot, undo as undoStackOp, redo as redoStackOp, emptyStack } from '@labkit/react/undo';
import { useUndoShortcut } from './useUndoShortcut';
```

Replace the top of the `Lab` function — delete:

- the `loadSnapshot` / `saveSnapshot` / `initialSnapshot` calls
- the manual `undoRef` / `redoRef` / `applySnapshot` / `undo` / `redo` / `forceRerender` machinery
- the `useEffect` that calls `saveSnapshot`
- the `useEffect` that registers the keydown handler

Replace with:

```tsx
const { config: design, state: runtime, setConfig, setState } = useExperimentState<RuntimeState, DesignState>();
const store = useLabStore();
const updateUndo = store.updateWorkspaceUndoStack;

const setDesign: React.Dispatch<React.SetStateAction<DesignState>> = (next) => {
  const nextDesign = typeof next === 'function' ? (next as (d: DesignState) => DesignState)(design) : next;
  // setConfig is per-key; replace the whole config by iterating top-level keys.
  for (const k of Object.keys(nextDesign) as (keyof DesignState)[]) {
    if ((design as Record<string, unknown>)[k] !== (nextDesign as Record<string, unknown>)[k]) {
      setConfig(k, (nextDesign as Record<string, keyof DesignState[keyof DesignState]>)[k] as never);
    }
  }
};

const setRuntime: React.Dispatch<React.SetStateAction<RuntimeState>> = (next) => {
  const nextRuntime = typeof next === 'function' ? (next as (r: RuntimeState) => RuntimeState)(runtime) : next;
  setState(nextRuntime);
};

// Debounced undo snapshot: 300ms after the last change.
const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const isRestoringRef = useRef(false);
useEffect(() => {
  if (isRestoringRef.current) {
    isRestoringRef.current = false;
    return;
  }
  if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
  snapTimerRef.current = setTimeout(() => {
    updateUndo('balloon', (prev) => pushSnapshot(prev ?? emptyStack(), { design, runtime }, 200));
  }, 300);
}, [design, runtime, updateUndo]);

const undo = useCallback(() => {
  const ws = store.workspaces.find((w) => w.id === 'balloon');
  if (!ws) return;
  const result = undoStackOp(ws.undoStack, { design, runtime });
  if (!result) return;
  isRestoringRef.current = true;
  const snap = result.snapshot as { design: DesignState; runtime: RuntimeState };
  setDesign(snap.design);
  setRuntime(snap.runtime);
  updateUndo('balloon', result.stack);
}, [design, runtime, store.workspaces, updateUndo]);

const redo = useCallback(() => {
  const ws = store.workspaces.find((w) => w.id === 'balloon');
  if (!ws) return;
  const result = redoStackOp(ws.undoStack, { design, runtime });
  if (!result) return;
  isRestoringRef.current = true;
  const snap = result.snapshot as { design: DesignState; runtime: RuntimeState };
  setDesign(snap.design);
  setRuntime(snap.runtime);
  updateUndo('balloon', result.stack);
}, [design, runtime, store.workspaces, updateUndo]);

useUndoShortcut({ undo, redo });
```

Replace `addEffect`, `removeEffect`, etc. to read `nextId` from `design.nextId` instead of the deleted state hook:

```tsx
const addEffect = (kind: EffectKind, overrides?: ParamBag) => {
  const params = { ...defaultParams(EFFECT_CONTROLS[kind]), ...(overrides ?? {}) };
  // …tail color-slot derivation unchanged…
  const inst: EffectInstance = { id: design.nextId, kind, params };
  setDesign((d) => ({ ...d, effects: [...d.effects, inst], nextId: d.nextId + 1 }));
  setExpandedIds((s) => new Set(s).add(inst.id));
};
```

`resetAll` becomes:

```tsx
const resetAll = () => {
  if (!confirm('Reset all controls to defaults?')) return;
  localStorage.removeItem('speech-balloon-lab-v12:workspaces');
  window.location.reload();
};
```

(Hard reload is the simplest way; the SingletonExperimentProvider seeds from `initialConfig` when storage is empty.)

- [ ] **Step 4: Delete persistence.ts**

```bash
cd ~/src/experiments/speech-balloons && rm src/persistence.ts
```

Update imports in `Lab.tsx`: remove `import { loadSnapshot, saveSnapshot, LAB_STORAGE_KEY } from './persistence';` and replace any `LAB_STORAGE_KEY` reference with the inline string `'speech-balloon-lab-v12:workspaces'`.

- [ ] **Step 5: Verify test + dev**

```bash
cd ~/src/experiments/speech-balloons && npm test 2>&1 | tail -10
npm run dev &
```

Confirm:
- Lab loads with previously persisted state (if any) or default state. If an old `localStorage['speech-balloon-lab-v12']` entry existed before, it's been lifted into `speech-balloon-lab-v12:workspaces` and the bare key removed.
- Adjusting any control persists across reload.
- ⌘Z / ⌘⇧Z work.
- Reset confirms then resets.

To prove the migration works, run this in the browser console before installing the cutover (i.e., on the still-old version), then reload after the cutover:

```js
// Inspect what's there pre-migration:
localStorage.getItem('speech-balloon-lab-v12')

// Post-migration, the bare key should be gone and the new key populated:
localStorage.getItem('speech-balloon-lab-v12')              // null
localStorage.getItem('speech-balloon-lab-v12:workspaces')   // array with one workspace
```

- [ ] **Step 6: Commit**

```bash
git add -A
git rm src/persistence.ts
git commit -m "speech-balloons: adopt labkit state runtime + undo primitives

Replaces the local snapshot/undo/persistence machinery with
SingletonExperimentProvider + useExperimentState + labkit's pushSnapshot/
undo/redo primitives. Storage key migrates to the labkit shape
('speech-balloon-lab-v12:workspaces') — old localStorage entries
under the bare key are ignored and re-seeded from defaults."
```

---

### Task B6: Wrap in LabShell, trim styles, rename to sb-*

**Files:**
- Modify: `~/src/experiments/speech-balloons/src/Lab.tsx`
- Modify: `~/src/experiments/speech-balloons/src/styles.css`

- [ ] **Step 1: Wrap in LabShell**

Edit `~/src/experiments/speech-balloons/src/Lab.tsx`. Wrap the JSX root:

```tsx
return (
  <LabShell
    title="I'll take 'Balloons' for $600, Alex"
    header={
      <div className="sb-toolbar-actions">
        {/* keep the existing right-side action buttons here */}
      </div>
    }
  >
    <div className="sb-workspace">
      {/* keep the existing main grid */}
    </div>
  </LabShell>
);
```

The top toolbar's left-side fields (Font / Size / Text / Background) stay inside `.sb-workspace` (or move to LabShell's header — your call; spec says header). The right-side buttons (Undo / Redo / Export / Download / Reset) become the `LabShell` header content.

Add import:

```ts
import { LabShell } from '@labkit/react';
```

- [ ] **Step 2: Rename CSS classes to sb- prefix**

In `~/src/experiments/speech-balloons/src/styles.css`, perform these renames (use your editor's find-replace, full-word match):

| Old | New |
|---|---|
| `.lab` | `.sb-lab` (or delete — LabShell already wraps) |
| `.toolbar` | `.sb-toolbar` |
| `.workspace` | `.sb-workspace` |
| `.side-panel` | `.sb-side-panel` |
| `.preview` | `.sb-preview` |
| `.preview-stage` | `.sb-preview-stage` |
| `.zoom-bar` | `.sb-zoom-bar` |
| `.brand` | `.sb-brand` |
| `.toolbar-group` | `.sb-toolbar-group` |
| `.field` | (delete — `lk-property-row` handles this) |
| `.subpanel` | (delete — `lk-property-group` handles this) |
| `.effect-card`, `.layer-stack-*`, `.drag-handle`, etc. | (delete — replaced by `lk-layer-*`) |
| `.curve-*` | (delete — see Task B4) |

Update the matching JSX in `Lab.tsx` to use the new `sb-*` class names.

Inside `styles.css`, replace any hardcoded colors (`#1a1a2e`, `#0f1320`, etc.) with `--lk-*` tokens where labkit defines an equivalent:

- Backgrounds → `var(--lk-bg)` / `var(--lk-bg-elevated)` / `var(--lk-bg-sunken)`
- Text → `var(--lk-text)` / `var(--lk-text-dim)`
- Borders → `var(--lk-border)`

Keep balloon-specific colors (preview stage backgrounds, tail accents) as raw values — they're content, not chrome.

- [ ] **Step 3: Visual diff against the original snapshots**

```bash
cd ~/src/experiments/speech-balloons && npm run dev &
```

Spot-check against `post-cleanup-overview.png` and `final-parallax.png`. Differences in chrome are expected (LabShell adds its own header bar); the preview stage and control layout should look the same.

- [ ] **Step 4: Final test + lint**

```bash
cd ~/src/experiments/speech-balloons && npm test 2>&1 | tail -10
npm run build 2>&1 | tail -10
```

Expected: tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "speech-balloons: wrap in LabShell, trim styles, prefix sb-*

Final cutover: LabShell owns the top-level chrome (title + header
actions). Local CSS classes prefixed with sb- to keep them out of
labkit's namespace. Tokens (--lk-bg, --lk-border, --lk-text) used
where labkit's theme already provides the right value."
```

---

## Phase C — Cleanup

### Task C1: Update HANDOFF + TODO + PROJECTS index

**Files:**
- Modify: `~/src/experiments/speech-balloons/HANDOFF.md`
- Modify: `~/src/experiments/speech-balloons/TODO.md`
- Modify: `~/src/PROJECTS.md`

- [ ] **Step 1: Refresh HANDOFF**

Edit `~/src/experiments/speech-balloons/HANDOFF.md`. Update the "Architecture" / "Where things live" section to point at `@labkit/react` for chrome, controls, layers, curve editor, and state. Note that `persistence.ts` and `src/CurveEditor/` are gone.

- [ ] **Step 2: Resolve TODOs that the port addressed**

Edit `~/src/experiments/speech-balloons/TODO.md`. Mark resolved any item that the port took care of. If TODO mentions UI rewrites or labkit, mark them done.

- [ ] **Step 3: Update PROJECTS index**

Edit `~/src/PROJECTS.md`. Update the `experiments` entry — no change needed for the index itself, but consider adding a `speech-balloons` sub-bullet noting it's a labkit consumer.

- [ ] **Step 4: Commit**

```bash
cd ~/src/experiments/speech-balloons && git add HANDOFF.md TODO.md
cd ~/src && git add PROJECTS.md
cd ~/src/experiments && git commit -m "docs(speech-balloons): refresh handoff/todo post-labkit port"
cd ~/src && git -C ../home || git commit -m "docs(projects): note speech-balloons is a labkit consumer"
```

(If `~/src/PROJECTS.md` isn't in git, skip the third commit and just save the file.)

---

## Self-Review Checklist

After Phase A and Phase B commits are landed, run through this:

- [ ] Lint clean: `cd ~/src/labkit && npm run lint` and `cd ~/src/experiments/speech-balloons && npx tsc --noEmit`
- [ ] Tests pass: both repos `npm test`
- [ ] Storybook builds: `cd ~/src/labkit && npm run build-storybook`
- [ ] Dev server: `cd ~/src/experiments/speech-balloons && npm run dev` — lab loads and persists
- [ ] Manual matrix:
  - Slider readout shows en-dash on negative values
  - Color alpha slider is disabled when the field doesn't support it
  - Switching fill `mode` shows/hides Aqua/Bevel/Dome groups
  - Adding a layer via "+" button works in each stack
  - Dragging a layer card shows the drop-hint and reorders
  - Tail card shows numeric badge + accent border
  - Removing a tail decrements next-tail's badge index
  - Tail minimap drag still updates the corresponding tail's sliders
  - Curve editor accepts drag/add/delete; flip button mirrors
  - ⌘Z / ⌘⇧Z work for any control change
  - Reset prompts and resets to defaults
  - localStorage persists across reload
  - SVG download produces a file that opens in a browser
- [ ] LOC sanity: `wc -l src/Lab.tsx` reports ≤ 500 LOC

If any item fails, file a follow-up task rather than amending past commits.
