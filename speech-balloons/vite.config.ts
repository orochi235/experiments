import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GH Pages serves this experiment under /experiments/speech-balloons/.
  base: process.env.NODE_ENV === 'production' ? '/experiments/speech-balloons/' : '/',
  plugins: [react()],
  server: { port: 5180, open: true },
});
