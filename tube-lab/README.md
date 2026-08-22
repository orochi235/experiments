# Tube lab

A build snapshot of klieg's tube lab — sixteen panels on one WebGL context, each drawing a letter as
a swept neon tube, with a rail that tunes the whole spec live. Vendored here as a built bundle
because it is a React + TypeScript app: this directory has no build step, but it did have one.

Source lives in `~/src/blitsklieg` (repo `orochi235/klieg`) at
`packages/core/dev/tube-lab`. Snapshot taken from `d15df0c`.

To refresh it:

    cd ~/src/blitsklieg/packages/core
    npx vite build dev/tube-lab --base ./ --outDir ~/src/experiments/tube-lab --emptyOutDir

`--base ./` matters: without it the bundle asks for `/assets/...` and finds nothing when served
from a subdirectory of the barrel site.

Everything is in the bundle, including the font and labkit's stylesheet, so it needs only a static
server. The lab persists tuning and layout to `localStorage` under `tube-lab/v2`, which it shares
with the dev copy when both are served from localhost.
