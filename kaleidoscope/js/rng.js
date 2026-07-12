// mulberry32: tiny 32-bit seeded PRNG, plenty for scatter reproducibility.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rand, min, max) => min + rand() * (max - min);
export const randInt = (rand, n) => Math.floor(rand() * n);
export const randPick = (rand, arr) => arr[randInt(rand, arr.length)];
