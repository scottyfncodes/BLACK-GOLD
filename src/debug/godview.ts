/**
 * DEVELOPMENT ONLY. Draws the hidden geology over Fig. 1 and Fig. 2 so the generator can be
 * checked by eye. Loaded by main.tsx only when import.meta.env.DEV; production builds never
 * include this file (scripts/check-bundle.mjs fails the build if its marker appears).
 * Press G to toggle.
 */
import { columnAt, generateGeology, isCharged } from "../sim/geology/truth/model";
import { surfaceSigns } from "../sim/geology/truth/surface";
import type { MapView } from "../render/plate/map";
import type { SectionGeometry } from "../render/plate/section";

const MARKER = "BLACK-GOLD-DEV-GOD-VIEW";
const FLUID: Record<string, string> = { oil: "rgba(20,20,20,0.85)", gas: "rgba(220,60,200,0.7)", water: "rgba(60,120,220,0.25)", sulphurWater: "rgba(200,200,40,0.45)", none: "rgba(0,0,0,0)" };

const hook = {
  on: false,
  overlay: {
    map(ctx: CanvasRenderingContext2D, v: MapView, seed: string) {
      const t = generateGeology(seed);
      const P = (x: number, y: number) => [(x - v.cx) * v.scale + v.w / 2, (y - v.cy) * v.scale + v.h / 2] as const;
      ctx.save();
      ctx.font = "bold 11px monospace";
      for (const d of t.domes) {
        const [x, y] = P(d.x, d.y);
        ctx.strokeStyle = isCharged(d) ? "#00a000" : "#808080";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, d.saltR * v.scale, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, (d.saltR + d.flankW) * v.scale, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(`${d.id} crest ${Math.round(d.crest * 3.28)}ft fill ${d.charge.fill.toFixed(2)}`, x + 6, y);
      }
      for (const s of surfaceSigns(t)) {
        const [x, y] = P(s.x, s.y);
        ctx.fillStyle = s.falsePositive ? "#ff8800" : "#0060ff";
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      ctx.fillStyle = "#c00";
      ctx.fillText(`DEV · TRUTH (${MARKER})`, 8, v.h - 8);
      ctx.restore();
    },
    section(ctx: CanvasRenderingContext2D, g: SectionGeometry, seed: string) {
      const t = generateGeology(seed);
      ctx.save();
      const n = 60;
      for (let i = 0; i < n; i++) {
        const km = ((i + 0.5) / n) * g.lengthKm;
        const x = g.a[0] + ((g.b[0] - g.a[0]) * km) / g.lengthKm, y = g.a[1] + ((g.b[1] - g.a[1]) * km) / g.lengthKm;
        for (const iv of columnAt(t, x, y, 900)) {
          ctx.fillStyle = FLUID[iv.fluid] ?? "transparent";
          if (iv.lithology === "salt") ctx.fillStyle = "rgba(255,120,120,0.35)";
          if (iv.lithology === "caprock") ctx.fillStyle = "rgba(160,120,60,0.5)";
          const y0 = g.Y(iv.top * 3.28084), y1 = g.Y(iv.base * 3.28084);
          ctx.fillRect(g.X(km) - 2, y0, 4, Math.max(1, y1 - y0));
        }
      }
      ctx.fillStyle = "#c00";
      ctx.font = "bold 11px monospace";
      ctx.fillText("DEV · TRUTH", 8, 20);
      ctx.restore();
    },
  },
};

(globalThis as { __blackGoldGodView?: typeof hook }).__blackGoldGodView = hook;
window.addEventListener("keydown", (e) => {
  if (e.key === "g" && !(e.target instanceof HTMLInputElement)) {
    hook.on = !hook.on;
    console.info(`[dev] god view ${hook.on ? "on" : "off"}`);
  }
});
