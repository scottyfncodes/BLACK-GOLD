/*
 * Diagnostic campaigns (analysis only; truth is used to explain outcomes, never to play).
 * Three-year campaigns over the 44 seeded worlds used for PR #9; every well that does not
 * strike oil is given one primary cause, and failed companies are replayed with one decision
 * changed (counterfactuals) to separate avoidable mistakes from geology no decision could beat.
 * Not part of CI (minutes long). Run: npx vitest run --dir tools/analysis --include 'tools/analysis/*.harness.ts'
 * Findings: docs/DESIGN.md §8, "Why companies fail".
 */
import { it } from "vitest";
import { CAMPAIGN_START, gameEngine, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, recoveryPaths, type Driller, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { generateGeology, columnAt } from "../../src/sim/geology/truth/model";
import { runningProfile, RUN_STEP_FT } from "../../src/sim/hidden/quicksand";

const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rej = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
type W = { id: string; x: number; y: number; status: string; depthFt: number; casedFt: number; outcome?: string; strings: { method?: string; damage?: string | null; hung?: boolean }[]; collapse?: unknown; fishCount: number; lastInflow?: number };
const ops = (w: WorldState) => operationsOf(w) as unknown as { cash: number; well: W | null; past: W[]; crew: { pending: { id: number; kind: string } | null; candidates: Driller[] }; outcome: { endedAt: number | null }; production: { producers: unknown[] } };
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const surveyAt = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y));
const paths = (w: WorldState) => recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time));
const active = (w: WorldState) => { const s = ops(w).well?.status; return s === "rigging" || s === "drilling" || s === "stuck"; };
const MONTHS = 36;

/** Truth at a site, for diagnosis only: the first oil or gas within the rig's reach, and running sand above it. */
function siteTruth(seed: string, x: number, y: number) {
  const col = columnAt(generateGeology(seed), x, y, 800).map((iv) => ({ ...iv, topFt: iv.top * 3.2808 }));
  const hc = col.find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
  const payFt = hc && hc.topFt <= 2500 ? hc.topFt : null;
  const prof = runningProfile(seed, x, y);
  let lens = 0, run = 0;
  for (let i = 0; i * RUN_STEP_FT < (payFt ?? 2500); i++) { if (prof[i]! > 0.35) { run += RUN_STEP_FT; lens = Math.max(lens, run); } else run = 0; }
  return { payFt, pay: hc?.fluid ?? null, lens };
}

type Cause = "struck oil" | "struck gas" | "no oil within reach (site)" | "running sand" | "casing sizes exhausted" | "mechanical" | "capital exhausted" | "plugged on advice short of the pay" | "other";

/** The one primary cause of a well's end, from its record and the truth below it (analysis only). */
function cause(seed: string, w: W): Cause {
  if (w.status === "gusher") return w.outcome?.startsWith("OIL") ? "struck oil" : "struck gas";
  const t = siteTruth(seed, w.x, w.y);
  if (t.payFt === null) return "no oil within reach (site)";
  if (w.collapse || w.strings.some((s) => s.damage === "collapsed") || /swage|nothing left/.test(w.outcome ?? "")) return "mechanical";
  const prof = runningProfile(seed, w.x, w.y);
  const near = (ft: number) => { for (let f = Math.max(0, ft - 25); f <= ft + 10; f += RUN_STEP_FT) if ((prof[Math.floor(f / RUN_STEP_FT)] ?? 0) > 0.2) return true; return false; };
  const inSand = near(w.depthFt) && w.depthFt < t.payFt;
  if (inSand && w.strings.length >= 3) return "casing sizes exhausted";
  if (inSand || w.strings.some((s) => s.hung)) return "running sand";
  if (/abandoned at|plugged and abandoned/.test(w.outcome ?? "") && w.fishCount >= 2) return "mechanical";
  if (/^The money/.test(w.outcome ?? "")) return "capital exhausted";
  if (/save the company's money/.test(w.outcome ?? "")) return "plugged on advice short of the pay";
  return "other";
}

interface Policy { hire?: "dearest"; relocate?: boolean; borrow?: boolean; oracleSite?: boolean; declineQuit?: boolean }

function drillOut(w: WorldState, p: Policy) {
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let k = 0; k < 4000 && active(w); k++) {
    const r = gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    if (!active(w)) break;
    // Counterfactual "borrow to finish": take the bank's credit at the low-money warning.
    if (p.borrow && r.events.some((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === "lowfunds")) {
      const room = (positionOf(w.systems.operations as never, w.seed, w.time) as unknown as { creditRoomCents: number }).creditRoomCents;
      if (room >= 5_000) cmd(w, "bank.borrow", { cents: Math.floor(room / 5_000) * 5_000 });
    }
    // Counterfactual "move on": at the first report of sand running back, plug and try elsewhere on the lease.
    if (p.relocate && (ops(w).well!.lastInflow ?? 0) >= 4 && ops(w).well!.strings.length === 0 && !ops(w).well!.id.endsWith("-moved")) {
      return "relocate" as const;
    }
    const q = ops(w).crew.pending;
    if (q) cmd(w, p.declineQuit && q.kind === "quit" ? "crew.decline" : "crew.accept", { id: q.id });
    const well = ops(w).well!;
    if (well.status === "stuck" && !ops(w).crew.pending && !(well as unknown as { busy: unknown }).busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
  }
  const well = ops(w).well;
  if (well && well.status === "gusher") cmd(w, "prod.cap");
  return "done" as const;
}

/** The game's own recovery paths to a next well near `at`. */
function nextWell(w: WorldState, at: { x: number; y: number }, end: number): boolean {
  for (let guard = 0; guard < 60 && w.time < end; guard++) {
    if (ops(w).outcome.endedAt !== null) return false;
    const ps = paths(w);
    const borrow = (cents: number) => { if (cents > 0) cmd(w, "bank.borrow", { cents }); };
    const drill = ps.find((p) => p.kind === "drill" || p.kind === "leaseAndDrill") as { kind: string; surveyId: string; borrowCents: number } | undefined;
    const here = surveyAt(at.x, at.y);
    if (drill) {
      borrow(drill.borrowCents);
      if (drill.kind === "leaseAndDrill") cmd(w, "lease.take", { surveyId: drill.surveyId, offer: "asking" });
      const s = SURVEYS.find((x) => x.id === drill.surveyId)!;
      const spot = here && here.id === s.id ? at : { x: s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, y: s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length };
      if (!rej(cmd(w, "rig.spud", spot))) return true;
    }
    const c = ps.find((p) => p.kind === "contract") as { borrowCents: number } | undefined;
    if (c) { borrow(c.borrowCents); cmd(w, "company.contract"); gameEngine.advance(w, w.time + 31 * MINUTES_PER_DAY); continue; }
    const pl = ps.find((p) => p.kind === "pull") as { borrowCents: number } | undefined;
    if (pl) { borrow(pl.borrowCents); cmd(w, "rig.pull"); gameEngine.advance(w, w.time + 6 * MINUTES_PER_DAY); continue; }
    const b = ps.find((p) => p.kind === "buyRig") as { borrowCents: number } | undefined;
    if (b) { borrow(b.borrowCents); cmd(w, "company.buyRig"); continue; }
    if (ps.some((p) => p.kind === "contracted" || p.kind === "producing")) { gameEngine.advance(w, w.time + 31 * MINUTES_PER_DAY); if (ps.some((p) => p.kind === "producing") && !drill) return false; continue; }
    return false;
  }
  return false;
}

/** Oil sites in the surveys, shallowest first (analysis only), with their running sand. */
function oilSites(seed: string) {
  const t = generateGeology(seed);
  const out: { x: number; y: number; ft: number; lens: number }[] = [];
  for (const s of SURVEYS) {
    const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.25) {
      if (!insidePoly(s.poly, x, y)) continue;
      const hc = columnAt(t, x, y, 500).find((iv) => iv.fluid === "oil");
      if (hc) out.push({ x, y, ft: hc.top * 3.2808, lens: siteTruth(seed, x, y).lens });
    }
  }
  return out.sort((a, b) => a.ft - b.ft);
}

function campaign(seed: string, first: "best" | "flank", p: Policy) {
  const w = gameEngine.createWorld(seed, CAMPAIGN_START);
  const end = CAMPAIGN_START + MONTHS * 30 * MINUTES_PER_DAY;
  const hill = printedMap(seed).hills[0];
  if (!hill) return null;
  const offsets = [[0.15, 0.1], [-0.15, -0.1], [0.3, -0.2], [-0.3, 0.2], [0, 0.35], [0.35, 0], [-0.35, 0], [0, -0.35]];
  let spots = offsets.map(([dx, dy]) => ({ x: hill.x + dx!, y: hill.y + dy! })).filter((s) => surveyAt(s.x, s.y));
  if (first === "best") {
    const sites = oilSites(seed);
    if (!sites.length) return null;
    // Counterfactual "better site": the shallowest oil with no running lens over 50 ft above it (oracle, a bound).
    const pick = p.oracleSite ? (sites.find((s) => s.lens < 50) ?? sites[0]!) : sites[0]!;
    spots = [{ x: pick.x, y: pick.y }, ...spots];
  }
  if (!spots.length) return null;
  if (p.hire === "dearest") {
    // Counterfactual "hire the dearest man in Beaumont": wage is public, ability is not.
    const best = [...ops(w).crew.candidates].sort((a, b) => b.wageCents - a.wageCents)[0];
    if (best) cmd(w, "crew.hire", { id: best.id });
  }
  cmd(w, "lease.take", { surveyId: surveyAt(spots[0]!.x, spots[0]!.y)!.id, offer: "asking" });
  let wells = 0, k = 0;
  const firstSpot = spots[0]!;
  while (w.time < end && ops(w).outcome.endedAt === null) {
    if (ops(w).production.producers.length) { gameEngine.advance(w, Math.min(end, w.time + 30 * MINUTES_PER_DAY)); continue; }
    const at = spots[k % spots.length]!; k++;
    const spudded = wells === 0 ? !rej(cmd(w, "rig.spud", at)) : nextWell(w, at, end);
    if (!spudded) break;
    wells++;
    if (drillOut(w, p) === "relocate") {
      // Plug and move about 0.6 km along the same lease, if it reaches; else the next spot.
      cmd(w, "rig.abandon");
      const s = surveyAt(firstSpot.x, firstSpot.y)!;
      const cand = [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.45, 0.45], [-0.45, -0.45]].map(([dx, dy]) => ({ x: firstSpot.x + dx!, y: firstSpot.y + dy! })).find((q) => insidePoly(s.poly, q.x, q.y));
      if (cand) spots.splice(k, 0, cand);
      p = { ...p, relocate: false };
      continue;
    }
    if (wells > 12) break;
  }
  if (w.time < end && ops(w).outcome.endedAt === null) gameEngine.advance(w, end);
  const o = ops(w);
  const all = [...o.past, ...(o.well ? [o.well] : [])];
  return { survived: o.outcome.endedAt === null, oil: all.some((x) => x.status === "gusher" && x.outcome?.startsWith("OIL")), causes: all.map((x) => cause(seed, x)), firstCause: all[0] ? cause(seed, all[0]) : "other", lens: all[0] ? siteTruth(seed, all[0].x, all[0].y).lens : 0 };
}

it("diagnosis", () => {
  const seeds: string[] = [];
  for (let i = 0; i < 88 && seeds.length < 44; i++) if (printedMap(seedN(i)).hills[0]) seeds.push(seedN(i));
  for (const first of ["best", "flank"] as const) {
    const base = seeds.map((s) => [s, campaign(s, first, {})] as const).filter(([, r]) => r) as [string, NonNullable<ReturnType<typeof campaign>>][];
    const n = base.length;
    const failed = base.filter(([, r]) => !r.survived);
    const tally = (xs: string[]) => { const t: Record<string, number> = {}; for (const x of xs) t[x] = (t[x] ?? 0) + 1; return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "); };
    console.log(`\n=== ${first === "best" ? "best site first" : "hill flank first"}: ${n} companies, survived ${n - failed.length}, struck oil ${base.filter(([, r]) => r.oil).length} ===`);
    console.log(`every well's end (all companies): ${tally(base.flatMap(([, r]) => r.causes))}`);
    console.log(`failed companies, first well's end: ${tally(failed.map(([, r]) => r.firstCause))}`);
    console.log(`failed companies, every well's end: ${tally(failed.flatMap(([, r]) => r.causes))}`);
    const lensB = (l: number) => (l === 0 ? "none" : l < 50 ? "thin" : l < 110 ? "thick" : "very thick");
    console.log(`failed companies by running sand above their first well's pay: ${tally(failed.map(([, r]) => lensB(r.lens)))}; survivors: ${tally(base.filter(([, r]) => r.survived).map(([, r]) => lensB(r.lens)))}`);
    // Counterfactuals on the companies that failed.
    const variants: [string, Policy][] = [
      ["hire the dearest driller at the start (public wage only)", { hire: "dearest" }],
      ["move on at the first report of running sand (plug, re-spud 0.6 km along the lease)", { relocate: true }],
      ["borrow the bank's credit at the low-money warning", { borrow: true }],
      ["decline the counsel to quit", { declineQuit: true }],
      ["ORACLE: start at the shallowest oil without thick running sand (a bound, not a player strategy)", { oracleSite: true }],
    ];
    for (const [label, p] of variants) {
      let saved = 0, struck = 0;
      for (const [seed] of failed) {
        const r = campaign(seed, first, p);
        if (!r) continue;
        if (r.survived) saved++;
        if (r.oil) struck++;
      }
      // And the cost of the same decision to the companies that survived without it.
      let lost = 0;
      for (const [seed] of base.filter(([, r]) => r.survived)) { const r = campaign(seed, first, p); if (r && !r.survived) lost++; }
      console.log(`  if ${label}: ${saved} of ${failed.length} failed companies survive (${struck} strike oil); ${lost} of ${n - failed.length} survivors would have failed`);
    }
  }
});
