import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Weasel-ui (consumed transitively via @labkit/react/weasel-ui) is shipped
// source-only and its components import `@orochi235/weasel` plus a handful
// of monorepo-internal bare paths (`core/...`, `features/...`). Reuse the
// kit's own alias generator so vite resolves them all from any position.
const weaselRoot = fileURLToPath(new URL('../../weasel', import.meta.url));
const aliasModule = (await import(
  /* @vite-ignore */ new URL(`file://${weaselRoot}/scripts/vite-aliases.ts`).href
)) as { weaselAliases: (root: string) => { find: string | RegExp; replacement: string }[] };
const weaselAliases = aliasModule.weaselAliases(weaselRoot);

export default defineConfig({
  // GH Pages serves this experiment under /experiments/speech-balloons/.
  base: process.env.NODE_ENV === 'production' ? '/experiments/speech-balloons/' : '/',
  plugins: [react()],
  resolve: {
    alias: weaselAliases,
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5180, open: true },
});
