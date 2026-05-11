import { state, scheduleRender } from '../state.js';

// Global view-mode toggle in the Style Adjustments panel.
// One projection applies to all 6 dome previews and the lightbox.
export function wireProjectionToggles() {
  document.querySelectorAll('.proj-btn.global').forEach(btn => {
    btn.addEventListener('click', () => {
      const proj = btn.dataset.proj;
      if (!proj) return;
      state.projection = proj;
      document.querySelectorAll('.proj-btn.global').forEach(b =>
        b.classList.toggle('active', b === btn));
      scheduleRender();
    });
  });
}
