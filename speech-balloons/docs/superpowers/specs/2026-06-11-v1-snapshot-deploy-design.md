# v1 Snapshot Deploy — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Freeze the speech-balloons app as it currently exists on GitHub Pages
(built from `main`) and serve that snapshot at
`/experiments/speech-balloons/v1/`, while development continues at the
current route. The snapshot mechanism must be a rerunnable script so
future versions (`v2`, `v3`, …) can be cut the same way.

## Context

- GH Pages deploys on push to `main` via `.github/workflows/deploy.yml`:
  each vite experiment is built with `NODE_ENV=production` and its `dist/`
  is copied to `_site/<experiment>/`.
- `speech-balloons` is a vite app. Vite copies `public/` verbatim into
  `dist/`, so anything at `speech-balloons/public/v1/` is served at
  `/experiments/speech-balloons/v1/` in production and `/v1` on the dev
  server — with zero CI or vite-config changes.
- The `port-to-labkit` branch's vite config resolves sibling repos
  (`../../weasel`, `../../labkit`). Builds of refs after the labkit port
  therefore require those local checkouts and inherit their current
  state. This is inherent to the project setup, not to the snapshot
  script. (Known related issue, out of scope here: CI cannot build the
  labkit-ported config once it merges to `main`.)

## Mechanism

### Script: `speech-balloons/scripts/snapshot.sh <version> [ref]`

Also exposed as `npm run snapshot` in `speech-balloons/package.json`.
`ref` defaults to `main`. Steps:

1. **Validate inputs.** `version` must match `v[0-9]+` (keeps the
   nested-snapshot prune glob safe). Refuse to proceed if
   `speech-balloons/public/<version>/` already exists, unless `--force`
   is given.
2. **Temp worktree.** `git worktree add --detach <tmpdir> <ref>` so the
   user's working tree and branch are untouched.
3. **Install.** `npm ci` in the worktree's `speech-balloons/` with
   `NODE_ENV` unset (so devDependencies, including vite, install).
4. **Build with relative base.**
   `NODE_ENV=production npx vite build --base=./`
   — a relative base makes the frozen build location-independent, so it
   works both at `/experiments/speech-balloons/<version>/` on Pages and
   at `/<version>/` on the local dev server. (An absolute versioned base
   was originally specified, but its asset URLs only resolve on Pages.)
   The CLI flag overrides the base hardcoded in `vite.config.ts`, so the
   script works against both pre- and post-labkit refs without editing
   the checked-out config.
5. **Prune nested snapshots.** Delete any `dist/v[0-9]*/` directories
   from the build output. Because `public/` is copied verbatim into
   `dist/`, a `v2` built from a `main` that already contains
   `public/v1/` would otherwise embed a full copy of v1 inside v2.
   Each snapshot stays self-contained.
6. **Install snapshot.** Copy `dist/` to
   `speech-balloons/public/<version>/` in the real working tree.
7. **Clean up.** Remove the temp worktree (`git worktree remove`, with
   a trap so cleanup also happens on failure). Print the snapshot path
   and a reminder to commit. Committing is left to the user.

### Serving

No changes to CI or vite config. `public/v1/` rides along into every
future production build and lands at
`https://orochi235.github.io/experiments/speech-balloons/v1/`. The dev
server serves it at `http://localhost:5180/v1/`.

### v1 itself

Cut by running `scripts/snapshot.sh v1 main` and committing the
resulting `public/v1/` directory. Committed build artifacts are
deliberate here: a frozen snapshot is an artifact, not source, and
committing it makes it immune to toolchain and dependency drift.

## Error handling

- Bad version string, missing ref, or pre-existing snapshot dir →
  fail fast with a clear message before any build work.
- Build or install failure → script exits nonzero; trap removes the
  temp worktree; the real working tree is never touched until the
  build has succeeded.

## Testing

- Run `scripts/snapshot.sh v1 main`; verify `public/v1/index.html`
  references assets via relative `./assets/...` URLs.
- Load `/v1/` on the dev server and verify the app boots and renders.
- After merge/deploy, spot-check the production URL.

## Out of scope

- No UI link from the current app to `/v1` (reachable by URL only).
- No CI changes; no fix for the labkit-port CI build issue.
