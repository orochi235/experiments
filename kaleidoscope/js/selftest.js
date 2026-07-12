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
async function testScene() {}
async function testEngines() {}
