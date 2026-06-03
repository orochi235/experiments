# Per-Light Lit-Region Decomposition with Stacked BRDF Terms

## Names this goes by

- **Per-light lit-region decomposition** — the architectural pattern.
- **Stacked BRDF terms / multi-pass shading** — the term-separation idea (Lambert diffuse, Blinn-Phong specular, rim/Fresnel, ambient).
- **Forward multi-pass rendering** — the closest 3D-graphics analog.
- In illustration software (Procreate / Clip Studio / Illustrator with live effects): **layered tonal painting** or **layer-stack lighting**.

There isn't one canonical SVG-world name — it's a synthesis of three ideas (per-light culling, BRDF-term separation, per-region gradient fills) that's well-trodden in 3D engines but ad-hoc in vector graphics.

## Architecture

For each light L:
  For each BRDF term T (e.g. Diffuse, Specular, Rim, Ambient):
    1. Compute the *region* on the body where T contributes: a polygon (or clip-path) defined by ray-projecting L against the 3D body model. The region is term-specific:
       - Diffuse: the entire lit half (where `N·L > 0`).
       - Specular: a narrow zone around the reflection vector (where `R·V > cosθ_spec`).
       - Rim: a thin band near the terminator (where `|N·V| < ε`).
       - Ambient: the whole body (independent of L).
    2. Pick a *gradient shape* matching the term: radialGradient for specular hot spots, smooth shading along surface tilt for diffuse, narrow band gradient for rim.
    3. Sample brightness stops from the term's BRDF formula along the gradient axis.
    4. Emit one `<path>` (clipped to the region) filled with that gradient.
  End for
End for
Composite all paths additively (`mix-blend-mode: screen` or per-stop opacity over the base color).

```
finalColor(P) = baseColor + Σ_lights Σ_terms region_mask(L, T, P) · gradient(L, T, P)
```

## Why this beats today's approach

Today's dome shading:
- N angular sub-slices per light's lit arc.
- Each slice gets one `<radialGradient>` from centroid to local rim radius.
- Stops sampled assuming "body of revolution" with a fixed BRDF (single Lambert-like term modulated by user contour).
- Banding visible on extreme aspect ratios because per-slice `bwNorm = bw/rLocal` changes step-wise across slices.

Per-light-region with stacked BRDF terms:
- Far fewer gradient primitives — one region per (light × term) instead of N slices per light. Maybe 2–4 regions total on a typical dome (1 diffuse + 1 specular + optional rim) vs. 64–96 sub-slices.
- Each region has its own gradient shape best-suited to its BRDF term.
- Inter-region discontinuities are *meant to be there* (the terminator between diffuse and ambient is a real lighting feature, not an artifact).
- No banding from per-slice approximations — each region is a single smooth gradient.
- Specular / rim become first-class instead of needing further refinements on top.

## Skipped problems / tradeoffs

- **Region clip computation is harder** than the simple lit-arc wedge today. Specular regions in particular need the body's local surface normal in 3D — which we approximate from `domeSurfaceTilt(r)` along centroid-radial rays. May still be artifact-prone near corners on elongated bodies.
- **SVG `<radialGradient>` is still axially symmetric** — specular highlights on a non-flat surface aren't quite radial. Multiple stacked radial gradients can approximate it; otherwise we're back to bitmap territory.
- **Compositing math**: additive blending in linear color space looks correct; sRGB additive can over-brighten. SVG composite operators are mostly sRGB. May need a `feFlood + feComposite` filter chain or just accept the slight over-bright.
- **Rim/Fresnel** especially needs the view vector. For a flat-screen UI assume the viewer is at `(cx, cy, +∞)` so `V = (0, 0, 1)`; rim is then `1 - |N_z|`. Trivial.

## Application sketch to current dome

Replace `domeLayers` memo's "N slices × per-light gradient" loop with:

```ts
for (const light of domeLights) {
  // Diffuse: existing wedge clipPath + a body-of-revolution radial gradient.
  layers.push(diffuseLayer(light));
  // Specular: tighter wedge around the reflection vector, radial gradient centered
  // on the reflection-vector rim point with small radius.
  layers.push(specularLayer(light));
  // Rim: thin band near the terminator (between lit arcs).
  layers.push(rimLayer(light));
}
// Ambient: one body-fill of the base color (already in place).
```

Each `*Layer` builds `{ clipD, gradientDef, opacity }` and the JSX renders them with screen blend mode, same as today.

## Open questions

- Can we get away with one diffuse + one spec layer per light, or do we still need slice subdivision for shape accuracy on extreme bodies? Probably the latter for diffuse on elongated bodies — but slice count can drop drastically since the gradient inside each slice is now physically meaningful, not a 1D projection.
- Do we want the user to control which BRDF terms are active per light? Probably yes for stylistic flexibility — comic-art dome vs. realistic dome.

## When to revisit

This is a significant re-architecture, not a small fix. Worth doing when:
- The remaining banding becomes a real visual blocker, or
- We want specular/rim highlights as first-class features (currently `domeGloss`, `specStrength`, `specSize` exist in the schema but aren't wired up — they were placeholder slots for exactly this kind of work).

Until then, the per-slice radial gradient approach is a reasonable approximation.
