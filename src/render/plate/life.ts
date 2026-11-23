/**
 * The living plate: what moves on the map. Light by hour of day, smoke from Beaumont's mills,
 * the Texas & New Orleans train, the field party riding the survey it is walking, the company's
 * derricks (ink: infrastructure) and, where a well came in, oil soaking the paper.
 * Inputs are observable state only. Motion uses the real-time animation clock.
 */
import { SURVEYS, centroid } from "../../content/geography/surveys";
import { toCalendar, type KnowledgeView, type Well } from "../../sim";
import { lengthOf, pointAt, type Pt } from "./kit";
import { geography } from "./geography";
import { toPx, type MapView } from "./map";
import { FONT, INK } from "./palette";

export interface LifeInputs {
  anim: number;
  gameTime: number;
  knowledge: KnowledgeView;
  wells: Well[];
  /** Wells capped and selling oil. */
  producing?: string[];
}

export function drawLife(ctx: CanvasRenderingContext2D, v: MapView, inp: LifeInputs): void {
  const P = toPx(v), g = geography();

  // Oil on the paper where a well came in: an irregular, deepening stain.
  for (const w of inp.wells) {
    if (w.status !== "gusher") continue;
    const [x, y] = P([w.x, w.y]);
    const r = Math.max(14, 0.55 * v.scale);
    ctx.fillStyle = "rgba(18, 14, 10, 0.18)";
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4, rr = r * (0.6 + 0.4 * Math.sin(k * 1.7));
      ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.3, rr, rr * 0.75, a, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Beaumont's sawmill smoke, drifting east on the Gulf wind.
  const mill = P([g.town.center[0] + 0.55, g.town.center[1] - 0.25]);
  for (let k = 0; k < 8; k++) {
    const age = (inp.anim * 0.18 + k / 8) % 1;
    ctx.fillStyle = `rgba(90, 80, 70, ${0.22 * (1 - age)})`;
    ctx.beginPath();
    ctx.arc(mill[0] + age * 38, mill[1] - age * 22, 2 + age * 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // The train: an engine and four cars working along the line, with its own smoke.
  const rail = g.rail.map(P);
  const L = lengthOf(rail);
  const s = ((inp.anim * 26) % (L + 400)) - 200;
  if (s > 0 && s < L) {
    for (let k = 0; k < 5; k++) {
      const p = pointAt(rail, Math.max(0, s - k * 11));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = INK.ink;
      ctx.fillRect(-4.5, -3, 9, 6);
      ctx.restore();
    }
    const head = pointAt(rail, s);
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = `rgba(60, 52, 44, ${0.3 - k * 0.05})`;
      ctx.beginPath(); ctx.arc(head.x - k * 7, head.y - 8 - k * 3, 2.5 + k * 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // The field party riding the survey it is walking.
  const task = inp.knowledge.task;
  if (task && task.kind === "walk") {
    const sv = SURVEYS.find((x) => x.id === task.surveyId);
    if (sv) {
      const [cx, cy] = P(centroid(sv.poly));
      const r = Math.max(10, 0.35 * v.scale);
      const a = inp.anim * 0.7;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a * 1.3) * r * 0.6;
      rider(ctx, x, y, Math.cos(a) < 0 ? -1 : 1, inp.anim);
    }
  }

  // The company's derricks, in ink.
  for (const w of inp.wells) {
    const [x, y] = P([w.x, w.y]);
    derrick(ctx, x, y, w.status === "gusher");
    ctx.font = `italic 12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = inp.producing?.includes(w.id) ? `${w.name}: producing` : w.status === "gusher" ? `${w.name}: ${w.outcome?.startsWith("GAS") ? "gas" : "oil"} at ${Math.floor(w.depthFt)} ft` : w.status === "dry" ? `${w.name}: dry, ${Math.floor(w.depthFt)} ft` : `${w.name}: ${Math.floor(w.depthFt)} ft`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK.paper;
    ctx.strokeText(label, x + 10, y - 6);
    ctx.fillStyle = INK.carmine;
    ctx.fillText(label, x + 10, y - 6);
  }

  // Daylight over the whole sheet.
  const c = toCalendar(inp.gameTime);
  const hour = c.hour + c.minute / 60;
  const tint = hour < 5 || hour >= 21 ? "rgba(30, 36, 70, 0.32)" : hour < 7 ? "rgba(214, 132, 104, 0.12)" : hour >= 18 ? `rgba(200, 110, 60, ${0.06 + Math.min(1, (hour - 18) / 3) * 0.16})` : null;
  if (tint) {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, v.w, v.h);
  }
}

function derrick(ctx: CanvasRenderingContext2D, x: number, y: number, oiled: boolean): void {
  ctx.strokeStyle = oiled ? "#140e0a" : INK.ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 4); ctx.lineTo(x, y - 14); ctx.lineTo(x + 6, y + 4);
  ctx.moveTo(x - 4, y - 2); ctx.lineTo(x + 4, y - 2);
  ctx.moveTo(x - 5, y + 2); ctx.lineTo(x + 3, y - 6);
  ctx.moveTo(x - 7, y + 4); ctx.lineTo(x + 7, y + 4);
  ctx.stroke();
}

function rider(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, t: number): void {
  const bob = Math.sin(t * 9) * 0.8;
  ctx.fillStyle = INK.ink;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(x, y + bob, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill(); // horse
  ctx.beginPath(); ctx.moveTo(x + dir * 4, y - 1 + bob); ctx.lineTo(x + dir * 7, y - 4 + bob); ctx.stroke(); // neck
  for (const lx of [-3, 3]) { ctx.beginPath(); ctx.moveTo(x + lx, y + 2 + bob); ctx.lineTo(x + lx + Math.sin(t * 9 + lx) * 1.2, y + 6); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(x - dir * 0.5, y - 6 + bob, 1.6, 0, Math.PI * 2); ctx.fill(); // rider
  ctx.fillRect(x - dir * 0.5 - 2.5, y - 8 + bob, 5, 1); // hat
}

export type { Pt };
