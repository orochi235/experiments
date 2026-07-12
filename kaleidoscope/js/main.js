import { loadParts } from './parts.js';
import { defaultScene, scatter, decodeHash, saveLocal, partColor } from './scene.js';
import { renderPreview } from './engines.js';
import { renderChamber, getSelected } from './editor.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  if (new URLSearchParams(location.search).has('selftest')) {
    const { runSelftest } = await import('./selftest.js');
    await runSelftest();
  }

  const store = await loadParts('assets');
  let scene = defaultScene();
  const fromHash = decodeHash(location.hash);
  if (fromHash) Object.assign(scene, fromHash, { palette: scene.palette });
  if (!scene.partSet.length) scene.partSet = store.list.map(p => p.id);
  scatter(scene, store);

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
    renderSelectionSwatches();
  }
  update();

  // Later tasks extend boot(): editor pane (Task 11), sidebar (Task 13),
  // export (Task 14), persistence load (Task 15).
  window.__kaleido = { scene, store, update };  // console access during development
}

boot();
