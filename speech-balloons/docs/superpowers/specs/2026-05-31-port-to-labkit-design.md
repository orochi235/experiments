# Port speech-balloons to @labkit/react

Date: 2026-05-31
Status: Draft for review

## Goal

Move speech-balloons off its bespoke UI/state/undo stack and onto `@labkit/react` (which itself draws on `@orochi235/weasel` and `@orochi235/weasel-ui`). Keep all current behavior. Add to labkit only what's genuinely missing; pass through what already exists in weasel-ui.

End state:

- Speech-balloons stays at `experiments/speech-balloons/`, depends on `@labkit/react` via `file:../../labkit`.
- `Lab.tsx` shrinks from ~1215 LOC to an estimated ~400 LOC (rendering composition only).
- Local files removed: `persistence.ts`, the local `CurveEditor/`.
- Files unchanged in behavior: `SpeechBalloon.tsx`, `geometry.ts`, `clipping.ts`, `plateauMat.ts`, `textToPath.ts`, `TailMinimap.tsx`, `controls.ts` (small shape adjustments).

## Why labkit (and weasel-ui through it)

After surveying both:

- Labkit's `ui/properties` module already ships `PropertyPanel`, `PropertyList`, `SliderRow` (editable readout, `format`, `unit`), `ColorRow` (with `alpha`/`alphaDisabled`), and the other field rows we need.
- Weasel-ui has `CurveEditor` (mature, with `Plot2D`, hitTest, catmull-rom/monotone/interpolation), `useReorderDragList` (pointer-capture-correct reorder), `formatNumber`/`MINUS_SIGN`, `paintGradientTrack`, oklch color helpers.
- Labkit has storage adapters, snapshot/undo primitives, and `LabShell` chrome.

So most of the heavy lifting exists. The port mostly *deletes* code from speech-balloons; only a few small additions land in labkit.

## Architecture after port

```
main.tsx
  └─ <LabShell title="…" header={<TopToolbar/>}>
       <SingletonExperimentProvider
           id="balloon"
           initialConfig={defaultDesign}      // design + effects + colors
           initialState={defaultRuntime}      // text/font/zoom (ephemeral)
           storage={localStorageAdapter}
           storageKey="speech-balloon-lab/v1">
         <div className="sb-workspace">       // 3-col CSS grid, local class
           <aside className="sb-side-left">
             <PropertyPanel>…base controls…</PropertyPanel>
             <LayerStack title="Morph" effects={morphEffects} …/>
             <LayerStack title="Fill"  effects={leftEffects}  …/>
           </aside>
           <section className="sb-preview">
             <div ref={stageRef}><SpeechBalloon design={design} runtime={runtime}/></div>
             <ZoomBar …/>                    // local; not promoted
           </section>
           <aside className="sb-side-right">
             <TailMinimap …/>                // local; not promoted
             <LayerStack title="Tails" effects={rightEffects} …/>
           </aside>
         </div>
       </SingletonExperimentProvider>
     </LabShell>
```

State split:

- `config` (durable, persisted, undoable) ← speech-balloons' current `design` + `nextId`.
- `state` (session, not necessarily persisted) ← speech-balloons' current `runtime` (text, fontSize, fontFamily, zoom, fitToContent).
- A debounced 300 ms snapshot pushes `{config, state}` onto labkit's `pushSnapshot` whenever either changes.
- ⌘Z / ⌘⇧Z / ⌘Y bound by a small local `useUndoShortcut({undo, redo})` hook.

Storage migration: keep the existing localStorage key (`LAB_STORAGE_KEY`) so users don't lose work.

## What's added to labkit

| # | Item | Where | Rough LOC |
|---|---|---|---|
| L1 | `PropertyGroup` — header row with `hideWhen(params)`, renders a sub-card around grouped rows | `src/ui/properties/PropertyGroup.tsx` | ~80 |
| L2 | `LayerStack` — expandable cards, drop hints, palette `+` buttons, primary-select hoist, optional accent color + index badge. Built on weasel-ui `useReorderDragList`. | `src/ui/layers/LayerStack.tsx` (+ `.less`) | ~250 |
| L3 | `CurveField` — wraps weasel-ui `CurveEditor` with per-stop numeric readouts + flip button | `src/ui/properties/CurveField.tsx` | ~70 |
| L4 | Pass-through re-exports from weasel-ui: `CurveEditor`, `useReorderDragList`, `formatNumber`/`MINUS_SIGN`, `paintGradientTrack`, `oklchToHex`/`chromaAt` | `src/passthrough/weasel-ui.ts` exported via new `./weasel-ui` subpath | ~20 |
| L5 | `SingletonExperimentProvider` + `createLabStore` export — one-workspace convenience so `useExperimentState` works without `<Lab instruments={…}>` | `src/state/SingletonExperiment.tsx` (+ export) | ~60 |
| L6 | Storybook stories + vitest tests for each new component | colocated | — |

Notes:

- The older `src/controls/ControlPanel.tsx` stays put. Speech-balloons uses the newer `ui/properties` surface only. A follow-up can deprecate `controls/` once no consumer remains.
- `useReorderDragList` is the load-bearing piece of `LayerStack`; pulling it through avoids re-implementing pointer-capture-correct reorder.
- `CurveEditor` from weasel-ui supersedes speech-balloons' local fork. The local `CurveEditor/` directory is deleted in the cutover.

## What stays in speech-balloons

- `SpeechBalloon.tsx`, `geometry.ts`, `clipping.ts`, `plateauMat.ts`, `textToPath.ts`, `TailMinimap.tsx` — unchanged.
- `controls.ts` — small shape changes only:
  - `header` items get an optional `hideWhen(params)` predicate (already present in some entries).
  - `range` items with `maxFn({W, H})` keep that field; the consumer (`Lab.tsx`) computes the resolved max and passes `max={n}` to `SliderRow`. (No labkit change required.)
- `Lab.tsx` — keeps:
  - Top toolbar contents (font/size/text/bg/undo/redo/export/download).
  - 3-column layout and SB-specific class names (`sb-*`).
  - Tail color-slot derivation (sticky `colorSlot` per tail id).
  - Fit-to-stage `reach` math + zoom bar.
  - SVG download (`textToPath` inlining + serialize). weasel-svg's path serializer is for weasel scene graphs, not arbitrary SVG output, so it's not applicable here.
  - Local `useUndoShortcut` hook (small enough that exporting it from labkit isn't worth it).
- `styles.css` — trimmed to balloon-specific rules; consumes `--lk-*` tokens for colors/radii/spacing rather than hard-coding.

## Deliberately not done

- **Don't go through `defineInstrument({...})`.** Speech-balloons is one screen, not a multi-workspace lab. `LabShell` + `SingletonExperimentProvider` is the right depth.
- **Don't promote `ZoomBar`.** The fit-to-stage math depends on render-specific `reach` calculation. Revisit once a second consumer wants the same affordance.
- **Don't promote `TailMinimap`.** Tails are balloon-specific.
- **Don't pull in `@orochi235/weasel-history`.** Labkit's existing snapshot-stack covers SB's needs.
- **Don't try to use weasel-svg for SVG export.** Wrong abstraction (parses/serializes weasel scenes, not freeform SVG documents).

## Phasing

### Phase A — labkit additions (one PR per item; ~7 commits in labkit)

Order matters because A5 supersedes the local `CurveEditor/`, and A6 underpins A2.

| # | Commit |
|---|---|
| A1 | `PropertyGroup` + tests + story |
| A2 | `LayerStack` + tests + story (consumes weasel-ui `useReorderDragList`) |
| A3 | `CurveField` + tests + story (consumes weasel-ui `CurveEditor`) |
| A4 | Pass-through re-exports + `./weasel-ui` subpath in `package.json#exports` |
| A5 | `SingletonExperimentProvider` + export `createLabStore` + test |
| A6 | Doc update: `docs/AGENTS.md` table entries for new components |

Each commit ships independently green (lint, vitest, build, storybook). Land in main; do not block speech-balloons cutover behind a labkit release — speech-balloons consumes labkit via `file:../../labkit`.

### Phase B — speech-balloons cutover (one PR; ~5 commits in speech-balloons)

| # | Commit |
|---|---|
| B1 | Add `@labkit/react` dep, import `@labkit/react/styles.css` in `main.tsx`, no behavior change |
| B2 | Replace local `SliderField`/`ColorField`/`Section`/`ControlList` rendering with `SliderRow`/`ColorRow`/`PropertyGroup`/`PropertyList`. Verify all sliders, color fields, subpanels render and behave the same. Visual diff against checked-in PNG snapshots. |
| B3 | Replace local `LayerStack`/`EffectCard` with labkit `<LayerStack>`. Verify reorder, drop hints, palette, accent, badge. |
| B4 | Replace local `CurveField`/`CurveEditor/` with labkit `<CurveField>`. Delete the local `CurveEditor/` directory. |
| B5 | Replace local snapshot/undo/persistence with `<SingletonExperimentProvider>` + labkit undo primitives + local `useUndoShortcut`. Delete `persistence.ts`. Migrate localStorage key. |
| B6 | Wrap in `<LabShell>`, trim `styles.css` to balloon-specific, rename non-labkit classes to `sb-*`, remove dead code. |

### Phase C — cleanup

- Update `HANDOFF.md` and `TODO.md` to reflect new structure.
- Update `~/src/PROJECTS.md` if the one-line description of speech-balloons needs adjustment.
- File a follow-up issue in labkit for deprecating `src/controls/ControlPanel.tsx` once no consumer remains.

## Verification

- Existing speech-balloons vitest suites (`clipping.test.ts`, `geometry.test.ts`, `plateauMat.test.ts`) continue to pass at every commit — they cover pure geometry, untouched by this port.
- After each B-commit: load the dev server, exercise the lab, and spot-check against the PNG snapshots in the repo root (`bubbles-current.png`, `chevron-inline.png`, `lightning-final.png`, `pivot-multiply-balloon.png`, etc.). Confirm: undo/redo, reset, layer drag-reorder, tail minimap drag, curve editor drag, alpha gating on colors, en-dash on negative readouts, SVG download.
- New labkit components ship with vitest + Storybook stories per existing conventions (`scripts/check-class-prefix.ts` enforces `lk-` prefix).

## Risks

- **`LayerStack` API shape (medium):** Speech-balloons has three stacks with subtly different needs (Tails has accent color + numeric badge + minimap-coupled state; Morph/Fill are plain). First implementation should expose enough slots without becoming a parameter dump; resist abstracting until a second consumer exists. If the surface starts to bloat, fall back to having SB compose primitives (`useReorderDragList` + own card layout) directly.
- **Singleton store overhead (low):** Labkit's store holds `workspaces[]` and `savedSnapshots[]` that SB doesn't use. ~1 KB of unused state. Acceptable; alternative is plain React state + labkit undo primitives, which gives up `useExperimentState`.
- **Persistence migration (low):** Keep the existing `LAB_STORAGE_KEY`; map it to the labkit store key. Test with an existing snapshot in localStorage to confirm round-trip.
- **CurveEditor behavior drift (low):** Weasel-ui's `CurveEditor` is more capable than SB's local fork. Confirm the `domain="1d"`, `constrain="function"`, `endpoints="pinned-x"`, `addPointMode="click-curve"` knobs all exist with the same semantics. If they don't, decide between adapting SB to weasel-ui's surface or filing a labkit shim.
- **CSS interaction (low):** Labkit's `lk-*` classes vs SB's existing class names. Keep SB's local classes under a `sb-` prefix; rely on `--lk-*` tokens for theming alignment.

## Open questions

- Should labkit re-export pass-throughs flat (under `@labkit/react`) or under a subpath (`@labkit/react/weasel-ui`)? Subpath is cleaner; flat is fewer imports. Recommend subpath.
- Once SB lands, is the older `src/controls/ControlPanel.tsx` still earning its keep, or should labkit deprecate it? Track separately.
