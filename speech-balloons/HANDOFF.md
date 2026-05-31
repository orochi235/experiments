# Speech Balloon Lab — Migration to @labkit/react

This lab was originally modeled on the weasel Badge lab (see commit history for
the original HANDOFF notes). The port to `@labkit/react` is now complete:
- Phase A (core balloons + basic UI/state) lives in `~/src/labkit` 
- Phase B (effects, fills, tails, advanced features) lives in this repo

This document describes the current labkit-based architecture.

## Current architecture

The lab is split across two repos:

**`~/src/labkit` (Phase A)** — presentational primitives for interactive labs:
- `<LabShell>` — top-level shell (header, toolbar, workspace grid)
- `<PropertyPanel>`, `<PropertyList>`, `<PropertyGroup>` — control hierarchies
- `<SliderRow>`, `<ColorRow>`, `<CurveField>` — individual form controls
- `<LayerStack>` — add/remove/reorder effects with stable React keys
- `<SingletonExperimentProvider>` + `useExperimentState` — state + undo + persistence primitives (`pushSnapshot`, `undo`, `redo`)

**`~/src/experiments/speech-balloons/` (Phase B)** — domain-specific:
- `src/SpeechBalloon.tsx` — main component (shape-mode vs compose-mode)
- `src/types.ts` — BalloonBase | BalloonEffect | Params types
- `src/bases/` — base body shapes (oval, rectangle, cloud, burst, thought)
- `src/effects/` — layered effects (tail, fill, stroke, shadow, dashed-outline)
- `src/controls.ts` — per-shape control descriptors (drives PropertyPanel rendering)
- `src/Lab.tsx` — experiment page mounting `<LabShell>` + local wrappers

## Composition model

Two modes:

1. **Shape mode** — `<SpeechBalloon shape="oval" shapeParams={…}>`. One named,
   fixed silhouette.
2. **Compose mode** — `<SpeechBalloon base="…" baseParams={…} effects={[…]}>`.
   A base + ordered effect stack.

Key design choices:
- **Tail as an effect** (not a base property) lets you attach tails to any base
  and stack multiple tails (one per speaking character).
- **Fill as an effect** (in the main effects list) lets you composite base fills,
  strokes, shadows, and dashed outlines in sequence.
- **Shared snapshots** across base/effect params via `LabSnapshot` — state and
  undo/redo handle both uniformly.

## UI controls

Controls are defined in `src/controls.ts` as descriptor objects (shape, effect,
kind, min/max, options, etc.). `<PropertyPanel>` from labkit walks these
descriptors and renders:
- `<SliderRow>` for range controls
- `<ColorRow>` for color swatches
- `<CurveField>` for curve editing (wraps weasel-ui's `CurveEditor`)
- Select dropdowns for choice controls
- Divider headers for visual grouping

Adding a new base/effect with a control entry gives you form UI for free.

**Current controls** in `src/controls.ts`:
- **Bases**: oval, rectangle, cloud, burst, thought
- **Effects**: tail (with position, angle, length, base-width, curve, style/solid/bubbles/dashed), fill (color + optional gradient), stroke, shadow, dashed-outline

## State, persistence, undo/redo

Managed by labkit's `<SingletonExperimentProvider>`:
- `useExperimentState()` hook provides `state` + `setState`
- `pushSnapshot()`, `undo()`, `redo()` primitives handle undo/redo stacks
- localStorage key: `lk:speech-balloon-lab-v12:workspaces` (versioned; bump on schema change)
- 300ms debounce coaleses rapid slider scrubs into single undo entries
- 200-entry stack cap

One `LabSnapshot` interface captures all lab state (base, baseParams, effects,
tone, fills, text, etc.). See `src/Lab.tsx` for the experiment setup and
snapshot shape.

## Lab UI sections (implemented)

- **Preview pane** with zoom slider (4×–8× magnification for detail inspection)
- **Minimap** with drag handle for tail-tip positioning (subclass of `<LayerStack>`)
- **Effect stack** (`<LayerStack>` from labkit) — add/remove/reorder effects with stable React keys
- **Control panels** — per-shape/per-effect property groups rendered by `<PropertyPanel>` from labkit
- **Export button** serializes current snapshot as hand-writable `<SpeechBalloon …>` props JSON
- **Undo/Redo buttons** (keyboard: Cmd+Z / Cmd+Shift+Z)
- **Text input** for label text inside the balloon

## Files deleted during port

The following files from the Badge lab prototype were not ported:
- Old local `src/persistence.ts` — now labkit's `<SingletonExperimentProvider>`
- Old `src/CurveEditor/` wrapper — now labkit's `<CurveField>`

These deletions are intentional; the labkit primitives are simpler and battle-tested.
