import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Weasel-ui (consumed transitively via @weasel-js/labkit/weasel-ui) is shipped
// source-only and its components import `@weasel-js/core` plus a handful of
// monorepo-internal bare paths (`core/...`, `features/...`). Reuse the kit's
// own alias generator so vite resolves them all from any position.
//
// Labkit itself is the exception: we consume its *dist* through node_modules
// (see optimizeDeps below), so its auto-generated source aliases are filtered
// out — otherwise subpath imports like `@weasel-js/labkit/styles.css` would
// be rewritten into packages/labkit/src/ where they don't exist.
const weaselRoot = fileURLToPath(new URL('../../weasel', import.meta.url));
const aliasModule = (await import(
  /* @vite-ignore */ new URL(`file://${weaselRoot}/scripts/vite-aliases.ts`).href
)) as {
  weaselAliases: (
    root: string,
    overrides?: { find: string | RegExp; replacement: string }[],
  ) => { find: string | RegExp; replacement: string }[];
};
// tokens.css is generated rather than authored, so it does not sit where the alias generator's
// `<package>/<subpath>` rule looks for it. The generator expects this one to be overridden.
const weaselAliases = aliasModule
  .weaselAliases(weaselRoot, [
    {
      find: '@weasel-js/theme/tokens.css',
      replacement: `${weaselRoot}/packages/theme/src/generated/tokens.css`,
    },
  ])
  .filter((a) => !String(a.find).includes('labkit'));

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
    exclude: ['@weasel-js/labkit'],
  },
  server: {
    port: 5180,
    open: true,
    // Vite rewrites bare assets in linked packages (e.g. labkit's @font-face
    // URL) to /@fs/<absolute path>. That path is outside this project's
    // root, so it needs explicit fs allow-listing.
    fs: { allow: ['.', weaselRoot] },
  },
});
