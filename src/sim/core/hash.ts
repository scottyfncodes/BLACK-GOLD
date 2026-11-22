/**
 * Canonical serialization and a stable hash of world state.
 * Object keys are sorted, so two states with equal content always hash equally,
 * regardless of the order their properties were created in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const child = (v as Record<string, unknown>)[k];
      if (child !== undefined) out[k] = sortKeys(child);
    }
    return out;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`Non-finite number in state: ${v}`);
  return v;
}

/** cyrb53: 53-bit string hash, returned as 14 hex digits. */
export function hashString53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function hashState(state: unknown): string {
  return hashString53(canonicalJson(state));
}
