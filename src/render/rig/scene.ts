/**
 * The rig: an animated plate. Above ground, the 1890 cable-tool rig at work; below, a cutaway of
 * the hole inked in only from the company's own bailer samples (blank paper below the bit).
 * Inputs are the observable well state and knowledge; nothing here reads geological truth.
 * Drawn every frame; motion is driven by `anim` (real seconds), never by the sim clock.
 */
import { toCalendar, type SampleEvidence, type Well } from "../../sim";
import { fbm, hash } from "../plate/kit";
import { FONT, INK } from "../plate/palette";
import { paper } from "../plate/paper";
import { column } from "../plate/section";

export interface SceneInput {
  w: number;
  h: number;
  /** Real seconds since the view opened (animation clock). */
  anim: number;
  /** Game time, for the light. */
  gameTime: number;
  well: Well;
  samples: SampleEvidence[];
  /** 0–1 position in the current stroke of the walking beam (0 = top). */
  stroke: number;
}

interface Drop { x: number; y: number; vx: number; vy: number; r: number; }
interface Puff { x: number; y: number; r: number; age: number; life: number; dark: boolean; }

/** Persistent animation state: particles and the oil that has stained the paper. */
export class SceneState {
  drops: Drop[] = [];
  puffs: Puff[] = [];
  stains: { x: number; y: number; r: number }[] = [];
  lastStroke = 0;
  gusherAge = 0;
  private seed = 1;
  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}

export interface Layout {
  horizon: number;
  derrickX: number;
  floorY: number;
  derrickH: number;
  /** Depth (ft) → y in the cutaway. */
  Y: (ft: number) => number;
  maxFt: number;
}

export function layout(w: number, h: number, depthFt: number): Layout {
  const horizon = Math.round(h * 0.54);
  const floorY = horizon + Math.round(h * 0.02);
  const derrickX = Math.round(w * (w > 700 ? 0.34 : 0.3));
  const derrickH = Math.min(h * 0.48, w * 0.6);
  const maxFt = Math.max(400, Math.ceil((depthFt + 160) / 100) * 100);
  const top = floorY + 14, bottom = h - 26;
  return { horizon, derrickX, floorY, derrickH, maxFt, Y: (ft) => top + (ft / maxFt) * (bottom - top) };
}

/** Light over the plate by hour: dawn rose, noon clear, dusk amber, night indigo. */
function light(hour: number): { tint: string; alpha: number; dark: number } {
  if (hour < 5 || hour >= 21) return { tint: "40, 46, 80", alpha: 0.38, dark: 0.55 };
  if (hour < 7) return { tint: "214, 132, 104", alpha: 0.2 * (1 - (hour - 5) / 2) + 0.06, dark: 0.15 };
  if (hour < 17) return { tint: "255, 244, 214", alpha: 0.05, dark: 0 };
  if (hour < 19.5) return { tint: "214, 120, 60", alpha: 0.08 + 0.18 * ((hour - 17) / 2.5), dark: 0.12 };
  return { tint: "90, 60, 90", alpha: 0.3, dark: 0.35 };
}

export function drawScene(ctx: CanvasRenderingContext2D, s: SceneState, inp: SceneInput, dt: number): void {
  const { w, h, well } = inp;
  const L = layout(w, h, well.depthFt);
  const cal = toCalendar(inp.gameTime);
  const hour = cal.hour + cal.minute / 60;
  const lit = light(hour);
  const working = well.status === "drilling" && !well.busy && (well.feeding || well.auto || well.contact > 0);
  const gusher = well.status === "gusher";
  if (gusher) s.gusherAge += dt;

  paper(ctx, w, h);

  // ---- Sky: a wash graded to the horizon, and clouds drifting on the wind.
  const sky = ctx.createLinearGradient(0, 0, 0, L.horizon);
  sky.addColorStop(0, `rgba(${lit.tint}, ${Math.min(0.6, lit.alpha * 1.6)})`);
  sky.addColorStop(1, `rgba(${lit.tint}, ${lit.alpha * 0.5})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, L.horizon);
  for (let i = 0; i < 6; i++) {
    const cx = ((hash(i, 1, 7) * w * 1.4 + inp.anim * (6 + i * 1.5)) % (w * 1.4)) - w * 0.2;
    const cy = L.horizon * (0.12 + hash(i, 2, 7) * 0.45);
    cloud(ctx, cx, cy, 40 + hash(i, 3, 7) * 70, lit.dark);
  }

  drawSun(ctx, inp, L, hour);

  // ---- Far horizon: woodland marks along the Neches, Beaumont's mills with their smoke.
  ctx.strokeStyle = `rgba(70, 84, 44, ${0.55 - lit.dark * 0.2})`;
  ctx.lineWidth = 0.8;
  for (let x = w * 0.55; x < w; x += 6) {
    const yy = L.horizon - 3 - fbm(x / 40, 1, 3, 2) * 9;
    ctx.beginPath();
    ctx.arc(x, yy, 2 + hash(x, 0, 2) * 1.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();
  }
  const millX = w * 0.08;
  ctx.fillStyle = INK.ink;
  for (let k = 0; k < 5; k++) ctx.fillRect(millX + k * 9, L.horizon - 6 - hash(k, 4, 4) * 6, 7, 8 + hash(k, 4, 4) * 6);
  ctx.fillRect(millX + 20, L.horizon - 24, 3, 24);
  for (let k = 0; k < 7; k++) {
    const age = (inp.anim * 0.25 + k / 7) % 1;
    ctx.fillStyle = `rgba(80, 70, 60, ${0.25 * (1 - age)})`;
    ctx.beginPath();
    ctx.arc(millX + 21 + age * 60, L.horizon - 26 - age * 34, 3 + age * 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Ground line and prairie grass bending in the wind.
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, L.horizon);
  ctx.lineTo(w, L.horizon);
  ctx.stroke();
  ctx.fillStyle = "rgba(214, 178, 108, 0.14)";
  ctx.fillRect(0, L.horizon, w, L.floorY - L.horizon + 4);
  ctx.strokeStyle = "rgba(90, 96, 52, 0.7)";
  ctx.lineWidth = 0.8;
  for (let x = 2; x < w; x += 7) {
    if (Math.abs(x - L.derrickX) < L.derrickH * 0.22) continue;
    const sway = Math.sin(inp.anim * 1.6 + x * 0.05) * 2.2 + fbm(x / 30, inp.anim * 0.2, 9, 2) * 2;
    const gh = 5 + hash(x, 1, 9) * 7;
    ctx.beginPath();
    ctx.moveTo(x, L.horizon);
    ctx.quadraticCurveTo(x + sway * 0.4, L.horizon - gh * 0.6, x + sway, L.horizon - gh);
    ctx.stroke();
  }

  drawSite(ctx, inp, L, hour);
  drawRigAbove(ctx, s, inp, L, working, gusher, dt);
  drawCutaway(ctx, inp, L, working);
  if (gusher) drawGusher(ctx, s, inp, L, dt);

  // Night falls over the whole plate.
  if (lit.dark > 0) {
    ctx.fillStyle = `rgba(20, 24, 48, ${lit.dark * 0.35})`;
    ctx.fillRect(0, 0, w, L.horizon);
  }
  // Oil that has rained on the paper stays there.
  ctx.fillStyle = "rgba(18, 14, 10, 0.85)";
  for (const st of s.stains) { ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill(); }
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dark: number): void {
  ctx.fillStyle = `rgba(${dark > 0.3 ? "60, 64, 90" : "255, 252, 240"}, ${dark > 0.3 ? 0.18 : 0.45})`;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.ellipse(x + (k - 2) * r * 0.35, y + Math.sin(k * 1.7) * r * 0.08, r * (0.35 + 0.15 * Math.sin(k)), r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = `rgba(110, 100, 90, 0.18)`;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.8, y + r * 0.12);
  ctx.lineTo(x + r * 0.8, y + r * 0.12);
  ctx.stroke();
}

function timber(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, wdt: number): void {
  ctx.lineWidth = wdt;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawRigAbove(ctx: CanvasRenderingContext2D, s: SceneState, inp: SceneInput, L: Layout, working: boolean, gusher: boolean, dt: number): void {
  const { well } = inp;
  const X = L.derrickX, base = L.floorY, H = L.derrickH;
  const halfBase = H * 0.17, halfTop = H * 0.035;
  // Raising the derrick: it grows course by course while the rig builders work.
  const built = well.status === "rigging" && well.busy ? Math.min(1, Math.max(0.08, 1 - (well.busy.until - inp.gameTime) / (3 * 1440))) : 1;
  const topY = base - H * built;
  const legX = (y: number, side: number) => X + side * (halfBase - (halfBase - halfTop) * ((base - y) / H));
  ctx.strokeStyle = gusher ? "#140e0a" : INK.ink;
  ctx.lineCap = "round";
  // Legs, girts and braces.
  for (const side of [-1, 1]) timber(ctx, legX(base, side), base, legX(topY, side), topY, 3.2);
  const courses = 9;
  for (let k = 1; k <= courses; k++) {
    const y = base - (H * k) / courses;
    if (y < topY - 0.5) break;
    timber(ctx, legX(y, -1), y, legX(y, 1), y, 1.6);
    const yPrev = base - (H * (k - 1)) / courses;
    ctx.globalAlpha = 0.85;
    timber(ctx, legX(yPrev, -1), yPrev, legX(y, 1), y, 1);
    timber(ctx, legX(yPrev, 1), yPrev, legX(y, -1), y, 1);
    ctx.globalAlpha = 1;
  }
  // Timber shading on the sunward leg.
  ctx.strokeStyle = "rgba(42, 33, 24, 0.35)";
  for (let y = base - 4; y > topY; y -= 5) timber(ctx, legX(y, 1) - 3, y, legX(y, 1) - 1, y - 3, 0.6);
  // Ladder up the left leg.
  ctx.strokeStyle = INK.inkSoft;
  for (let y = base - 8; y > topY + 6; y -= 7) timber(ctx, legX(y, -1) + 1, y, legX(y, -1) + 7, y, 0.8);
  // Derrick floor and the bull wheel beside it.
  ctx.strokeStyle = INK.ink;
  timber(ctx, X - halfBase - 18, base, X + halfBase + 10, base, 3);
  const bwX = X - halfBase - 30, bwY = base - 16, bwR = 13;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(bwX, bwY, bwR, 0, Math.PI * 2); ctx.stroke();
  const bwSpin = well.busy?.op === "bail" ? inp.anim * 4 : 0;
  for (let k = 0; k < 6; k++) { const a = bwSpin + (k / 6) * Math.PI * 2; timber(ctx, bwX, bwY, bwX + Math.cos(a) * bwR, bwY + Math.sin(a) * bwR, 1); }
  if (built < 1) {
    ctx.font = `italic 14px ${FONT}`;
    ctx.fillStyle = INK.carmine;
    ctx.textAlign = "center";
    ctx.fillText("rig builders at work", X, topY - 12);
    return;
  }
  // Crown block.
  ctx.fillStyle = INK.ink;
  ctx.fillRect(X - halfTop - 6, topY - 6, (halfTop + 6) * 2, 7);
  ctx.beginPath(); ctx.arc(X + 2, topY - 9, 5, 0, Math.PI * 2); ctx.stroke();

  // Walking beam: rocks on the samson post, driven by the pitman from the band wheel.
  const stroke = working ? inp.stroke : well.busy ? 0.15 : 0.35;
  const swing = Math.cos(stroke * Math.PI * 2) * 0.09;
  const postX = X + H * 0.42, postTop = base - H * 0.17;
  const beamL = H * 0.38, beamR = H * 0.3;
  const leftX = postX - Math.cos(swing) * beamL, leftY = postTop - Math.sin(swing) * beamL;
  const rightX = postX + Math.cos(swing) * beamR, rightY = postTop + Math.sin(swing) * beamR;
  timber(ctx, postX - 10, base, postX, postTop, 3.4);
  timber(ctx, postX + 10, base, postX, postTop, 3.4);
  timber(ctx, leftX, leftY, rightX, rightY, 5);
  // Band wheel with its crank and the pitman rod.
  const wheelX = rightX + H * 0.04, wheelY = base - H * 0.1, wheelR = H * 0.085;
  const crank = stroke * Math.PI * 2 + Math.PI / 2;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(wheelX, wheelY, wheelR, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 8; k++) { const a = crank + (k / 8) * Math.PI * 2; timber(ctx, wheelX, wheelY, wheelX + Math.cos(a) * wheelR, wheelY + Math.sin(a) * wheelR, 1); }
  const pinX = wheelX + Math.cos(crank) * wheelR * 0.55, pinY = wheelY + Math.sin(crank) * wheelR * 0.55;
  timber(ctx, rightX, rightY, pinX, pinY, 2.6);
  timber(ctx, wheelX - 8, base, wheelX, wheelY, 2.2);
  timber(ctx, wheelX + 8, base, wheelX, wheelY, 2.2);
  // Engine house and boiler with its stack.
  const boilX = wheelX + wheelR + H * 0.12, boilY = base - H * 0.07;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect?.(boilX - H * 0.1, boilY - H * 0.05, H * 0.2, H * 0.08, H * 0.04); ctx.stroke();
  timber(ctx, boilX + H * 0.06, boilY - H * 0.05, boilX + H * 0.06, boilY - H * 0.2, 4);
  ctx.strokeStyle = INK.inkSoft;
  timber(ctx, wheelX, wheelY, boilX - H * 0.1, boilY, 0.9); // drive belt
  // Steam and smoke: a chuff each stroke while the engine works.
  if (working && s.lastStroke > 0.5 && inp.stroke < 0.5) {
    s.puffs.push({ x: boilX + H * 0.06, y: boilY - H * 0.2, r: 4, age: 0, life: 3, dark: true });
    s.puffs.push({ x: boilX - H * 0.1, y: boilY - H * 0.02, r: 3, age: 0, life: 1.2, dark: false });
  }
  s.lastStroke = inp.stroke;
  for (const p of s.puffs) {
    p.age += dt;
    p.x += (p.dark ? 9 : 14) * dt;
    p.y -= (p.dark ? 12 : 4) * dt;
    p.r += (p.dark ? 6 : 9) * dt;
  }
  s.puffs = s.puffs.filter((p) => p.age < p.life);
  for (const p of s.puffs) {
    const a = 1 - p.age / p.life;
    ctx.fillStyle = p.dark ? `rgba(60, 52, 44, ${0.35 * a})` : `rgba(255, 255, 255, ${0.55 * a})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }

  // The drilling line: crown pulley → temper screw at the beam's end → down the hole.
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(X + 2, topY - 4);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(X, base);
  ctx.stroke();
  // The temper screw clamp.
  ctx.fillStyle = INK.carmine;
  ctx.fillRect(leftX - 3, leftY - 2, 6, 10);

  // The driller at the temper screw, and the tool dresser at the forge when dressing.
  figure(ctx, leftX + 14, base, 1, working ? Math.sin(inp.anim * 5) * 0.5 : 0);
  if (well.busy?.op === "dress") {
    const fx = X - halfBase - 58;
    ctx.fillStyle = `rgba(230, 120, 40, ${0.5 + 0.3 * Math.sin(inp.anim * 9)})`;
    ctx.beginPath(); ctx.arc(fx, base - 6, 7, 0, Math.PI * 2); ctx.fill();
    figure(ctx, fx + 14, base, -1, Math.sin(inp.anim * 7));
  }
  if (well.status === "stuck") {
    ctx.font = `italic 15px ${FONT}`;
    ctx.fillStyle = INK.carmine;
    ctx.textAlign = "center";
    ctx.textAlign = "left";
    ctx.fillText("the tools are fast in the hole", X + halfBase * 0.6 + 12, base - H * 0.55);
  }
}

function figure(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, arm: number): void {
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(x, y - 23, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - 5, y - 27, 10, 1.6); // hat brim
  timber(ctx, x, y - 20, x, y - 9, 2.4);
  timber(ctx, x, y - 9, x - 3, y, 1.6);
  timber(ctx, x, y - 9, x + 3, y, 1.6);
  timber(ctx, x, y - 17, x - dir * 7, y - 14 - arm * 4, 1.4);
}

function drawCutaway(ctx: CanvasRenderingContext2D, inp: SceneInput, L: Layout, working: boolean): void {
  const { well, w } = inp;
  const X = L.derrickX, top = L.Y(0);
  const colW = 54;
  // What the company knows: its own samples, inked beside the hole. Everything else is blank.
  const own = inp.samples.filter((s) => s.wellId === well.id);
  let lastShowY = -Infinity;
  for (const s of own) {
    const y0 = L.Y(s.topFt), y1 = L.Y(s.baseFt);
    for (const side of [-1, 1]) {
      const x = side < 0 ? X - 6 - colW : X + 6;
      column(ctx, x, y0, colW, Math.max(1.5, y1 - y0), s.lith);
      // Feather the bed's outer edge: inferred no further than the hole itself.
      const g = ctx.createLinearGradient(side < 0 ? x : x + colW, 0, side < 0 ? x + 18 : x + colW - 18, 0);
      g.addColorStop(0, "rgba(243, 234, 213, 1)");
      g.addColorStop(1, "rgba(243, 234, 213, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(side < 0 ? x - 1 : x + colW - 18, y0 - 1, 19, Math.max(2, y1 - y0) + 2);
    }
    if (s.show && (y0 + y1) / 2 - lastShowY > 22) {
      lastShowY = (y0 + y1) / 2;
      ctx.font = `italic 13px ${FONT}`;
      ctx.fillStyle = INK.carmine;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(s.show === "gas" ? "gas!" : s.show === "oil" ? "oil!" : "sulphur", X + 12 + colW, (y0 + y1) / 2);
    }
  }
  // Depth scale.
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.inkSoft;
  ctx.lineWidth = 0.8;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ax = Math.max(46, X - colW - 70);
  ctx.beginPath(); ctx.moveTo(ax, top); ctx.lineTo(ax, L.Y(L.maxFt)); ctx.stroke();
  const step = L.maxFt > 1200 ? 200 : 100;
  for (let ft = 0; ft <= L.maxFt; ft += step) {
    ctx.beginPath(); ctx.moveTo(ax - 4, L.Y(ft)); ctx.lineTo(ax, L.Y(ft)); ctx.stroke();
    ctx.fillText(ft === 0 ? "0 ft" : String(ft), ax - 7, L.Y(ft));
  }
  // The hole, its casing, and the cuttings.
  const bottom = L.Y(well.depthFt);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(X + side * 4, top); ctx.lineTo(X + side * 4, bottom); ctx.stroke(); }
  if (well.casedFt > 0) {
    ctx.lineWidth = 2.4;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(X + side * 5.5, top); ctx.lineTo(X + side * 5.5, L.Y(well.casedFt)); ctx.stroke(); }
  }
  const fillTop = L.Y(Math.max(0, well.depthFt - well.fillFt));
  ctx.fillStyle = "rgba(122, 104, 80, 0.55)";
  ctx.fillRect(X - 3.5, fillTop, 7, Math.max(0, bottom - fillTop));
  // The tools: a stem and bit on the line, striking with each stroke.
  const slackPx = Math.max(0, (well.depthFt - well.reachFt)) * ((L.Y(100) - L.Y(0)) / 100);
  const lift = working ? Math.max(0, Math.sin(inp.stroke * Math.PI * 2)) * 9 : well.busy ? 40 : 6;
  const bitY = Math.min(bottom, bottom - slackPx - lift);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X, top); ctx.lineTo(X, bitY - 30); ctx.stroke();
  ctx.fillStyle = INK.ink;
  ctx.fillRect(X - 2.5, bitY - 30, 5, 24);
  ctx.beginPath(); ctx.moveTo(X - 3.5, bitY - 6); ctx.lineTo(X + 3.5, bitY - 6); ctx.lineTo(X, bitY); ctx.closePath(); ctx.fill();
  // Below the bit: unknown.
  if (well.status !== "gusher") {
    ctx.font = `italic 13px ${FONT}`;
    ctx.fillStyle = "rgba(106, 90, 72, 0.7)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("unknown", X, Math.min(L.Y(L.maxFt) - 18, bottom + 16));
  }
  // The driller's log: the period's own record of the hole, written up from each bail.
  if (inp.w > 760) drillersLog(ctx, inp, L, own);

  // The bottom of the hole, labelled.
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = INK.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.floor(well.depthFt)} ft`, X + 12, bottom);
  void w;
}

function drawGusher(ctx: CanvasRenderingContext2D, s: SceneState, inp: SceneInput, L: Layout, dt: number): void {
  const X = L.derrickX, base = L.floorY, H = L.derrickH;
  const gas = !!inp.well.outcome?.startsWith("GAS");
  const rise = Math.min(1, s.gusherAge / 1.2);
  const topY = base - H * 1.3 * rise;

  if (gas) {
    // A gas blowout: a pale, churning plume and a roar, sand and water thrown with it.
    for (let k = 0; k < 4; k++) s.puffs.push({ x: X + (s.rand() - 0.5) * 10, y: base - s.rand() * (base - topY), r: 6 + s.rand() * 8, age: 0, life: 2.2 + s.rand(), dark: false });
    for (const p of s.puffs) { p.age += dt * 0.4; p.y -= 40 * dt; p.x += 22 * dt; p.r += 14 * dt; }
    ctx.fillStyle = "rgba(235, 232, 222, 0.55)";
    for (let k = 0; k < 10; k++) {
      const y = base - (base - topY) * (k / 10), wob = Math.sin(inp.anim * 11 + k * 1.3) * 4;
      ctx.beginPath(); ctx.ellipse(X + wob, y, 6 + k * 2.4, 9, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(120, 110, 96, 0.6)";
    ctx.lineWidth = 1;
    for (let k = 0; k < 24; k++) {
      const a = -Math.PI / 2 + (s.rand() - 0.5) * 0.9, r = (base - topY) * s.rand();
      const x = X + Math.cos(a) * r * 0.3, y = base + Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); ctx.stroke();
    }
  } else {
    // Oil: a dark roiling jet over the crown, a mist, and drops streaming down the wind.
    const mist = ctx.createRadialGradient(X + 30, topY + 20, 4, X + 30, topY + 20, H * 0.7);
    mist.addColorStop(0, "rgba(18, 14, 10, 0.35)");
    mist.addColorStop(1, "rgba(18, 14, 10, 0)");
    ctx.fillStyle = mist;
    ctx.fillRect(X - H, topY - H * 0.5, H * 2.4, H * 1.6);
    const N = 28, left: [number, number][] = [], right: [number, number][] = [];
    for (let k = 0; k <= N; k++) {
      const f = k / N, y = base - (base - topY) * f;
      const half = 3 + f * f * 16 + Math.sin(inp.anim * 13 + k * 1.1) * (1 + f * 3);
      const sway = Math.sin(inp.anim * 3 + f * 4) * f * 6;
      left.push([X + sway - half, y]);
      right.push([X + sway + half, y]);
    }
    ctx.fillStyle = "rgba(16, 12, 9, 0.92)";
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1]);
    ctx.closePath();
    ctx.fill();
    // Sheen on the jet: thin lighter streaks running up it.
    ctx.strokeStyle = "rgba(120, 104, 84, 0.45)";
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      left.forEach(([x, y], i) => { const xx = x + (right[i]![0] - x) * (0.3 + k * 0.2) + Math.sin(inp.anim * 7 + i + k) * 1.2; if (i) ctx.lineTo(xx, y); else ctx.moveTo(xx, y); });
      ctx.stroke();
    }
    // The crown of the gusher breaks into a spreading plume.
    ctx.fillStyle = "rgba(16, 12, 9, 0.85)";
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + inp.anim * 1.5;
      ctx.beginPath(); ctx.arc(X + Math.cos(a) * 14 + 8, topY + Math.sin(a) * 6, 9 + Math.sin(inp.anim * 5 + k) * 2, 0, Math.PI * 2); ctx.fill();
    }
    for (let k = 0; k < 14; k++) {
      s.drops.push({ x: X + (s.rand() - 0.5) * 16, y: topY + s.rand() * 10, vx: (s.rand() - 0.3) * 180, vy: -50 - s.rand() * 140, r: 0.8 + s.rand() * 2.2 });
    }
    for (const d of s.drops) { d.vy += 280 * dt; d.vx += 30 * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
    // Drops that land splash; a few spatter the sky of the plate itself.
    for (const d of s.drops) {
      if (s.stains.length >= 1200) break;
      if (d.y > base && s.rand() < 0.25) splat(s, d.x, base - s.rand() * 5, d.r * 1.4);
      else if (d.y < L.horizon && s.rand() < 0.003) splat(s, d.x, d.y, d.r);
    }
    s.drops = s.drops.filter((d) => d.y < base + 4 && d.x > -20 && d.x < inp.w + 20).slice(-900);
    ctx.strokeStyle = "rgba(16, 12, 9, 0.9)";
    ctx.lineCap = "round";
    for (const d of s.drops) {
      const sp = Math.hypot(d.vx, d.vy) || 1;
      ctx.lineWidth = d.r;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - (d.vx / sp) * d.r * 4, d.y - (d.vy / sp) * d.r * 4); ctx.stroke();
    }
    ctx.fillStyle = "rgba(16, 12, 9, 0.78)";
    ctx.beginPath(); ctx.ellipse(X + 14, base + 3, Math.min(H * 1.1, 24 + s.gusherAge * 26), 7, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The pay zone in the section, observed at last.
  const y = L.Y(inp.well.depthFt);
  ctx.fillStyle = gas ? "rgba(140, 130, 120, 0.7)" : "rgba(16, 12, 9, 0.85)";
  ctx.fillRect(X - 70, y - 4, 140, 10);
  ctx.font = `italic 15px ${FONT}`;
  ctx.fillStyle = INK.carmine;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(gas ? "gas sand" : "oil sand", X + 76, y + 1);
}

/** An irregular splatter: a blot with satellite droplets. */
function splat(s: SceneState, x: number, y: number, r: number): void {
  s.stains.push({ x, y, r });
  const n = 1 + Math.floor(s.rand() * 3);
  for (let k = 0; k < n; k++) {
    const a = s.rand() * Math.PI * 2, d = r * (1.2 + s.rand() * 1.6);
    s.stains.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, r: r * (0.25 + s.rand() * 0.35) });
  }
}

/** The sun (or moon) on its arc, low and large at dawn and dusk. */
function drawSun(ctx: CanvasRenderingContext2D, inp: SceneInput, L: Layout, hour: number): void {
  const day = hour >= 5.5 && hour <= 19.5;
  const t = day ? (hour - 5.5) / 14 : ((hour + 24 - 19.5) % 24) / 10;
  const x = inp.w * (0.08 + 0.84 * t), y = L.horizon - Math.sin(t * Math.PI) * L.horizon * 0.72 - 10;
  const low = Math.max(0, 1 - Math.sin(t * Math.PI) * 2.2);
  const r = 13 + low * 7;
  if (day) {
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 5);
    g.addColorStop(0, `rgba(240, ${200 - low * 70}, ${120 - low * 60}, 0.35)`);
    g.addColorStop(1, "rgba(240, 200, 120, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    ctx.fillStyle = `rgba(236, ${206 - low * 80}, ${140 - low * 80}, 0.9)`;
  } else ctx.fillStyle = "rgba(236, 232, 214, 0.85)";
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(42, 33, 24, 0.35)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** The working site around the derrick, in ink: shed, pit, pipe, barrels, wagon, tent, shadow. */
function drawSite(ctx: CanvasRenderingContext2D, inp: SceneInput, L: Layout, hour: number): void {
  const X = L.derrickX, base = L.floorY, H = L.derrickH, w = inp.w;
  // The derrick's long shadow, cast away from the sun.
  const t = Math.min(1, Math.max(0, (hour - 5.5) / 14));
  const lean = (0.5 - t) * 2; // +1 at dawn (shadow to the right), -1 at dusk
  if (hour > 5.5 && hour < 19.5) {
    const len = H * (0.25 + Math.abs(lean) * 0.9);
    ctx.fillStyle = "rgba(42, 33, 24, 0.10)";
    ctx.beginPath();
    ctx.moveTo(X - H * 0.17, base);
    ctx.lineTo(X + H * 0.17, base);
    ctx.lineTo(X + lean * len + 6, base + 10);
    ctx.lineTo(X + lean * len - 6, base + 10);
    ctx.closePath();
    ctx.fill();
  }
  // Worked ground around the rig and the wagon ruts leading in.
  ctx.fillStyle = "rgba(122, 96, 64, 0.16)";
  ctx.beginPath(); ctx.ellipse(X + H * 0.25, base + 4, H * 0.75, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(90, 70, 50, 0.35)";
  ctx.lineWidth = 1;
  for (const dy of [3, 7]) { ctx.beginPath(); ctx.moveTo(0, base + dy + 2); ctx.quadraticCurveTo(X * 0.5, base + dy - 2, X - H * 0.3, base + dy); ctx.stroke(); }
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.ink;
  // Slush pit: muddy water from the hole.
  ctx.fillStyle = "rgba(96, 82, 60, 0.45)";
  ctx.beginPath(); ctx.ellipse(X - H * 0.36, base + 5, H * 0.1, 4, 0, 0, Math.PI * 2); ctx.fill();
  // Casing joints stacked on skids.
  const px = X - H * 0.62, py = base - 3;
  ctx.lineWidth = 1;
  for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) {
    const cx = px + k * 7 + row * 3.5, cy = py - row * 6;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 3); ctx.lineTo(cx + H * 0.16, cy - 3); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx + H * 0.16, cy + 3); ctx.stroke();
  }
  // Water barrels.
  for (let k = 0; k < 2; k++) {
    const bx = X + H * 0.2 + k * 11, by = base;
    ctx.strokeRect(bx, by - 13, 9, 13);
    ctx.beginPath(); ctx.moveTo(bx, by - 9); ctx.lineTo(bx + 9, by - 9); ctx.moveTo(bx, by - 4); ctx.lineTo(bx + 9, by - 4); ctx.stroke();
  }
  // Engine house: a plank shed over boiler and engine, its stack through the roof.
  const ex = X + H * 0.92, ew = H * 0.34, eh = H * 0.13;
  if (ex + ew < w + 40) {
    ctx.fillStyle = "rgba(214, 178, 108, 0.25)";
    ctx.fillRect(ex, base - eh, ew, eh);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(ex, base - eh, ew, eh);
    ctx.lineWidth = 0.6;
    for (let y = base - eh + 4; y < base; y += 4) { ctx.beginPath(); ctx.moveTo(ex, y); ctx.lineTo(ex + ew, y); ctx.stroke(); }
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(ex - 6, base - eh); ctx.lineTo(ex + ew / 2, base - eh - H * 0.08); ctx.lineTo(ex + ew + 6, base - eh); ctx.stroke();
    ctx.fillStyle = INK.ink;
    ctx.fillRect(ex + ew * 0.3, base - eh * 0.75, ew * 0.16, eh * 0.75); // door, dark
  }
  // The crew's tent and the supply wagon at the edge of the site.
  const tx = Math.min(w - 40, ex + ew + H * 0.25);
  ctx.lineWidth = 1.3;
  ctx.fillStyle = "rgba(243, 234, 213, 0.9)";
  ctx.beginPath(); ctx.moveTo(tx - 18, base); ctx.lineTo(tx, base - 22); ctx.lineTo(tx + 18, base); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx, base - 22); ctx.lineTo(tx - 4, base); ctx.stroke();
  const wx = X - H * 0.95;
  if (wx > 20) {
    ctx.strokeRect(wx, base - 16, 34, 9);
    for (const k of [6, 28]) { ctx.beginPath(); ctx.arc(wx + k, base - 4, 4.5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(wx + 34, base - 12); ctx.lineTo(wx + 48, base - 10); ctx.stroke(); // tongue
  }
}

function drillersLog(ctx: CanvasRenderingContext2D, inp: SceneInput, L: Layout, own: SampleEvidence[]): void {
  const x = Math.max(L.derrickX + 150, inp.w * 0.4), top = L.Y(0) + 6;
  const width = Math.min(380, inp.w - x - 460);
  if (width < 240) return;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK.ink;
  ctx.textAlign = "left";
  ctx.font = `400 15px ${FONT}`;
  ctx.fillText(`DRILLER'S LOG · ${inp.well.name.toUpperCase()}`, x, top + 12);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, top + 20); ctx.lineTo(x + width, top + 20); ctx.stroke();
  ctx.font = `italic 12px ${FONT}`;
  ctx.fillStyle = INK.inkSoft;
  ctx.fillText("From", x, top + 36);
  ctx.fillText("To", x + 52, top + 36);
  ctx.fillText("Formation, as bailed", x + 104, top + 36);
  const rowH = 19, room = Math.floor((inp.h - 40 - (top + 46)) / rowH);
  if (room < 2) return;
  if (own.length === 0) {
    ctx.font = `italic 14px ${FONT}`;
    ctx.fillText("Nothing bailed yet. Every bail brings up a sample.", x, top + 60);
    return;
  }
  // Merge successive bails of the same rock into one entry, as a driller would write it up.
  const rows: { top: number; base: number; call: string; show?: string }[] = [];
  for (const smp of own) {
    const last = rows[rows.length - 1];
    if (last && last.call === smp.call) last.base = smp.baseFt;
    else rows.push({ top: smp.topFt, base: smp.baseFt, call: smp.call, ...(smp.show ? { show: smp.show } : {}) });
  }
  const shown = rows.slice(-room);
  shown.forEach((r, i) => {
    const y = top + 56 + i * rowH;
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = INK.ink;
    ctx.fillText(String(r.top), x, y);
    ctx.fillText(String(r.base), x + 52, y);
    ctx.fillStyle = r.show ? INK.carmine : INK.ink;
    let text = r.call;
    while (ctx.measureText(text).width > width - 110 && text.length > 8) text = text.slice(0, -2);
    if (text !== r.call) text = text.trimEnd() + "…";
    ctx.fillText(text, x + 104, y);
    ctx.strokeStyle = "rgba(205, 184, 150, 0.8)";
    ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + width, y + 6); ctx.stroke();
  });
}
