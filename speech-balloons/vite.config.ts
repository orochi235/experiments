import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Weasel-ui (consumed transitively via @labkit/react/weasel-ui) is shipped
// source-only and its components import `@orochi235/weasel` plus a handful
// of monorepo-internal bare paths (`core/...`, `features/...`). Reuse the
// kit's own alias generator so vite resolves them all from any position.
const weaselRoot = fileURLToPath(new URL('../../weasel', import.meta.url));
const labkitRoot = fileURLToPath(new URL('../../labkit', import.meta.url));
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
  // Skip pre-bundling labkit. It's a file: workspace dep we rebuild often;
  // pre-bundling caches stale and HMR can't replace the cached version.
  // Excluding makes vite serve labkit's dist as-is, so a normal reload
  // picks up rebuilds.
  optimizeDeps: {
    exclude: ['@labkit/react'],
  },
  server: {
    port: 5180,
    open: true,
    // Vite rewrites bare assets in linked packages (e.g. labkit's @font-face
    // URL) to /@fs/<absolute path>. That path is outside this project's
    // root, so it needs explicit fs allow-listing.
    fs: { allow: ['.', labkitRoot, weaselRoot] },
  },
});
