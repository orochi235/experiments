# sky-color-gl

WebGL2 port of the sky-color experiment. Six atmospheric scattering models
(Rayleigh, Preetham, Nishita, Hosek-Wilkie, Ozone, CIE Clear) rendered as
fragment shaders, with planet presets and per-pixel postprocess style.

## Run

    npm install
    npm run dev

Opens at http://localhost:5173 (or whatever Vite picks).

## Build

    npm run build
    npm run preview

## Source

Ported from `~/src/experiments/sky-color/sky-models.html`. Design and plan in
`docs/specs/` and `docs/plans/`.
