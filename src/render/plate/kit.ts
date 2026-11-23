/**
 * Drawing kit for the plate renderer: deterministic noise and plane geometry.
 * Noise here is keyed on fixed constants, never on the world seed or anything geological,
 * so procedural detail can never correlate with hidden structure (docs/ART-DIRECTION.md §1).
 */
export type Pt = [number, number];

export function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, s: number, octaves = 4): number {
  let t = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < octaves; i++) {
    t += a * vnoise(x * f, y * f, s + i * 17);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return t / n;
}

export function resample(pts: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d <= len) {
      out.push([x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export function chaikin(pts: Pt[], n: number): Pt[] {
  for (let k = 0; k < n; k++) {
    const o: Pt[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    o.push(pts[pts.length - 1]!);
    pts = o;
  }
  return pts;
}

export function normals(pts: readonly Pt[]): Pt[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
}

/** Displace a centreline sideways with smooth noise, then smooth: a meandering channel. */
export function meander(pts: readonly Pt[], amp: number, wave: number, seed: number): Pt[] {
  const r = resample(pts, wave / 10);
  const n = normals(r);
  let s = 0;
  const out = r.map((p, i) => {
    if (i > 0) s += Math.hypot(p[0] - r[i - 1]![0], p[1] - r[i - 1]![1]);
    const taper = Math.min(1, i / 6, (r.length - 1 - i) / 6);
    const d = (fbm(s / wave, 0.5, seed, 3) - 0.5) * 2 * amp * taper;
    return [p[0] + n[i]![0] * d, p[1] + n[i]![1] * d] as Pt;
  });
  return chaikin(out, 2);
}

/** A ragged belt either side of a line (woodland along a river). */
export function belt(center: readonly Pt[], width: number, seed: number): Pt[] {
  const n = normals(center);
  const L = center.map((p, i) => { const w = width * (0.55 + fbm(p[0] * 0.9, p[1] * 0.9, seed, 3)); return [p[0] + n[i]![0] * w, p[1] + n[i]![1] * w] as Pt; });
  const R = center.map((p, i) => { const w = width * (0.55 + fbm(p[0] * 0.9 + 9, p[1] * 0.9, seed + 3, 3)); return [p[0] - n[i]![0] * w, p[1] - n[i]![1] * w] as Pt; });
  return L.concat(R.reverse());
}

export function inside(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function lengthOf(pts: readonly Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return L;
}

export function pointAt(pts: readonly Pt[], s: number): { x: number; y: number; a: number } {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i === pts.length - 1) {
      const t = l ? Math.min(1, s / l) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    s -= l;
  }
  return { x: pts[0]![0], y: pts[0]![1], a: 0 };
}

export function path(ctx: CanvasRenderingContext2D, pts: readonly Pt[], close = false): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
}

/** Deterministic jittered-grid scatter inside a polygon (or everywhere when poly is null). */
export function scatter(poly: readonly Pt[] | null, cell: number, seed: number, bbox: [number, number, number, number], fn: (x: number, y: number, r: number) => void): void {
  const [x0, y0, x1, y1] = bbox;
  for (let gy = Math.floor(y0 / cell); gy <= y1 / cell; gy++)
    for (let gx = Math.floor(x0 / cell); gx <= x1 / cell; gx++) {
      const x = (gx + 0.15 + hash(gx, gy, seed) * 0.7) * cell, y = (gy + 0.15 + hash(gx, gy, seed + 1) * 0.7) * cell;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (!poly || inside(poly, x, y)) fn(x, y, hash(gx, gy, seed + 2));
    }
}

export type Box = [number, number, number, number];

/** Greedy label placement: a label is drawn only where it overlaps nothing already placed. */
export class Placer {
  private boxes: Box[] = [];
  constructor(private w: number, private h: number, private margin = 6) {}
  /** Reserve space for a mark or a label that is always drawn. */
  add(b: Box): void {
    this.boxes.push(b);
  }
  fits(b: Box): boolean {
    if (b[0] < this.margin || b[1] < this.margin || b[2] > this.w - this.margin || b[3] > this.h - this.margin) return false;
    return !this.boxes.some((p) => !(b[2] < p[0] || b[0] > p[2] || b[3] < p[1] || b[1] > p[3]));
  }
  /** Reserve and report whether it was free. */
  take(b: Box): boolean {
    if (!this.fits(b)) return false;
    this.boxes.push(b);
    return true;
  }
}
