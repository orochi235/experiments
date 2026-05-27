import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpeechBalloon } from './SpeechBalloon';
import {
  BASE_CONTROLS,
  EFFECT_CONTROLS,
  BASE_KINDS,
  LEFT_PANEL_EFFECTS,
  RIGHT_PANEL_EFFECTS,
  defaultParams,
  effectSummary,
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
          <h1>Speech Balloon Lab</h1>
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
          <button className="icon-btn" onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
            <UndoIcon />
          </button>
          <button className="icon-btn" onClick={redo} title="Redo (⌘⇧Z)" aria-label="Redo">
            <RedoIcon />
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
          />
        </aside>

        <section className="preview">
          <div className="preview-stage">
            <SpeechBalloon design={design} runtime={runtime} />
          </div>
        </section>

        <aside className="side-panel right">
          <Section title="Body">
            <label className="field">
              <span>Shape</span>
              <select value={design.base} onChange={(e) => setBase(e.target.value as BalloonBase)}>
                {BASE_KINDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
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
}: LayerStackProps) {
  // dropIndicator: { id, position } where `id` is the effect being hovered over
  const [dropHint, setDropHint] = useState<{ id: number; position: 'before' | 'after' } | null>(null);

  return (
    <>
      <h2 className="layer-stack-title">{title}</h2>
      <div className="layers-add">
        <span className="layers-add-label">+ Layer</span>
        {allKinds.map((k) => (
          <button key={k} onClick={() => onAdd(k)} className="add-layer-btn">
            {k}
          </button>
        ))}
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
}
function EffectCard({
  effect,
  expanded,
  dragging,
  onToggleExpanded,
  onRemove,
  onChange,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
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
      <div className="effect-head" onClick={onToggleExpanded} role="button" tabIndex={0}>
        <span
          className="drag-handle"
          aria-hidden="true"
          title="Drag to reorder"
          onMouseDown={() => setDraggable(true)}
          onMouseUp={() => setDraggable(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <DragHandleIcon />
        </span>
        <span className="caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="effect-kind">{effect.kind}</span>
        <span className="effect-summary">{effectSummary(effect.kind, effect.params)}</span>
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
      {expanded && (
        <div className="effect-body">
          <ControlList controls={EFFECT_CONTROLS[effect.kind]} params={effect.params} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-section">
      <h2>{title}</h2>
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
  labels: string[];
  min: number;
  max: number;
  step: number;
  onChange: (values: number[]) => void;
}
function CurveField({ values, labels, min, max, step, onChange }: CurveFieldProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // values is interleaved [x0, y0, x1, y1, ...]; pair count = values.length / 2.
  const points = useMemo(() => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
    return out;
  }, [values]);
  const N = points.length;

  const VBW = 100;
  const VBH = 80;
  const padX = 4;
  const padTop = 4;
  const padBot = 4;
  const innerW = VBW - 2 * padX;
  const innerH = VBH - padTop - padBot;

  const toCoord = (x: number, y: number) => ({
    x: padX + x * innerW,
    y: padTop + (1 - (y - min) / (max - min)) * innerH,
  });

  const fromClient = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * VBW;
    const svgY = ((clientY - rect.top) / rect.height) * VBH;
    const xNorm = Math.max(0, Math.min(1, (svgX - padX) / innerW));
    const yNorm = Math.max(0, Math.min(1, 1 - (svgY - padTop) / innerH));
    const y = min + yNorm * (max - min);
    const ySnap = Math.round(y / step) * step;
    return { x: xNorm, y: Math.max(min, Math.min(max, ySnap)) };
  };

  const handlePointerDown = (i: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
    setDragIdx(i);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null) return;
    const { x: rawX, y } = fromClient(e.clientX, e.clientY);
    // Constrain X to stay strictly between neighbors (monotone order).
    const eps = 0.001;
    const leftBound = dragIdx === 0 ? 0 : points[dragIdx - 1].x + eps;
    const rightBound = dragIdx === N - 1 ? 1 : points[dragIdx + 1].x - eps;
    const x = Math.max(leftBound, Math.min(rightBound, rawX));
    if (points[dragIdx].x === x && points[dragIdx].y === y) return;
    const next = values.slice();
    next[dragIdx * 2] = x;
    next[dragIdx * 2 + 1] = y;
    onChange(next);
  };
  const handlePointerEnd = () => setDragIdx(null);
  const handleDoubleClick = (i: number) => () => {
    const next = values.slice();
    next[i * 2] = N > 1 ? i / (N - 1) : 0;
    next[i * 2 + 1] = 0;
    onChange(next);
  };

  // Smooth cubic-Bezier path through the points, using Hermite tangents
  // computed by finite differences. Matches the interpolation used downstream
  // for the SVG gradient, so the editor preview is honest.
  const smoothPath = (() => {
    if (N < 2) return '';
    const tangents = points.map((p, i) => {
      if (i === 0) return (points[1].y - p.y) / Math.max(1e-3, points[1].x - p.x);
      if (i === N - 1) return (p.y - points[N - 2].y) / Math.max(1e-3, p.x - points[N - 2].x);
      return (points[i + 1].y - points[i - 1].y) / Math.max(1e-3, points[i + 1].x - points[i - 1].x);
    });
    let d = '';
    for (let i = 0; i < N - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const h = p1.x - p0.x;
      const c1 = toCoord(p0.x + h / 3, p0.y + (h * tangents[i]) / 3);
      const c2 = toCoord(p1.x - h / 3, p1.y - (h * tangents[i + 1]) / 3);
      const end = toCoord(p1.x, p1.y);
      if (i === 0) {
        const start = toCoord(p0.x, p0.y);
        d += `M ${start.x} ${start.y} `;
      }
      d += `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y} `;
    }
    return d.trim();
  })();

  const zeroNorm = (0 - min) / (max - min);
  const zeroY = padTop + (1 - zeroNorm) * innerH;

  return (
    <div className="curve-field">
      <svg
        ref={svgRef}
        className="curve-editor"
        viewBox={`0 0 ${VBW} ${VBH}`}
        preserveAspectRatio="none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <rect x="0" y="0" width={VBW} height={VBH} fill="rgba(0,0,0,0.35)" />
        {zeroNorm > 0 && zeroNorm < 1 && (
          <line
            x1={padX}
            y1={zeroY}
            x2={VBW - padX}
            y2={zeroY}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="2 2"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={smoothPath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => {
          const c = toCoord(p.x, p.y);
          const isActive = dragIdx === i;
          return (
            <g key={i}>
              <circle
                cx={c.x}
                cy={c.y}
                r="6"
                fill="transparent"
                style={{ cursor: 'move', touchAction: 'none' }}
                onPointerDown={handlePointerDown(i)}
                onDoubleClick={handleDoubleClick(i)}
              />
              <circle
                cx={c.x}
                cy={c.y}
                r={isActive ? 3.5 : 3}
                fill={isActive ? 'var(--accent)' : '#fff'}
                stroke="var(--accent)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
      <div className="curve-readouts">
        {points.map((p, i) => (
          <div key={i} className={`curve-stop-readout${dragIdx === i ? ' is-active' : ''}`}>
            <span>{labels[i] ?? `Stop ${i}`}</span>
            <em>{p.y.toFixed(step < 1 ? 2 : 0)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ControlListProps {
  controls: LabControl[];
  params: ParamBag;
  onChange: (key: string, value: ParamValue) => void;
}
function ControlList({ controls, params, onChange }: ControlListProps) {
  return (
    <>
      {controls.map((c, idx) => {
        if (c.kind === 'header') {
          if (c.hideWhen && c.hideWhen(params)) return null;
          return <h3 key={`h-${idx}`}>{c.label}</h3>;
        }
        if (c.hideWhen && c.hideWhen(params)) return null;
        const label = c.label ?? c.key;
        const value = params[c.key];
        if (c.kind === 'range') {
          return (
            <SliderField
              key={c.key}
              label={label}
              value={Number(value ?? c.default)}
              min={c.min}
              max={c.max}
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
            <CurveField
              key={c.key}
              values={arr}
              labels={c.labels}
              min={c.min}
              max={c.max}
              step={c.step}
              onChange={(vals) => onChange(c.key, vals)}
            />
          );
        }
        return (
          <label key={c.key} className="field text">
            <span>{label}</span>
            <input type="text" value={String(value ?? c.default)} onChange={(e) => onChange(c.key, e.target.value)} />
          </label>
        );
      })}
    </>
  );
}

function UndoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
    </svg>
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
