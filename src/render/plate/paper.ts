import { fbm, hash } from "./kit";
import { INK } from "./palette";

/**
 * Paper: ground tone, broad foxing anchored to the map (so it moves with the sheet), and a
 * fine fibre grain. The grain tile is made once through an injectable canvas factory, so the
 * renderer also runs under test with a recording context.
 */
export type CanvasFactory = (w: number, h: number) => { getContext(type: "2d"): CanvasRenderingContext2D | null } & CanvasImageSource;

let factory: CanvasFactory | undefined;
export function setCanvasFactory(f: CanvasFactory): void {
  factory = f;
  grainTile = undefined;
}

let grainTile: CanvasImageSource | undefined;
function grain(): CanvasImageSource | undefined {
  if (grainTile || !factory) return grainTile;
  const n = 256, c = factory(n, n), g = c.getContext("2d");
  if (!g) return undefined;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = fbm(x / 3, y / 3, 91, 2) * 0.6 + hash(x, y, 5) * 0.4 + (fbm(x / 40, y / 2.2, 77, 2) - 0.5) * 0.35;
      const i = (y * n + x) * 4, t = Math.max(0, Math.min(255, v * 255));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = t;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}

/** Fill (0,0,w,h) with paper. `ox, oy` are the sheet's offset in px so foxing moves with the map. */
export function paper(ctx: CanvasRenderingContext2D, w: number, h: number, ox = 0, oy = 0): void {
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, w, h);
  const step = 8;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const v = fbm((x - ox) / 260, (y - oy) / 260, 101, 3) - 0.5;
      if (Math.abs(v) < 0.05) continue;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${(v * 0.1).toFixed(3)})` : `rgba(120,90,40,${(-v * 0.1).toFixed(3)})`;
      ctx.fillRect(x, y, step, step);
    }
  const tile = grain();
  if (tile) {
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.globalCompositeOperation = "multiply";
    const pat = ctx.createPattern(tile, "repeat");
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}
