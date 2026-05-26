# Speech Balloon Lab — TODO

## Export / library split

- [ ] **Refactor Export to emit baked, static path data.** Today the Export button
  copies the raw `LabSnapshot` (effect params). A consumer would have to
  rerun the geometry + clipper pipeline to render it. Instead, walk the
  compose pipeline once on export and serialize the *resolved* output:
  - `bodyPath: string` — the unioned body+bubbles path
  - `lightningPaths: string[]` — one filled-ribbon path per lightning tail
  - `fill.gradient: { stops, hx, hy, spread }` — already concrete; keep
  - text/font/size/colors as-is
  - Lean baked into bodyPath (already true)
- [ ] Once that's done, factor the runtime `<SpeechBalloon>` into a separate
  package that just renders the resolved snapshot. Library size: no
  `clipper2-ts`, no `geometry.ts`. ~2 KB.

## Geometry features available from the badge lab

(Confirmed portable — see `~/src/weasel/.../Badge/`)

- [ ] **`bloat`** — constant outward perimeter offset, Photoshop-style expand.
  ~5-line addition to the compose loop.
- [ ] **Perimeter-offset effects as their own layers:**
  - [ ] Puffs (sinusoidal bumps — cloud-like outline)
  - [ ] Scallops (rounded bumps)
  - [ ] Bites (inverse Puffs, perimeter punches inward)
  - [ ] Spikes (the multi-peak version of the classic tail)
- [ ] **Component-zone decorations** (badge lab's `EffectModule.Component` + `zone: 'background' | 'foreground' | 'mask'`):
  - [ ] Bevel
  - [ ] Sheen
  - [ ] Metal
  - [ ] Woodgrain

## Open lab features

- [ ] **Light direction** for the puffy filter — currently hard-coded "from above".
  Expose `lightAngle` so the inset shadow rotates with it.
- [ ] **Lightning `taper`** currently does nothing. Could narrow the bolt toward the
  tip (vary `inflatePathsD` width along the polyline — needs segment-by-segment
  inflate + union, or a custom ribbon builder).
- [ ] **Multiple fill effects** — only the first fill renders. Stacked fills with
  blend modes / clip regions would let you composite a base fill with a localized
  highlight overlay.
- [ ] **Anchor-point dragging for label position** inside the body (mentioned in
  the original HANDOFF). Today text always centers in the body box.
- [ ] **Named presets / preset library** — save current snapshot as a named preset,
  load by name.
- [ ] **Cross-panel single effect stack?** The current split (fill on left, others
  on right) makes location predictable but means you can't have, say, a stroke
  effect ordered between two fills. Worth revisiting if multiple fills land.
