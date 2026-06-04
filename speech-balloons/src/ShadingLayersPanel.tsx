import { useState } from 'react';
import type { ShadingItem } from './types';
import { groupShadingItems } from './shadingLayers';

interface Props {
  items: ShadingItem[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  // Visibility checkbox state — ids in this list render `display:none` via
  // the SVG <style> rules SpeechBalloon emits. Independent from highlight.
  hiddenIds: readonly string[];
  onSetHidden: (ids: string[]) => void;
}

export function ShadingLayersPanel({
  items, highlightedId, onHighlight,
  hiddenIds, onSetHidden,
}: Props) {
  const [hideNonLight, setHideNonLight] = useState(false);
  const groups = groupShadingItems(items, { hideNonLight });
  const hiddenSet = new Set(hiddenIds);

  const toggleHidden = (id: string) => {
    const next = new Set(hiddenSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSetHidden(Array.from(next));
  };

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
                const isVisible = !hiddenSet.has(item.id);
                return (
                  <li key={item.id} className="sb-shading-panel__item">
                    <input
                      type="checkbox"
                      className="sb-shading-panel__vis"
                      checked={isVisible}
                      onChange={() => toggleHidden(item.id)}
                      title={isVisible ? 'Hide this contributor' : 'Show this contributor'}
                      aria-label={`${isVisible ? 'Hide' : 'Show'} ${item.label}`}
                    />
                    <button
                      type="button"
                      className={`sb-shading-panel__row${isActive ? ' is-active' : ''}${isVisible ? '' : ' is-hidden'}`}
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
