// Console assertion suite. Runs only when the page is opened with ?selftest.
const results = [];

export function assert(name, cond) {
  results.push({ name, pass: !!cond });
  console[cond ? 'log' : 'error'](`${cond ? 'PASS' : 'FAIL'} ${name}`);
}

export function assertClose(name, a, b, tol = 1e-6) {
  assert(name, Math.abs(a - b) <= tol);
}

export async function runSelftest() {
  results.length = 0;  // reruns from the console shouldn't accumulate
  const { mulberry32, randRange, randInt } = await import('./rng.js');

  // RNG determinism
  const a = mulberry32(1234), b = mulberry32(1234);
  assert('rng: same seed, same sequence',
    [a(), a(), a()].join() === [b(), b(), b()].join());
  const c = mulberry32(1);
  assert('rng: values in [0,1)', Array.from({ length: 100 }, c).every(v => v >= 0 && v < 1));
  const d = mulberry32(7);
  assert('rng: randRange respects bounds',
    Array.from({ length: 100 }, () => randRange(d, 2, 5)).every(v => v >= 2 && v < 5));
  const e = mulberry32(7);
  assert('rng: randInt respects bounds',
    Array.from({ length: 100 }, () => randInt(e, 4)).every(v => Number.isInteger(v) && v >= 0 && v < 4));

  // Isolate groups: a throwing group records a FAIL instead of killing the
  // suite and the summary line.
  for (const [group, fn] of [['color', testColor], ['scene', testScene], ['engines', testEngines]]) {
    try { await fn(); } catch (err) { assert(`${group}: test group threw (${err.message})`, false); }
  }

  const failed = results.filter(r => !r.pass);
  console.log(`selftest: ${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0;
}

// Filled in by later tasks:
async function testColor() {
  const { hexToOklch, oklchToHex, remapColor } = await import('./color.js');

  const rt = oklchToHex(hexToOklch('#c91a09'));
  assert('color: hex→oklch→hex round-trips', rt === '#c91a09' || nearHex(rt, '#c91a09', 2));

  assert('color: remap base to itself is identity-ish',
    nearHex(remapColor('#9ba19d', '#9ba19d', '#9ba19d'), '#9ba19d', 2));

  // A darker shade of gray base remapped onto red stays darker than red
  const shade = remapColor('#5c605e', '#9ba19d', '#c91a09');
  const L = (h) => hexToOklch(h).L;
  assert('color: shade ordering preserved', L(shade) < L('#c91a09'));

  assert('color: remap is deterministic',
    remapColor('#5c605e', '#9ba19d', '#c91a09') === shade);

  // Full asset shade ramp onto red stays monotone in L (catches base-noise
  // amplification producing lightness kinks in gradient bands)
  const ramp = ['#555956', '#595c5a', '#757976', '#8b918d', '#979d99', '#9aa09c', '#9ea4a0', '#cad1cc'];
  const Ls = ramp.map(s => hexToOklch(remapColor(s, '#9ba19d', '#c91a09')).L);
  assert('color: remapped ramp is monotone', Ls.every((v, i) => i === 0 || v >= Ls[i - 1] - 1e-4));

  // Out-of-gamut highlight keeps the target hue after chroma fitting
  // (catches per-channel gamut clipping shifting hue). Red keeps enough
  // fitted chroma for a well-defined output hue; very light targets clamp
  // to near-white where hue is float noise.
  const hR = hexToOklch('#c91a09').h;
  const hHi = hexToOklch(remapColor('#cad1cc', '#9ba19d', '#c91a09')).h;
  assert('color: fitted highlight hue stays true', Math.abs(hHi - hR) < 6 * Math.PI / 180);
}

function nearHex(a, b, tol) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= tol);
}
async function testScene() {
  const { defaultScene, scatter, serialize, deserialize, encodeHash, decodeHash } =
    await import('./scene.js');
  const fakeStore = { list: [{ id: '3001' }, { id: '3941' }, { id: '4070' }] };

  const s1 = defaultScene(), s2 = defaultScene();
  s1.seed = s2.seed = 42;
  scatter(s1, fakeStore); scatter(s2, fakeStore);
  assert('scene: scatter is deterministic',
    JSON.stringify(s1.chamber.parts) === JSON.stringify(s2.chamber.parts));
  assert('scene: scatter respects density', s1.chamber.parts.length === s1.density);
  assert('scene: parts land inside chamber', s1.chamber.parts.every(p =>
    p.x >= 0 && p.x <= s1.chamber.width && p.y >= 0 && p.y <= s1.chamber.height));
  assert('scene: scatter only uses enabled parts', (() => {
    const s = defaultScene(); s.seed = 7; s.partSet = ['3941'];
    scatter(s, fakeStore);
    return s.chamber.parts.every(p => p.partRef === '3941');
  })());

  const round = deserialize(serialize(s1));
  assert('scene: serialize round-trips', JSON.stringify(round) === JSON.stringify(s1));

  const h = encodeHash(s1);
  const dec = decodeHash(h);
  assert('scene: hash round-trips seed+knobs',
    dec.seed === s1.seed && dec.mode === s1.mode && dec.density === s1.density &&
    dec.radial.order === s1.radial.order && dec.tiling.group === s1.tiling.group);
  assert('scene: hash omits tweaks', dec.chamber === undefined);
  assert('scene: decodeHash rejects garbage', decodeHash('#s=%%%') === null);
  assert('scene: decodeHash rejects valid-base64 non-scene', decodeHash('#s=YWJj') === null);
  assert('scene: all-stale partSet falls back to full list', (() => {
    const s = defaultScene(); s.seed = 3; s.partSet = ['not-a-part'];
    scatter(s, fakeStore);
    return s.chamber.parts.length > 0 && s.chamber.parts.every(p => p.partRef !== undefined);
  })());
  assert('scene: deserialize recovers from empty palette colors', (() => {
    const bad = { ...defaultScene(), palette: { name: 'classic-brights', colors: [], background: '#000000' } };
    return deserialize(JSON.stringify(bad)).palette.colors.length > 0;
  })());
}
async function testEngines() {
  const { chamberGroup, renderPreview } = await import('./engines.js');
  const { defaultScene, scatter } = await import('./scene.js');
  const fakeStore = {
    list: [{ id: 'x' }],
    symbolId: (id, color) => `sym-${id}-${color.slice(1)}`,
  };
  const scene = defaultScene();
  scene.seed = 5; scene.density = 4;
  scatter(scene, fakeStore);

  const g = chamberGroup(scene, fakeStore, {});
  assert('engines: chamber has one use per part',
    g.querySelectorAll('use').length === 4);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  scene.mode = 'radial'; scene.radial = { order: 6, mirror: true };
  renderPreview(svg, scene, fakeStore);
  assert('engines: radial mirror renders 2×order wedges',
    svg.querySelectorAll('[data-wedge]').length === 12);
  assert('engines: mirrored wedge reflects then rotates',
    svg.querySelector('[data-wedge="1"]').getAttribute('transform') === 'rotate(30) scale(1,-1)');
  scene.radial.mirror = false;
  renderPreview(svg, scene, fakeStore);
  assert('engines: radial no-mirror renders order wedges',
    svg.querySelectorAll('[data-wedge]').length === 6);
  assert('engines: background rect uses palette background',
    svg.querySelector('rect').getAttribute('fill') === scene.palette.background);

  for (const [group, expectedUses] of [['p1', 1], ['pm', 2], ['pmm', 4]]) {
    scene.mode = 'tiling'; scene.tiling = { group, tileSize: 300 };
    renderPreview(svg, scene, fakeStore);
    assert(`engines: ${group} tile composes ${expectedUses} chamber copies`,
      svg.querySelectorAll('pattern use[href="#tiling-chamber"]').length === expectedUses);
    assert(`engines: ${group} pattern rect present`,
      svg.querySelector('rect[fill^="url(#"]') !== null);
  }
  // p4m composes via an intermediate cell def: 2 chamber uses in the cell,
  // 4 cell uses in the pattern (cell lives in <defs>, not under <pattern>).
  scene.mode = 'tiling'; scene.tiling = { group: 'p4m', tileSize: 300 };
  renderPreview(svg, scene, fakeStore);
  assert('engines: p4m cell mirrors chamber across the diagonal',
    svg.querySelectorAll('#p4m-cell use[href="#tiling-chamber"]').length === 2);
  assert('engines: p4m pattern stamps 4 cells',
    svg.querySelectorAll('pattern use[href="#p4m-cell"]').length === 4);
  assert('engines: p4m pattern rect present',
    svg.querySelector('rect[fill^="url(#"]') !== null);

  for (const group of ['p6m', 'p3m1']) {
    scene.mode = 'tiling'; scene.tiling = { group, tileSize: 300 };
    renderPreview(svg, scene, fakeStore);
    assert(`engines: ${group} builds a motif`, svg.querySelector('#hex-motif') !== null);
    assert(`engines: ${group} stamps motif on hex lattice (5 stamps)`,
      svg.querySelectorAll('pattern > g > use[href="#hex-motif"]').length === 5);
  }
}
