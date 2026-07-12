import { PRESETS, getPreset } from './palettes.js';

const $ = (id) => document.getElementById(id);

// Bind every sidebar control to the scene. reroll() = scatter + update;
// update() = re-render only (tweaks preserved).
export function bindSidebar(scene, store, { update, reroll }) {
  // Continuous sliders fire per pointermove; re-rasterizing the pattern costs
  // up to ~150ms in p4m at high density, so coalesce to one update per frame.
  const coalesce = (fn) => {
    let raf = 0;
    return () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fn(); }); };
  };
  const cUpdate = coalesce(update), cReroll = coalesce(reroll);

  const setModeVisibility = () => {
    document.querySelectorAll('[data-mode]').forEach(elm => {
      elm.classList.toggle('mode-hidden', elm.dataset.mode !== scene.mode);
    });
  };

  // Symmetry
  $('ctl-mode').value = scene.mode;
  $('ctl-mode').onchange = (e) => { scene.mode = e.target.value; setModeVisibility(); update(); };
  $('ctl-order').value = scene.radial.order;
  $('ctl-order').oninput = (e) => { scene.radial.order = +e.target.value; cUpdate(); };
  $('ctl-mirror').checked = scene.radial.mirror;
  $('ctl-mirror').onchange = (e) => { scene.radial.mirror = e.target.checked; update(); };
  $('ctl-group').value = scene.tiling.group;
  $('ctl-group').onchange = (e) => { scene.tiling.group = e.target.value; update(); };
  $('ctl-tilesize').value = scene.tiling.tileSize;
  $('ctl-tilesize').oninput = (e) => { scene.tiling.tileSize = +e.target.value; cUpdate(); };
  setModeVisibility();

  // Scatter knobs (reroll on change — they define the scatter)
  $('ctl-density').value = scene.density;
  $('ctl-density').oninput = (e) => { scene.density = +e.target.value; cReroll(); };
  $('ctl-sizemin').value = scene.sizeRange[0];
  $('ctl-sizemin').oninput = (e) => { scene.sizeRange[0] = +e.target.value; cReroll(); };
  $('ctl-sizemax').value = scene.sizeRange[1];
  $('ctl-sizemax').oninput = (e) => { scene.sizeRange[1] = +e.target.value; cReroll(); };
  $('ctl-jitter').value = scene.rotationJitter;
  $('ctl-jitter').oninput = (e) => { scene.rotationJitter = +e.target.value; cReroll(); };
  $('ctl-seed').value = scene.seed;
  $('ctl-seed').onchange = (e) => { scene.seed = +e.target.value; reroll(); };
  $('ctl-shuffle').onclick = () => {
    scene.seed = Math.floor(Math.random() * 2 ** 31);
    $('ctl-seed').value = scene.seed;
    reroll();
  };

  // Part set
  $('part-list').replaceChildren(...store.list.map(({ id, name }) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = scene.partSet.includes(id);
    cb.onchange = () => {
      scene.partSet = cb.checked
        ? [...scene.partSet, id]
        : scene.partSet.filter(p => p !== id);
      if (!scene.partSet.length) { cb.checked = true; scene.partSet = [id]; return; }
      reroll();
    };
    label.append(cb, ` ${name} (${id})`);
    return label;
  }));

  // Palette
  $('ctl-palette').replaceChildren(...Object.keys(PRESETS).map(n => {
    const o = document.createElement('option'); o.value = o.textContent = n; return o;
  }));
  $('ctl-palette').value = scene.palette.name;
  $('ctl-palette').onchange = (e) => {
    scene.palette = getPreset(e.target.value);
    renderPaletteSwatches();
    $('ctl-bg').value = scene.palette.background;
    update();  // recolors in place — colorIndex entries survive
  };
  $('ctl-bg').value = scene.palette.background;
  $('ctl-bg').oninput = (e) => { scene.palette.background = e.target.value; update(); };

  function renderPaletteSwatches() {
    $('palette-swatches').replaceChildren(...scene.palette.colors.map((c, i) => {
      const inp = document.createElement('input');
      inp.type = 'color'; inp.className = 'swatch'; inp.value = c;
      inp.oninput = () => { scene.palette.colors[i] = inp.value; update(); };
      return inp;
    }));
  }
  renderPaletteSwatches();
}
