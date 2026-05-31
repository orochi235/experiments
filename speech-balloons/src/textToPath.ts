// Convert <text> elements in an SVG to <path> outlines so the exported file
// renders identically without the viewer having the original fonts installed.
//
// Pipeline per font (family + weight + style):
//   1. Fetch the Google Fonts CSS (browser UA → WOFF2 URLs).
//   2. Pick the @font-face block matching the requested (family, weight, style).
//      Prefer the "latin" subset (the one without a 0x0100+ unicode-range).
//   3. Fetch the WOFF2 binary, decompress to TTF via wawoff2, parse via opentype.js.
//   4. Cache the resulting Font keyed by family|weight|style.
//
// Then for each <text>: read computed style + attributes, build a <path> using
// font.getPath(...), and replace the original <text> node.
//
// If a font can't be loaded, the <text> is left alone (logged to console).

import opentype from 'opentype.js';
import wawoff2 from 'wawoff2';

type FontKey = string; // `${family}|${weight}|${style}`

// Module-level cache: subsequent downloads reuse parsed fonts.
const fontCache = new Map<FontKey, Promise<opentype.Font | null>>();

// Bundle the Google Fonts URL used by index.html. Re-fetching it returns the
// same WOFF2 sources the browser already cached. Keeping this in sync with
// index.html is a known caveat (see report).
const GOOGLE_FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Oswald:wght@300;500;700&family=Bangers&family=Comic+Neue:wght@400;700&display=swap';

let cssTextPromise: Promise<string> | null = null;
function getGoogleFontsCss(): Promise<string> {
  if (!cssTextPromise) {
    cssTextPromise = fetch(GOOGLE_FONTS_CSS_URL).then((r) => {
      if (!r.ok) throw new Error(`Google Fonts CSS fetch failed: ${r.status}`);
      return r.text();
    });
  }
  return cssTextPromise;
}

interface FaceBlock {
  family: string;
  weight: number;
  style: string;
  src: string; // first url(...) in the src descriptor
  unicodeRange: string | null;
}

function parseFaces(css: string): FaceBlock[] {
  const out: FaceBlock[] = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(css)) !== null) {
    const body = m[1];
    const family = /font-family:\s*['"]?([^;'"]+)['"]?\s*;/.exec(body)?.[1]?.trim();
    const weightRaw = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400';
    const styleRaw = /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal';
    const src = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.trim();
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null;
    if (!family || !src) continue;
    const weight = parseInt(weightRaw, 10) || 400;
    out.push({ family, weight, style: styleRaw, src, unicodeRange });
  }
  return out;
}

// Pick the most "general" face for a (family, weight, style): prefer a block
// without a unicode-range (typically when only one subset exists), otherwise
// the "latin" subset (low ASCII coverage), otherwise the first match.
function pickFace(faces: FaceBlock[], family: string, weight: number, style: string): FaceBlock | null {
  const fam = family.toLowerCase();
  const matches = faces.filter(
    (f) => f.family.toLowerCase() === fam && f.weight === weight && f.style === style,
  );
  if (matches.length === 0) return null;
  const noRange = matches.find((f) => !f.unicodeRange);
  if (noRange) return noRange;
  // "latin" subset covers U+0000-00FF — recognise by the U+0000 / U+00FF range.
  const latin = matches.find((f) => f.unicodeRange && /U\+0000-00FF/i.test(f.unicodeRange));
  if (latin) return latin;
  return matches[0];
}

async function loadFontUncached(family: string, weight: number, style: string): Promise<opentype.Font | null> {
  try {
    const css = await getGoogleFontsCss();
    const faces = parseFaces(css);
    const face = pickFace(faces, family, weight, style);
    if (!face) {
      console.warn(`textToPath: no @font-face for ${family} ${weight} ${style}`);
      return null;
    }
    const woff2Buf = await fetch(face.src).then((r) => {
      if (!r.ok) throw new Error(`Font fetch failed: ${r.status} for ${face.src}`);
      return r.arrayBuffer();
    });
    // wawoff2.decompress takes a Uint8Array and returns a Uint8Array (TTF bytes).
    const ttfBytes = await wawoff2.decompress(new Uint8Array(woff2Buf));
    const ttfBuffer = ttfBytes.buffer.slice(
      ttfBytes.byteOffset,
      ttfBytes.byteOffset + ttfBytes.byteLength,
    ) as ArrayBuffer;
    return opentype.parse(ttfBuffer);
  } catch (err) {
    console.warn(`textToPath: failed to load font ${family} ${weight} ${style}:`, err);
    return null;
  }
}

function loadFont(family: string, weight: number, style: string): Promise<opentype.Font | null> {
  const key: FontKey = `${family.toLowerCase()}|${weight}|${style}`;
  let p = fontCache.get(key);
  if (!p) {
    p = loadFontUncached(family, weight, style);
    fontCache.set(key, p);
  }
  return p;
}

// Pull the first quoted or comma-separated family name from a CSS font-family
// string, e.g. "'Bangers', system-ui, sans-serif" → "Bangers".
function primaryFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '');
}

function parseWeight(w: string | null | undefined): number {
  if (!w) return 400;
  const named: Record<string, number> = {
    normal: 400, bold: 700, lighter: 300, bolder: 700,
  };
  if (named[w]) return named[w];
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 400;
}

function parseLengthPx(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

// Replace every <text> in `svg` with a <path> outline. Mutates the SVG.
// Fonts that fail to load leave the original <text> in place.
export async function inlineSvgTextAsPaths(svg: SVGSVGElement): Promise<void> {
  const texts = Array.from(svg.querySelectorAll('text'));
  if (texts.length === 0) return;

  // Stage 1: gather font requests so we kick off all loads in parallel.
  type Job = {
    el: SVGTextElement;
    family: string;
    weight: number;
    style: string;
    fontSize: number;
    fill: string;
    x: number;
    y: number;
    anchor: string;
    dominantBaseline: string;
    text: string;
  };
  const jobs: Job[] = [];
  for (const el of texts) {
    const cs = window.getComputedStyle(el);
    const family = primaryFamily(cs.fontFamily || el.getAttribute('font-family') || '');
    if (!family) continue;
    const weight = parseWeight(cs.fontWeight || el.getAttribute('font-weight'));
    const styleAttr = (cs.fontStyle || el.getAttribute('font-style') || 'normal').trim();
    const style = styleAttr === 'italic' || styleAttr === 'oblique' ? 'italic' : 'normal';
    const fontSize = parseLengthPx(cs.fontSize || el.getAttribute('font-size'), 16);
    const fill = el.getAttribute('fill') ?? cs.fill ?? 'black';
    const textX = parseFloat(el.getAttribute('x') ?? '0') || 0;
    const textY = parseFloat(el.getAttribute('y') ?? '0') || 0;
    const anchor = (el.getAttribute('text-anchor') ?? cs.textAnchor ?? 'start').trim();
    const dominantBaseline = (el.getAttribute('dominant-baseline') ?? cs.dominantBaseline ?? 'alphabetic').trim();
    // Multi-line text uses <tspan> children; emit one job per tspan with
    // its own x/y. Single-line text (no tspan children) falls back to the
    // text element's own attributes + textContent.
    const tspans = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'tspan') as SVGTSpanElement[];
    if (tspans.length === 0) {
      const text = el.textContent ?? '';
      if (text) jobs.push({ el, family, weight, style, fontSize, fill, x: textX, y: textY, anchor, dominantBaseline, text });
    } else {
      let yCursor = textY;
      for (const ts of tspans) {
        const tsX = parseFloat(ts.getAttribute('x') ?? '') || textX;
        const tsDy = parseFloat(ts.getAttribute('dy') ?? '') || 0;
        const tsY = parseFloat(ts.getAttribute('y') ?? '');
        yCursor = Number.isFinite(tsY) ? tsY : yCursor + tsDy;
        const text = ts.textContent ?? '';
        if (!text.trim()) continue;
        jobs.push({ el, family, weight, style, fontSize, fill, x: tsX, y: yCursor, anchor, dominantBaseline, text });
      }
    }
  }

  // Collect paths per text element first — multi-tspan jobs share a parent
  // and we can't replaceWith() per-job (the first call removes the parent).
  const byEl = new Map<SVGTextElement, SVGPathElement[]>();
  await Promise.all(
    jobs.map(async (job) => {
      const font = await loadFont(job.family, job.weight, job.style);
      if (!font) return; // leave <text> in place
      let drawX = job.x;
      const advance = font.getAdvanceWidth(job.text, job.fontSize);
      if (job.anchor === 'middle') drawX = job.x - advance / 2;
      else if (job.anchor === 'end') drawX = job.x - advance;

      // opentype's getPath uses the alphabetic baseline. SVG dominant-baseline
      // affects where the rendered glyph sits relative to `y`. Map the common
      // cases we actually emit (default + central). Anything else falls back
      // to alphabetic.
      let drawY = job.y;
      if (job.dominantBaseline === 'central' || job.dominantBaseline === 'middle') {
        const scale = job.fontSize / font.unitsPerEm;
        const midOffset = ((font.ascender + font.descender) / 2) * scale;
        drawY = job.y + midOffset;
      } else if (job.dominantBaseline === 'hanging') {
        const scale = job.fontSize / font.unitsPerEm;
        drawY = job.y + font.ascender * scale;
      }

      const otPath = font.getPath(job.text, drawX, drawY, job.fontSize);
      const d = otPath.toPathData(3);
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', d);
      pathEl.setAttribute('fill', job.fill);
      const list = byEl.get(job.el);
      if (list) list.push(pathEl);
      else byEl.set(job.el, [pathEl]);
    }),
  );

  // Stage 2: replace each <text> with a <g> containing all its paths.
  for (const [el, paths] of byEl) {
    if (paths.length === 0) continue;
    const transform = el.getAttribute('transform');
    if (paths.length === 1 && !transform) {
      el.replaceWith(paths[0]);
    } else {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (transform) g.setAttribute('transform', transform);
      for (const p of paths) g.appendChild(p);
      el.replaceWith(g);
    }
  }
}
