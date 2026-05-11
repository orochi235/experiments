import { state, setStateValue, applyPreset, scheduleRender } from '../state.js';

const SLIDERS = [
  { id: 'turbidity',     path: 'T',                  label: 'vTurb',   fmt: v => v.toFixed(1) },
  { id: 'latitude',      path: 'lat',                label: 'vLat',    fmt: v => v + '°' },
  { id: 'viewElev',      path: 'viewEl',             label: 'vElev',   fmt: v => v + '°' },
  { id: 'dayOfYear',     path: '_doySlider',         label: 'vDay',
    fmt: v => {
      // Slider is offset by the winter-solstice convention. Use a 365-day
      // (non-leap) calendar so the same doy always maps to the same
      // month/day regardless of whether the current year has Feb 29.
      const doy = ((parseInt(v) - 1 + 354) % 365) + 1;
      const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      let d = doy, m = 0;
      while (d > md[m] && m < 11) { d -= md[m]; m++; }
      const months = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[m]} ${d}`;
    } },
  { id: 'albedo',        path: 'albedo',             label: 'vAlbedo', fmt: v => v.toFixed(2) },
  { id: 'ozoneStrength', path: 'ozone',              label: 'vOzone',  fmt: v => v.toFixed(2) },
  { id: 'hueShift',      path: 'style.hueShift',     label: 'vHue',    fmt: v => v + '°' },
  { id: 'saturation',    path: 'style.saturation',   label: 'vSat',    fmt: v => v.toFixed(2) },
  { id: 'vibrance',      path: 'style.vibrance',     label: 'vVib',    fmt: v => v.toFixed(2) },
  { id: 'exposure',      path: 'style.exposure',     label: 'vExp',    fmt: v => v.toFixed(1) },
  { id: 'contrast',      path: 'style.contrast',     label: 'vCont',   fmt: v => v.toFixed(2) },
  { id: 'warmth',        path: 'style.warmth',       label: 'vWarm',   fmt: v => v.toFixed(2) },
  { id: 'twilightGlow',  path: 'style.twilightGlow', label: 'vGlow',   fmt: v => v.toFixed(2) },
  { id: 'nightTint',     path: 'style.nightTint',    label: 'vNight',  fmt: v => v.toFixed(2) },
  { id: 'atmoDensity',   path: 'atmoDens',           label: 'vAtmoDens',  fmt: v => v.toFixed(2) },
  { id: 'sunDistance',   path: 'sunDist',            label: 'vSunDist',   fmt: v => v.toFixed(2) + ' AU' },
  { id: 'stellarTemp',   path: 'stellarTemp',        label: 'vStellarTemp', fmt: v => Math.round(v) + ' K' },
  { id: 'hour',          path: 'hour',               label: 'vHour',
    fmt: (() => {
      // Format the time using whatever the user's locale prefers
      // (en-US: "12:00 PM"; en-GB: "12:00"; ja-JP: "12:00"; etc.)
      const tf = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
      return v => {
        const h24 = Math.floor(v);
        const m = Math.round((v - h24) * 60);
        const d = new Date();
        d.setHours(h24, m, 0, 0);
        return tf.format(d);
      };
    })() },
];

export function wireControls() {
  for (const s of SLIDERS) {
    const el = document.getElementById(s.id);
    if (!el) continue;
    const labelEl = document.getElementById(s.label);
    const update = () => {
      const v = parseFloat(el.value);
      setStateValue(s.path, v);
      if (labelEl) labelEl.textContent = s.fmt(v);

      // Day-of-year slider has a winter-solstice offset in the original
      if (s.id === 'dayOfYear') {
        const doy = ((parseInt(el.value) - 1 + 354) % 365) + 1;
        state.doy = doy;
      }

      // Planet sliders re-apply preset physics
      if (s.id === 'atmoDensity' || s.id === 'sunDistance' || s.id === 'stellarTemp') {
        applyPreset(state.preset);
      }

      scheduleRender();
    };
    el.addEventListener('input', update);
    update();
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });
}
