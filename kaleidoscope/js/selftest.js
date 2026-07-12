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

  await testColor();
  await testScene();
  await testEngines();

  const failed = results.filter(r => !r.pass);
  console.log(`selftest: ${results.length - failed.length}/${results.length} passed`);
  return failed.length === 0;
}

// Filled in by later tasks:
async function testColor() {}
async function testScene() {}
async function testEngines() {}
