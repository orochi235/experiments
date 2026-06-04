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
