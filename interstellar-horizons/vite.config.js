import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  // GH Pages serves this experiment under /experiments/interstellar-horizons/.
  base: process.env.NODE_ENV === 'production' ? '/experiments/interstellar-horizons/' : '/',
  plugins: [glsl({ compress: false, watch: true })],
  server: { open: false },
});
