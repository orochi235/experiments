import { state, scheduleRender } from '../state.js';

export function wireProjectionToggles() {
  document.querySelectorAll('.proj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const model = btn.parentElement.parentElement.querySelector('canvas.dome.gl').dataset.model;
      const proj = btn.dataset.proj;
      if (!model || !proj || !state.dome[model]) return;
      state.dome[model].projection = proj;
      btn.parentElement.querySelectorAll('.proj-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scheduleRender();
    });
  });
}
