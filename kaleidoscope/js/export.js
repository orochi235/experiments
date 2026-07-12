import { renderPreview } from './engines.js';
import { partColor } from './scene.js';

// Build a standalone SVG document string at w×h. Re-renders the scene into a
// detached svg with a viewBox re-derived for the target aspect ratio, then
// inlines every referenced <symbol> so the file is self-contained.
export function buildSvgDocument(scene, store, w, h) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);          // clip-path/use resolution needs it in-document
  renderPreview(svg, scene, store);

  // Re-derive viewBox for target aspect so tiling fills exactly & radial centers.
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
  const targetAR = w / h, srcAR = vw / vh;
  let nx = vx, ny = vy, nw = vw, nh = vh;
  if (targetAR > srcAR) { nw = vh * targetAR; nx = vx - (nw - vw) / 2; }
  else { nh = vw / targetAR; ny = vy - (nh - vh) / 2; }
  svg.setAttribute('viewBox', `${nx} ${ny} ${nw} ${nh}`);
  // widen background rects to the new viewBox
  svg.querySelectorAll('rect').forEach(r => {
    if (r.getAttribute('fill') === scene.palette.background || r.getAttribute('fill')?.startsWith('url(')) {
      r.setAttribute('x', nx); r.setAttribute('y', ny);
      r.setAttribute('width', nw); r.setAttribute('height', nh);
    }
  });

  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('width', w); svg.setAttribute('height', h);

  let markup = svg.outerHTML;
  svg.remove();

  // The live #preview-svg (still document-attached) defines its own elements
  // with the SAME ids (radial-chamber, radial-sector, tiling-chamber, tile,
  // tile-cell, p4m-cell, tile-tri, hex-motif) — url(#id)/href="#id" resolve
  // to whichever same-id element comes FIRST in document order, which need
  // not be this (later-appended) export svg's own defs. Namespace every id
  // and internal reference with an "x-" prefix at the string level so this
  // document's refs are unambiguous and self-contained, independent of what
  // else is on the page. Symbol refs (href="#sym-...") get prefixed by the
  // same blanket replace, then un-prefixed back, since the referenced
  // <symbol> markup is inlined below with its original unprefixed id.
  markup = markup
    .replace(/(?<!-)id="/g, 'id="x-')             // (?<!-) skips data-part-id="…"
    .replaceAll('url(#', 'url(#x-')
    .replaceAll('href="#', 'href="#x-')
    .replaceAll('href="#x-sym-', 'href="#sym-');

  // Inline every symbol referenced by the scene.
  const symbols = new Set(scene.chamber.parts.map(p =>
    store.symbolMarkup(p.partRef, partColor(scene, p))));
  const defsMarkup = `<defs>${[...symbols].join('')}</defs>`;
  markup = markup.replace('>', `>${defsMarkup}`);

  // Strict SVG 1.1 renderers (Illustrator, macOS Preview/Quick Look) only
  // follow xlink:href on <use> — SVG2's plain href paints blank there. Emit
  // both. (Only <use> elements carry href in this document.)
  markup = markup.replace(/ href="([^"]+)"/g, ' href="$1" xlink:href="$1"');

  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const stamp = (scene) => `kaleidoscope-${scene.mode}-${scene.seed}`;

export function downloadSvg(scene, store, w = 2560, h = 1440) {
  const doc = buildSvgDocument(scene, store, w, h);
  download(new Blob([doc], { type: 'image/svg+xml' }), `${stamp(scene)}.svg`);
}

export function downloadPng(scene, store, w, h) {
  const doc = buildSvgDocument(scene, store, w, h);
  const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => download(blob, `${stamp(scene)}-${w}x${h}.png`), 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert('PNG export failed: SVG did not rasterize'); };
  img.src = url;
}
