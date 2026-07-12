import { loadParts } from './parts.js';
import { defaultScene, scatter, decodeHash, saveLocal } from './scene.js';
import { renderPreview } from './engines.js';
import { renderChamber } from './editor.js';

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
  };

  function update() {
    renderPreview($('preview-svg'), scene, store);
    renderChamber($('chamber-svg'), scene, store, onEditorChange);
    document.body.style.setProperty('--bg', scene.palette.background);
    saveLocal(scene);
  }
  update();

  // Later tasks extend boot(): editor pane (Task 11), sidebar (Task 13),
  // export (Task 14), persistence load (Task 15).
  window.__kaleido = { scene, store, update };  // console access during development
}

boot();
