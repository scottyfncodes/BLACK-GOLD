/**
 * Fig. 1: the map. Two passes that never mix (docs/ART-DIRECTION.md §1):
 *   drawPrint      the published survey — persistent geography and printed hills only.
 *   drawManuscript the company's carmine hand — evidence, interpretations, selection.
 * Inputs are the printed map and the knowledge view. There is no path to geological truth.
 */
import { SURVEYS, centroid, type Survey } from "../../content/geography/surveys";
import { toCalendar, type KnowledgeView, type PrintedMap } from "../../sim";
import { fbm, hash, inside, lengthOf, normals, path, Placer, pointAt, type Box, type Pt } from "./kit";
import { geography } from "./geography";
import { FONT, INK, WASH } from "./palette";
import { paper } from "./paper";

export interface MapView {
  w: number;
  h: number;
  /** Centre of the view in km. */
  cx: number;
  cy: number;
  /** px per km. */
  scale: number;
}

export type Selection =
  | { kind: "survey"; id: string }
  | { kind: "well"; id: string }
  | { kind: "section"; id: string }
  | { kind: "prospect"; id: string }
  | null;

export interface ManuscriptInputs {
  knowledge: KnowledgeView;
  print: PrintedMap;
  selection: Selection;
  /** First point of a section line being drawn. */
  draft: Pt | null;
}

/** County scale shows the whole sheet; field scale shows names and detail. */
export const FIELD_SCALE = 34;

export const toPx = (v: MapView) => ([x, y]: readonly [number, number]): Pt => [(x - v.cx) * v.scale + v.w / 2, (y - v.cy) * v.scale + v.h / 2];
export const toKm = (v: MapView) => (px: number, py: number): Pt => [(px - v.w / 2) / v.scale + v.cx, (py - v.h / 2) / v.scale + v.cy];

// ---------------------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------------------

export function drawPrint(ctx: CanvasRenderingContext2D, v: MapView, print: PrintedMap): void {
  const P = toPx(v), PP = (pts: readonly Pt[]) => pts.map(P);
  const g = geography();
  const field = v.scale >= FIELD_SCALE;
  const [ox, oy] = P([0, 0]);
  paper(ctx, v.w, v.h, ox, oy);

  // Washes: land and water only (infrastructure is ink).
  ctx.fillStyle = WASH.prairie;
  ctx.fillRect(0, 0, v.w, v.h);
  for (const poly of g.woods) wash(ctx, PP(poly), WASH.wood, 3, v);
  for (const poly of g.marsh) wash(ctx, PP(poly), WASH.marsh, 7, v);

  // Woodland and marsh marks, anchored in km so they do not swim when the map pans.
  const woods = g.woods.map(PP), marsh = g.marsh.map(PP);
  // Bounding boxes first: most scatter points are nowhere near a given polygon.
  const bb = (p: Pt[]): Box => p.reduce<Box>((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const woodsBB = woods.map(bb), marshBB = marsh.map(bb);
  const within = (polys: Pt[][], boxes: Box[], x: number, y: number) => polys.some((p, i) => { const b = boxes[i]!; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(p, x, y); });
  scatterKm(v, field ? 7.5 : 10, 61, (x, y, r) => {
    if (!within(woods, woodsBB, x, y) || within(marsh, marshBB, x, y)) return;
    if (fbm(x / 70 - ox / 70, y / 70 - oy / 70, 64, 3) < 0.36 + r * 0.12) return;
    const rr = (field ? 1.5 : 1.1) + r * 1.1;
    ctx.strokeStyle = "rgba(70, 84, 44, 0.75)";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, rr, Math.PI * 0.85, Math.PI * 2.25);
    ctx.stroke();
    ctx.fillRect(x - 0.4, y + rr - 0.2, 0.8, 1.4);
  });
  scatterKm(v, 13, 71, (x, y, r) => {
    if (r > 0.7 || !within(marsh, marshBB, x, y)) return;
    ctx.strokeStyle = "rgba(40, 92, 104, 0.75)";
    ctx.lineWidth = 0.6;
    const ww = 2.5 + r * 2;
    ctx.beginPath();
    ctx.moveTo(x - ww, y);
    ctx.lineTo(x + ww, y);
    for (const dx of [-1.3, 0, 1.3]) { ctx.moveTo(x + dx * 0.5, y); ctx.lineTo(x + dx, y - 2 - r); }
    ctx.stroke();
  });

  for (const hill of print.hills) drawHill(ctx, P([hill.x, hill.y]), hill.radius * v.scale);

  // Water
  const river = PP(g.river.line);
  drawRiver(ctx, river, g.river.line.map((_, i) => Math.max(2.5, g.river.width(i) * v.scale)));
  for (const c of g.channels) if (c.kind !== "river") creek(ctx, PP(c.line), c.kind === "bayou" ? 1.6 : 0.9);

  // Surveys (print): dash-dot property lines.
  ctx.save();
  ctx.strokeStyle = INK.survey;
  ctx.lineWidth = 0.7;
  ctx.setLineDash([7, 2, 1.5, 2]);
  for (const s of SURVEYS) { path(ctx, PP(s.poly), true); ctx.stroke(); }
  ctx.restore();

  // Culture, in ink.
  for (const b of g.town.blocks) {
    const q = PP(b.poly);
    ctx.fillStyle = b.built ? WASH.town : "rgba(196, 92, 82, 0.12)";
    path(ctx, q, true);
    ctx.fill();
    ctx.strokeStyle = "rgba(42, 33, 24, 0.5)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const r of g.roads) {
    ctx.strokeStyle = "rgba(120, 72, 40, 0.85)";
    ctx.lineWidth = r.kind === "road" ? 1.4 : 0.8;
    ctx.setLineDash(r.kind === "road" ? [] : [4, 3]);
    path(ctx, PP(r.line));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const rail = PP(g.rail);
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 2.6;
  path(ctx, rail);
  ctx.stroke();
  ctx.strokeStyle = INK.paper;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([7, 7]);
  path(ctx, rail);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = INK.ink;
  for (const f of g.farmsteads) {
    const [x, y] = P(f);
    ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
  }
  // Settlers' well-houses: printed because they stand in plain sight.
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1;
  for (const w of print.wells) {
    const [x, y] = P([w.x, w.y]);
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  lettering(ctx, v, print, field);
}

function scatterKm(v: MapView, cellPx: number, seed: number, fn: (x: number, y: number, r: number) => void): void {
  const cell = cellPx / v.scale;
  const x0 = v.cx - v.w / 2 / v.scale, x1 = v.cx + v.w / 2 / v.scale, y0 = v.cy - v.h / 2 / v.scale, y1 = v.cy + v.h / 2 / v.scale;
  const P = toPx(v);
  for (let gy = Math.floor(y0 / cell); gy <= y1 / cell; gy++)
    for (let gx = Math.floor(x0 / cell); gx <= x1 / cell; gx++) {
      const [x, y] = P([(gx + 0.15 + hash(gx, gy, seed) * 0.7) * cell, (gy + 0.15 + hash(gx, gy, seed + 1) * 0.7) * cell]);
      fn(x, y, hash(gx, gy, seed + 2));
    }
}

function wash(ctx: CanvasRenderingContext2D, poly: Pt[], color: string, seed: number, v: MapView): void {
  const [ox, oy] = toPx(v)([0, 0]);
  for (let pass = 0; pass < 2; pass++) {
    const p = poly.map(([x, y]) => [x + (fbm((x - ox) / 30, (y - oy) / 30, seed + pass, 2) - 0.5) * 8, y + (fbm((x - ox) / 30 + 5, (y - oy) / 30, seed + pass, 2) - 0.5) * 8] as Pt);
    ctx.fillStyle = color;
    path(ctx, p, true);
    ctx.fill();
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  path(ctx, poly, true);
  ctx.stroke();
  ctx.restore();
}

function drawHill(ctx: CanvasRenderingContext2D, [cx, cy]: Pt, r: number): void {
  const rx = r, ry = r * 0.78;
  const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.25, 2, cx, cy, rx);
  g.addColorStop(0, "rgba(160, 92, 42, 0)");
  g.addColorStop(0.55, "rgba(160, 92, 42, 0.16)");
  g.addColorStop(1, "rgba(160, 92, 42, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.3, 0, Math.PI * 2);
  ctx.fill();
  hachures(ctx, cx, cy, rx, ry, INK.relief, 1);
}

/** Hachures: strokes down the slope in rows between form lines, heavier where steeper. */
export function hachures(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, weight: number): void {
  ctx.strokeStyle = color;
  const rings = 6, rot = -0.3, cr = Math.cos(rot), sr = Math.sin(rot);
  for (let k = 0; k < rings; k++) {
    const r0 = 0.28 + (k / rings) * 0.72, r1 = 0.28 + ((k + 1) / rings) * 0.72 - 0.025;
    const steep = Math.sin(((k + 0.5) / rings) * Math.PI);
    const n = Math.max(12, Math.floor((Math.PI * (rx + ry) * r0) / 3.4));
    ctx.lineWidth = (0.3 + steep * 0.6) * weight;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + k * 0.13, j = 1 + (fbm(Math.cos(t) * 2, Math.sin(t) * 2, 57, 2) - 0.5) * 0.3;
      const x0 = Math.cos(t) * rx * r0 * j, y0 = Math.sin(t) * ry * r0 * j, x1 = Math.cos(t) * rx * r1 * j, y1 = Math.sin(t) * ry * r1 * j;
      ctx.moveTo(cx + x0 * cr - y0 * sr, cy + x0 * sr + y0 * cr);
      ctx.lineTo(cx + x1 * cr - y1 * sr, cy + x1 * sr + y1 * cr);
    }
    ctx.stroke();
  }
}

function drawRiver(ctx: CanvasRenderingContext2D, c: Pt[], widths: number[]): void {
  const n = normals(c);
  const L = c.map((p, i) => [p[0] + (n[i]![0] * widths[i]!) / 2, p[1] + (n[i]![1] * widths[i]!) / 2] as Pt);
  const R = c.map((p, i) => [p[0] - (n[i]![0] * widths[i]!) / 2, p[1] - (n[i]![1] * widths[i]!) / 2] as Pt);
  ctx.fillStyle = WASH.water;
  path(ctx, L.concat(R.slice().reverse()), true);
  ctx.fill();
  ctx.strokeStyle = "rgba(40, 80, 110, 0.35)";
  ctx.lineWidth = 3;
  path(ctx, L); ctx.stroke();
  path(ctx, R); ctx.stroke();
  ctx.strokeStyle = INK.water;
  ctx.lineWidth = 0.9;
  path(ctx, L); ctx.stroke();
  path(ctx, R); ctx.stroke();
}

function creek(ctx: CanvasRenderingContext2D, pts: Pt[], w: number): void {
  ctx.strokeStyle = INK.water;
  ctx.lineCap = "round";
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = 0.4 + (i / pts.length) * w;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
    ctx.lineTo(pts[i]![0], pts[i]![1]);
    ctx.stroke();
  }
}

function halo(ctx: CanvasRenderingContext2D, draw: (f: (t: string, x: number, y: number) => void) => void, width = 3.5): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK.paper;
  ctx.lineWidth = width;
  draw((t, x, y) => ctx.strokeText(t, x, y));
  ctx.restore();
  draw((t, x, y) => ctx.fillText(t, x, y));
}

function spaced(ctx: CanvasRenderingContext2D, f: (t: string, x: number, y: number) => void, text: string, x: number, y: number, tracking: number): void {
  const chars = [...text];
  const w = chars.reduce((a, c) => a + ctx.measureText(c).width + tracking, -tracking);
  let cx = x - w / 2;
  ctx.textAlign = "left";
  for (const c of chars) { f(c, cx, y); cx += ctx.measureText(c).width + tracking; }
}

/** Letter text along a path; returns the box it occupies so it can be reserved. */
function along(ctx: CanvasRenderingContext2D, f: (t: string, x: number, y: number) => void, text: string, pts: Pt[], frac: number, spacing: number): Box {
  if (pts[pts.length - 1]![0] < pts[0]![0]) { pts = pts.slice().reverse(); frac = 1 - frac; }
  const L = lengthOf(pts), widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let s = Math.max(0, Math.min(L - total, L * frac - total / 2));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  [...text].forEach((ch, i) => {
    const p = pointAt(pts, s + widths[i]! / 2);
    box[0] = Math.min(box[0], p.x - 8); box[1] = Math.min(box[1], p.y - 8); box[2] = Math.max(box[2], p.x + 8); box[3] = Math.max(box[3], p.y + 8);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    f(ch, 0, 0);
    ctx.restore();
    s += widths[i]!;
  });
  return box;
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  return [...text].reduce((a, c) => a + ctx.measureText(c).width + tracking, -tracking);
}

function lettering(ctx: CanvasRenderingContext2D, v: MapView, print: PrintedMap, field: boolean): void {
  const P = toPx(v), g = geography();
  const placer = new Placer(v.w, v.h, 4);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK.ink;
  ctx.font = `400 ${field ? 22 : 17}px ${FONT}`;
  const t = P(g.town.label);
  const tw = trackedWidth(ctx, "BEAUMONT", field ? 5.5 : 4);
  // Keep the town's name on the sheet even when the town is near the edge.
  const tx = Math.max(10 + tw / 2, Math.min(v.w - 10 - tw / 2, t[0]));
  if (t[1] > -20 && t[1] < v.h + 20) {
    halo(ctx, (f) => spaced(ctx, f, "BEAUMONT", tx, t[1], field ? 5.5 : 4), 5);
    placer.add([tx - tw / 2, t[1] - 20, tx + tw / 2, t[1] + 4]);
  }
  ctx.fillStyle = INK.water;
  ctx.font = `italic ${field ? 14 : 12}px ${FONT}`;
  let box: Box | undefined;
  halo(ctx, (f) => { box = along(ctx, f, "Neches  River", g.river.line.map(P), 0.56, 2.2); }, 4);
  if (box) placer.add(box);
  ctx.font = `italic ${field ? 12 : 11}px ${FONT}`;
  for (const c of g.channels) if (c.kind === "bayou") { halo(ctx, (f) => { box = along(ctx, f, c.name, c.line.map(P), 0.5, 1.4); }, 3.5); if (box) placer.add(box); }
  ctx.fillStyle = INK.ink;
  ctx.font = `${field ? 11 : 11}px ${FONT}`;
  halo(ctx, (f) => { box = along(ctx, f, "TEXAS & NEW ORLEANS R. R.", g.rail.map(P).map(([x, y]) => [x, y - 9] as Pt), 0.22, 1.6); }, 3);
  if (box) placer.add(box);
  for (const s of g.settlement) {
    const [x, y] = P(s.at);
    ctx.font = `${field ? 12 : 11}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillRect(x - 2, y - 2, 4, 4);
    halo(ctx, (f) => f(s.name, x - 7, y), 3);
  }
  ctx.fillStyle = INK.relief;
  ctx.font = `${field ? 13 : 11}px ${FONT}`;
  ctx.textBaseline = "middle";
  for (const h of print.hills) {
    const [x, y] = P([h.x, h.y]);
    const hw = trackedWidth(ctx, h.name.toUpperCase(), 3), off = h.radius * v.scale * 0.78 + 13;
    // Below the hill if there is room, otherwise above it; never over another name.
    const ly = [y + off, y - off].find((yy) => placer.take([x - hw / 2, yy - 9, x + hw / 2, yy + 9]));
    if (ly !== undefined) halo(ctx, (f) => spaced(ctx, f, h.name.toUpperCase(), x, ly, 3), 3.5);
  }
  ctx.fillStyle = "#2f6a72";
  ctx.font = `italic ${field ? 12 : 11}px ${FONT}`;
  const m = P([12, 23.2]);
  halo(ctx, (f) => spaced(ctx, f, "Salt  Marsh", m[0], m[1], 2), 3.5);
  if (!field) return;
  // Survey names, along each grant's top side, only where the grant is big enough on screen
  // and the name collides with nothing already lettered.
  for (const s of SURVEYS) {
    const [x, y] = P(centroid(s.poly));
    const q = s.poly.map(P);
    const side = Math.min(Math.hypot(q[1]![0] - q[0]![0], q[1]![1] - q[0]![1]), Math.hypot(q[2]![0] - q[1]![0], q[2]![1] - q[1]![1]));
    const a = Math.atan2(q[1]![1] - q[0]![1], q[1]![0] - q[0]![0]);
    ctx.font = `italic 11px ${FONT}`;
    const nw = ctx.measureText(s.name.toUpperCase()).width;
    if (side < Math.max(56, nw * 0.85)) continue;
    const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a)), hw = nw / 2 + 4, hh = 15;
    if (!placer.take([x - (hw * ca + hh * sa), y - (hw * sa + hh * ca), x + (hw * ca + hh * sa), y + (hw * sa + hh * ca)])) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = INK.survey;
    ctx.textAlign = "center";
    ctx.font = `italic 11px ${FONT}`;
    halo(ctx, (f) => f(s.name.toUpperCase(), 0, -6), 3);
    ctx.font = `11px ${FONT}`;
    halo(ctx, (f) => f(`A-${s.abstract}`, 0, 7), 3);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------------------
// Manuscript: the company's carmine hand
// ---------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const shortDate = (t: number) => { const c = toCalendar(t); return `${c.day} ${MONTHS[c.month - 1]}`; };

export function drawManuscript(ctx: CanvasRenderingContext2D, v: MapView, m: ManuscriptInputs): void {
  const P = toPx(v), field = v.scale >= FIELD_SCALE;
  const k = m.knowledge;
  const placer = new Placer(v.w, v.h, 6);
  // Reserve every mark first so no note is written over a mark.
  for (const e of k.evidence) {
    if (e.kind === "surfaceSign" || e.kind === "wellRecord") { const [x, y] = P([e.x, e.y]); placer.add([x - 7, y - 12, x + 7, y + 7]); }
  }
  for (const p of k.interp.prospects) {
    const [x, y] = P([p.x, p.y]);
    const ly = y - p.r * v.scale * 0.8 - 9;
    placer.add([x - 40, ly - 9, x + 40, ly + 9]);
  }
  for (const s of k.interp.sections) {
    for (const q of [P(s.a), P(s.b)]) placer.add([q[0] - 20, q[1] - 20, q[0] + 20, q[1] + 20]);
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Surveys examined: a dotted carmine line just inside the boundary. Walked is known;
  // only untouched paper is unknown.
  const walked = new Set(k.evidence.filter((e) => e.kind === "walked").map((e) => (e as { surveyId: string }).surveyId));
  ctx.strokeStyle = INK.carmine;
  ctx.lineWidth = 1;
  ctx.setLineDash([1.2, 3]);
  for (const s of SURVEYS) if (walked.has(s.id)) { path(ctx, inset(s.poly.map(P), 3.5), true); ctx.stroke(); }
  ctx.setLineDash([]);

  // Selection: solid carmine with a tinted band inside.
  if (m.selection?.kind === "survey") {
    const s = SURVEYS.find((x) => x.id === m.selection!.id);
    if (s) selectSurvey(ctx, s.poly.map(P));
  }

  // Surface signs, in carmine, weighted by how strongly they were seen.
  ctx.fillStyle = INK.carmine;
  ctx.strokeStyle = INK.carmine;
  ctx.font = `italic ${field ? 12 : 11}px ${FONT}`;
  for (const e of k.evidence) {
    if (e.kind !== "surfaceSign") continue;
    const [x, y] = P([e.x, e.y]);
    const w = e.strength === "faint" ? 0.8 : e.strength === "clear" ? 1.2 : 1.7;
    ctx.lineWidth = w;
    sign(ctx, e.sign, x, y, w, v.scale);
    if (field) note(ctx, placer, x, y, `${signWord(e.sign, e.strength, e.reliefFt)} · ${shortDate(e.t)}`);
  }

  // Wells whose logs we have: filled in carmine.
  for (const e of k.evidence) {
    if (e.kind !== "wellRecord") continue;
    const [x, y] = P([e.x, e.y]);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (field) note(ctx, placer, x, y, `${e.owner}'s well, log to ${e.depthFt} ft`);
  }
  if (m.selection?.kind === "well") {
    const w = m.print.wells.find((x) => x.id === m.selection!.id);
    if (w) { const [x, y] = P([w.x, w.y]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); }
  }

  // Prospects: dotted, because they are conjecture.
  for (const p of k.interp.prospects) {
    const [x, y] = P([p.x, p.y]);
    const sel = m.selection?.kind === "prospect" && m.selection.id === p.id;
    ctx.lineWidth = sel ? 2 : 1.3;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.ellipse(x, y, p.r * v.scale, p.r * v.scale * 0.8, -0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `italic ${field ? 13 : 11}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloC(ctx, `Prospect ${p.numeral}`, x, y - p.r * v.scale * 0.8 - 9);
  }

  // Lines of section: a construction line, dash-dot, lettered at each end.
  for (const s of k.interp.sections) {
    const a = P(s.a), b = P(s.b);
    const sel = m.selection?.kind === "section" && m.selection.id === s.id;
    ctx.lineWidth = sel ? 2 : 1.2;
    ctx.setLineDash([10, 3, 2, 3]);
    path(ctx, [a, b]);
    ctx.stroke();
    ctx.setLineDash([]);
    endLetters(ctx, a, b, s.letter);
  }
  if (m.draft) {
    const [x, y] = P(m.draft);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function inset(q: Pt[], d: number): Pt[] {
  const [cx, cy] = q.reduce((a, p) => [a[0] + p[0] / q.length, a[1] + p[1] / q.length], [0, 0]);
  return q.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; return [x - ((x - cx) / l) * d, y - ((y - cy) / l) * d]; });
}

function selectSurvey(ctx: CanvasRenderingContext2D, q: Pt[]): void {
  ctx.save();
  path(ctx, q, true);
  ctx.clip();
  ctx.strokeStyle = "rgba(163, 48, 42, 0.22)";
  ctx.lineWidth = 8;
  path(ctx, q, true);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = INK.carmine;
  ctx.lineWidth = 1.8;
  path(ctx, q, true);
  ctx.stroke();
}

function sign(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, scale: number): void {
  if (kind === "mound") {
    const r = Math.max(10, 0.7 * scale);
    hachures(ctx, x, y, r, r * 0.78, INK.carmine, 0.8);
    return;
  }
  if (kind === "gasSeep") {
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 3; k++) { ctx.moveTo(x - 2.5 + k * 2.5, y - 5); ctx.quadraticCurveTo(x - 1.5 + k * 2.5, y - 8, x - 2.5 + k * 2.5, y - 11); }
    ctx.stroke();
    return;
  }
  if (kind === "sourSpring") {
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 1 + w * 0.3, 0, Math.PI * 2); ctx.fill();
    return;
  }
  // Paraffin dirt: a small hatched square.
  ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
  ctx.beginPath(); ctx.moveTo(x - 3.5, y + 3.5); ctx.lineTo(x + 3.5, y - 3.5); ctx.stroke();
}

function signWord(kind: string, strength: string, reliefFt?: number): string {
  if (kind === "mound") return `a rise, ~${reliefFt ?? "?"} ft`;
  const s = strength === "strong" ? "strong" : strength === "clear" ? "" : "faint";
  const w = { gasSeep: "gas bubbling", sourSpring: "sour spring", paraffinDirt: "waxy dirt" }[kind] ?? kind;
  return s ? `${w}, ${s}` : w;
}

function note(ctx: CanvasRenderingContext2D, placer: Placer, x: number, y: number, text: string): void {
  const tw = ctx.measureText(text).width;
  const tries: Pt[] = [[12, -14], [-12, -14], [12, 18], [-12, 18], [16, -32], [-16, -32], [16, 36], [-16, 36]];
  for (const [dx, dy] of tries) {
    const bx = dx > 0 ? x + dx : x + dx - tw, by = y + dy - 11;
    const box: Box = [bx, by, bx + tw, by + 15];
    if (!placer.take(box)) continue;
    ctx.textAlign = dx > 0 ? "left" : "right";
    ctx.textBaseline = "alphabetic";
    haloC(ctx, text, x + dx, y + dy);
    return;
  }
  // No room: the mark stands without its note; the field notes list it in full.
}

function haloC(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK.paper;
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillStyle = INK.carmine;
  ctx.fillText(text, x, y);
}

function endLetters(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, letter: string): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  ctx.font = `700 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  haloC(ctx, letter, a[0] - (dx / l) * 12, a[1] - (dy / l) * 12);
  haloC(ctx, `${letter}′`, b[0] + (dx / l) * 13, b[1] + (dy / l) * 13);
}

// ---------------------------------------------------------------------------------------
// Hit testing (UI selection)
// ---------------------------------------------------------------------------------------

export function hitTest(v: MapView, m: ManuscriptInputs, px: number, py: number): Selection {
  const P = toPx(v);
  for (const w of m.print.wells) { const [x, y] = P([w.x, w.y]); if (Math.hypot(x - px, y - py) < 12) return { kind: "well", id: w.id }; }
  for (const s of m.knowledge.interp.sections) {
    const a = P(s.a), b = P(s.b);
    if (distToSegment([px, py], a, b) < 8) return { kind: "section", id: s.id };
  }
  for (const p of m.knowledge.interp.prospects) {
    const [x, y] = P([p.x, p.y]), r = p.r * v.scale;
    const d = Math.hypot((px - x) / r, (py - y) / (r * 0.8));
    if (Math.abs(d - 1) < 0.15 || (d < 1 && r < 30)) return { kind: "prospect", id: p.id };
  }
  const [kx, ky] = toKm(v)(px, py);
  const s = SURVEYS.find((x) => inside(x.poly, kx, ky));
  return s ? { kind: "survey", id: s.id } : null;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function surveyById(id: string): Survey | undefined {
  return SURVEYS.find((s) => s.id === id);
}

