/**
 * A CanvasRenderingContext2D that draws nothing and records everything: every method call and
 * every property set, with numbers rounded to 0.01 px. Two identical logs mean identical pixels.
 */
export function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const fmt = (v: unknown): string => (typeof v === "number" ? (Math.round(v * 100) / 100).toString() : typeof v === "string" ? JSON.stringify(v) : v && typeof v === "object" && "__id" in v ? String((v as { __id: string }).__id) : typeof v);
  let gradients = 0;
  const target: Record<string, unknown> = {
    measureText: (t: string) => { log.push(`measureText(${JSON.stringify(t)})`); return { width: t.length * 6.5 }; },
    createPattern: () => { log.push("createPattern"); return { __id: "pattern" }; },
    createRadialGradient: (...a: number[]) => { const id = `grad${gradients++}`; log.push(`createRadialGradient(${a.map(fmt).join(",")})`); return { __id: id, addColorStop: (o: number, c: string) => log.push(`${id}.addColorStop(${fmt(o)},${c})`) }; },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => log.push("putImageData"),
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return (...args: unknown[]) => { log.push(`${String(k)}(${args.map(fmt).join(",")})`); };
    },
    set(t, k, v) {
      log.push(`${String(k)}=${fmt(v)}`);
      t[`__${String(k)}`] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}
