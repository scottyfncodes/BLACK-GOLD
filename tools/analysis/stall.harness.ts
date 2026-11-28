/*
 * M9a-0: when should a driller recognise a hole that makes no footage? Analysis only; not part of CI.
 * Run: OUT=/path/stall.jsonl WORLDS=240 SHARD=0 SHARDS=1 \
 *   npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/stall.harness.ts
 *
 * In each world, holes are drilled with a hired driller trusted with his own judgement and money
 * enough never to run short, at the printed hills and around them (where running sand is met).
 * Each time a run of bails from about the same bottom begins, it is followed: told to keep at it
 * every time, how long until the hole makes footage again (if ever, within 120 days), and how far
 * it then gets. Truth is read only to say whether oil lay below.
 */
import { it } from "vitest";
import { appendFileSync } from "node:fs";
import { gameEngine, MINUTES_PER_DAY, operationsOf, printedMap, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { generateGeology, columnAt } from "../../src/sim/geology/truth/model";

const N = Number(process.env.WORLDS ?? 240);
const SHARD = Number(process.env.SHARD ?? 0), SHARDS = Number(process.env.SHARDS ?? 1);
const OUT = process.env.OUT;
const DAY = MINUTES_PER_DAY;
const FT = 3.2808;
const cmd = (w: WorldState, type: string, payload: unknown = null) => gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rej = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
type Run = { fromFt: number; at: number; bails: number } | null | undefined;
const runOf = (w: WorldState) => (operationsOf(w).well as unknown as { noHole?: Run }).noHole;

function oilBelowFt(seed: string, x: number, y: number): number | null {
  const hc = columnAt(generateGeology(seed), x, y, 800).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
  return hc && hc.fluid === "oil" && hc.top * FT <= 2500 ? hc.top * FT : null;
}

it("runs of bails from the same bottom, followed", () => {
  const seeds: string[] = [];
  for (let i = 0; seeds.length < N && i < N * 3; i++) if (printedMap(seedN(i)).hills[0]) seeds.push(seedN(i));
  for (const seed of seeds.filter((_, i) => i % SHARDS === SHARD)) {
    const hills = printedMap(seed).hills;
    const sites = hills.flatMap((h) => [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]].map(([dx, dy]) => ({ x: h.x + dx!, y: h.y + dy! })));
    const w = gameEngine.createWorld(seed, 0);
    (w.systems.operations as unknown as { ledger: { balances: Record<string, number> } }).ledger.balances.cash = 50_000_000;
    cmd(w, "crew.orders", { authority: "judgement", budgetCents: 1_000_000 });
    for (const site of sites) {
      const s = SURVEYS.find((v) => insidePoly(v.poly, site.x, site.y));
      if (!s) continue;
      cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
      if (rej(cmd(w, "rig.spud", site))) continue;
      gameEngine.advance(w, w.time + 3 * DAY + 10);
      cmd(w, "rig.auto", { on: true });
      const runs: { fromFt: number; rawFt: number; startDay: number; raisedAfterDays: number | null; resumedAfterDays: number | null; bailsAtResume: number | null }[] = [];
      let cur: (typeof runs)[number] | null = null;
      const spud = w.time;
      for (let k = 0; k < 4 * 400; k++) {
        const st = operationsOf(w).well!.status;
        if (st !== "drilling" && st !== "rigging" && st !== "stuck") break;
        const r = gameEngine.advance(w, w.time + DAY / 4);
        const run = runOf(w);
        // A run worth following: at least 8 bails from the same bottom.
        if (run && run.bails >= 8 && (!cur || cur.rawFt !== run.fromFt)) {
          if (cur && cur.resumedAfterDays === null) cur.resumedAfterDays = (run.at - (spud + cur.startDay * DAY)) / DAY;
          cur = { fromFt: Math.round(run.fromFt), rawFt: run.fromFt, startDay: (run.at - spud) / DAY, raisedAfterDays: null, resumedAfterDays: null, bailsAtResume: null };
          runs.push(cur);
        }
        if (cur && cur.resumedAfterDays === null && (!run || run.fromFt !== cur.rawFt)) { cur.resumedAfterDays = ((run ? run.at : w.time) - (spud + cur.startDay * DAY)) / DAY; }
        if (cur && cur.raisedAfterDays === null && r.events.some((e) => e.type === "driller.advice" && (e.data as { kind: string }).kind === "stalled")) cur.raisedAfterDays = (w.time - (spud + cur.startDay * DAY)) / DAY;
        const p = operationsOf(w).crew.pending;
        // The owner: pipe and fishing yes; money and "no hole", keep at it.
        if (p) cmd(w, p.kind === "quit" || p.kind === "decide" || p.kind === "stalled" || p.kind === "abandon" ? "crew.decline" : "crew.accept", { id: p.id });
        if (cur && cur.resumedAfterDays === null && w.time - (spud + cur.startDay * DAY) > 120 * DAY) break;
        if (operationsOf(w).well!.status === "stuck" && !operationsOf(w).crew.pending && !operationsOf(w).well!.busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
      }
      const well = operationsOf(w).well!;
      if (["drilling", "rigging", "stuck"].includes(well.status)) cmd(w, "rig.abandon");
      if (runs.length && OUT) appendFileSync(OUT, JSON.stringify({ seed, site, depthFt: Math.round(well.depthFt), outcome: well.outcome, oil: !!well.outcome?.startsWith("OIL"), oilBelowFt: oilBelowFt(seed, site.x, site.y), driller: operationsOf(w).crew.driller.temperament, runs }) + "\n");
    }
  }
});
