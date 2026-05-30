import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SpeechBalloon } from './SpeechBalloon';
import { CurveEditor, type ControlPoint } from './CurveEditor';
import {
  BASE_CONTROLS,
  EFFECT_CONTROLS,
  BASE_KINDS,
  LEFT_PANEL_EFFECTS,
  RIGHT_PANEL_EFFECTS,
  defaultParams,
  type LabControl,
} from './controls';
import { loadSnapshot, saveSnapshot, LAB_STORAGE_KEY } from './persistence';
import type {
  BalloonBase,
  DesignState,
  EffectInstance,
  EffectKind,
  LabSnapshot,
  ParamBag,
  ParamValue,
  RuntimeState,
} from './types';

const FONT_OPTIONS = [
  { label: 'Comic Neue', value: 'Comic Neue, system-ui, sans-serif' },
  { label: 'Bangers', value: 'Bangers, system-ui, sans-serif' },
  { label: 'Oswald', value: 'Oswald, sans-serif' },
  { label: 'System sans-serif', value: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  { label: 'System monospace', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { label: 'System serif', value: 'ui-serif, Georgia, serif' },
];

export function Lab() {
  const initial = useMemo(() => loadSnapshot(), []);
  const [runtime, setRuntime] = useState<RuntimeState>(initial.runtime);
  const [design, setDesign] = useState<DesignState>(initial.design);
  const [nextId, setNextId] = useState<number>(initial.nextId);
  // Per-effect expand/collapse state (UI-only, not persisted).
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set(initial.design.effects.map((e) => e.id)));
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const currentSnapshot = useCallback(
    (): LabSnapshot => ({ runtime, design, nextId }),
    [runtime, design, nextId],
  );

  useEffect(() => {
    saveSnapshot(currentSnapshot());
  }, [currentSnapshot]);

  // Undo/redo with debounced snapshot coalescing.
  const undoRef = useRef<LabSnapshot[]>([initial]);
  const redoRef = useRef<LabSnapshot[]>([]);
  const isRestoringRef = useRef(false);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => {
      const snap = currentSnapshot();
      const top = undoRef.current[undoRef.current.length - 1];
      if (top && JSON.stringify(top) === JSON.stringify(snap)) return;
      undoRef.current.push(snap);
      if (undoRef.current.length > 200) undoRef.current.shift();
      redoRef.current = [];
      forceRerender((n) => n + 1);
    }, 300);
  }, [currentSnapshot]);

  const applySnapshot = (snap: LabSnapshot) => {
    isRestoringRef.current = true;
    setRuntime(snap.runtime);
    setDesign(snap.design);
    setNextId(snap.nextId);
  };

  const undo = () => {
    if (undoRef.current.length <= 1) return;
    const current = undoRef.current.pop()!;
    redoRef.current.push(current);
    applySnapshot(undoRef.current[undoRef.current.length - 1]);
    forceRerender((n) => n + 1);
  };
  const redo = () => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    undoRef.current.push(snap);
    applySnapshot(snap);
    forceRerender((n) => n + 1);
  };

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
  }, []);

  // --- Effect mutators ----------------------------------------------------

  const updateEffectParam = (id: number, key: string, value: ParamValue) => {
    setDesign((d) => ({
      ...d,
      effects: d.effects.map((e) => (e.id === id ? { ...e, params: { ...e.params, [key]: value } } : e)),
    }));
  };
  const addEffect = (kind: EffectKind) => {
    const inst: EffectInstance = { id: nextId, kind, params: defaultParams(EFFECT_CONTROLS[kind]) };
    setNextId((n) => n + 1);
    setDesign((d) => ({ ...d, effects: [...d.effects, inst] }));
    // Newly-added effects start expanded so the user can tweak right away.
    setExpandedIds((s) => new Set(s).add(inst.id));
  };
  const removeEffect = (id: number) => {
    setDesign((d) => ({ ...d, effects: d.effects.filter((e) => e.id !== id) }));
    setExpandedIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  };
  const reorderEffect = (dragId: number, targetId: number, position: 'before' | 'after') => {
    if (dragId === targetId) return;
    setDesign((d) => {
      const out = d.effects.slice();
      const fromIdx = out.findIndex((e) => e.id === dragId);
      if (fromIdx < 0) return d;
      const [moved] = out.splice(fromIdx, 1);
      const targetIdx = out.findIndex((e) => e.id === targetId);
      if (targetIdx < 0) return d;
      const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
      out.splice(insertAt, 0, moved);
      return { ...d, effects: out };
    });
  };
  const toggleExpanded = (id: number) => {
    setExpandedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const updateBaseParam = (key: string, value: ParamValue) => {
    setDesign((d) => ({ ...d, baseParams: { ...d.baseParams, [key]: value } }));
  };
  const setBase = (base: BalloonBase) => {
    setDesign((d) => ({ ...d, base, baseParams: defaultParams(BASE_CONTROLS[base]) }));
  };

  const resetAll = () => {
    if (!confirm('Reset all controls to defaults?')) return;
    localStorage.removeItem(LAB_STORAGE_KEY);
    const snap = loadSnapshot();
    applySnapshot(snap);
    undoRef.current = [snap];
    redoRef.current = [];
    setExpandedIds(new Set(snap.design.effects.map((e) => e.id)));
    forceRerender((n) => n + 1);
  };

  const exportSnapshot = () => {
    const snap = currentSnapshot();
    const json = JSON.stringify(snap, null, 2);
    navigator.clipboard?.writeText(json);
    console.log('Lab snapshot copied to clipboard:\n', json);
  };

  const leftEffects = design.effects.filter((e) => LEFT_PANEL_EFFECTS.includes(e.kind));
  const rightEffects = design.effects.filter((e) => RIGHT_PANEL_EFFECTS.includes(e.kind));

  return (
    <div className="lab">
      <header className="toolbar">
        <div className="brand">
          <h1>{`I'll take "Balloons" for $600, Alex`}</h1>
        </div>
        <div className="toolbar-group">
          <label className="field">
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
          <label className="field range">
            <span>
              Size <em>{runtime.fontSize}</em>
            </span>
            <input
              type="range"
              min={10}
              max={72}
              step={1}
              value={runtime.fontSize}
              onChange={(e) => setRuntime((r) => ({ ...r, fontSize: Number(e.target.value) }))}
            />
          </label>
          <label className="field text">
            <span>Text</span>
            <input
              type="text"
              value={runtime.text}
              onChange={(e) => setRuntime((r) => ({ ...r, text: e.target.value }))}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={runtime.fitToContent}
              onChange={(e) => setRuntime((r) => ({ ...r, fitToContent: e.target.checked }))}
            />
            <span>Size to content</span>
          </label>
        </div>
        <div className="toolbar-group right">
          <button onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
            Undo
          </button>
          <button onClick={redo} title="Redo (⌘⇧Z)" aria-label="Redo">
            Redo
          </button>
          <button onClick={exportSnapshot} title="Copy snapshot JSON to clipboard">
            Export
          </button>
          <button onClick={resetAll} className="danger" title="Reset to defaults">
            Reset all
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="side-panel left">
          <Section
            title="Body"
            headerRight={
              <select
                className="effect-primary"
                value={design.base}
                onChange={(e) => setBase(e.target.value as BalloonBase)}
              >
                {BASE_KINDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            }
          >
            <ControlList
              controls={BASE_CONTROLS[design.base]}
              params={design.baseParams}
              onChange={updateBaseParam}
            />
            {runtime.fitToContent ? (
              <>
                <SliderField label="Pad X" value={design.padX} min={4} max={80} step={1} fixed={0}
                  onChange={(v) => setDesign((d) => ({ ...d, padX: v }))} />
                <SliderField label="Pad Y" value={design.padY} min={4} max={60} step={1} fixed={0}
                  onChange={(v) => setDesign((d) => ({ ...d, padY: v }))} />
              </>
            ) : (
              <>
                <SliderField
                  label="Size"
                  value={Math.max(design.width, design.height)}
                  min={60}
                  max={500}
                  step={2}
                  fixed={0}
                  onChange={(v) => setDesign((d) => {
                    const ar = d.width / d.height;
                    return ar >= 1
                      ? { ...d, width: v, height: Math.round(v / ar) }
                      : { ...d, width: Math.round(v * ar), height: v };
                  })}
                />
                <SliderField
                  label="Aspect ratio"
                  value={design.width / design.height}
                  min={0.3}
                  max={3.5}
                  step={0.05}
                  fixed={2}
                  onChange={(ar) => setDesign((d) => {
                    const size = Math.max(d.width, d.height);
                    return ar >= 1
                      ? { ...d, width: size, height: Math.round(size / ar) }
                      : { ...d, width: Math.round(size * ar), height: size };
                  })}
                />
              </>
            )}
            <SliderField label="Italic lean" value={design.lean} min={-25} max={25} step={0.5} fixed={1}
              onChange={(v) => setDesign((d) => ({ ...d, lean: v }))} />
            <label className="field color">
              <span>Text color</span>
              <input type="color" value={design.textColor}
                onChange={(e) => setDesign((d) => ({ ...d, textColor: e.target.value }))} />
            </label>
            <label className="field color">
              <span>Background</span>
              <input type="color" value={design.bg}
                onChange={(e) => setDesign((d) => ({ ...d, bg: e.target.value }))} />
            </label>
          </Section>

          <LayerStack
            title="Fill"
            effects={leftEffects}
            allKinds={LEFT_PANEL_EFFECTS}
            expandedIds={expandedIds}
            draggingId={draggingId}
            onAdd={addEffect}
            onRemove={removeEffect}
            onToggleExpanded={toggleExpanded}
            onReorder={reorderEffect}
            onChange={updateEffectParam}
            onDragStart={setDraggingId}
            onDragEnd={() => setDraggingId(null)}
            bodyW={design.width}
            bodyH={design.height}
          />
        </aside>

        <section className="preview">
          <div className="preview-stage">
            <SpeechBalloon design={design} runtime={runtime} />
          </div>
        </section>

        <aside className="side-panel right">
          <LayerStack
            title="Effects"
            effects={rightEffects}
            allKinds={RIGHT_PANEL_EFFECTS}
            expandedIds={expandedIds}
            draggingId={draggingId}
            onAdd={addEffect}
            onRemove={removeEffect}
            onToggleExpanded={toggleExpanded}
            onReorder={reorderEffect}
            onChange={updateEffectParam}
            onDragStart={setDraggingId}
            onDragEnd={() => setDraggingId(null)}
          />
        </aside>
      </main>
    </div>
  );
}

// --- Layer stack: add palette + draggable expandable cards ---------------

interface LayerStackProps {
  title: string;
  effects: EffectInstance[];
  allKinds: EffectKind[];
  expandedIds: Set<number>;
  draggingId: number | null;
  onAdd: (kind: EffectKind) => void;
  onRemove: (id: number) => void;
  onToggleExpanded: (id: number) => void;
  onReorder: (dragId: number, targetId: number, position: 'before' | 'after') => void;
  onChange: (id: number, key: string, value: ParamValue) => void;
  onDragStart: (id: number | null) => void;
  onDragEnd: () => void;
  bodyW?: number;
  bodyH?: number;
}
function LayerStack({
  title,
  effects,
  allKinds,
  expandedIds,
  draggingId,
  onAdd,
  onRemove,
  onToggleExpanded,
  onReorder,
  onChange,
  onDragStart,
  onDragEnd,
  bodyW,
  bodyH,
}: LayerStackProps) {
  // dropIndicator: { id, position } where `id` is the effect being hovered over
  const [dropHint, setDropHint] = useState<{ id: number; position: 'before' | 'after' } | null>(null);

  return (
    <>
      <div className="layer-stack-head">
        <h2 className="layer-stack-title">{title}</h2>
        <div className="layers-add">
          <span className="layers-add-label">+ Layer</span>
          {allKinds.map((k) => (
            <button key={k} onClick={() => onAdd(k)} className="add-layer-btn">
              {k}
            </button>
          ))}
        </div>
      </div>
      {effects.map((eff) => {
        const isExpanded = expandedIds.has(eff.id);
        const isDragging = draggingId === eff.id;
        const showHintBefore = dropHint && dropHint.id === eff.id && dropHint.position === 'before';
        const showHintAfter = dropHint && dropHint.id === eff.id && dropHint.position === 'after';
        return (
          <div key={eff.id} className="layer-wrap">
            {showHintBefore && <div className="drop-hint" />}
            <EffectCard
              effect={eff}
              expanded={isExpanded}
              dragging={isDragging}
              onToggleExpanded={() => onToggleExpanded(eff.id)}
              onRemove={() => onRemove(eff.id)}
              onChange={(key, value) => onChange(eff.id, key, value)}
              onDragStart={() => onDragStart(eff.id)}
              onDragEnd={() => {
                onDragEnd();
                setDropHint(null);
              }}
              onDragOver={(e) => {
                if (draggingId === null || draggingId === eff.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                setDropHint({ id: eff.id, position });
              }}
              onDragLeave={() => {
                setDropHint((h) => (h && h.id === eff.id ? null : h));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId === null || draggingId === eff.id) return;
                const dragKind = effects.find((x) => x.id === draggingId)?.kind;
                if (!dragKind) return;
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                onReorder(draggingId, eff.id, position);
                setDropHint(null);
              }}
              bodyW={bodyW}
              bodyH={bodyH}
            />
            {showHintAfter && <div className="drop-hint" />}
          </div>
        );
      })}
      {effects.length === 0 && <div className="layers-empty">No layers — add one above.</div>}
    </>
  );
}

interface EffectCardProps {
  effect: EffectInstance;
  expanded: boolean;
  dragging: boolean;
  onToggleExpanded: () => void;
  onRemove: () => void;
  onChange: (key: string, value: ParamValue) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  bodyW?: number;
  bodyH?: number;
}
function EffectCard({
  effect,
  expanded,
  dragging,
  onToggleExpanded: _onToggleExpanded,
  onRemove,
  onChange,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  bodyW,
  bodyH,
}: EffectCardProps) {
  // Drag is opt-in: the card is only `draggable` while the user is pressing the
  // ⋮⋮ handle. Without this, the whole card swallows pointer events to inner
  // controls (sliders, color pickers) since `draggable` intercepts the drag start.
  const [draggable, setDraggable] = useState(false);
  return (
    <div
      className={`effect-card ${expanded ? 'is-expanded' : 'is-collapsed'} ${dragging ? 'is-dragging' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(effect.id));
        onDragStart();
      }}
      onDragEnd={() => {
        setDraggable(false);
        onDragEnd();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {(() => {
        // Hoist the effect's primary mode/shape select into the title bar.
        // We treat the first non-header control as primary when it's a
        // select — that's `mode` on fill, `shape` on tail; spikes / stroke
        // / shadow have none.
        const allControls = EFFECT_CONTROLS[effect.kind];
        const firstNonHeader = allControls.find((c) => c.kind !== 'header');
        const primarySelect = firstNonHeader && firstNonHeader.kind === 'select' ? firstNonHeader : null;
        const bodyControls = primarySelect
          ? allControls.filter((c) => !('key' in c) || c.key !== primarySelect.key)
          : allControls;
        const primaryValue = primarySelect
          ? String(effect.params[primarySelect.key] ?? primarySelect.default)
          : '';
        return (
          <>
            <div className="effect-head">
              <span
                className="drag-handle"
                aria-hidden="true"
                title="Drag to reorder"
                onMouseDown={() => setDraggable(true)}
                onMouseUp={() => setDraggable(false)}
              >
                <DragHandleIcon />
              </span>
              <span className="effect-kind">{effect.kind}</span>
              {primarySelect && (
                <select
                  className="effect-primary"
                  value={primaryValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onChange(primarySelect.key, e.target.value)}
                >
                  {primarySelect.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              )}
              <button
                className="card-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Remove layer"
                aria-label="Remove layer"
              >
                ✕
              </button>
            </div>
            {(
              <div className="effect-body">
                <ControlList controls={bodyControls} params={effect.params} onChange={onChange} bodyW={bodyW} bodyH={bodyH} />
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

function Section({ title, headerRight, children }: { title: string; headerRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel-section">
      <div className="panel-section-head">
        <h2>{title}</h2>
        {headerRight}
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

// --- Field renderers -----------------------------------------------------

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fixed: number;
  onChange: (v: number) => void;
}
function SliderField({ label, value, min, max, step, fixed, onChange }: SliderFieldProps) {
  return (
    <label className="field range">
      <span>
        {label} <em>{Number(value).toFixed(fixed)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

interface CurveFieldProps {
  values: number[];
  min: number;
  max: number;
  step: number;
  onChange: (values: number[]) => void;
}
function CurveField({ values, min, max, step, onChange }: CurveFieldProps) {
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

  const points: ControlPoint[] = useMemo(() => {
    const out: ControlPoint[] = [];
    for (let i = 0; i + 1 < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
    return out;
  }, [values]);

  const handleChange = useCallback((next: ControlPoint[]) => {
    const flat: number[] = new Array(next.length * 2);
    for (let i = 0; i < next.length; i++) {
      const ySnap = Math.round(next[i].y / step) * step;
      const y = Math.max(min, Math.min(max, ySnap));
      flat[i * 2] = next[i].x;
      flat[i * 2 + 1] = y;
    }
    onChange(flat);
  }, [onChange, min, max, step]);

  // Flip the curve left-to-right: each point at (x, y) becomes (1 - x, y);
  // then resort so x is monotonic. Pairs swap rim ↔ center semantics.
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

  const HEIGHT = 110;
  return (
    <div className="curve-field">
      <div ref={wrapRef} className="curve-editor-host">
        {width > 0 && (
          <CurveEditor
            value={points}
            onChange={handleChange}
            domain="1d"
            constrain="function"
            xRange={[0, 1]}
            yRange={[min, max]}
            width={width}
            height={HEIGHT}
            endpoints="pinned-x"
            addPointMode="click-curve"
            minPoints={2}
            grid={{}}
          />
        )}
      </div>
      <div className="curve-readouts">
        {points.map((p, i) => (
          <div key={i} className="curve-stop-readout">
            <em>{p.y.toFixed(step < 1 ? 2 : 0)}</em>
          </div>
        ))}
      </div>
      <button type="button" className="curve-flip-btn" onClick={handleFlip}>
        Flip horizontally
      </button>
    </div>
  );
}

interface ControlListProps {
  controls: LabControl[];
  params: ParamBag;
  onChange: (key: string, value: ParamValue) => void;
  bodyW?: number;
  bodyH?: number;
}
function renderControl(
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
      <SliderField
        key={c.key}
        label={label}
        value={clampedValue}
        min={c.min}
        max={dynMax}
        step={c.step}
        fixed={c.step < 1 ? 2 : 0}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  }
  if (c.kind === 'select') {
    return (
      <label key={c.key} className="field">
        <span>{label}</span>
        <select value={String(value ?? c.default)} onChange={(e) => onChange(c.key, e.target.value)}>
          {c.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  if (c.kind === 'color') {
    return (
      <label key={c.key} className="field color">
        <span>{label}</span>
        <input type="color" value={String(value ?? c.default)} onChange={(e) => onChange(c.key, e.target.value)} />
      </label>
    );
  }
  if (c.kind === 'toggle') {
    return (
      <label key={c.key} className="checkbox">
        <input type="checkbox" checked={Boolean(value ?? c.default)} onChange={(e) => onChange(c.key, e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (c.kind === 'curve') {
    const arr = Array.isArray(value) ? (value as number[]) : c.defaults;
    return (
      <div key={c.key} className="curve-block">
        {c.label && <h3 className="curve-label">{c.label}</h3>}
        <CurveField
          values={arr}
          min={c.min}
          max={c.max}
          step={c.step}
          onChange={(vals) => onChange(c.key, vals)}
        />
      </div>
    );
  }
  return (
    <label key={c.key} className="field text">
      <span>{label}</span>
      <input type="text" value={String(value ?? c.default)} onChange={(e) => onChange(c.key, e.target.value)} />
    </label>
  );
}

function ControlList({ controls, params, onChange, bodyW, bodyH }: ControlListProps) {
  // Group controls by their containing header so headered sections render
  // inside a `.subpanel` with its own background. Controls before the first
  // header render inline at the parent grid level.
  type Group = { header: string | null; items: LabControl[] };
  const groups: Group[] = [{ header: null, items: [] }];
  for (const c of controls) {
    if (c.kind === 'header') {
      if (c.hideWhen && c.hideWhen(params)) continue;
      groups.push({ header: c.label, items: [] });
    } else {
      groups[groups.length - 1].items.push(c);
    }
  }
  return (
    <>
      {groups.map((g, gi) => {
        const visible = g.items.filter((c) => !c.hideWhen || !c.hideWhen(params));
        if (visible.length === 0) return null;
        if (g.header === null) {
          return visible.map((c) => renderControl(c, params, onChange, bodyW, bodyH));
        }
        return (
          <div key={`grp-${gi}`} className="subpanel">
            <h3 className="subpanel-title">{g.header}</h3>
            {visible.map((c) => renderControl(c, params, onChange, bodyW, bodyH))}
          </div>
        );
      })}
    </>
  );
}

function DragHandleIcon() {
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
