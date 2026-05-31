# Handoff — diagnose slow font-switch in speech-balloons

Date: 2026-05-31

## Symptom

Switching the font in the lab's top toolbar `<select>` (Bangers ↔ Oswald ↔ Comic Neue ↔ system) is noticeably slow — multi-hundred-ms perceived stall before the preview re-renders with the new face. This is new since the @labkit/react port.

## What's NOT the cause (already ruled out)

- **Weasel atlas generation.** Speech-balloons renders SVG `<text>` only; never hits weasel's MSDF text path. The only weasel-derived component in use is `weasel-ui`'s `CurveEditor` (via the `@labkit/react/weasel-ui` passthrough), which doesn't render text.
- **wawoff2 / inlineSvgTextAsPaths.** That's only on Download SVG (Lab.tsx ~line 197), not on font switch.

## Suspect list (in order of likelihood)

1. **First-time font fetch.** Google Fonts CSS is loaded once via `index.html`'s `<link>`, but woff2 binaries fetch lazily per family+weight. First switch to a never-rendered family blocks until the woff2 lands. Subsequent switches should be near-instant. **Test: switch back and forth quickly — second switch should feel fast if this is it.**
2. **Whole-chrome font re-render.** After the port, labkit's `--lk-font` resolves to Oswald (see `speech-balloons/src/styles.css` `.lk-shell` override). Changing the dropdown changes `runtime.fontFamily`, which only affects the SVG preview — but the browser may still trigger a font swap pass that touches all `text` runs in the page. Less likely; we're not changing `--lk-font`, only the SVG's inline `font-family`.
3. **Per-key setConfig fan-out + snapshot push.** `setRuntime` calls `setState(nextRuntime)` (whole-state replace, single setConfig). That triggers a render. 300ms later the snapshot push fires. Snapshot push uses `JSON.stringify` for dedupe — for a snapshot with effects + curve arrays, that string can be a few KB. Probably not the bottleneck but worth measuring.
4. **Vite dev-mode re-transform.** Switching the font shouldn't invalidate any modules, but the recent `vite.config.ts` change added `server.fs.allow: ['.', labkitRoot, weaselRoot]` — vite now traverses more file trees on HMR ticks. Possible but speculative.

## How to instrument

Open dev tools in the browser. Run from the page (paste into the console, then change the font in the dropdown):

```js
performance.clearMarks();
performance.clearMeasures();

// Hook React commits via a one-shot MutationObserver on the preview <svg>.
const stage = document.querySelector('.sb-preview-stage');
const obs = new MutationObserver(() => {
  performance.mark('mutation');
});
obs.observe(stage, { attributes: true, childList: true, subtree: true, characterData: true });

// Wrap document.fonts.load to time font fetches.
const origLoad = document.fonts.load.bind(document.fonts);
document.fonts.load = (spec) => {
  performance.mark(`font-load-start:${spec}`);
  return origLoad(spec).then((r) => {
    performance.mark(`font-load-end:${spec}`);
    performance.measure(`font-load:${spec}`, `font-load-start:${spec}`, `font-load-end:${spec}`);
    return r;
  });
};

// Mark just before the change handler fires.
const sel = document.querySelector('.sb-toolbar-fields select') || document.querySelector('select');
sel.addEventListener('change', () => {
  performance.mark('select-change');
}, { capture: true, once: false });

// Inspect after a switch:
setTimeout(() => {
  console.table(performance.getEntriesByType('measure'));
  console.table(performance.getEntriesByName('mutation').slice(0, 5));
  console.table(performance.getEntriesByName('select-change'));
}, 3000);
```

Then change the font. After ~3s, the console will print:
- Any `font-load:*` measures with their durations (suspect #1).
- Mutation timestamps (when the preview actually updated).
- The select-change timestamp.

The gap `select-change → first mutation → font-load-end` will tell you which segment is slow.

Also check **Performance** tab → record a font switch. Look for long tasks in `Script`, `Render`, or `Painting` lanes. Look for `Recalculate Style` spans tied to the SVG.

## Where to start poking in code (if the timing points at code, not network)

- `~/src/experiments/speech-balloons/src/Lab.tsx`
  - Around line 360-395: toolbar `<select>` for Font binds `onChange={(e) => setRuntime((r) => ({ ...r, fontFamily: e.target.value }))}`.
  - `setRuntime` is defined inside `Lab` (search for `const setRuntime`). It calls `setState(nextRuntime)` (the labkit `setState`, which replaces the whole `runtime` slice atomically — should be cheap).
- `~/src/experiments/speech-balloons/src/SpeechBalloon.tsx`
  - The component renders `<text>` elements with `fontFamily={runtime.fontFamily}`. Search for `fontFamily`. If `<text>` is created/destroyed on font change (vs re-styled), browser pays a full layout pass.
- `~/src/experiments/speech-balloons/src/Lab.tsx` snapshot push effect
  - Search for `prevSettledRef` / `pushSnapshot`. The 300ms debounce shouldn't visually block, but the `JSON.stringify` could spike main-thread time on commit. Worth verifying with a `performance.mark` around the timer callback.

## Quick experiments to bisect

1. **Disable the snapshot push** temporarily (comment out the `updateUndo` line inside the setTimeout in Lab.tsx). Does the switch feel faster? If yes → push is the cost.
2. **Pre-warm fonts**: in `main.tsx`, after createRoot, call `Promise.all(['Bangers','Oswald','Comic Neue'].map(f => document.fonts.load(`1em "${f}"`)))`. If this makes switches fast → it's the lazy font fetch.
3. **Bypass labkit's Oswald**: temporarily remove the `.lk-shell { --lk-font-display: Oswald }` override in `speech-balloons/src/styles.css`. If switches get fast → cross-chrome font swap is implicated.

## Repo state (as of handoff)

- `~/src/experiments` on branch `port-to-labkit`, HEAD ≈ `7bbadc3 fix(speech-balloons): downloadSvg falls back when wawoff2 hangs`.
- `~/src/labkit` on branch `port-to-labkit`, HEAD ≈ `9609720 feat(labkit): uppercase the hoisted primary-select in LayerStack card head`.
- Dev server: `cd ~/src/experiments/speech-balloons && npm run dev` → http://localhost:5180/.
- Tests: `cd ~/src/experiments/speech-balloons && npm test` (35 tests).

## What to ship

If the diagnostic points at #1 (font fetch) — pre-warm in main.tsx is the right fix.
If at #2 (whole-chrome) — drop the `--lk-font` override and let chrome stay on the labkit default; only the SVG preview uses the user-selected font.
If at #3 (snapshot push) — replace `JSON.stringify` dedupe with a shallow-ref check on the config slice the user actually changed (the deep stringify is overkill).
If at #4 (vite) — narrow `server.fs.allow` to just `[labkitRoot + '/dist', weaselRoot + '/packages']` instead of the whole repos.

## Pointers to the port history

- Spec: `speech-balloons/docs/superpowers/specs/2026-05-31-port-to-labkit-design.md`
- Plan: `speech-balloons/docs/superpowers/plans/2026-05-31-port-to-labkit.md`
- The full sequence of port commits is on `port-to-labkit` in both repos.
