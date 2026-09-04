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
  useTrialState,
  useLabStore,
} from '@weasel-js/labkit';
import { pushSnapshot, undo as undoStackOp, redo as redoStackOp, emptyStack } from '@weasel-js/labkit/undo';
import { SpeechBalloon, bareBaseRadiusRange } from './SpeechBalloon';
import { ShadingLayersPanel } from './ShadingLayersPanel';
import { bareBaseMaxBevel, buildBaseSampler, type BaseSampler } from './geometry';
import {
  LayeredCurveEditor,
  createFunctionLayer,
  type AnchorRenderProps,
  type ControlPoint,
  type CurveLayer,
  type FunctionLayerState,
} from '@weasel-js/ui';
import { TailMinimap, tailColor, type MinimapTail } from './TailMinimap';
import { LightsPanel } from './LightsPanel';
import { ensureLights } from './lightRig';
import { interpFlat, migrateSeam, remapAcrossPartition, SEAM_X_EPS } from './contourEditor';
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
  ShadingItem,
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
  const { config: design, state: runtime, setConfig, setState } = useTrialState<RuntimeState, DesignState>();
  const store = useLabStore();
  const updateUndo = store.updateTrialUndoStack;
  const currentUndoStack = store.trials.find((w) => w.id === 'balloon')?.undoStack ?? emptyStack();
  const view = store.trials.find((w) => w.id === 'balloon')?.view ?? { zoom: 1.2, pan: { x: 0, y: 0 } };

  // Refs hold the latest staged value so chained setDesign / setRuntime calls
  // in the same tick compose instead of clobbering. Without these, two
  // back-to-back `setDesign(d => ...)` calls would both see the closure's
  // `design` from the last render, and the second would overwrite the
  // first's changes. (The partition drag — which writes both `contour` and
  // `bevelWidth` per tick — hit this exact bug.)
  const designRef = useRef(design);
  designRef.current = design;
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  const setDesign: React.Dispatch<React.SetStateAction<DesignState>> = useCallback((next) => {
    const current = designRef.current;
    const nextDesign = typeof next === 'function' ? (next as (d: DesignState) => DesignState)(current) : next;
    designRef.current = nextDesign;
    // setConfig is per-key; iterate top-level keys and only set those that changed.
    for (const k of Object.keys(nextDesign) as (keyof DesignState)[]) {
      if (current[k] !== nextDesign[k]) {
        setConfig(k, nextDesign[k] as never);
      }
    }
  }, [setConfig]);

  const setRuntime: React.Dispatch<React.SetStateAction<RuntimeState>> = useCallback((next) => {
    const current = runtimeRef.current;
    const nextRuntime = typeof next === 'function' ? (next as (r: RuntimeState) => RuntimeState)(current) : next;
    runtimeRef.current = nextRuntime;
    setState(nextRuntime);
  }, [setState]);

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
      ensureLights(parsed.design as unknown as Record<string, unknown>);
      setDesign(parsed.design);
      setRuntime(parsed.runtime);
    } catch (err) {
      alert(`Failed to load snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const [isPreparingSvg, setIsPreparingSvg] = useState(false);
  const [shadingItems, setShadingItems] = useState<ShadingItem[]>([]);
  const [highlightedShadingId, setHighlightedShadingId] = useState<string | null>(null);
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
    store.updateTrialView('balloon', { ...view, zoom: fit });
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
            <span>Debug overlay</span>
          </label>
          <label className="sb-checkbox">
            <input
              type="checkbox"
              checked={!!runtime.heightmapDebug}
              onChange={(e) => setRuntime((r) => ({ ...r, heightmapDebug: e.target.checked }))}
            />
            <span>Heightmap overlay</span>
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
              <SpeechBalloon
                design={design}
                runtime={runtime}
                zoom={view.zoom}
                onShadingItems={setShadingItems}
                highlightedShadingId={highlightedShadingId}
                onUpdateLight={(i, patch) =>
                  setDesign((d) => {
                    const cur = d.lights[i];
                    if (cur && cur.az === patch.az && cur.el === patch.el) return d; // no-op → same ref, per-key guard skips
                    return { ...d, lights: d.lights.map((l, k) => (k === i ? { ...l, ...patch } : l)) };
                  })
                }
              />
            </div>
            <div className="sb-zoom-bar">
              <span className="sb-zoom-label">Zoom</span>
              <button type="button" onClick={() => store.updateTrialView('balloon', { ...view, zoom: Math.max(0.1, view.zoom - 0.1) })} title="Zoom out">−</button>
              <input
                className="sb-zoom-slider"
                type="range"
                min={0.1}
                max={4}
                step={0.05}
                value={view.zoom}
                onChange={(e) => store.updateTrialView('balloon', { ...view, zoom: Number(e.target.value) })}
              />
              <button type="button" onClick={() => store.updateTrialView('balloon', { ...view, zoom: Math.min(4, view.zoom + 0.1) })} title="Zoom in">+</button>
              <span className="sb-zoom-readout">{Math.round(view.zoom * 100)}%</span>
              <button type="button" onClick={() => store.updateTrialView('balloon', { ...view, zoom: 1 })} title="Reset to 100%">1:1</button>
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
            <LightsPanel
              lights={design.lights}
              onChange={(next) => setDesign((d) => ({ ...d, lights: next }))}
              showHandles={runtime.showLightHandles !== false}
              onShowHandles={(show) => setRuntime((r) => ({ ...r, showLightHandles: show }))}
            />
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
            <ShadingLayersPanel
              items={shadingItems}
              highlightedId={highlightedShadingId}
              onHighlight={setHighlightedShadingId}
              hiddenIds={runtime.hiddenShadingIds ?? []}
              onSetHidden={(ids) => setRuntime((r) => ({ ...r, hiddenShadingIds: ids }))}
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

// ── Rim contour editor (LayeredCurveEditor) ───────────────────────────
// Replaces the single-layer CurveBlock for the `contour` param. Two
// function layers (bevel + spline) share a 1D domain split at x=b where
// b = bevelWidth / dMax. The bevel side is filled (golden), the spline
// side is just a stroke (purple). A draggable partition handle lets the
// user move b directly, which writes back through onChange to the
// `bevelWidth` param. Storage stays as a single flat number[] of anchors
// — the two-layer view is purely a UI affordance, with synthetic seam
// anchors interpolated at x=b when no real anchor sits exactly there.

interface PartitionState { x: number; y: number }

// Passive read-only layer that paints a yellow band across the plot to
// show the bevel face. The band spans [0, bevelWidth/Rmin] — from the
// rim inward to the deepest the bevel reaches on the narrowest body
// direction. It represents the bevel FACE, not the inner-edge ridge:
// starting it at bevelWidth/Rmax (the ridge zone) was reverted once
// already (711bbaf) — don't reintroduce it.
interface MarksLayerState { band: { xMin: number; xMax: number } | null }
function createMarksLayer(): CurveLayer<MarksLayerState> {
  return {
    id: 'marks',
    render(state, ctx) {
      if (!state.band) return null;
      const left = ctx.toPlot({ x: state.band.xMin, y: 0 }).x;
      const right = ctx.toPlot({ x: state.band.xMax, y: 0 }).x;
      const x = Math.min(left, right);
      const w = Math.max(1, Math.abs(right - left));
      return (
        <rect
          x={x} y={0}
          width={w} height={ctx.plotSize.height}
          fill="rgba(255, 204, 0, 0.18)"
          pointerEvents="none"
        />
      );
    },
  };
}

function createPartitionLayer(): CurveLayer<PartitionState> {
  return {
    id: 'partition',
    render(state, ctx) {
      const plotPt = ctx.toPlot({ x: state.x, y: state.y });
      const h = ctx.plotSize.height;
      // Goldenrod (matches the partition diamond) at full opacity when
      // active, dimmed when idle. Mid-tone grays disappeared against the
      // dark grid; tying the guide color to the handle keeps the bevel
      // edge legible at a glance.
      const guideStroke = ctx.isActive ? 'goldenrod' : 'rgba(218,165,32,0.7)';
      return (
        <g>
          <line
            x1={plotPt.x}
            x2={plotPt.x}
            y1={0}
            y2={h}
            stroke={guideStroke}
            strokeDasharray="2 4"
            strokeLinecap="round"
            strokeWidth={2}
          />
          <g style={{ cursor: 'move' }} data-anchor-index="partition">
            <Diamond cx={plotPt.x} cy={plotPt.y} size={10} />
          </g>
        </g>
      );
    },
    hitTest(state, plot, ctx) {
      const p = ctx.toPlot({ x: state.x, y: state.y });
      const dx = plot.x - p.x;
      const dy = plot.y - p.y;
      return dx * dx + dy * dy < 10 * 10 ? { kind: 'handle' } : null;
    },
    onPointerDown(_state, hit) {
      if (hit.kind !== 'handle') return;
      return {
        onMove(_state, model, _e, ctx) {
          const span = ctx.modelRange.xMax - ctx.modelRange.xMin;
          const pad = span * 0.05;
          const xLo = ctx.modelRange.xMin + pad;
          const xHi = ctx.modelRange.xMax - pad;
          const yLo = Math.min(ctx.modelRange.yMin, ctx.modelRange.yMax);
          const yHi = Math.max(ctx.modelRange.yMin, ctx.modelRange.yMax);
          return {
            x: Math.max(xLo, Math.min(xHi, model.x)),
            y: Math.max(yLo, Math.min(yHi, model.y)),
          };
        },
      };
    },
  };
}

function splitFlatAtPartition(flat: readonly number[], b: number): {
  bevel: ControlPoint[];
  spline: ControlPoint[];
} {
  const cpts: ControlPoint[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) cpts.push({ x: flat[i]!, y: flat[i + 1]! });
  cpts.sort((a, c) => a.x - c.x);
  // Decide whether an anchor "is" the seam.
  const seamIdx = cpts.findIndex((p) => Math.abs(p.x - b) < SEAM_X_EPS);
  const seamY = seamIdx >= 0 ? cpts[seamIdx]!.y : interpFlat(flat, b);
  const seam: ControlPoint = { x: b, y: seamY };
  const bevel = cpts.filter((p) => p.x < b - SEAM_X_EPS);
  const spline = cpts.filter((p) => p.x > b + SEAM_X_EPS);
  // Both layers need their boundary endpoints; bevel must include x=0 anchor
  // (synthesize if missing), spline must include x=1 anchor.
  if (bevel.length === 0 || Math.abs(bevel[0]!.x) > SEAM_X_EPS) {
    bevel.unshift({ x: 0, y: interpFlat(flat, 0) });
  }
  if (spline.length === 0 || Math.abs(spline[spline.length - 1]!.x - 1) > SEAM_X_EPS) {
    spline.push({ x: 1, y: interpFlat(flat, 1) });
  }
  bevel.push(seam);
  spline.unshift(seam);
  return { bevel, spline };
}

// Merge a layer's incoming points back into the unified flat array.
//   - `incoming` is the layer's new anchors (with first or last at x=b).
//   - `otherSide` is the OTHER layer's current anchors (also bookended at b).
//   - The seam (at x=b) is taken from `incoming` so the user's seam-y drag
//     wins; the other side adopts it on the next render via splitFlatAtPartition.
function mergeLayerPoints(
  incoming: readonly ControlPoint[],
  otherSide: readonly ControlPoint[],
  b: number,
): number[] {
  const all: ControlPoint[] = [];
  // Push all from `incoming` (including its seam anchor at x=b).
  for (const p of incoming) all.push(p);
  // From the other side, skip its seam anchor (which is at x=b) so we don't
  // get two seam entries; `incoming`'s seam is the canonical one.
  for (const p of otherSide) {
    if (Math.abs(p.x - b) < SEAM_X_EPS) continue;
    all.push(p);
  }
  all.sort((a, c) => a.x - c.x);
  // Flatten.
  const out: number[] = [];
  for (const p of all) out.push(p.x, p.y);
  return out;
}

interface RimContourBlockProps {
  label?: string;
  values: number[];
  bevelWidth: number;
  dMax: number;
  defaultContour: readonly number[];
  bevelBand?: { xMin: number; xMax: number } | null;
  onContourChange: (vals: number[]) => void;
  onBevelWidthChange: (px: number) => void;
}

// Mirrors the `bevelWidth` control's default in `controls.ts`. Reset uses
// it so one click returns both the curve and the partition to the
// canonical starting state.
const DEFAULT_BEVEL_WIDTH_PX = 22;

function Diamond({ cx, cy, size = 8, fill = 'goldenrod' }: { cx: number; cy: number; size?: number; fill?: string }) {
  const r = size / 2;
  return (
    <polygon
      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
      fill={fill}
    />
  );
}

// Pulls the y of the seam anchor at x≈b out of a flat values array, or
// falls back to a linear-interp estimate if the array hasn't been
// migrated to include one yet (first render).
function seamYFromValues(values: readonly number[], b: number): number {
  for (let i = 0; i + 1 < values.length; i += 2) {
    if (Math.abs(values[i]! - b) < SEAM_X_EPS) return values[i + 1]!;
  }
  return interpFlat(values, b);
}

function RimContourBlock({
  label,
  values,
  bevelWidth,
  dMax,
  defaultContour,
  bevelBand,
  onContourChange,
  onBevelWidthChange,
}: RimContourBlockProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Partition x in model space [0, 1] derived from the px-valued bevelWidth.
  const b = Math.max(0.05, Math.min(0.95, dMax > 0 ? bevelWidth / dMax : 0.25));

  // Keep the seam-anchor invariant (a real anchor at x≈b) when b changes
  // out from under the contour — the bevel-width slider writes only
  // `bevelWidth`, so the contour must follow here. A seam at the previous
  // b MOVES via the same proportional remap as a partition drag; plain
  // insertion only happens on first mount of a seam-less stored contour.
  // (Insert-without-remove here was the stray-anchor-per-slider-tick bug.)
  const prevBRef = useRef(b);
  useEffect(() => {
    const bPrev = prevBRef.current;
    prevBRef.current = b;
    const next = migrateSeam(values, bPrev, b);
    if (next) onContourChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b]);

  const { bevel, spline } = useMemo(() => splitFlatAtPartition(values, b), [values, b]);

  const bevelLayer = useMemo(() => createFunctionLayer({
    id: 'bevel',
    domain: '1d',
    endpoints: 'pinned-x',
    constrain: 'function',
    addPointMode: 'click-curve',
    fill: { side: 'below' },
    xClamp: [0, b],
    minPoints: 2,
    renderAnchor: ({ cx, cy, point, isPinnedEndpoint }: AnchorRenderProps) => {
      if (!isPinnedEndpoint) return undefined; // default circle for user anchors
      // x=0 endpoint: goldenrod diamond. Seam endpoint (x≈b): hidden — the
      // partition layer's circle is the visible anchor at the seam.
      if (Math.abs(point.x) < SEAM_X_EPS) return <Diamond cx={cx} cy={cy} />;
      return null;
    },
  }), [b]);
  const splineLayer = useMemo(() => createFunctionLayer({
    id: 'spline',
    domain: '1d',
    endpoints: 'pinned-x',
    constrain: 'function',
    addPointMode: 'click-curve',
    xClamp: [b, 1],
    minPoints: 2,
    renderAnchor: ({ cx, cy, point, isPinnedEndpoint }: AnchorRenderProps) => {
      if (!isPinnedEndpoint) return undefined;
      // x=1 endpoint: goldenrod diamond. Seam endpoint (x≈b): hidden.
      if (Math.abs(point.x - 1) < SEAM_X_EPS) return <Diamond cx={cx} cy={cy} />;
      return null;
    },
  }), [b]);
  const partitionLayer = useMemo(() => createPartitionLayer(), []);
  const marksLayer = useMemo(() => createMarksLayer(), []);

  // Marks layer first so the band paints UNDER the curves and partition.
  const layers = useMemo(() => [
    { layer: marksLayer, state: { band: bevelBand ?? null } as MarksLayerState },
    { layer: bevelLayer, state: { points: bevel, activeIndex: null } as FunctionLayerState },
    { layer: splineLayer, state: { points: spline, activeIndex: null } as FunctionLayerState },
    { layer: partitionLayer, state: { x: b, y: seamYFromValues(values, b) } as PartitionState },
  ], [marksLayer, bevelBand, bevelLayer, bevel, splineLayer, spline, partitionLayer, b]);

  const onLayerChange = (id: string, nextUnknown: unknown) => {
    if (id === 'bevel') {
      const next = nextUnknown as FunctionLayerState;
      onContourChange(mergeLayerPoints(next.points, spline, b));
    } else if (id === 'spline') {
      const next = nextUnknown as FunctionLayerState;
      onContourChange(mergeLayerPoints(next.points, bevel, b));
    } else if (id === 'partition') {
      const next = nextUnknown as PartitionState;
      const bOld = b;
      const bNew = next.x;
      const seamY = next.y;
      const remapped = remapAcrossPartition(values, bOld, bNew, seamY);
      onContourChange(remapped);
      onBevelWidthChange(bNew * dMax);
    }
  };

  const height = width > 0 ? Math.round(width * 0.6) : 0;

  // Reset returns the curve to the three constrained anchors only — any
  // user-added intermediate points are discarded. Y values at x=0, x=b,
  // and x=1 are sampled from the default curve so the shape still feels
  // like the canonical starting point.
  const handleReset = () => {
    const bNew = Math.max(0.05, Math.min(0.95, DEFAULT_BEVEL_WIDTH_PX / dMax));
    const y0 = interpFlat(defaultContour, 0);
    const ySeam = interpFlat(defaultContour, bNew);
    const y1 = interpFlat(defaultContour, 1);
    onContourChange([0, y0, bNew, ySeam, 1, y1]);
    onBevelWidthChange(DEFAULT_BEVEL_WIDTH_PX);
  };

  // Mirror around x=0.5: every anchor (x, y) becomes (1−x, y). The seam
  // moves with the rest so the bevel/spline sides swap roles and no
  // anchor ends up on the wrong side of its constraint.
  const handleFlip = () => {
    const flipped: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < values.length; i += 2) {
      flipped.push({ x: 1 - values[i]!, y: values[i + 1]! });
    }
    flipped.sort((a, c) => a.x - c.x);
    const out: number[] = [];
    for (const p of flipped) out.push(p.x, p.y);
    onContourChange(out);
    onBevelWidthChange(Math.max(0, dMax - bevelWidth));
  };

  return (
    <div className="sb-curve-block lk-property-group__span" ref={wrapRef}>
      {label && <h3 className="sb-curve-label">{label}</h3>}
      {width > 0 && (
        <LayeredCurveEditor
          layers={layers}
          onLayerChange={onLayerChange}
          width={width}
          height={height}
          xRange={[0, 1]}
          yRange={[0, 1]}
          grid={{ divisions: 4 }}
          axes={{}}
        >
          <style>{`
            [data-layer-id="bevel"] {
              --curve-line: goldenrod;
              --curve-fill: color-mix(in srgb, goldenrod 35%, transparent);
              --curve-anchor-fill: goldenrod;
              --curve-anchor-stroke: goldenrod;
            }
            [data-layer-id="spline"] {
              --curve-line: rebeccapurple;
            }
          `}</style>
        </LayeredCurveEditor>
      )}
      <div className="sb-curve-actions">
        <button type="button" onClick={handleReset}>Reset</button>
        <button type="button" onClick={handleFlip}>Flip horizontally</button>
      </div>
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
    // Special: the dome `contour` uses the rim/spline layered editor with a
    // draggable partition handle bound to `bevelWidth`. dMax is the medial-
    // axis depth of the bare body — same value the heightmap & shading use
    // to normalize bevelWidth → partition x.
    if (c.key === 'contour' && sampler && typeof params.bevelWidth === 'number') {
      const dMax = Math.max(1, bareBaseMaxBevel(sampler));
      // Yellow bevel-face band: [0, bw / Rmin]. Contour x: 0 = rim,
      // 1 = center. The bevel face occupies [0, bw/R] and R varies per
      // direction; use Rmin (the narrowest direction) so the band covers
      // every direction's bevel face. (Restores 711bbaf, which the
      // layered-editor rewrite in bbc78e4 accidentally reverted.)
      let bevelBand: { xMin: number; xMax: number } | null = null;
      const { Rmin } = bareBaseRadiusRange(sampler);
      if (Rmin > 1e-3) {
        bevelBand = { xMin: 0, xMax: Math.min(1, params.bevelWidth / Rmin) };
      }
      return (
        <RimContourBlock
          key={c.key}
          label={c.label}
          values={arr}
          bevelWidth={params.bevelWidth}
          dMax={dMax}
          defaultContour={c.defaults}
          bevelBand={bevelBand}
          onContourChange={(vals) => onChange(c.key, vals)}
          onBevelWidthChange={(px) => onChange('bevelWidth', px)}
        />
      );
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

