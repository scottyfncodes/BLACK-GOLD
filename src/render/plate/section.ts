/**
 * Fig. 2: a section along a player-drawn line, built from knowledge alone, with what was observed,
 * what was told and what is inferred kept visibly apart:
 *   - the surface (printed hills and rises the party has seen),
 *   - the company's own holes near the line, from their bailer samples: OBSERVED, solid ink columns,
 *   - settlers' wells near the line, from their owners' accounts: HEARSAY, columns in a dashed frame,
 *   - correlations between neighbouring logs, dashed carmine (inferred), queried beyond the last one,
 *   - a geologist's reading of the depth to the rock: INFERRED, a hatched carmine band,
 *   - the player's prospects, dotted (conjecture).
 * Everything else is blank paper, which means unknown (docs/ART-DIRECTION.md §1).
 */
import { type KnowledgeView, type NewsEvidence, type PrintedMap, type ReadingEvidence, type ReportedInterval, type SampleEvidence, type SectionLine } from "../../sim";
import { Placer, type Pt } from "./kit";
import { FONT, INK, LITH } from "./palette";
import { paper } from "./paper";

/** Records within this distance (km) of the line are projected onto it. */
export const CORRIDOR_KM = 0.8;
const KM_PER_MILE = 1.609344;

export interface SectionGeometry {
  /** km along the line → px */
  X: (km: number) => number;
  /** feet below datum → px */
  Y: (ft: number) => number;
  lengthKm: number;
  a: Pt;
  b: Pt;
}

/** A log on the section: a settler's account (hearsay) or the company's own hole (observed). */
interface Log {
  owner: string;
  depthFt: number;
  intervals: ReportedInterval[];
  observed: boolean;
}

interface Control {
  rec: Log;
  along: number;
}

/** Where a point falls along the line (km), or null when it is outside the corridor. */
function project(line: SectionLine, x: number, y: number, corridor = CORRIDOR_KM): number | null {
  const [ax, ay] = line.a, [bx, by] = line.b;
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  const t = ((x - ax) * dx + (y - ay) * dy) / (L * L);
  if (t < 0 || t > 1) return null;
  const off = Math.abs((x - ax) * dy - (y - ay) * dx) / L;
  return off <= corridor ? t * L : null;
}

/** The company's own holes as logs, built from their bailer samples: each bed as the bailer called it. */
function ownLogs(k: KnowledgeView): (Log & { x: number; y: number })[] {
  const by = new Map<string, SampleEvidence[]>();
  for (const e of k.evidence) if (e.kind === "sample") by.set(e.wellId, [...(by.get(e.wellId) ?? []), e]);
  const names = new Map<string, string>();
  for (const e of k.evidence) if (e.kind === "account") names.set(e.wellId, e.name);
  const out: (Log & { x: number; y: number })[] = [];
  for (const [id, ss] of by) {
    const intervals: ReportedInterval[] = [];
    for (const s of ss) {
      const call = s.call.split(",")[0]!;
      const prev = intervals[intervals.length - 1];
      // A bed continues while the rock and its show stay the same: caprock bailed every few feet with sulphur water is one bed, not forty.
      if (prev && prev.lith === s.lith && prev.show === s.show) { prev.baseFt = s.baseFt; continue; }
      intervals.push({ topFt: s.topFt, baseFt: s.baseFt, call: s.show ? s.call : call, lith: s.lith, ...(s.show ? { show: s.show } : {}) });
    }
    out.push({ owner: names.get(id) ?? "our well", depthFt: ss[ss.length - 1]!.baseFt, intervals, observed: true, x: ss[0]!.x, y: ss[0]!.y });
  }
  return out;
}

export function controlsFor(line: SectionLine, k: KnowledgeView): Control[] {
  const out: Control[] = [];
  for (const e of k.evidence) {
    if (e.kind !== "wellRecord") continue;
    const along = project(line, e.x, e.y);
    if (along !== null) out.push({ rec: { owner: e.owner, depthFt: e.depthFt, intervals: e.intervals, observed: false }, along });
  }
  for (const o of ownLogs(k)) {
    const along = project(line, o.x, o.y);
    if (along !== null) out.push({ rec: o, along });
  }
  return out.sort((p, q) => p.along - q.along);
}

/** Other operators' finished wells near the line that the company knows only from the news: a depth and an outcome, nothing of the ground. */
function heardOf(line: SectionLine, k: KnowledgeView): { n: NewsEvidence; along: number }[] {
  const logged = new Set(k.evidence.filter((e) => e.kind === "wellRecord").map((e) => (e as { wellId: string }).wellId));
  const out: { n: NewsEvidence; along: number }[] = [];
  for (const e of k.evidence) {
    if (e.kind !== "news" || (e.event !== "oil" && e.event !== "gas" && e.event !== "dry") || e.x === null || e.y === null || !e.wellId || logged.has(e.wellId)) continue;
    const along = project(line, e.x, e.y);
    if (along !== null) out.push({ n: e, along });
  }
  return out;
}

/** The geologist's readings of rock depth near the line (the latest per rise). */
function readingsFor(line: SectionLine, k: KnowledgeView): { r: ReadingEvidence; along: number }[] {
  const out: { r: ReadingEvidence; along: number }[] = [];
  for (const e of [...k.evidence].reverse()) {
    if (e.kind !== "reading" || !e.rockFt || (e.verdict !== "range" && e.verdict !== "deep")) continue;
    const along = project(line, e.x, e.y, CORRIDOR_KM * 1.5);
    if (along === null || out.some((o) => Math.abs(o.along - along) < 0.4)) continue;
    out.push({ r: e, along });
  }
  return out;
}

/** Surface relief (ft) at a point along the line, from printed hills and observed rises only. */
function reliefAt(p: Pt, print: PrintedMap, k: KnowledgeView): number {
  let ft = 0;
  for (const h of print.hills) ft = Math.max(ft, h.reliefFt * Math.exp(-((Math.hypot(p[0] - h.x, p[1] - h.y) / (h.radius * 0.7)) ** 2)));
  for (const e of k.evidence) {
    if (e.kind !== "surfaceSign" || e.sign !== "mound" || !e.reliefFt) continue;
    ft = Math.max(ft, e.reliefFt * Math.exp(-((Math.hypot(p[0] - e.x, p[1] - e.y) / 0.6) ** 2)));
  }
  return ft;
}

export function drawSection(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  line: SectionLine,
  k: KnowledgeView,
  print: PrintedMap,
  overlay?: (ctx: CanvasRenderingContext2D, g: SectionGeometry) => void,
): void {
  paper(ctx, w, h);
  const compact = w < 520;
  const padL = compact ? 44 : 58, padR = compact ? 18 : 28, padT = compact ? 50 : 56, padB = compact ? 50 : 56;
  const [ax, ay] = line.a, [bx, by] = line.b;
  const L = Math.hypot(bx - ax, by - ay);
  const controls = controlsFor(line, k);
  const readings = readingsFor(line, k);
  const heard = heardOf(line, k);
  const deepest = Math.max(0, ...controls.map((c) => c.rec.depthFt), ...readings.map(({ r }) => (r.rockFt![1] ?? r.rockFt![0] + 250)), ...heard.map(({ n }) => n.depthFt ?? 0));
  const maxFt = Math.max(600, Math.ceil((deepest + 150) / 100) * 100);
  const X = (km: number) => padL + (km / L) * (w - padL - padR);
  const Y = (ft: number) => padT + (ft / maxFt) * (h - padT - padB);
  const pointAlong = (km: number): Pt => [ax + ((bx - ax) * km) / L, ay + ((by - ay) * km) / L];
  // Surface relief is drawn ×4 larger than the depth scale so a 15 ft hill is legible.
  const groundY = (km: number) => Y(0) - reliefAt(pointAlong(km), print, k) * ((h - padT - padB) / maxFt) * 4;

  // Ground line (known: it is the surface) with grass ticks.
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const km = (i / 120) * L;
    if (i) ctx.lineTo(X(km), groundY(km));
    else ctx.moveTo(X(km), groundY(km));
  }
  ctx.stroke();
  ctx.lineWidth = 0.6;
  for (let km = 0.04; km < L; km += Math.max(0.05, L / 60)) {
    const x = X(km), y = groundY(km);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 1.5, y - 3); ctx.moveTo(x, y); ctx.lineTo(x + 1.5, y - 3); ctx.stroke();
  }

  // The geologist's reading: where he looks for the rock. Inferred, so hatched and dashed, never solid.
  for (const { r, along } of readings) {
    const [lo, hiOrNull] = r.rockFt!;
    const hi = hiOrNull ?? Math.min(maxFt, lo + 250);
    const half = Math.min(0.5, L * 0.12);
    const x0 = X(Math.max(0, along - half)), x1 = X(Math.min(L, along + half));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, Y(lo), x1 - x0, Y(hi) - Y(lo));
    ctx.clip();
    ctx.strokeStyle = INK.carmine;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.8;
    for (let d = -(Y(hi) - Y(lo)); d < x1 - x0; d += 7) { ctx.beginPath(); ctx.moveTo(x0 + d, Y(hi)); ctx.lineTo(x0 + d + (Y(hi) - Y(lo)), Y(lo)); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = INK.carmine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, Y(lo), x1 - x0, Y(hi) - Y(lo));
    ctx.setLineDash([]);
    ctx.font = `italic ${compact ? 11 : 12}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // The caption sits beside the band, on its left, so it never runs into a log's words on the right.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const mid = (Y(lo) + Y(hi)) / 2, cx = x0 - 6;
    halo(ctx, hiOrNull === null ? `rock deeper than ${lo} ft?` : `rock, ${lo}–${hi} ft?`, cx, mid - (compact ? 6 : 7), INK.carmine);
    ctx.font = `italic ${compact ? 10 : 11}px ${FONT}`;
    halo(ctx, "the geologist's reading", cx, mid + (compact ? 7 : 8), INK.carmine);
  }

  // Correlations between neighbouring records: dashed, carmine (the company's inference).
  ctx.strokeStyle = INK.carmine;
  ctx.fillStyle = INK.carmine;
  ctx.lineWidth = 1;
  ctx.font = `italic ${compact ? 12 : 13}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const colW = compact ? 18 : 24;
  for (let i = 0; i + 1 < controls.length; i++) {
    for (const [d1, d2] of correlate(controls[i]!.rec.intervals, controls[i + 1]!.rec.intervals)) {
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(X(controls[i]!.along) + colW / 2, Y(d1));
      ctx.lineTo(X(controls[i + 1]!.along) - colW / 2, Y(d2));
      ctx.stroke();
    }
  }
  // Queried beyond the outermost records.
  const stub = Math.min(0.6, L * 0.15);
  for (const [c, dir] of [[controls[0], -1], [controls[controls.length - 1], 1]] as const) {
    if (!c) continue;
    // One query per change of rock, not per show: a stub says "this contact may continue", nothing more.
    for (const [i, iv] of c.rec.intervals.entries()) {
      if (i === 0 || c.rec.intervals[i - 1]!.lith === iv.lith) continue;
      const x0 = X(c.along) + (dir * colW) / 2, x1 = X(Math.max(0, Math.min(L, c.along + dir * stub)));
      if (Math.abs(x1 - x0) < 10) continue;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x0, Y(iv.topFt)); ctx.lineTo(x1, Y(iv.topFt)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText("?", x1 + dir * 6, Y(iv.topFt));
    }
  }
  ctx.setLineDash([]);

  // Logs: pattern first, tint underneath. Words go beside a column only where there is room.
  const room = controls.map((c, i) => (controls[i + 1] ? X(controls[i + 1]!.along) - X(c.along) : w - padR - X(c.along)));
  const labels = new Placer(w, h, 2);
  controls.forEach((c, ci) => {
    const x = X(c.along) - colW / 2;
    for (const iv of c.rec.intervals) column(ctx, x, Y(iv.topFt), colW, Math.max(2, Y(iv.baseFt) - Y(iv.topFt)), iv.lith);
    // Observed by our bailer: a heavy solid frame. Told by a settler: a dashed frame.
    ctx.strokeStyle = INK.ink;
    ctx.lineWidth = c.rec.observed ? 2 : 1.1;
    ctx.setLineDash(c.rec.observed ? [] : [3, 3]);
    ctx.strokeRect(x - 2, Y(0), colW + 4, Y(c.rec.depthFt) - Y(0));
    ctx.setLineDash([]);
    // Bottom of knowledge.
    ctx.strokeStyle = INK.carmine;
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x - 4, Y(c.rec.depthFt)); ctx.lineTo(x + colW + 4, Y(c.rec.depthFt)); ctx.stroke();
    ctx.font = `italic ${compact ? 11 : 12}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const crowded = ci > 0 && X(c.along) - X(controls[ci - 1]!.along) < 120;
    const tight = compact && (crowded || (controls[ci + 1] !== undefined && X(controls[ci + 1]!.along) - X(c.along) < 120));
    const base = tight ? `to ${c.rec.depthFt} ft` : c.rec.observed ? `our hole, ${c.rec.depthFt} ft` : `no record below ${c.rec.depthFt} ft`, bw = ctx.measureText(base).width;
    // Step the label down until it overlaps no other label.
    for (const dy of [5, 19, 33, 47]) {
      const y = Y(c.rec.depthFt) + dy;
      if (!labels.take([X(c.along) - bw / 2, y, X(c.along) + bw / 2, y + 14])) continue;
      halo(ctx, base, X(c.along), y, INK.carmine);
      break;
    }
    // Head: well symbol and owner.
    ctx.strokeStyle = INK.carmine;
    ctx.fillStyle = INK.carmine;
    ctx.beginPath(); ctx.arc(X(c.along), groundY(c.along) - 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${compact ? 11 : 12}px ${FONT}`;
    ctx.textBaseline = "bottom";
    halo(ctx, c.rec.observed ? c.rec.owner : `${c.rec.owner} (his account)`, X(c.along), groundY(c.along) - 14 - (crowded && ci % 2 ? 14 : 0), INK.ink);
    // His words, beside the column, only where there is room before the next record.
    if (room[ci]! > (compact ? 120 : 170)) {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = `${compact ? 11 : 12}px ${FONT}`;
      let lastY = -Infinity;
      for (const iv of c.rec.intervals) {
        const y = (Y(iv.topFt) + Y(iv.baseFt)) / 2;
        if (y - lastY < 13) continue;
        lastY = y;
        const words = room[ci]! < 260 ? iv.call.split(",")[0]! : iv.call;
        halo(ctx, words, X(c.along) + colW / 2 + 6, y, iv.show ? INK.carmine : INK.ink);
      }
    }
  });

  // Other operators' wells known from the news: a dashed ink line to the depth reported, the outcome
  // at its foot. Told, not seen: no beds are drawn, because none were described.
  for (const { n, along } of heard) {
    const x = X(along), d = n.depthFt ?? 0;
    ctx.strokeStyle = INK.ink;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, groundY(along)); ctx.lineTo(x, Y(d)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = INK.ink;
    ctx.beginPath(); ctx.arc(x, Y(d), n.event === "oil" ? 3.2 : 2.4, 0, Math.PI * 2);
    if (n.event === "oil") ctx.fill(); else ctx.stroke();
    ctx.font = `italic ${compact ? 10 : 11}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const short = (n.name ?? n.operator ?? "").replace(/^the /, "").replace(/ Oil Co\.| Petroleum Co\./, "");
    const label = `${short}: ${n.event === "dry" ? "dry" : n.event}, ${d} ft (news)`;
    const lw = ctx.measureText(label).width;
    if (labels.take([x - lw / 2, Y(d) + 4, x + lw / 2, Y(d) + 18])) halo(ctx, label, x, Y(d) + 4, INK.inkSoft);
  }

  // The player's prospects that this line crosses: a dotted bracket, explicitly a guess.
  for (const p of k.interp.prospects) {
    const t = ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (L * L);
    const off = Math.abs((p.x - ax) * (by - ay) - (p.y - ay) * (bx - ax)) / L;
    if (t < 0 || t > 1 || off > p.r) continue;
    const half = Math.sqrt(p.r * p.r - off * off);
    const k0 = t * L - half, k1 = t * L + half;
    ctx.strokeStyle = INK.carmine;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(X(k0), groundY(k0) - 18); ctx.lineTo(X(k0), groundY(k0) - 26); ctx.lineTo(X(k1), groundY(k1) - 26); ctx.lineTo(X(k1), groundY(k1) - 18);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `italic ${compact ? 11 : 12}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    halo(ctx, `Prospect ${p.numeral}, our guess`, X((k0 + k1) / 2), groundY((k0 + k1) / 2) - 29, INK.carmine);
  }

  // When nothing is known below the surface, say so plainly. The paper stays blank.
  if (controls.length === 0 && readings.length === 0 && heard.length === 0) {
    ctx.fillStyle = INK.inkSoft;
    ctx.font = `italic ${compact ? 13 : 15}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Nothing is known below the surface along this line.", w / 2, (Y(0) + Y(maxFt)) / 2 - 10);
    ctx.font = `italic ${compact ? 12 : 13}px ${FONT}`;
    ctx.fillText(compact ? "Ask a settler about his well nearby." : "Ask a settler about a well near the line, or draw the line through one.", w / 2, (Y(0) + Y(maxFt)) / 2 + 14);
  }

  // Axes, ends, title.
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.ink;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(padL - 10, Y(0)); ctx.lineTo(padL - 10, Y(maxFt)); ctx.stroke();
  ctx.font = `${compact ? 11 : 12}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const step = maxFt > 1000 ? 400 : 200;
  for (let d = 0; d <= maxFt; d += step) {
    ctx.beginPath(); ctx.moveTo(padL - 14, Y(d)); ctx.lineTo(padL - 10, Y(d)); ctx.stroke();
    ctx.fillText(d === 0 ? "0 ft" : String(d), padL - 16, Y(d));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const miles = L / KM_PER_MILE;
  const tick = miles > 4 ? 1 : 0.5;
  for (let mi = 0; mi <= miles + 1e-6; mi += tick) {
    const x = X(mi * KM_PER_MILE);
    ctx.beginPath(); ctx.moveTo(x, Y(maxFt)); ctx.lineTo(x, Y(maxFt) + 4); ctx.stroke();
    ctx.fillText(mi === 0 ? "0" : `${mi}`, x, Y(maxFt) + 6);
  }
  ctx.textAlign = "right";
  ctx.fillText("miles", w - padR, Y(maxFt) + 6 + (compact ? 13 : 14));
  ctx.font = `700 ${compact ? 14 : 16}px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = INK.carmine;
  ctx.fillText(line.letter, padL - 10, 10);
  ctx.textAlign = "right";
  ctx.fillText(`${line.letter}′`, w - padR, 10);
  ctx.fillStyle = INK.inkSoft;
  ctx.font = `italic ${compact ? 11 : 12}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const ours = controls.filter((c) => c.rec.observed).length;
  ctx.fillText(compact ? `${controls.length} log${controls.length === 1 ? "" : "s"} · relief ×4` : `${ours} of ours, ${controls.length - ours} settlers' within ½ mile · relief ×4`, padL - 10, Y(maxFt) + 6 + (compact ? 13 : 14));
  // The key, under the scale: what was seen, what was told, what is inferred.
  legend(ctx, w - padR, Y(maxFt) + 6 + (compact ? 32 : 36), compact);

  overlay?.(ctx, { X, Y: (ft) => Y(ft), lengthKm: L, a: line.a, b: line.b });
}

/** A small key, right-aligned at (right, y): solid frame observed, dashed frame told, hatching and dashes inferred. */
function legend(ctx: CanvasRenderingContext2D, right: number, y: number, compact: boolean): void {
  ctx.save();
  ctx.font = `italic ${compact ? 10 : 11}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const items: [string, (x: number) => void][] = [
    ["observed", (x) => { ctx.strokeStyle = INK.ink; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(x, y - 5, 10, 10); }],
    ["told", (x) => { ctx.strokeStyle = INK.ink; ctx.lineWidth = 1.1; ctx.setLineDash([3, 2]); ctx.strokeRect(x, y - 5, 10, 10); }],
    ["inferred", (x) => { ctx.strokeStyle = INK.carmine; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 12, y); ctx.stroke(); }],
  ];
  const widths = items.map(([t]) => ctx.measureText(t).width + 18);
  let x = right - widths.reduce((a, b) => a + b + 8, 0);
  items.forEach(([t, mark], i) => {
    mark(x);
    ctx.setLineDash([]);
    ctx.fillStyle = i === 2 ? INK.carmine : INK.inkSoft;
    ctx.fillText(t, x + 15, y);
    x += widths[i]! + 8;
  });
  ctx.restore();
}

function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK.paper;
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Lithology: standard pattern over a tint (dots sand, dashes clay, circles gravel, brick rock, crosses salt). */
export function column(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lith: ReportedInterval["lith"]): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = LITH[lith];
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = INK.ink;
  ctx.fillStyle = INK.ink;
  ctx.lineWidth = 0.7;
  if (lith === "clay") {
    for (let yy = y + 3, r = 0; yy < y + h; yy += 4.5, r++)
      for (let xx = x + (r % 2 ? 1 : 4); xx < x + w; xx += 7) { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 4, yy); ctx.stroke(); }
  } else if (lith === "sand") {
    for (let yy = y + 2, r = 0; yy < y + h; yy += 3.6, r++)
      for (let xx = x + (r % 2 ? 1.5 : 3.3); xx < x + w; xx += 3.6) { ctx.beginPath(); ctx.arc(xx, yy, 0.6, 0, Math.PI * 2); ctx.fill(); }
  } else if (lith === "gravel") {
    for (let yy = y + 3, r = 0; yy < y + h; yy += 5, r++)
      for (let xx = x + (r % 2 ? 2 : 4.5); xx < x + w; xx += 5) { ctx.beginPath(); ctx.arc(xx, yy, 1.3, 0, Math.PI * 2); ctx.stroke(); }
  } else if (lith === "rock") {
    for (let yy = y, r = 0; yy < y + h; yy += 5, r++) {
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
      for (let xx = x + (r % 2 ? 0 : 4); xx < x + w; xx += 8) { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 5); ctx.stroke(); }
    }
  } else {
    for (let yy = y + 3; yy < y + h; yy += 6)
      for (let xx = x + 3; xx < x + w; xx += 6) { ctx.beginPath(); ctx.moveTo(xx - 1.6, yy); ctx.lineTo(xx + 1.6, yy); ctx.moveTo(xx, yy - 1.6); ctx.lineTo(xx, yy + 1.6); ctx.stroke(); }
  }
  ctx.restore();
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 0.9;
  ctx.strokeRect(x, y, w, h);
}

/**
 * Pair the contacts of two logs by the order of their changes in rock type (clay→sand, …).
 * A simple, explainable correlation: what a driller would do with two logs on a table.
 */
export function correlate(a: ReportedInterval[], b: ReportedInterval[]): [number, number][] {
  const contacts = (ivs: ReportedInterval[]) => ivs.slice(1).map((iv, i) => ({ key: `${ivs[i]!.lith}>${iv.lith}`, ft: iv.topFt }));
  const ca = contacts(a), cb = contacts(b);
  const out: [number, number][] = [];
  let j = 0;
  for (const c of ca) {
    const k = cb.findIndex((d, idx) => idx >= j && d.key === c.key);
    if (k < 0) continue;
    out.push([c.ft, cb[k]!.ft]);
    j = k + 1;
  }
  return out;
}

