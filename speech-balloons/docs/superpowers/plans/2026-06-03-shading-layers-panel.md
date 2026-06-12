# Shading-layers debug panel — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-sidebar panel that lists every shading element currently rendered on the balloon; clicking a row toggles a pulsing magenta highlight on that element. Dev-only, no persistence.

**Architecture:** Render-time registry. While `SpeechBalloon` is rendering its shading JSX, each tagged element pushes a `{id, label, group}` descriptor into a local array; after render the array is published to `Lab` via an `onShadingItems` callback fired in `useEffect`. `Lab` owns `highlightedShadingId` state and passes it back down; `SpeechBalloon` attaches a `shading-pulse` CSS class to the matching `data-shading-id` element. A small filter toggle hides body/bevel/aqua-gradient rows so only Lambertian/specular/rim show.

**Tech Stack:** React 18, TypeScript, SVG (no canvas), Vitest for any pure-function tests, Vite for the dev server.

**Spec:** `docs/superpowers/specs/2026-06-03-shading-layers-panel-design.md`

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/types.ts` | Add `ShadingItem` and `ShadingGroup` types | Modify |
| `src/SpeechBalloon.tsx` | Build registry while rendering; publish via `onShadingItems`; accept `highlightedShadingId`; tag elements with `data-shading-id`; apply `shading-pulse` class | Modify |
| `src/ShadingLayersPanel.tsx` | The panel itself: grouped list, filter toggle, click handlers | Create |
| `src/Lab.tsx` | Own `shadingItems`, `highlightedShadingId`, `hideNonLightSurfaces` state; mount panel below Tails; wire props into `SpeechBalloon` | Modify |
| `src/styles.css` | `.shading-pulse` keyframes + class | Modify |
| `src/ShadingLayersPanel.test.ts` | Unit test for the pure grouping/filtering helper | Create |

---

### Task 1: Add shading-registry types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the two types**

Append to `src/types.ts`:

```ts
export type ShadingGroup =
  | 'body'    // base body fill
  | 'dome'    // per-light dome wedges (dome mode)
  | 'brdf'    // Lambertian / specular / rim/Fresnel (BRDF mode)
  | 'aqua'    // aqua-mode body gradient + gloss
  | 'bevel';  // bevel inset path

export interface ShadingItem {
  id: string;
  label: string;
  group: ShadingGroup;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(speech-balloons): ShadingGroup + ShadingItem types for layers panel"
```

---

### Task 2: Pure grouping helper + test

A tiny pure function the panel will use to group items for display and apply the "hide non-light surfaces" filter. Unit-tested in isolation so the panel's React code stays thin.

**Files:**
- Create: `src/shadingLayers.ts`
- Create: `src/shadingLayers.test.ts`

- [ ] **Step 1: Write the failing test**

`src/shadingLayers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupShadingItems, NON_LIGHT_GROUPS } from './shadingLayers';
import type { ShadingItem } from './types';

const items: ShadingItem[] = [
  { id: 'body', label: 'Body fill', group: 'body' },
  { id: 'dome.key', label: 'Key light', group: 'dome' },
  { id: 'dome.fill', label: 'Fill light', group: 'dome' },
  { id: 'aqua.body', label: 'Aqua body', group: 'aqua' },
  { id: 'bevel', label: 'Bevel band', group: 'bevel' },
];

describe('groupShadingItems', () => {
  it('groups items by their group, preserving input order within a group', () => {
    const grouped = groupShadingItems(items, { hideNonLight: false });
    expect(grouped.map((g) => g.group)).toEqual(['body', 'dome', 'aqua', 'bevel']);
    expect(grouped.find((g) => g.group === 'dome')!.items.map((i) => i.id)).toEqual(['dome.key', 'dome.fill']);
  });

  it('hideNonLight removes body, aqua, bevel groups', () => {
    const grouped = groupShadingItems(items, { hideNonLight: true });
    expect(grouped.map((g) => g.group)).toEqual(['dome']);
  });

  it('NON_LIGHT_GROUPS contains exactly body, aqua, bevel', () => {
    expect(new Set(NON_LIGHT_GROUPS)).toEqual(new Set(['body', 'aqua', 'bevel']));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/shadingLayers.test.ts
```

Expected: FAIL — `Cannot find module './shadingLayers'`.

- [ ] **Step 3: Implement the helper**

`src/shadingLayers.ts`:

```ts
import type { ShadingGroup, ShadingItem } from './types';

export const NON_LIGHT_GROUPS: readonly ShadingGroup[] = ['body', 'aqua', 'bevel'];

export interface GroupedShading {
  group: ShadingGroup;
  items: ShadingItem[];
}

export function groupShadingItems(
  items: readonly ShadingItem[],
  opts: { hideNonLight: boolean },
): GroupedShading[] {
  const hide = new Set<ShadingGroup>(opts.hideNonLight ? NON_LIGHT_GROUPS : []);
  const out: GroupedShading[] = [];
  const byGroup = new Map<ShadingGroup, ShadingItem[]>();
  for (const item of items) {
    if (hide.has(item.group)) continue;
    let bucket = byGroup.get(item.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(item.group, bucket);
      out.push({ group: item.group, items: bucket });
    }
    bucket.push(item);
  }
  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/shadingLayers.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shadingLayers.ts src/shadingLayers.test.ts
git commit -m "feat(speech-balloons): groupShadingItems helper for layers panel"
```

---

### Task 3: Pulse CSS

**Files:**
- Modify: `src/styles.css` (append)

- [ ] **Step 1: Append the keyframes and class**

```css
/* Shading-layers debug highlight. Driven by data-shading-id on the matching
   SVG element; class added by SpeechBalloon when highlightedShadingId matches. */
@keyframes shading-pulse {
  0%, 100% { filter: drop-shadow(0 0 0 magenta); }
  50%      { filter: drop-shadow(0 0 6px magenta); }
}
.shading-pulse {
  animation: shading-pulse 1.2s ease-in-out infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(speech-balloons): pulse animation for shading-layer highlight"
```

---

### Task 4: Registry plumbing in SpeechBalloon — props + publish

Add the two new props (`onShadingItems`, `highlightedShadingId`) and the local registry array. The actual tag sites get wired up in Task 5; this task only adds the scaffolding.

**Files:**
- Modify: `src/SpeechBalloon.tsx`

- [ ] **Step 1: Import the types**

Near the existing imports at the top:

```ts
import type { ShadingItem } from './types';
```

(Keep existing imports.)

- [ ] **Step 2: Extend the `Props` interface**

Find the existing `interface Props` (search for `interface Props`) and add the two optional props at the end of the interface:

```ts
onShadingItems?: (items: ShadingItem[]) => void;
highlightedShadingId?: string | null;
```

- [ ] **Step 3: Destructure the new props**

In the function signature `export function SpeechBalloon({ design, runtime, zoom: zoomProp }: Props)`, extend the destructure:

```ts
export function SpeechBalloon({
  design,
  runtime,
  zoom: zoomProp,
  onShadingItems,
  highlightedShadingId,
}: Props) {
```

- [ ] **Step 4: Add the per-render registry and `pulseIf` helper**

Inside the component body, after the existing `useMemo`/state declarations but before the `return (` (locate the JSX `return` near line 1400+), insert:

```ts
// Render-time registry of shading elements. Each tagged JSX element calls
// `pushShading` to add itself; after this render the array is published to
// the parent via onShadingItems. Recreated every render so it always
// reflects the current mode/light/effect set.
const shadingItems: ShadingItem[] = [];
const pushShading = (item: ShadingItem): string => {
  shadingItems.push(item);
  return item.id;
};
const pulseIf = (id: string): string | undefined =>
  highlightedShadingId === id ? 'shading-pulse' : undefined;

// Publish after each render. useEffect's dep on a JSON-stringified id list
// avoids re-firing when the (always-new) array reference changes but the
// item set hasn't.
const shadingItemsKey = shadingItems.map((s) => s.id).join('|');
useEffect(() => {
  onShadingItems?.(shadingItems);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [shadingItemsKey, onShadingItems]);
```

If `useEffect` isn't already imported from React at the top of the file, add it.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (No JSX consumers yet — the registry is wired but unused, which is fine.)

- [ ] **Step 6: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): SpeechBalloon registry + highlight props (no tag sites yet)"
```

---

### Task 5: Tag each rendered shading element

Walk through the three mode branches and the aqua/bevel paths, attaching `data-shading-id` and the pulse class to every shading-relevant element.

**Files:**
- Modify: `src/SpeechBalloon.tsx`

> Site map (line numbers approximate, search the actual matches):
> - Aqua body path (~L1473)
> - Aqua gloss path (~L1474)
> - Aqua per-bubble body circle (~L1477)
> - Aqua per-bubble gloss circle (~L1479)
> - Dome base path (~L1517)
> - Dome per-light wedge paths (~L1520)
> - BRDF base path (~L1539)
> - BRDF per-layer paths (~L1586)
> - Bevel band path — search for `bevelPath` in the JSX (only under the dome-debug overlay today; if no production bevel band exists, skip this site and document below)

- [ ] **Step 1: Aqua body + gloss**

Replace the aqua block (the `<>` after `fillRender.mode === 'aqua' && (`) so each rendered element registers:

```tsx
<>
  <path
    d={bodyOnlyPath}
    fill={`url(#${aquaBodyId})`}
    data-shading-id={pushShading({ id: 'aqua.body', label: 'Aqua body gradient', group: 'aqua' })}
    className={pulseIf('aqua.body')}
  />
  {fillRender.glossStrength > 0 && (
    <path
      d={bodyOnlyPath}
      fill={`url(#${aquaGlossId})`}
      data-shading-id={pushShading({ id: 'aqua.gloss', label: 'Aqua gloss', group: 'aqua' })}
      className={pulseIf('aqua.gloss')}
    />
  )}
  {allBubbles.map((b, i) => (
    <g key={i}>
      <circle
        cx={b.cx} cy={b.cy} r={b.r}
        fill={`url(#${aquaBodyId})`}
        data-shading-id={pushShading({ id: `aqua.bubble-${i}.body`, label: `Bubble ${i + 1} body`, group: 'aqua' })}
        className={pulseIf(`aqua.bubble-${i}.body`)}
      />
      {fillRender.glossStrength > 0 && (
        <circle
          cx={b.cx} cy={b.cy} r={b.r}
          fill={`url(#${aquaGlossId})`}
          data-shading-id={pushShading({ id: `aqua.bubble-${i}.gloss`, label: `Bubble ${i + 1} gloss`, group: 'aqua' })}
          className={pulseIf(`aqua.bubble-${i}.gloss`)}
        />
      )}
    </g>
  ))}
</>
```

- [ ] **Step 2: Dome base + per-light wedges**

In the dome mode block, change the base body path to:

```tsx
<path
  d={bodyPath}
  fill={fillRender.base}
  data-shading-id={pushShading({ id: 'body', label: 'Body fill', group: 'body' })}
  className={pulseIf('body')}
/>
```

And the per-light wedge `<path>` (inside `domeLayers.map((_, i) => ...`) becomes:

```tsx
{domeLayers.map((_, i) => {
  const id = `dome.light-${i}`;
  const label = i === 0 ? 'Key light' : i === 1 ? 'Fill light' : `Light ${i + 1}`;
  return (
    <path
      key={i}
      d={bodyPath}
      fill={`url(#${idPrefix}-dome-grad-${i})`}
      clipPath={`url(#${idPrefix}-dome-clip-${i})`}
      data-shading-id={pushShading({ id, label, group: 'dome' })}
      className={pulseIf(id)}
    />
  );
})}
```

- [ ] **Step 3: BRDF base + per-layer paths**

In the BRDF mode block, the base body path becomes the same as the dome one above (same `'body'` id — both modes contribute a body row; only one is active at a time, so no collision).

```tsx
<path
  d={bodyPath}
  fill={fillRender.base}
  data-shading-id={pushShading({ id: 'body', label: 'Body fill', group: 'body' })}
  className={pulseIf('body')}
/>
```

And the per-layer `brdfLayers.map((layer) => ...)`:

```tsx
{brdfLayers.map((layer) => {
  const id = `brdf.${layer.key}`;
  return (
    <path
      key={layer.key}
      d={bodyPath}
      fill={`url(#${idPrefix}-brdf-grad-${layer.key})`}
      clipPath={`url(#${idPrefix}-brdf-clip-${layer.key})`}
      data-shading-id={pushShading({ id, label: layer.key, group: 'brdf' })}
      className={pulseIf(id)}
    />
  );
})}
```

(`layer.key` looks like `"key.diffuse"`, `"fill.specular"`, etc.; that string is fine as a label for v1.)

- [ ] **Step 4: Bevel band site check**

Search for `bevelPath` inside the JSX `return` (not inside `domeDebug` overlay — that overlay is independent and out of scope). If there is a production bevel band path, tag it as `id: 'bevel', label: 'Bevel band', group: 'bevel'`. If `bevelPath` only appears inside the dome-debug overlay (which is gated by `domeDebug`, not a regular render), skip this step — there's nothing to tag.

- [ ] **Step 5: Type-check + smoke test**

```bash
npx tsc --noEmit
npm run dev
```

In the browser, switch between dome / brdf / aqua. Open dev tools and confirm the rendered SVG body/dome/brdf/aqua paths each carry a `data-shading-id` attribute that matches the mode.

- [ ] **Step 6: Commit**

```bash
git add src/SpeechBalloon.tsx
git commit -m "feat(speech-balloons): tag shading elements with data-shading-id"
```

---

### Task 6: ShadingLayersPanel component

**Files:**
- Create: `src/ShadingLayersPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import type { ShadingItem } from './types';
import { groupShadingItems } from './shadingLayers';

interface Props {
  items: ShadingItem[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
}

export function ShadingLayersPanel({ items, highlightedId, onHighlight }: Props) {
  const [hideNonLight, setHideNonLight] = useState(false);
  const groups = groupShadingItems(items, { hideNonLight });

  return (
    <div className="sb-shading-panel">
      <header className="sb-shading-panel__head">
        <h3 className="sb-shading-panel__title">Shading layers</h3>
        <label className="sb-checkbox">
          <input
            type="checkbox"
            checked={hideNonLight}
            onChange={(e) => setHideNonLight(e.target.checked)}
          />
          <span>Hide non-light surfaces</span>
        </label>
      </header>
      {groups.length === 0 ? (
        <p className="sb-shading-panel__empty">No shading elements rendered.</p>
      ) : (
        groups.map((g) => (
          <section key={g.group} className="sb-shading-panel__group">
            <h4 className="sb-shading-panel__group-label">{g.group}</h4>
            <ul className="sb-shading-panel__list">
              {g.items.map((item) => {
                const isActive = item.id === highlightedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`sb-shading-panel__row${isActive ? ' is-active' : ''}`}
                      onClick={() => onHighlight(isActive ? null : item.id)}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Append panel styles to `src/styles.css`**

```css
.sb-shading-panel { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.sb-shading-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sb-shading-panel__title { font-size: 12px; font-weight: 600; margin: 0; }
.sb-shading-panel__group { display: flex; flex-direction: column; gap: 2px; }
.sb-shading-panel__group-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin: 4px 0 0;
}
.sb-shading-panel__list { list-style: none; padding: 0; margin: 0; }
.sb-shading-panel__row {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
  cursor: pointer;
}
.sb-shading-panel__row:hover { background: rgba(255, 255, 255, 0.05); }
.sb-shading-panel__row.is-active {
  background: rgba(255, 0, 255, 0.12);
  border-color: rgba(255, 0, 255, 0.6);
}
.sb-shading-panel__empty { font-size: 12px; opacity: 0.6; }
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ShadingLayersPanel.tsx src/styles.css
git commit -m "feat(speech-balloons): ShadingLayersPanel component + styles"
```

---

### Task 7: Wire panel into Lab

Mount the new panel under "Tails" in the right sidebar, own the shared state, plumb `onShadingItems` and `highlightedShadingId` into the `SpeechBalloon` instance.

**Files:**
- Modify: `src/Lab.tsx`

- [ ] **Step 1: Imports**

Add near the existing imports:

```ts
import { useState } from 'react'; // if not already imported
import { ShadingLayersPanel } from './ShadingLayersPanel';
import type { ShadingItem } from './types';
```

- [ ] **Step 2: State**

Inside `export function Lab()`, alongside other `useState` calls, add:

```ts
const [shadingItems, setShadingItems] = useState<ShadingItem[]>([]);
const [highlightedShadingId, setHighlightedShadingId] = useState<string | null>(null);
```

- [ ] **Step 3: Wire props on the rendered `<SpeechBalloon ... />`**

Find the `<SpeechBalloon` invocation inside `Lab.tsx` and add:

```tsx
<SpeechBalloon
  // …existing props
  onShadingItems={setShadingItems}
  highlightedShadingId={highlightedShadingId}
/>
```

- [ ] **Step 4: Mount panel under Tails**

Locate the `<aside className="sb-side-panel sb-side-panel-right">` block (around `Lab.tsx:674`). After the existing `EffectLayerStack title="Tails"` block, add:

```tsx
<ShadingLayersPanel
  items={shadingItems}
  highlightedId={highlightedShadingId}
  onHighlight={setHighlightedShadingId}
/>
```

- [ ] **Step 5: Type-check + dev smoke test**

```bash
npx tsc --noEmit
npm run dev
```

In the browser:
1. Confirm the panel appears below the Tails stack on the right.
2. Switch fill mode between aqua / dome / brdf — confirm the row set changes and that only the current mode's rows appear.
3. Click a row — confirm a pulsing magenta drop-shadow appears on the corresponding SVG element. Click the same row again — confirm it stops.
4. Toggle "Hide non-light surfaces" — confirm body/aqua/bevel rows disappear and only dome/brdf rows remain.

- [ ] **Step 6: Commit**

```bash
git add src/Lab.tsx
git commit -m "feat(speech-balloons): wire shading-layers panel below Tails"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass (no existing tests broken).

- [ ] **Step 2: Type-check the whole project**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual walk-through**

In `npm run dev`:
- Default state shows the dome rows (body + key + fill light).
- Switching to BRDF replaces dome rows with brdf rows (one per `brdfLayer.key`).
- Switching to aqua shows aqua rows (body, gloss if `glossStrength > 0`, and one row per bubble).
- Clicking a row highlights the right element. The "active" row's background turns magenta-tinted; the SVG element pulses.
- Clicking the same row again clears the highlight.
- Toggling "Hide non-light surfaces" removes body/aqua/bevel rows.
- Reloading the page clears the highlight (state is component-local, not persisted). ✓

- [ ] **Step 4: If everything passes, no further commits**

The plan is complete. The previous per-task commits cover the change set.

---

## Self-review

- **Spec coverage**: panel location (Task 7) ✓, render-time registry (Tasks 4–5) ✓, single-select toggle highlight (Task 6) ✓, pulse CSS (Task 3) ✓, hide-non-light filter (Task 6) ✓, Lab-local state (Task 7) ✓, only-current-mode (auto via registry; documented in Task 5 smoke test) ✓, no fold-in of existing debug toggles (no Task touches them) ✓.
- **Placeholder scan**: no TBD/TODO; each code step shows the exact code.
- **Type consistency**: `ShadingItem` / `ShadingGroup` defined in Task 1 used identically in Tasks 2–7. `pushShading` / `pulseIf` names consistent across Task 4 and Task 5. `onShadingItems` and `highlightedShadingId` prop names consistent across `SpeechBalloon` (Task 4), wiring (Task 7), and panel-internal `onHighlight` / `highlightedId` (Task 6).
- **Potential issue noted but not blocking:** the bevel-band site (Task 5 Step 4) is documented as "skip if not in production render". Spec lists `bevel` as a group; if `bevelPath` is debug-overlay only today, the group simply never appears in `shadingItems`, which is the correct behavior.
