import { remapColor } from './color.js';

// Loads the manifest + part SVGs, owns a hidden document-level <svg> that
// accumulates recolored <symbol>s. <use href="#id"> resolves across SVG
// elements within the same document, so one defs host serves every pane.
export async function loadParts(baseUrl = 'assets') {
  const manifest = await (await fetch(`${baseUrl}/manifest.json`)).json();
  const parts = new Map();

  await Promise.all(manifest.parts.map(async ({ id, name }) => {
    try {
      const text = await (await fetch(`${baseUrl}/${id}.svg`)).text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      if (root.tagName !== 'svg') throw new Error('not svg');
      root.querySelector('rect[fill="white"]')?.remove();  // background plate
      parts.set(id, { id, name, viewBox: root.getAttribute('viewBox'), inner: root.innerHTML });
    } catch (err) {
      console.warn(`kaleidoscope: part ${id} failed to load (${err.message}); placeholder used`);
      parts.set(id, { id, name, viewBox: '0 0 100 100', inner: PLACEHOLDER(id), broken: true });
    }
  }));

  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  const cache = new Map();  // `${partId}|${color}` -> <symbol> element
  // TODO: unbounded growth — a live color picker scrubbing hundreds of
  // hexes mints ~50KB of dead DOM per (part,color); add eviction of symbols not
  // used by the current render, or a transient scratch symbol for picker drags.
  const base = manifest.baseColor;

  function recoloredInner(part, color) {
    if (part.broken) return part.inner;
    const memo = new Map();
    return part.inner.replace(/#[0-9a-fA-F]{6}/g, (hex) => {
      const k = hex.toLowerCase();
      if (!memo.has(k)) memo.set(k, remapColor(k, base, color));
      return memo.get(k);
    });
  }

  // brick-icons SVGs define gradients as id="g0", id="g1", ... plus a part-
  // specific silhouette <clipPath id="sclip"> — identical ids across parts/
  // colors would collide in the shared document (first-in-document wins:
  // corrupted shading, linework clipped by the wrong part's silhouette), so
  // namespace every id per symbol. Rewriting all ids is verified safe: assets
  // contain no href="#..." and no external url() refs.
  function namespaceIds(markup, ns) {
    return markup
      .replaceAll('id="', `id="${ns}-`)
      .replaceAll('url(#', `url(#${ns}-`);
  }

  function symbolFor(partId, color) {
    color = color.toLowerCase();
    const key = `${partId}|${color}`;
    if (!cache.has(key)) {
      const part = parts.get(partId);
      const sym = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
      sym.id = `sym-${partId}-${color.slice(1)}`;
      sym.setAttribute('viewBox', part.viewBox);
      sym.innerHTML = namespaceIds(recoloredInner(part, color), `p${partId}-${color.slice(1)}`);  // 'p': ids must not start with a digit (strict XML parsers)
      host.appendChild(sym);
      cache.set(key, sym);
    }
    return cache.get(key);
  }

  return {
    list: manifest.parts,
    baseColor: base,
    symbolId: (partId, color) => symbolFor(partId, color).id,
    symbolMarkup: (partId, color) => symbolFor(partId, color).outerHTML,
  };
}

const PLACEHOLDER = (id) => `
  <rect x="5" y="5" width="90" height="90" fill="none" stroke="#e05555" stroke-width="3" stroke-dasharray="6 4"/>
  <text x="50" y="55" text-anchor="middle" fill="#e05555" font-size="16" font-family="monospace">${id}</text>`;
