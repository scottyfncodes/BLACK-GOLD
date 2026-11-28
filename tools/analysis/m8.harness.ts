/*
 * M8b, The Field: what to do after a strike, measured. Analysis only; not part of CI.
 * Run: OUT=/path/m8.jsonl WORLDS=240 SHARD=0 SHARDS=1 \
 *   npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/m8.harness.ts
 * Then: node tools/analysis/m8-compare.mjs /path/m8-*.jsonl
 *
 * Each world: the company drills its first well at truth's cheapest oil site (scaffolding, so
 * that most worlds have a strike to play from; the exploration game is M7's) and caps it. From
 * that moment the world is copied four ways and played five years:
 *  - passive: produce, nothing more;
 *  - defensive leasing: lease every survey near the strike it can (as money comes in), to keep
 *    other operators off the structure;
 *  - quick offsets: drill offset wells beside the strike on its own lease, as fast as the one rig can;
 *  - combined: both, offsets reaching onto the newly leased ground.
 * After the strike every decision reads only public information: the strike's own position and
 * depth, the printed map, the company's books, the news. Truth is read only to measure (field
 * share from the hidden tanks, whether leased ground holds oil).
 */
import { it } from "vitest";
import { appendFileSync } from "node:fs";
import { gameEngine, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly, centroid } from "../../src/content/geography/surveys";
import type { FieldState } from "../../src/sim/hidden/reservoir";
import { RUSH } from "../../src/sim/rush/decide";
// Truth: scaffolding (the first site) and measurement only.
import { generateGeology, columnAt } from "../../src/sim/geology/truth/model";
import { runningProfile, RUN_STEP_FT } from "../../src/sim/hidden/quicksand";

const N = Number(process.env.WORLDS ?? 240);
const SHARD = Number(process.env.SHARD ?? 0), SHARDS = Number(process.env.SHARDS ?? 1);
const OUT = process.env.OUT;
const FT = 3.2808;
const DAY = MINUTES_PER_DAY;
const YEAR = 365 * DAY;
const LEASE_KM = 1.6;
const cmd = (w: WorldState, type: string, payload: unknown = null) => gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rej = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const field = (w: WorldState) => (w.systems.operations as unknown as { field: FieldState }).field;
const surveyAt = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y));
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const pos = (w: WorldState) => positionOf(w.systems.operations as never, w.seed, w.time) as unknown as { cashCents: number; creditRoomCents: number; heldLeases: string[] };

// ── scaffolding: a first well on oil (truth), drilled with the driller trusted to case and fish
function lens(seed: string, x: number, y: number, toFt: number): number {
  const prof = runningProfile(seed, x, y);
  let best = 0, run = 0;
  for (let i = 0; i * RUN_STEP_FT < toFt; i++) { if (prof[i]! > 0.35) { run += RUN_STEP_FT; best = Math.max(best, run); } else run = 0; }
  return best;
}
function firstSite(seed: string): { x: number; y: number } | null {
  const t = generateGeology(seed);
  let best: { x: number; y: number; cost: number } | null = null;
  for (const s of SURVEYS) {
    const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.25) {
      if (!insidePoly(s.poly, x, y)) continue;
      const hc = columnAt(t, x, y, 450).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
      if (!hc || hc.fluid !== "oil") continue;
      const ft = hc.top * FT, cost = ft + 4 * lens(seed, x, y, ft);
      if (!best || cost < best.cost) best = { x, y, cost };
    }
  }
  return best;
}

/** Drill the current well out with the driller; decline counsel to stop until `quitBelowFt`; cap oil. */
/**
 * M9.0 re-measurement only (default off, so M8b's runs reproduce): with STALL_DAYS set, a hole that
 * has made no footage for that many days is plugged, as a player watching the depth would.
 */
const STALL_DAYS = process.env.STALL_DAYS ? Number(process.env.STALL_DAYS) : null;
function drillOut(w: WorldState, quitBelowFt: number): "oil" | "other" {
  gameEngine.advance(w, w.time + 3 * DAY + 10);
  cmd(w, "rig.auto", { on: true });
  let deepest = ops(w).well?.depthFt ?? 0, since = w.time;
  for (let k = 0; k < 2000; k++) {
    const s = ops(w).well?.status;
    if (s !== "rigging" && s !== "drilling" && s !== "stuck") break;
    gameEngine.advance(w, w.time + DAY, { stopOnInterrupt: true });
    const d = ops(w).well!.depthFt;
    if (d > deepest + 0.5) { deepest = d; since = w.time; }
    else if (STALL_DAYS !== null && w.time - since > STALL_DAYS * DAY && !ops(w).crew.pending) { cmd(w, "rig.abandon"); break; }
    const q = ops(w).crew.pending;
    if (q) {
      const stop = q.kind === "quit" || q.kind === "decide" || q.kind === "abandon";
      const keep = stop && ops(w).well!.depthFt < quitBelowFt && q.kind !== "abandon";
      if (q.kind === "quit" && keep) { const room = pos(w).creditRoomCents; if (room >= 5_000) cmd(w, "bank.borrow", { cents: Math.floor(room / 5_000) * 5_000 }); }
      cmd(w, keep ? "crew.decline" : "crew.accept", { id: q.id });
    }
    const now = ops(w).well!;
    if (now.status === "stuck" && !ops(w).crew.pending && !now.busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
  }
  const well = ops(w).well;
  if (well?.status === "gusher" && well.outcome?.startsWith("OIL")) {
    const room = pos(w).creditRoomCents;
    if (pos(w).cashCents < 8_000 && room >= 5_000) cmd(w, "bank.borrow", { cents: 5_000 });
    if (!rej(cmd(w, "prod.cap"))) return "oil";
  }
  return "other";
}

/** "alone": passive play in the same world with no other operators (the Rush switched off): the scale of what the Rush takes. */
type Strategy = "passive" | "defend" | "offsets" | "combined" | "alone";

/** Lease what it can near the strike: nearest first, as the cash allows (keeping a reserve to operate). */
function leaseAround(w: WorldState, strike: { x: number; y: number }, leased: Set<string>): void {
  const near = SURVEYS.map((s) => ({ s, d: Math.hypot(centroid(s.poly)[0] - strike.x, centroid(s.poly)[1] - strike.y) })).filter((v) => v.d <= LEASE_KM).sort((a, b) => a.d - b.d);
  for (const { s } of near) {
    if (pos(w).heldLeases.includes(s.id)) { leased.add(s.id); continue; }
    if (pos(w).cashCents < 40_000) return;
    if (!rej(cmd(w, "lease.take", { surveyId: s.id, offer: "asking" }))) leased.add(s.id);
  }
}

/** Offset spots, public: around the strike at a few hundred yards, then (combined) further out, on land the company holds. */
function offsetSpots(w: WorldState, strike: { x: number; y: number }, reach: number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const r of reach) for (let a = 0; a < 4; a++) {
    const x = strike.x + Math.cos((a * Math.PI) / 2) * r, y = strike.y + Math.sin((a * Math.PI) / 2) * r;
    const s = surveyAt(x, y);
    if (s && pos(w).heldLeases.includes(s.id)) out.push({ x, y });
  }
  return out;
}

function play(start: WorldState, strategy: Strategy, strike: { x: number; y: number; depthFt: number }) {
  const w = structuredClone(start);
  const maxWells = RUSH.maxWells;
  if (strategy === "alone") (RUSH as { maxWells: number }).maxWells = 0;
  try { return playOn(w, strategy, strike); } finally { (RUSH as { maxWells: number }).maxWells = maxWells; }
}

function playOn(w: WorldState, strategy: Strategy, strike: { x: number; y: number; depthFt: number }) {
  const t0 = w.time;
  const leased = new Set<string>(pos(w).heldLeases);
  const discoveryLease = new Set(leased);
  const drilled: { x: number; y: number }[] = [strike];
  let offsets = 0, offsetOil = 0;
  const snaps: Record<string, ReturnType<typeof measure>> = {};
  for (const [label, at] of [["y3", 3 * YEAR], ["y5", 5 * YEAR]] as const) {
    while (w.time < t0 + at && ops(w).outcome.endedAt === null) {
      if (strategy === "defend" || strategy === "combined") leaseAround(w, strike, leased);
      const free = !ops(w).well || ["gusher", "dry"].includes(ops(w).well!.status);
      if ((strategy === "offsets" || strategy === "combined") && free && offsets < 6 && pos(w).cashCents > 120_000) {
        const spots = offsetSpots(w, strike, strategy === "combined" ? [0.3, 0.6, 0.9] : [0.3, 0.6]).filter((p) => !drilled.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 0.2) && !ops(w).rush.wells.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < 0.2));
        const next = spots[0];
        if (next && !rej(cmd(w, "rig.spud", next))) {
          drilled.push(next);
          offsets++;
          if (drillOut(w, strike.depthFt + 300) === "oil") offsetOil++;
          continue;
        }
      }
      gameEngine.advance(w, Math.min(t0 + at, w.time + 15 * DAY));
    }
    if (w.time < t0 + at) gameEngine.advance(w, t0 + at);
    snaps[label] = measure(w, leased, discoveryLease, t0);
  }
  return { strategy, offsets, offsetOil, ...snaps };
}

/** Oil within reach anywhere under a survey (truth, measurement only), on a coarse grid. */
function surveyHasOil(seed: string, id: string): boolean {
  const s = SURVEYS.find((v) => v.id === id)!;
  const t = generateGeology(seed);
  const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.3) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.3) {
    if (!insidePoly(s.poly, x, y)) continue;
    const hc = columnAt(t, x, y, 760).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
    if (hc?.fluid === "oil") return true;
  }
  return false;
}

function measure(w: WorldState, leased: Set<string>, discoveryLease: Set<string>, t0: number) {
  const o = ops(w), f = field(w);
  const outCents = (cat: string) => o.ledger.entries.filter((e) => e.category === cat).reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0);
  // Field share: of all the oil drawn from the tanks the company's wells tap, how much was the company's.
  const companyWells = new Set(o.production.producers.map((p) => p.wellId));
  const tanks = new Set(f.taps.filter((t) => companyWells.has(t.wellId)).map((t) => t.tank));
  const tankDrawn = [...tanks].reduce((a, k) => a + f.tanks[k]!.drawnBbl, 0);
  const companyDrawn = o.production.producers.reduce((a, p) => a + Math.round(p.cumBbl / Math.max(0.01, 1 - p.waterCut)), 0);
  const rivalsOnOurTanks = f.taps.filter((t) => !companyWells.has(t.wellId) && tanks.has(t.tank)).length;
  const extra = [...leased].filter((id) => !discoveryLease.has(id));
  const acres = extra.reduce((a, id) => a + SURVEYS.find((s) => s.id === id)!.acres, 0);
  const dryAcres = extra.filter((id) => !surveyHasOil(w.seed, id)).reduce((a, id) => a + SURVEYS.find((s) => s.id === id)!.acres, 0);
  return {
    value: o.cash - o.debt,
    solvent: o.outcome.endedAt === null,
    barrels: o.production.producers.reduce((a, p) => a + p.cumBbl, 0),
    share: tankDrawn ? companyDrawn / tankDrawn : 1,
    rivalsOnOurTanks,
    rivalWells: o.rush.wells.length,
    rivalOil: o.rush.wells.filter((r) => r.status === "oil").length,
    rivalDry: o.rush.wells.filter((r) => r.status === "dry").length,
    leaseSpend: outCents("lease") / 100,
    // Capital put into offset wells after the strike (cash paid against wells, net of nothing).
    drillingAfter: o.ledger.entries.filter((e) => e.t > t0 && e.ref?.wellId && e.category !== "production").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0) / 100,
    acres, dryAcres, leasesTaken: extra.length,
  };
}

function seedsFor(): string[] {
  const seeds: string[] = [];
  for (let i = 0; seeds.length < N && i < N * 3; i++) if (printedMap(seedN(i)).hills[0]) seeds.push(seedN(i));
  return seeds.filter((_, i) => i % SHARDS === SHARD);
}

it("strategies after a strike", () => {
  for (const seed of seedsFor()) {
    const site = firstSite(seed);
    if (!site) { if (OUT) appendFileSync(OUT, JSON.stringify({ seed, strike: false, why: "no oil site" }) + "\n"); continue; }
    const w = gameEngine.createWorld(seed, 0);
    cmd(w, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
    const s = surveyAt(site.x, site.y)!;
    cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
    if (rej(cmd(w, "rig.spud", site))) { if (OUT) appendFileSync(OUT, JSON.stringify({ seed, strike: false, why: "no spud" }) + "\n"); continue; }
    const got = drillOut(w, 2500);
    if (got !== "oil") { if (OUT) appendFileSync(OUT, JSON.stringify({ seed, strike: false, why: "first well failed", outcome: ops(w).well?.outcome, depth: Math.round(ops(w).well?.depthFt ?? 0), cash: ops(w).cash }) + "\n"); continue; }
    const strike = { x: site.x, y: site.y, depthFt: Math.round(ops(w).well!.depthFt) };
    const rows = (["passive", "defend", "offsets", "combined", "alone"] as Strategy[]).map((st) => play(w, st, strike));
    if (OUT) appendFileSync(OUT, JSON.stringify({ seed, strike: true, strikeDay: Math.round(w.time / DAY), cashAtStrike: ops(w).cash, rows }) + "\n");
  }
});
