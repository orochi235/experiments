import { loadParts } from './parts.js';
import { defaultScene, scatter, decodeHash, encodeHash, saveLocal, loadLocal, serialize, deserialize, partColor } from './scene.js';
import { getPreset } from './palettes.js';
import { renderPreview } from './engines.js';
import { renderChamber, getSelected, clearSelection } from './editor.js';
import { bindSidebar } from './ui.js';
import { downloadPng, downloadSvg } from './export.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  if (new URLSearchParams(location.search).has('selftest')) {
    const { runSelftest } = await import('./selftest.js');
    await runSelftest();
  }

  const store = await loadParts('assets');

  let scene;
  const fromHash = decodeHash(location.hash);
  const local = loadLocal();
  // update() keeps the URL hash current, so on a plain reload the hash is our
  // own writing and the autosave (which carries tweaks) must win. Only a
  // foreign/shared hash — one that doesn't match the autosave's knobs — takes
  // the hash path.
  if (fromHash && !(local && encodeHash(local) === location.hash)) {
    const { paletteName, ...knobs } = fromHash;
    scene = { ...defaultScene(), ...knobs, palette: getPreset(paletteName) };
    if (!scene.partSet.length) scene.partSet = store.list.map(p => p.id);
    scatter(scene, store);          // hash = seed+knobs, so scatter reproduces it
  } else if (local) {
    scene = local;                  // full state incl. tweaks
  } else {
    scene = defaultScene();
    scene.partSet = store.list.map(p => p.id);
    scatter(scene, store);
  }

  function renderSelectionSwatches() {
    const sel = getSelected(scene);
    const box = $('selection-color');
    box.hidden = !sel;
    if (!sel) return;
    const row = $('selection-swatches');
    row.replaceChildren(...scene.palette.colors.map((c) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (partColor(scene, sel) === c ? ' active' : '');
      b.style.setProperty('--swatch', c);
      b.onclick = () => { sel.colorOverride = c; onEditorChange('tweak'); };
      return b;
    }));
    const custom = document.createElement('input');
    custom.type = 'color'; custom.className = 'swatch';
    custom.value = partColor(scene, sel);
    custom.oninput = () => { sel.colorOverride = custom.value; onEditorChange('tweak'); };
    row.appendChild(custom);
  }

  const onEditorChange = (kind, part) => {
    if (kind === 'drag' && part) {
      // Cheap mid-drag path: mutate the dragged part's <use> inside the
      // preview's chamber def — every wedge/tile instance follows via <use>.
      const u = $('preview-svg').querySelector(`use[data-part-id="${part.id}"]`);
      if (u) u.setAttribute('transform',
        `translate(${part.x},${part.y}) rotate(${part.rotation}) scale(${part.scale})`);
      return;
    }
    if (kind === 'tweak') renderPreview($('preview-svg'), scene, store);
    renderChamber($('chamber-svg'), scene, store, onEditorChange);
    saveLocal(scene);
    renderSelectionSwatches();
  };

  function update() {
    renderPreview($('preview-svg'), scene, store);
    renderChamber($('chamber-svg'), scene, store, onEditorChange);
    document.body.style.setProperty('--bg', scene.palette.background);
    saveLocal(scene);
    history.replaceState(null, '', encodeHash(scene));
    renderSelectionSwatches();
  }
  update();

  const reroll = () => { clearSelection(); scatter(scene, store); update(); };
  // clearSelection: after a reroll the new random parts reuse the same numeric
  // ids, so a stale selection would silently attach to an unrelated part.
  bindSidebar(scene, store, { update, reroll });

  const exportSize = () => {
    const v = $('ctl-export-preset').value;
    const [w, h] = v === 'custom'
      ? [+$('ctl-export-w').value, +$('ctl-export-h').value]
      : v.split('x').map(Number);
    return (w > 0 && h > 0 && w <= 16384 && h <= 16384) ? [w, h] : null;
  };
  $('ctl-export-preset').onchange = (e) => {
    $('export-custom').hidden = e.target.value !== 'custom';
  };
  $('ctl-export-png').onclick = () => { const s = exportSize(); if (s) downloadPng(scene, store, ...s); };
  $('ctl-export-svg').onclick = () => { const s = exportSize(); if (s) downloadSvg(scene, store, ...s); };

  // Durable full-scene copies (incl. tweaks) as downloadable/loadable JSON.
  $('ctl-scene-save').onclick = () => {
    const blob = new Blob([serialize(scene)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kaleidoscope-scene-${scene.seed}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('ctl-scene-load').onclick = () => $('ctl-scene-file').click();
  $('ctl-scene-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // update/reroll/onEditorChange close over this same `scene` binding, so
      // reassigning here is visible to them; bindSidebar captured the old
      // object by value, so re-bind to sync the controls to the loaded scene.
      scene = deserialize(await file.text());   // hardened: deep-merges + recovers bad nested state
      if (!scene.partSet.length) scene.partSet = store.list.map(p => p.id);
      clearSelection();  // a stale selection would attach to an unrelated loaded part
      bindSidebar(scene, store, { update, reroll });
      window.__kaleido.scene = scene;
      update();
    } catch (err) {
      document.querySelector('header .hint').textContent = 'Scene load failed: ' + err.message;
    }
    e.target.value = '';
  };

  window.__kaleido = { scene, store, update };  // console access during development
}

boot().catch((err) => {
  console.error('kaleidoscope: boot failed', err);
  const hint = document.querySelector('header .hint');
  if (hint) hint.textContent = 'Failed to load: ' + err.message;
});
