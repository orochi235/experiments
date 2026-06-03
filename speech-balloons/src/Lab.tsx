import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckboxRow,
  ColorRow,
  CurveField as KitCurveField,
  type CurveMark,
  LabShell,
  LayerStack as KitLayerStack,
  type LayerStackItem,
  PropertyGroup,
  PropertyList,
  PropertyPanel,
  SelectRow,
  SliderRow,
  TextRow,
  useExperimentState,
  useLabStore,
} from '@labkit/react';
import { pushSnapshot, undo as undoStackOp, redo as redoStackOp, emptyStack } from '@labkit/react/undo';
import { bareBaseRadiusRange, SpeechBalloon } from './SpeechBalloon';
import { buildBaseSampler, type BaseSampler } from './geometry';
import { TailMinimap, tailColor, type MinimapTail } from './TailMinimap';
import {
  BASE_CONTROLS,
  EFFECT_CONTROLS,
  BASE_KINDS,
  LEFT_PANEL_EFFECTS,
  MORPH_EFFECTS,
  RIGHT_PANEL_EFFECTS,
  defaultParams,
  type LabControl,
} from './controls';
import { inlineSvgTextAsPaths } from './textToPath';
import { useUndoShortcut } from './useUndoShortcut';
import type {
  BalloonBase,
  DesignState,
  EffectInstance,
  EffectKind,
  ParamBag,
  ParamValue,
  RuntimeState,
} from './types';

// --- Module-scope helpers for EffectLayerStack ------------------------------

function getPrimarySelect(kind: EffectKind) {
  const allControls = EFFECT_CONTROLS[kind];
  const firstNonHeader = allControls.find((c) => c.kind !== 'header');
  return firstNonHeader && firstNonHeader.kind === 'select' ? firstNonHeader : null;
}

function reorderWithinKindSet(
  effects: EffectInstance[],
  kindSet: readonly EffectKind[],
  orderedIds: Array<number | string>,
): EffectInstance[] {
  const byId = new Map(effects.map((e) => [e.id, e]));
  const otherEffects = effects.filter((e) => !kindSet.includes(e.kind));
  const reordered = (orderedIds as number[])
    .map((id) => byId.get(id))
    .filter((e): e is EffectInstance => e !== undefined);
  return [...otherEffects, ...reordered];
}

// Module-scope so React preserves the component identity across Lab
// re-renders. When this was defined inside Lab, every state change
// produced a new function reference, which React treated as a brand-new
// component type — remounting the entire layer-stack subtree (including
// the contour CurveEditor) and breaking in-flight drags.
interface EffectLayerStackProps {
  title: string;
  hideHead?: boolean;
  effects: EffectInstance[];
  kindSet: readonly EffectKind[];
  bodyW?: number;
  bodyH?: number;
  bodyShape?: BalloonBase;
  bodyParams?: ParamBag;
  decorate?: (eff: EffectInstance) => { accent?: string; badge?: string };
  onAdd: (kind: EffectKind) => void;
  onRemove: (id: number) => void;
  onReorder: (kindSet: readonly EffectKind[], orderedIds: Array<number | string>) => void;
  onPrimaryChange: (id: number, key: string, value: ParamValue) => void;
  onUpdateParam: (id: number, key: string, value: ParamValue) => void;
}
function EffectLayerStack({
  title, hideHead, effects, kindSet, bodyW, bodyH, bodyShape, bodyParams, decorate,
  onAdd, onRemove, onReorder, onPrimaryChange, onUpdateParam,
}: EffectLayerStackProps) {
  const items: LayerStackItem[] = effects.map((eff) => {
    const primary = getPrimarySelect(eff.kind);
    const decoration = decorate ? decorate(eff) : {};
    return {
      id: eff.id,
      kind: eff.kind,
      primaryValue: primary ? String(eff.params[primary.key] ?? primary.default) : undefined,
      primaryOptions: primary ? primary.options : undefined,
      ...decoration,
    };
  });
  return (
    <KitLayerStack
      title={title}
      hideHead={hideHead}
      items={items}
      paletteKinds={kindSet as unknown as string[]}
      onAdd={(k) => onAdd(k as EffectKind)}
      onRemove={(id) => onRemove(id as number)}
      onReorder={(ids) => onReorder(kindSet, ids)}
      onPrimaryChange={(id, value) => {
        const eff = effects.find((e) => e.id === id);
        if (!eff) return;
        const primary = getPrimarySelect(eff.kind);
        if (primary) onPrimaryChange(id as number, primary.key, value);
      }}
      renderBody={(item) => {
        const eff = effects.find((e) => e.id === item.id);
        if (!eff) return null;
        const primary = getPrimarySelect(eff.kind);
        const bodyControls = primary
          ? EFFECT_CONTROLS[eff.kind].filter((c) => !('key' in c) || c.key !== primary.key)
          : EFFECT_CONTROLS[eff.kind];
        return (
          <PropertyList pack="pairs">
            <ControlList
              controls={bodyControls}
              params={eff.params}
              onChange={(k, v) => onUpdateParam(eff.id, k, v)}
              bodyW={bodyW}
              bodyH={bodyH}
              bodyShape={bodyShape}
              bodyParams={bodyParams}
            />
          </PropertyList>
        );
      }}
    />
  );
}

const FONT_OPTIONS = [
  { label: 'Comic Neue', value: 'Comic Neue, system-ui, sans-serif' },
  { label: 'Bangers', value: 'Bangers, system-ui, sans-serif' },
  { label: 'Oswald', value: 'Oswald, sans-serif' },
  { label: 'System sans-serif', value: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  { label: 'System monospace', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { label: 'System serif', value: 'ui-serif, Georgia, serif' },
];

export function Lab() {
  const { config: design, state: runtime, setConfig, setState } = useExperimentState<RuntimeState, DesignState>();
  const store = useLabStore();
  const updateUndo = store.updateWorkspaceUndoStack;
  const currentUndoStack = store.workspaces.find((w) => w.id === 'balloon')?.undoStack ?? emptyStack();
  const view = store.workspaces.find((w) => w.id === 'balloon')?.view ?? { zoom: 1.2, pan: { x: 0, y: 0 } };

  const setDesign: React.Dispatch<React.SetStateAction<DesignState>> = useCallback((next) => {
    const nextDesign = typeof next === 'function' ? (next as (d: DesignState) => DesignState)(design) : next;
    // setConfig is per-key; iterate top-level keys and only set those that changed.
    for (const k of Object.keys(nextDesign) as (keyof DesignState)[]) {
      if ((design as Record<string, unknown>)[k] !== (nextDesign as Record<string, unknown>)[k]) {
        setConfig(k, (nextDesign as DesignState)[k] as never);
      }
    }
  }, [design, setConfig]);

  const setRuntime: React.Dispatch<React.SetStateAction<RuntimeState>> = useCallback((next) => {
    const nextRuntime = typeof next === 'function' ? (next as (r: RuntimeState) => RuntimeState)(runtime) : next;
    setState(nextRuntime);
  }, [runtime, setState]);

  const stageRef = useRef<HTMLDivElement | null>(null);

  // Track the last "settled" state. On the next settle, push THIS into the
  // past (matching labkit's undo semantics, where past contains history not
  // including current). On restore, refresh this to the restored snapshot
  // so we don't push it back into past on the per-key fan-out renders.
  const prevSettledRef = useRef<{ design: DesignState; runtime: RuntimeState } | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevSettledRef.current === null) {
      // First mount — seed the previous-settled snapshot.
      prevSettledRef.current = { design, runtime };
      return;
    }
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => {
      const prev = prevSettledRef.current!;
      const current = { design, runtime };
      if (JSON.stringify(prev) === JSON.stringify(current)) {
        // No real change since last settle. Common during multi-key
        // setConfig fan-out after a restore.
        return;
      }
      updateUndo('balloon', (stack) => pushSnapshot(stack ?? emptyStack(), prev, 200));
      prevSettledRef.current = current;
    }, 300);
  }, [design, runtime, updateUndo]);

  const undo = useCallback(() => {
    if (currentUndoStack.past.length === 0) return;
    const result = undoStackOp(currentUndoStack, { design, runtime });
    if (!result) return;
    const snap = result.snapshot as { design: DesignState; runtime: RuntimeState };
    prevSettledRef.current = snap;  // refresh guard so the post-restore renders don't push
    setDesign(snap.design);
    setRuntime(snap.runtime);
    updateUndo('balloon', result.stack);
  }, [design, runtime, currentUndoStack, updateUndo, setDesign, setRuntime]);

  const redo = useCallback(() => {
    if (currentUndoStack.future.length === 0) return;
    const result = redoStackOp(currentUndoStack, { design, runtime });
    if (!result) return;
    const snap = result.snapshot as { design: DesignState; runtime: RuntimeState };
    prevSettledRef.current = snap;  // same — guard the post-restore fan-out
    setDesign(snap.design);
    setRuntime(snap.runtime);
    updateUndo('balloon', result.stack);
  }, [design, runtime, currentUndoStack, updateUndo, setDesign, setRuntime]);

  useUndoShortcut({ undo, redo });

  // --- Effect mutators ----------------------------------------------------

  const updateEffectParam = (id: number, key: string, value: ParamValue) => {
    setDesign((d) => ({
      ...d,
      effects: d.effects.map((e) => (e.id === id ? { ...e, params: { ...e.params, [key]: value } } : e)),
    }));
  };
  const addEffect = (kind: EffectKind, overrides?: ParamBag) => {
    const params: ParamBag = { ...defaultParams(EFFECT_CONTROLS[kind]), ...(overrides ?? {}) };
    // Tails get an identity-bound color slot — sticky across removes so
    // existing tails keep their color when an earlier tail is deleted.
    if (kind === 'tail' && typeof params.colorSlot !== 'number') {
      const used = new Set<number>();
      for (const e of design.effects) {
        if (e.kind === 'tail' && typeof e.params.colorSlot === 'number') used.add(e.params.colorSlot as number);
      }
      let slot = 0;
      while (used.has(slot)) slot++;
      params.colorSlot = slot;
    }
    const inst: EffectInstance = { id: design.nextId, kind, params };
    setDesign((d) => ({ ...d, effects: [...d.effects, inst], nextId: d.nextId + 1 }));
  };
  const removeEffect = (id: number) => {
    setDesign((d) => ({ ...d, effects: d.effects.filter((e) => e.id !== id) }));
  };
  const updateBaseParam = (key: string, value: ParamValue) => {
    setDesign((d) => ({ ...d, baseParams: { ...d.baseParams, [key]: value } }));
  };
  const setBase = (base: BalloonBase) => {
    setDesign((d) => ({ ...d, base, baseParams: defaultParams(BASE_CONTROLS[base]) }));
  };

  const resetAll = () => {
    if (!confirm('Reset all controls to defaults?')) return;
    localStorage.removeItem('lk:speech-balloon-lab-v12:workspaces');
    window.location.reload();
  };

  const exportSnapshot = () => {
    const snap = { design, runtime };
    const json = JSON.stringify(snap, null, 2);
    navigator.clipboard?.writeText(json);
    console.log('Lab snapshot copied to clipboard:\n', json);
  };

  const saveSnapshot = () => {
    const snap = { design, runtime };
    const json = JSON.stringify(snap, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `speech-balloon-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const loadSnapshot = () => loadInputRef.current?.click();
  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { design?: DesignState; runtime?: RuntimeState };
      if (!parsed.design || !parsed.runtime || !Array.isArray(parsed.design.effects)) {
        alert('Not a valid speech-balloon snapshot — needs {design, runtime}.');
        return;
      }
      setDesign(parsed.design);
      setRuntime(parsed.runtime);
    } catch (err) {
      alert(`Failed to load snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const [isPreparingSvg, setIsPreparingSvg] = useState(false);
  const downloadSvg = async () => {
    const stage = stageRef.current;
    const svg = stage?.querySelector('svg');
    if (!svg) return;
    setIsPreparingSvg(true);
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      // The clone must be in the document for getComputedStyle on its <text>
      // elements to resolve inherited font properties. Mount it off-screen.
      clone.style.position = 'absolute';
      clone.style.left = '-99999px';
      clone.style.top = '-99999px';
      clone.style.visibility = 'hidden';
      document.body.appendChild(clone);
      try {
        // wawoff2's emscripten runtime can hang under vite dev's CJS shim
        // (onRuntimeInitialized never fires). Cap the inline-paths step at
        // 5s; if it hangs, fall back to keeping text as <text> elements so
        // the download still works (consumers without the font will see a
        // system fallback rather than getting a stuck button).
        await Promise.race([
          inlineSvgTextAsPaths(clone),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('text-as-paths timeout')), 5000),
          ),
        ]).catch((e) => {
          console.warn('[downloadSvg] text-as-paths failed, exporting with <text> elements:', e);
        });
      } finally {
        document.body.removeChild(clone);
      }
      // Strip the off-screen positioning we added before serializing.
      clone.style.position = '';
      clone.style.left = '';
      clone.style.top = '';
      clone.style.visibility = '';
      if (!clone.getAttribute('style')) clone.removeAttribute('style');
      const data = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${data}`], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'speech-balloon.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsPreparingSvg(false);
    }
  };

  const leftEffects = design.effects.filter((e) => LEFT_PANEL_EFFECTS.includes(e.kind));
  const morphEffects = design.effects.filter((e) => MORPH_EFFECTS.includes(e.kind));
  const rightEffects = design.effects.filter((e) => RIGHT_PANEL_EFFECTS.includes(e.kind));

  // Mirror SpeechBalloon's reach calculation so Fit-to-viewport can compute
  // the right zoom without measuring the rendered SVG.
  const reach = useMemo(() => {
    let max = 60;
    for (const eff of design.effects) {
      if (eff.kind === 'tail') {
        const shape = (eff.params.shape as string) ?? 'pointed';
        const size = (eff.params.size as number) ?? (eff.params.length as number) ?? 50;
        max = Math.max(max, size);
        if (shape === 'bubbles') {
          const diam = (eff.params.bubbleDiameter as number) ?? 30;
          const count = (eff.params.count as number) ?? 3;
          const gap = (eff.params.gap as number) ?? 0.15;
          max = Math.max(max, count * diam * (1 + gap));
        }
      } else if (eff.kind === 'spikes') {
        max = Math.max(max, (eff.params.length as number) ?? 18);
      } else if (eff.kind === 'lobes') {
        max = Math.max(max, (eff.params.depth as number) ?? 12);
      } else if (eff.kind === 'wobble') {
        max = Math.max(max, (eff.params.amplitude as number) ?? 8);
      } else if (eff.kind === 'jitter') {
        max = Math.max(max, (eff.params.amount as number) ?? 6);
      }
    }
    return max + 30;
  }, [design.effects]);
  const fitZoomToStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const pad = 0; // .preview-stage has no padding
    const fitW = (rect.width - pad * 2) / (design.width + 2 * reach);
    const fitH = (rect.height - pad * 2) / (design.height + 2 * reach);
    const fit = Math.max(0.1, Math.min(4, Math.min(fitW, fitH)));
    store.updateWorkspaceView('balloon', { ...view, zoom: fit });
  }, [design.width, design.height, reach, store, view]);
  const tailEffects = design.effects.filter((e) => e.kind === 'tail');
  // Sticky palette slot per tail id. Explicit slots in params win; tails
  // missing one (legacy snapshots) get the next-available slot derived in
  // a stable left-to-right pass — and a useEffect below persists the
  // derivation so the slot stays put through future removals.
  const tailColorSlotById = useMemo(() => {
    const map = new Map<number, number>();
    const used = new Set<number>();
    for (const e of tailEffects) {
      const s = e.params.colorSlot;
      if (typeof s === 'number') { map.set(e.id, s); used.add(s); }
    }
    let next = 0;
    for (const e of tailEffects) {
      if (map.has(e.id)) continue;
      while (used.has(next)) next++;
      map.set(e.id, next);
      used.add(next);
    }
    return map;
  }, [tailEffects]);
  // Persist derived slots back into params once, so the next render's
  // assignment is stable even after removals shift indices.
  useEffect(() => {
    let dirty = false;
    const nextEffects = design.effects.map((e) => {
      if (e.kind !== 'tail') return e;
      if (typeof e.params.colorSlot === 'number') return e;
      const slot = tailColorSlotById.get(e.id);
      if (slot === undefined) return e;
      dirty = true;
      return { ...e, params: { ...e.params, colorSlot: slot } };
    });
    if (dirty) setDesign((d) => ({ ...d, effects: nextEffects }));
  }, [design.effects, tailColorSlotById]);
  // id → 0-based position among tails (drives the numeric badge label)
  const tailIndexById = new Map<number, number>();
  tailEffects.forEach((e, i) => tailIndexById.set(e.id, i));
  const minimapTails: MinimapTail[] = tailEffects.map((e) => ({
    id: e.id,
    angle: (e.params.angle as number) ?? 115,
    length: (e.params.size as number) ?? 60,
    arc: (e.params.arc as number) ?? 0,
    outAngle: (e.params.outAngle as number) ?? 0,
    colorSlot: tailColorSlotById.get(e.id) ?? 0,
  }));
  const updateTailFromMinimap = (id: number, u: { angle?: number; length?: number; arc?: number; outAngle?: number }) => {
    // Apply all updates in a single setDesign so React doesn't partially
    // batch them — previously chaining updateEffectParam calls in a row
    // caused some props to lag, making the sliders appear out of sync with
    // the minimap drag.
    setDesign((d) => ({
      ...d,
      effects: d.effects.map((e) => {
        if (e.id !== id) return e;
        const params = { ...e.params };
        if (u.angle !== undefined) params.angle = u.angle;
        if (u.length !== undefined) params.size = u.length;
        if (u.arc !== undefined) params.arc = u.arc;
        if (u.outAngle !== undefined) params.outAngle = u.outAngle;
        return { ...e, params };
      }),
    }));
  };

  // --- Local panel component (captures Lab-scope handlers) -----------------


  return (
    <LabShell
      title="I'll take 'Balloons' for $600, Alex"
      header={
        <div className="sb-toolbar-actions">
          <button onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
            Undo
          </button>
          <button onClick={redo} title="Redo (⌘⇧Z)" aria-label="Redo">
            Redo
          </button>
          <button onClick={exportSnapshot} title="Copy snapshot JSON to clipboard">
            Export
          </button>
          <button onClick={saveSnapshot} title="Download snapshot as .json file">
            Save
          </button>
          <button onClick={loadSnapshot} title="Load snapshot from .json file">
            Load
          </button>
          <input
            ref={loadInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onLoadFile}
            style={{ display: 'none' }}
          />
          <button onClick={downloadSvg} title="Download as SVG" disabled={isPreparingSvg}>
            {isPreparingSvg ? 'Preparing…' : 'Download SVG'}
          </button>
          <button onClick={resetAll} className="danger" title="Reset to defaults">
            Reset all
          </button>
        </div>
      }
    >
      <div className="sb-lab-body">
        <div className="sb-toolbar-fields">
          {/* Font select, multi-line text textarea, and size-to-content checkbox keep
              raw HTML — none fit the labkit PropertyRow stacked label+control shape. */}
          <label className="sb-field">
            <span>Font</span>
            <select
              value={runtime.fontFamily}
              onChange={(e) => setRuntime((r) => ({ ...r, fontFamily: e.target.value }))}
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <SliderRow
            label="Size"
            value={runtime.fontSize}
            min={10}
            max={72}
            step={1}
            unit="px"
            onChange={(v) => setRuntime((r) => ({ ...r, fontSize: v }))}
          />
          <label className="sb-field sb-field-text">
            <span>Text</span>
            <textarea
              className="sb-text-multiline"
              rows={2}
              value={runtime.text}
              onChange={(e) => setRuntime((r) => ({ ...r, text: e.target.value }))}
            />
          </label>
          <label className="sb-checkbox">
            <input
              type="checkbox"
              checked={runtime.fitToContent}
              onChange={(e) => setRuntime((r) => ({ ...r, fitToContent: e.target.checked }))}
            />
            <span>Size to content</span>
          </label>
          <label className="sb-checkbox">
            <input
              type="checkbox"
              checked={!!runtime.domeDebug}
              onChange={(e) => setRuntime((r) => ({ ...r, domeDebug: e.target.checked }))}
            />
            <span>Dome debug overlay</span>
          </label>
          <ColorRow
            label="Background"
            value={splitColor(design.bg).rgb}
            alphaDisabled
            onChange={(rgb) => setDesign((d) => ({ ...d, bg: rgb }))}
          /> {/* canvas bg is re-parsed to rgba(...,0.7) — alpha intentionally not exposed */}
        </div>

        <div className="sb-workspace">
          <aside className="sb-side-panel sb-side-panel-left">
            <PropertyPanel title="Body">
              <PropertyList pack="pairs">
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
                <SliderRow label="Shear" value={design.shear} min={-25} max={25} step={0.5} unit={<sup>°</sup>}
                  onChange={(v) => setDesign((d) => ({ ...d, shear: v }))} />
                <ColorRow
                  label="Text color"
                  value={splitColor(design.textColor).rgb}
                  alpha={splitColor(design.textColor).alpha}
                  onChange={(rgb) => setDesign((d) => ({ ...d, textColor: combineColor(rgb, splitColor(d.textColor).alpha) }))}
                  onAlphaChange={(a) => setDesign((d) => ({ ...d, textColor: combineColor(splitColor(d.textColor).rgb, a) }))}
                />
              </PropertyList>
            </PropertyPanel>

            <EffectLayerStack
              title="Morph"
              effects={morphEffects}
              kindSet={MORPH_EFFECTS}
              bodyW={design.width}
              bodyH={design.height}
              bodyShape={design.base}
              bodyParams={design.baseParams}
              onAdd={addEffect}
              onRemove={removeEffect}
              onReorder={(ks, ids) => setDesign((d) => ({ ...d, effects: reorderWithinKindSet(d.effects, ks, ids) }))}
              onPrimaryChange={updateEffectParam}
              onUpdateParam={updateEffectParam}
            />

            <EffectLayerStack
              title="Fill"
              effects={leftEffects}
              kindSet={LEFT_PANEL_EFFECTS}
              bodyW={design.width}
              bodyH={design.height}
              bodyShape={design.base}
              bodyParams={design.baseParams}
              onAdd={addEffect}
              onRemove={removeEffect}
              onReorder={(ks, ids) => setDesign((d) => ({ ...d, effects: reorderWithinKindSet(d.effects, ks, ids) }))}
              onPrimaryChange={updateEffectParam}
              onUpdateParam={updateEffectParam}
            />
          </aside>

          <section className="sb-preview">
            <div className="sb-preview-stage" ref={stageRef}>
              <SpeechBalloon design={design} runtime={runtime} zoom={view.zoom} />
            </div>
            <div className="sb-zoom-bar">
              <span className="sb-zoom-label">Zoom</span>
              <button type="button" onClick={() => store.updateWorkspaceView('balloon', { ...view, zoom: Math.max(0.1, view.zoom - 0.1) })} title="Zoom out">−</button>
              <input
                className="sb-zoom-slider"
                type="range"
                min={0.1}
                max={4}
                step={0.05}
                value={view.zoom}
                onChange={(e) => store.updateWorkspaceView('balloon', { ...view, zoom: Number(e.target.value) })}
              />
              <button type="button" onClick={() => store.updateWorkspaceView('balloon', { ...view, zoom: Math.min(4, view.zoom + 0.1) })} title="Zoom in">+</button>
              <span className="sb-zoom-readout">{Math.round(view.zoom * 100)}%</span>
              <button type="button" onClick={() => store.updateWorkspaceView('balloon', { ...view, zoom: 1 })} title="Reset to 100%">1:1</button>
              <button type="button" onClick={fitZoomToStage} title="Fit content to viewport">Fit</button>
            </div>
          </section>

          <aside className="sb-side-panel sb-side-panel-right">
            <div className="sb-tail-minimap-wrap">
              <TailMinimap
                width={260}
                height={200}
                bodyShape={design.base}
                bodyW={design.width}
                bodyH={design.height}
                bodyParams={design.baseParams}
                shear={design.shear}
                tails={minimapTails}
                onUpdateTail={updateTailFromMinimap}
                onCommitTail={() => { /* per-tail commit hook; debounced undo coalesces */ }}
                onAddTail={(angle) => addEffect('tail', { angle })}
                onRemoveTail={(id) => removeEffect(id)}
              />
            </div>
            <EffectLayerStack
              title="Tails"
              hideHead
              effects={rightEffects}
              kindSet={RIGHT_PANEL_EFFECTS}
              bodyW={design.width}
              bodyH={design.height}
              bodyShape={design.base}
              bodyParams={design.baseParams}
              decorate={(eff) =>
                eff.kind === 'tail'
                  ? {
                      accent: tailColor(tailColorSlotById.get(eff.id) ?? 0),
                      badge: String((tailIndexById.get(eff.id) ?? 0) + 1),
                    }
                  : {}
              }
              onAdd={addEffect}
              onRemove={removeEffect}
              onReorder={(ks, ids) => setDesign((d) => ({ ...d, effects: reorderWithinKindSet(d.effects, ks, ids) }))}
              onPrimaryChange={updateEffectParam}
              onUpdateParam={updateEffectParam}
            />
          </aside>
        </div>
      </div>
    </LabShell>
  );
}

// --- Field renderers -----------------------------------------------------

interface CurveBlockProps {
  label?: string;
  values: number[];
  min: number;
  max: number;
  step: number;
  defaults?: readonly number[];
  marks?: readonly CurveMark[];
  onChange: (vals: number[]) => void;
}
function CurveBlock({ label, values, min, max, step, defaults, marks, onChange }: CurveBlockProps) {
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
    <div className="sb-curve-block lk-property-group__span" ref={wrapRef}>
      {label && <h3 className="sb-curve-label">{label}</h3>}
      {width > 0 && (
        <KitCurveField values={values} min={min} max={max} step={step} width={width} defaults={defaults} marks={marks} onChange={onChange} />
      )}
    </div>
  );
}

interface ControlListProps {
  controls: LabControl[];
  params: ParamBag;
  onChange: (key: string, value: ParamValue) => void;
  bodyW?: number;
  bodyH?: number;
  bodyShape?: BalloonBase;
  bodyParams?: ParamBag;
}

function ControlList({ controls, params, onChange, bodyW, bodyH, bodyShape, bodyParams }: ControlListProps) {
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
        const rows = visible.map((c) => renderRow(c, params, onChange, bodyW, bodyH, bodyShape, bodyParams));
        if (g.header === null) return rows;
        return (
          <PropertyGroup key={`grp-${gi}`} title={g.header} hidden={g.hidden} pack="pairs">
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
  bodyShape?: BalloonBase,
  bodyParams?: ParamBag,
): React.ReactNode {
  if (c.kind === 'header') return null;
  const label = c.label ?? c.key;
  const value = params[c.key];
  const sampler: BaseSampler | undefined =
    bodyShape && bodyParams && bodyW !== undefined && bodyH !== undefined
      ? buildBaseSampler(bodyShape, bodyParams, bodyW, bodyH)
      : undefined;
  if (c.kind === 'range') {
    const dynMax = c.maxFn && bodyW !== undefined && bodyH !== undefined
      ? c.maxFn({ W: bodyW, H: bodyH, sampler })
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
        alpha={alphaSupported ? alpha : undefined}
        alphaDisabled={!alphaSupported}
        onChange={(nextRgb) =>
          onChange(c.key, combineColor(nextRgb, alphaSupported ? alpha : 1))
        }
        onAlphaChange={alphaSupported ? (nextAlpha) => onChange(c.key, combineColor(rgb, nextAlpha)) : undefined}
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
    let marks: readonly CurveMark[] | undefined;
    if (
      c.key === 'contour' &&
      typeof params.bevelWidth === 'number' &&
      sampler !== undefined
    ) {
      const { Rmin } = bareBaseRadiusRange(sampler);
      if (Rmin > 1e-3) {
        // Contour x: 0 = rim, 1 = center. The bevel face occupies [0, bw/R]
        // and R varies per direction; use Rmin (the narrowest direction) so
        // the band covers every direction's bevel face.
        const xMax = Math.min(1, params.bevelWidth / Rmin);
        marks = [{ kind: 'band', x: [0, xMax], color: '#ffcc00' }];
      }
    }
    return (
      <CurveBlock
        key={c.key}
        label={c.label}
        values={arr}
        min={c.min}
        max={c.max}
        step={c.step}
        defaults={c.defaults}
        marks={marks}
        onChange={(vals) => onChange(c.key, vals)}
      />
    );
  }
  if (c.kind === 'text') {
    return (
      <TextRow
        key={c.key}
        label={label}
        value={String(value ?? c.default)}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  }
  // Exhaustiveness check — every LabControl kind must be handled above.
  const _exhaustive: never = c;
  void _exhaustive;
  throw new Error(`[Lab] unhandled control kind: ${(c as { kind: string }).kind}`);
}

function splitColor(hex: string): { rgb: string; alpha: number } {
  const h = (hex ?? '').trim();
  if (h.length === 9) return { rgb: h.slice(0, 7), alpha: parseInt(h.slice(7, 9), 16) / 255 };
  if (h.length === 7) return { rgb: h, alpha: 1 };
  return { rgb: '#000000', alpha: 1 };
}
function combineColor(rgb: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  if (a === 255) return rgb;
  return `${rgb}${a.toString(16).padStart(2, '0')}`;
}

