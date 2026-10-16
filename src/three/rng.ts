/** 确定性伪随机（mulberry32）—— 同一个 seed 永远得到同一座城。 */
export function makeRandom(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRandom>;

export function range(rng: Rng, a: number, b: number) {
  return a + (b - a) * rng();
}

export function pickOne<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
