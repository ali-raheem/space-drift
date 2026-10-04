// Seeded randomness, value noise and name generation. DOM-free so it can be
// unit-tested under Node.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  gauss() {
    const u = 1 - this.next(), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Pick a key of `weights` ({key: weight}) proportionally to its weight. */
  weighted(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = this.next() * total;
    for (const k in weights) {
      r -= weights[k];
      if (r < 0) return k;
    }
    return Object.keys(weights).pop();
  }
  /** A fresh, independent generator derived from this one. */
  fork() { return new Rng(Math.floor(this.next() * 4294967296)); }
}

/** 3D value noise with quintic interpolation and an fBm helper. Output in [0, 1]. */
export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  function noise3(x, y, z) {
    const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
    const X = xf & 255, Y = yf & 255, Z = zf & 255;
    const u = fade(x - xf), v = fade(y - yf), w = fade(z - zf);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(vals[perm[AA]], vals[perm[BA]], u), lerp(vals[perm[AB]], vals[perm[BB]], u), v),
      lerp(lerp(vals[perm[AA + 1]], vals[perm[BA + 1]], u), lerp(vals[perm[AB + 1]], vals[perm[BB + 1]], u), v),
      w
    );
  }

  function fbm3(x, y, z, octaves = 4) {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise3(x, y, z);
      norm += amp;
      x *= 2.03; y *= 2.03; z *= 2.03;
      amp *= 0.5;
    }
    return sum / norm;
  }

  return { noise3, fbm3 };
}

const ONSETS = ['k', 'v', 'th', 'z', 'm', 'r', 's', 'n', 'l', 'dr', 'kh', 'x', 'c', 'h', 'qu', 'y', 'b', 'tr', 'ph', 'sel', 'or'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'y', 'au', 'io'];
const CODAS = ['', '', '', 'n', 'r', 's', 'x', 'th', 'l', 'm', 'ss', 'k'];
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Sigma', 'Tau', 'Omicron', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];
const REGIONS = ['Expanse', 'Reach', 'Drift', 'Verge', 'Deep', 'Cluster', 'Void', 'Shoal', 'Marches', 'Rift', 'Hollow', 'Spur', 'Gulf', 'Barrens'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const CATALOGS = ['HD', 'KIC', 'TOI', 'GJ', 'HIP', 'WISE', 'LHS', 'XO'];

export function properName(rng) {
  let name = '';
  const syllables = rng.int(2, 3);
  for (let i = 0; i < syllables; i++) name += rng.pick(ONSETS) + rng.pick(VOWELS);
  name += rng.pick(CODAS);
  return name[0].toUpperCase() + name.slice(1);
}

export function sectorName(rng) {
  return `${rng.pick(GREEK)} ${properName(rng)} ${rng.pick(REGIONS)}`;
}

export function bodyName(rng, kind = 'planet') {
  if (kind === 'planet') {
    return rng.chance(0.55)
      ? `${properName(rng)} ${rng.pick(ROMAN)}`
      : `${rng.pick(CATALOGS)} ${rng.int(1000, 99999)} ${'bcdefg'[rng.int(0, 5)]}`;
  }
  if (kind === 'star') return rng.chance(0.5) ? properName(rng) : `${rng.pick(CATALOGS)} ${rng.int(1000, 99999)}`;
  return `${rng.pick(['PSR', 'SGR', 'XTE', 'GRS', 'Cyg'])} J${rng.int(1000, 2359)}${rng.sign() > 0 ? '+' : '−'}${rng.int(10, 89)}`;
}

export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return (Math.random() * 2 ** 32) >>> 0;
}
