/**
 * Seeded randomness, two kinds:
 *
 * 1. Counter-based: `rngKey(seed, "geology", basin, x, y)` is a pure hash. The same key
 *    always gives the same value, in any order. Use it for anything generated lazily
 *    (geology, terrain) so that generation order can never change the world.
 *
 * 2. Named streams: `nextFloat(world, "drilling:well-17")` draws from an sfc32 stream
 *    whose state is stored in the world (so it saves and loads). Each stream is seeded
 *    from the world seed plus its own name, so a new consumer in one module cannot
 *    shift the numbers any other module receives.
 */

/** A world seed: 64 bits as 16 lowercase hex digits. */
export type Seed = string;
export type StreamState = [number, number, number, number];

const SEED_RE = /^[0-9a-f]{16}$/;

export function isSeed(s: string): s is Seed {
  return SEED_RE.test(s);
}

export function parseSeed(seed: Seed): [number, number] {
  if (!isSeed(seed)) throw new Error(`Invalid seed "${seed}": expected 16 hex digits`);
  return [parseInt(seed.slice(0, 8), 16) >>> 0, parseInt(seed.slice(8), 16) >>> 0];
}

// lowbias32 finalizer (Chris Wellons): strong avalanche, 32-bit integer ops only.
function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

function hashString(s: string): number {
  // FNV-1a over UTF-16 code units, then mixed.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h >>> 0);
}

export type KeyPart = string | number;

/** Pure 32-bit hash of (seed, ...parts). Integers only for numeric parts. */
export function rngKey(seed: Seed, ...parts: KeyPart[]): number {
  const [hi, lo] = parseSeed(seed);
  let h = mix32(hi ^ 0x9e3779b9);
  h = mix32(h ^ lo);
  for (const p of parts) {
    let v: number;
    if (typeof p === "string") v = hashString(p);
    else {
      if (!Number.isSafeInteger(p)) throw new Error(`rngKey numeric parts must be integers, got ${p}`);
      v = (p >>> 0) ^ mix32(Math.floor(p / 0x100000000) >>> 0);
    }
    h = mix32((h + 0x9e3779b9 + v) >>> 0);
  }
  return h;
}

/** Uniform float in [0, 1) from a pure key. */
export function rngUnit(seed: Seed, ...parts: KeyPart[]): number {
  return rngKey(seed, ...parts) / 0x100000000;
}

export function streamInit(seed: Seed, name: string): StreamState {
  const s: StreamState = [rngKey(seed, "stream", name, 0), rngKey(seed, "stream", name, 1), rngKey(seed, "stream", name, 2), 1];
  // Warm up so nearby seeds decorrelate.
  for (let i = 0; i < 12; i++) streamNextU32(s);
  return s;
}

/** sfc32: mutates `s`, returns a uint32. */
export function streamNextU32(s: StreamState): number {
  let [a, b, c, d] = s;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  s[0] = a >>> 0;
  s[1] = b;
  s[2] = c;
  s[3] = d;
  return t;
}
