/**
 * Derived surface geography in km: meandered channels, woodland belts, marsh, Beaumont's plat
 * and farmsteads. Built once from the persistent 1890 geography with fixed noise keys; the same
 * in every campaign and unrelated to anything underground.
 */
import { JEFFERSON_1890, projectKm, type LatLon } from "../../content/geography/jefferson1890";
import { belt, hash, meander, resample, type Pt } from "./kit";

const P = (ll: LatLon): Pt => { const p = projectKm(JEFFERSON_1890, ll); return [p.x, p.y]; };

export interface Channel { id: string; name: string; kind: "river" | "bayou" | "creek"; line: Pt[]; width: (i: number) => number }
export interface Road { id: string; kind: "road" | "lane"; line: Pt[] }
export interface Block { poly: Pt[]; built: 0 | 0.5 | 1 }

export interface Geography {
  channels: Channel[];
  river: Channel;
  woods: Pt[][];
  marsh: Pt[][];
  rail: Pt[];
  roads: Road[];
  town: { center: Pt; blocks: Block[]; label: Pt };
  farmsteads: Pt[];
  settlement: { name: string; at: Pt }[];
}

let cached: Geography | undefined;

export function geography(): Geography {
  if (cached) return cached;
  const g = JEFFERSON_1890;
  const line = (id: string) => g.lines.find((l) => l.id === id)!;
  const river: Channel = { id: "neches", name: "Neches River", kind: "river", line: meander(line("neches").points.map(P), 0.32, 1.6, 11), width: (i) => 0.1 + 0.04 * hash(i >> 3, 3, 4) };
  const channels: Channel[] = [river];
  g.lines.filter((l) => l.kind === "bayou" || l.kind === "creek").forEach((l, k) => {
    const m = meander(l.points.map(P), l.kind === "bayou" ? 0.18 : 0.07, l.kind === "bayou" ? 0.9 : 0.45, 23 + k * 8);
    if (l.kind === "creek") m.push(nearest(river.line, m[m.length - 1]!));
    channels.push({ id: l.id, name: l.name, kind: l.kind === "bayou" ? "bayou" : "creek", line: m, width: () => 0 });
  });
  const pine = channels.find((c) => c.id === "pine-island-bayou")!;
  const woods = [belt(river.line, 0.85, 5), belt(pine.line, 0.45, 8)];
  const marsh = [
    ...g.areas.filter((a) => a.kind === "marsh" && a.id === "coastal-marsh").map((a) => a.points.map(P)),
    belt(river.line.slice(Math.floor(river.line.length * 0.62)), 1.1, 13),
  ];
  const roads: Road[] = g.lines.filter((l) => l.kind === "road").map((l) => ({ id: l.id, kind: "road", line: l.points.map(P) }));
  roads.push({ id: "lane-west", kind: "lane", line: [[30.084, -94.104], [30.07, -94.125], [30.058, -94.15], [30.05, -94.18]].map((p) => P(p as unknown as LatLon)) });
  roads.push({ id: "lane-south", kind: "lane", line: [[30.06, -94.088], [30.045, -94.1], [30.03, -94.098], [30.012, -94.09], [29.99, -94.1]].map((p) => P(p as unknown as LatLon)) });
  const beaumont = g.places.find((p) => p.id === "beaumont")!;
  const town = plat(P(beaumont.at), river.line);
  const farmsteads: Pt[] = [];
  roads.forEach((r, k) => resample(r.line, 0.9).forEach(([x, y], i) => {
    if (i === 0 || hash(i, k, 9) > 0.55) return;
    const side = hash(i, k, 10) > 0.5 ? 1 : -1;
    farmsteads.push([x + side * 0.09, y + 0.02]);
  }));
  const settlement = g.places.filter((p) => p.kind === "settlement").map((p) => ({ name: p.name, at: P(p.at) }));
  cached = { channels, river, woods, marsh, rail: line("tnorr").points.map(P), roads, town, farmsteads, settlement };
  return cached;
}

function nearest(line: readonly Pt[], p: Pt): Pt {
  return line.reduce((best, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? q : best), line[0]!);
}

function riverXAt(river: readonly Pt[], y: number): number {
  let best = river[0]!, bd = Infinity;
  for (const p of river) { const d = Math.abs(p[1] - y); if (d < bd) { bd = d; best = p; } }
  return best[0];
}

/** Beaumont's street grid on the west bank: dense at the core, ragged at the edge. */
function plat(center: Pt, river: readonly Pt[]): Geography["town"] {
  const [ox, oy] = center, ang = 0.28, block = 0.11, street = 0.032;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const at = (u: number, v: number): Pt => [ox + u * ca - v * sa, oy + u * sa + v * ca];
  const blocks: Block[] = [];
  for (let i = -7; i <= 4; i++)
    for (let j = -5; j <= 5; j++) {
      const u0 = i * (block + street), v0 = j * (block + street);
      const c = at(u0 + block / 2, v0 + block / 2);
      if (c[0] > riverXAt(river, c[1]) - 0.16) continue;
      const r = Math.hypot((i + 1.5) / 1.25, j) + (hash(i + 20, j + 20, 21) - 0.5) * 2.4;
      if (r > 4.6) continue;
      blocks.push({ poly: [at(u0, v0), at(u0 + block, v0), at(u0 + block, v0 + block), at(u0, v0 + block)], built: r < 2.4 ? 1 : r < 3.6 ? 0.5 : 0 });
    }
  return { center, blocks, label: [ox - 0.2, oy + 1.15] };
}
