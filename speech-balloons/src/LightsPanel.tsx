import { PropertyList, PropertyPanel, SliderRow, ColorRow } from '@weasel-js/labkit';
import type { LightInstance } from './types';
import { MAX_LIGHTS, MIN_LIGHTS, newLight } from './lightRig';

interface Props {
  lights: LightInstance[];
  onChange: (next: LightInstance[]) => void;
  showHandles: boolean;
  onShowHandles: (show: boolean) => void;
}

export function LightsPanel({ lights, onChange, showHandles, onShowHandles }: Props) {
  const update = (i: number, patch: Partial<LightInstance>) =>
    onChange(lights.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <PropertyPanel title="Lights">
      <label className="sb-checkbox sb-lights-handles-toggle">
        <input
          type="checkbox"
          checked={showHandles}
          onChange={(e) => onShowHandles(e.target.checked)}
        />
        <span>Show handles</span>
      </label>
      {lights.map((light, i) => (
        <section key={i} className="sb-light-group">
          <header className="sb-light-group__head">
            <h4 className="sb-light-group__title">Light {i + 1}</h4>
            <button
              type="button"
              className="sb-light-group__remove"
              disabled={lights.length <= MIN_LIGHTS}
              onClick={() => onChange(lights.filter((_, k) => k !== i))}
              title={lights.length <= MIN_LIGHTS ? 'At least one light is required' : 'Remove light'}
              aria-label={`Remove light ${i + 1}`}
            >
              ✕
            </button>
          </header>
          <PropertyList pack="pairs">
            <SliderRow label="Azimuth" value={light.az} min={0} max={359} step={1} unit={<sup>°</sup>}
              onChange={(v) => update(i, { az: v })} />
            <SliderRow label="Elevation" value={light.el} min={0} max={90} step={1} unit={<sup>°</sup>}
              onChange={(v) => update(i, { el: v })} />
            <SliderRow label="Intensity" value={light.intensity} min={0} max={2} step={0.02}
              onChange={(v) => update(i, { intensity: v })} />
            <ColorRow label="Color" value={light.color}
              onChange={(rgb) => update(i, { color: rgb })} />
          </PropertyList>
        </section>
      ))}
      <button
        type="button"
        className="sb-lights-add"
        disabled={lights.length >= MAX_LIGHTS}
        onClick={() => onChange([...lights, newLight()])}
      >
        + Add light
      </button>
    </PropertyPanel>
  );
}
