# Speech Balloon Lab — handoff from the weasel Badge lab

Source repo: `~/src/weasel` (Badge component lives in
`packages/weasel-ui/src/components/Badge/`). The Badge lab is the model
to port. This handoff distills what's worth lifting and what to leave
behind.

## What you're looking at in the source

```
packages/weasel-ui/src/components/Badge/
├── Badge.tsx              # main component — picks shape-mode vs compose-mode
├── Badge.module.css       # CSS custom props for tone/edge/fill
├── types.ts               # BadgeShape | BadgeTone | BadgeVariant | BadgeSize
├── shapeControls.ts       # per-shape control descriptors that drive the lab
├── bases/                 # base silhouettes (compose-mode foundation)
├── effects/               # layered effects applied around/over the base
├── shapes/                # ~25 standalone shape primitives
│   ├── Pill.tsx           # simplest — CSS-only
│   ├── Plain.tsx          # simplest — CSS-only
│   ├── Cloud.tsx          # perimeter-pattern (good template for a tail effect)
│   ├── Scalloped.tsx      # perimeter-pattern
│   ├── Shield.tsx, Crest.tsx, Starburst.tsx, Quatrefoil.tsx, …
│   └── index.ts           # SHAPES registry (lab iterates this)
├── Badge.stories.tsx      # 107 KB — includes the lab as `ComposeLab` story
└── Badge.test.tsx
```

## The composition model

Two modes, picked by which props you set:

1. **Shape mode** — `<Badge shape="pill" shapeParams={…}>`. One
   primitive renders the entire badge. Use when there's a named, fixed
   silhouette.
2. **Compose mode** — `<Badge base="…" baseParams={…} effects={[…]}>`.
   A base silhouette + an ordered list of effects layered on top.
   Compose mode beats shape mode when both are set.

Shared props:
- `tone`, `variant`, `size`, `padding`
- `bloat` — Photoshop-style expand/contract. Every perimeter sample is
  offset N px along its outward normal before effects run.
- `breakStyle: 'slice' | 'clone'` — CSS-rendered shapes wrapping across
  lines either get sliced (one badge cut by the line) or cloned (two
  separate badges).
- `crawl` — perimeter-pattern shapes (cloud, scalloped, postage, beavis)
  shift their pattern continuously when this is on.

**For speech balloons**, the same model maps cleanly:
- **Shape mode** for fixed balloons (`'oval'`, `'rectangle'`, `'thought'`).
- **Compose mode** for the configurable ones: pick a body shape as the
  base, then a `tail` effect (with position / angle / length / style),
  optionally a `stroke` / `shadow` / `dashed-outline` effect.

The tail being an **effect** (not a base property) is the design choice
worth copying — it lets you put a tail on any base, and you can stack
multiple tails (one per character speaking).

## The lab control descriptor pattern (this is the part to port)

`Badge.stories.tsx` defines a `LabControl` union and two registries
(`BASE_LAB_CONTROLS`, `EFFECT_LAB_CONTROLS`). The lab UI is built
generically by walking those descriptors — adding a new base/effect with
a control entry gives you sliders + selects + color pickers for free.

```ts
type LabControl =
  | { key: string; kind: 'range';  min: number; max: number; step: number; default: number }
  | { key: string; kind: 'select'; options: string[]; default: string }
  | { key: string; kind: 'color';  default: string }
  | { key: string; kind: 'text';   default: string }
  | { key: string; kind: 'header'; label: string };          // visual divider, no value

const BASE_LAB_CONTROLS: Record<BadgeBase, LabControl[]> = {
  'rounded-rect':   [
    { key: 'erosion',      kind: 'range', min: 0,   max: 1, step: 0.02, default: 0.16 },
    { key: 'eccentricity', kind: 'range', min: 0.3, max: 3, step: 0.05, default: 1    },
    { key: 'pinch',        kind: 'range', min: 0,   max: 1, step: 0.02, default: 0    },
  ],
  'chamfered-rect': [{ key: 'chamfer', kind: 'range', min: 0, max: 25, step: 0.5, default: 6 }],
  // … per base
};

const EFFECT_LAB_CONTROLS: Record<BadgeEffect, LabControl[]> = {
  spikes:   [ /* count, length, baseWidth, vertScale, horzScale, irregularity */ ],
  puffs:    [ /* bumpWidth, puffiness, irregularity */ ],
  bites:    [ /* biteRadius, biteSpacing, irregularity */ ],
  scallops: [ /* scallopRadius, scallopSpacing, irregularity */ ],
  bevel:    [ /* bevelWidth, lightFrom */ ],
  sheen:    [ /* lightFrom, intensity */ ],
  shadow:   [ /* dx, dy, opacity */ ],
  // … per effect
};
```

For speech balloons, your `LabControl` set will be very similar. A
likely starting registry:

```ts
const BASE_LAB_CONTROLS = {
  'oval':       [ { key: 'eccentricity', kind: 'range', … }, { key: 'pinch', kind: 'range', … } ],
  'rounded-rect': [ { key: 'radius', kind: 'range', … } ],
  'rectangle':  [],
  'cloud':      [ { key: 'bumpiness', kind: 'range', … }, { key: 'bumpCount', kind: 'range', … } ],
  'burst':      [ { key: 'spikes', kind: 'range', … }, { key: 'spikeDepth', kind: 'range', … } ],  // shouting
};

const EFFECT_LAB_CONTROLS = {
  tail:        [
    { key: 'side',     kind: 'select', options: ['bottom', 'top', 'left', 'right'], default: 'bottom' },
    { key: 'position', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },   // along the side
    { key: 'angle',    kind: 'range', min: -45, max: 45, step: 1, default: 0 },
    { key: 'length',   kind: 'range', min: 4, max: 40, step: 0.5, default: 18 },
    { key: 'baseWidth',kind: 'range', min: 4, max: 30, step: 0.5, default: 14 },
    { key: 'curve',    kind: 'range', min: -1, max: 1, step: 0.05, default: 0 },    // straight vs hooked
    { key: 'style',    kind: 'select', options: ['solid', 'bubbles', 'dashed'], default: 'solid' },
  ],
  stroke:      [ { key: 'width', kind: 'range', … }, { key: 'color', kind: 'color', … }, { key: 'dash', kind: 'range', … } ],
  shadow:      [ { key: 'dx', kind: 'range', … }, { key: 'dy', kind: 'range', … }, { key: 'opacity', kind: 'range', … } ],
};
```

The `'bubbles'` tail style is the thought-bubble trail of shrinking
circles — model it as the tail effect with discrete bubble samples
rather than a separate "thought balloon" shape.

## Persistence + undo/redo

The lab persists to localStorage on every state change and supports
undo/redo via debounced snapshot stacks. Lift this verbatim — it's
generic.

```ts
const LAB_STORAGE_KEY = 'speech-balloon-lab-v1';   // bump on schema change

// One interface containing every piece of lab state.
interface LabSnapshot { /* base, baseParams, effects, tone, label, … */ }

// On every state change, write to localStorage.
useEffect(() => {
  const snap = currentSnapshot();
  try { localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(snap)); } catch {}
}, [/* every piece of lab state */]);

// Undo stacks live in refs, not state. Restoring a snapshot mutates
// state, but a flag prevents that from self-pushing a new entry.
const undoRef = useRef<LabSnapshot[]>([currentSnapshot()]);
const redoRef = useRef<LabSnapshot[]>([]);
const isRestoringRef = useRef(false);
const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// 300ms coalesce — a slider scrub of 100 ticks becomes ONE undo entry.
useEffect(() => {
  if (isRestoringRef.current) { isRestoringRef.current = false; return; }
  if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
  snapTimerRef.current = setTimeout(() => {
    const snap = currentSnapshot();
    const top = undoRef.current[undoRef.current.length - 1];
    if (top && JSON.stringify(top) === JSON.stringify(snap)) return;  // no-op
    undoRef.current.push(snap);
    if (undoRef.current.length > 200) undoRef.current.shift();
    redoRef.current = [];
  }, 300);
}, [/* every piece of lab state */]);
```

Key details:
- Storage key is **versioned** (`-v6` in the original) — bump it when
  the snapshot schema changes so stale entries from older versions get
  dropped silently instead of crashing the lab on load.
- Snapshots compared by `JSON.stringify` equality — cheap because the
  whole state object is <2 KB.
- 200-entry cap so undo doesn't grow unboundedly during a long session.
- Programmatic restores flip `isRestoringRef` so undo/redo doesn't
  cascade into new undo entries.

## Lab UI sections worth keeping

From the original lab (lines ~1047–2280 of `Badge.stories.tsx`):
- **Preview pane** with a `zoom` slider (so you can inspect small
  details at 4×–8×).
- **Anchor point dragging** for the label inside the badge — same
  pattern works for positioning the tail tip on a balloon. The anchor's
  `(labelX, labelY)` offsets live in the snapshot.
- **Padding controls** with `linkPadX` / `linkPadY` toggles so you can
  drive both sides with one slider.
- **Effect stack** — add/remove/reorder with per-effect params. The lab
  uses a `nextId` counter for stable React keys when effects get
  reordered. Lift this; it'll be the same for tail-as-effect.
- **Export button** that serializes the current snapshot as the prop
  JSON you'd hand-write in a real `<SpeechBalloon …>` call. Use this to
  bootstrap a presets file once you've found shapes you like.
- **Tone/variant pickers**, **font controls** (family, size delta,
  bold/italic, caps) if you want text styling in the lab too.

## What to leave behind

- **Storybook**. The lab works fine as a standalone page; don't drag in
  Storybook + MDX + addons unless you already need them.
- **The 25-shape menagerie**. Most of those are decorative badge
  shapes that don't make sense as speech balloons (Coffin, Beavis,
  Postage, Receipt, Wood, Sparkler, Urn). Start with 4–6 balloon shapes
  and add as needed.
- **`bloat`** — the perimeter-normal-offset is mathy and only useful
  for the badge-with-decoration aesthetic. A balloon doesn't need it.
- **`crawl`** — animation of perimeter patterns. Not relevant for
  speech balloons unless you specifically want a "shimmer" effect.
- **The `breakStyle: 'slice' | 'clone'`** branching for CSS-rendered
  shapes wrapping across lines. Speech balloons don't typically wrap;
  if they do, you probably want a hard "balloon owns one block of
  text" rule.

## Quick reference: line numbers in the source

- `Badge.tsx:1-80` — prop shape + element-choice logic.
- `Badge.stories.tsx:664-732` — `LabControl` type + `BASE_LAB_CONTROLS`.
- `Badge.stories.tsx:734-…` — `EFFECT_LAB_CONTROLS`.
- `Badge.stories.tsx:1004` — `LAB_STORAGE_KEY` constant.
- `Badge.stories.tsx:1006-1033` — `LabSnapshot` interface.
- `Badge.stories.tsx:1035-1045` — `loadLabSnapshot()` with try/catch.
- `Badge.stories.tsx:1086-1100` — persistence `useEffect`.
- `Badge.stories.tsx:1102-1132` — undo/redo refs + debounced snapshot
  effect.
- `Badge.stories.tsx:1134-…` — `applySnapshot()`.
- `Badge.stories.tsx:2282` — `export const ComposeLab: Story = {…}`.

## Suggested first commits in the new repo

1. Stub `SpeechBalloon` component with `shape` / `base` + `effects`
   props (lift `Badge.tsx`'s prop split, drop the menagerie).
2. Two body shapes (`'rectangle'`, `'oval'`) and one tail effect — just
   enough to verify the composition pipeline end-to-end.
3. The lab page itself (Vite + React, no Storybook). Mount the
   `LabControl` walker that turns descriptors into form controls.
4. localStorage persistence + undo/redo from this handoff.
5. Add shapes (`'cloud'`, `'burst'`, `'thought'`) and effects
   (`'stroke'`, `'shadow'`, `'dashed-outline'`) one at a time.
