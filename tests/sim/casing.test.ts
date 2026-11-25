import { describe, expect, it } from "vitest";
import { noRunningSand } from "../helpers/ground";
import { CAMPAIGN_START, gameEngine, MAX_STRINGS, MINUTES_PER_DAY, operationsOf, PIPE, positionOf, recoveryPaths, stringCostCents, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { post, recompute } from "../../src/sim/company/ledger";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { columnAt, generateGeology, type Interval } from "../../src/sim/geology/truth/model";

/**
 * Casing strings (docs/DESIGN.md §8): up to three, mechanical stabilization kept apart from
 * hydraulic isolation, the seat and its performance known only from what the hole shows,
 * water cut when sands above the pay were never shut off, and pulling pipe from a dead hole.
 * Truth is used here only to choose where a test seats its pipe.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const FT = 3.2808;

/** A best oil site and its true column (feet). */
function site(i0 = 0): { seed: string; x: number; y: number; col: (Interval & { topFt: number; baseFt: number })[]; oilFt: number } {
  for (let i = i0; i < 200; i++) {
    const seed = (0xa0000 + i * 7919).toString(16).padStart(16, "0");
    const t = generateGeology(seed);
    for (const s of SURVEYS) {
      const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2)
        for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.2) {
          if (!insidePoly(s.poly, x, y)) continue;
          const col = columnAt(t, x, y, 500).map((iv) => ({ ...iv, topFt: iv.top * FT, baseFt: iv.base * FT }));
          const oil = col.find((iv) => iv.fluid === "oil");
          // A site with a water sand, then clay, above the pay: room for a test to seat pipe well or badly.
          const sand = oil && col.find((iv) => iv.lithology === "sand" && iv.fluid === "water" && iv.baseFt < oil.topFt - 100);
          const clay = sand && col.find((iv) => iv.lithology === "clay" && iv.topFt >= sand.baseFt - 1 && iv.baseFt < oil!.topFt && iv.baseFt - iv.topFt > 30);
          if (oil && clay && oil.topFt < 1300 && !col.some((iv) => iv.fluid === "gas") && noRunningSand(seed, x, y, oil.topFt)) return { seed, x, y, col, oilFt: oil.topFt };
        }
    }
  }
  throw new Error("no site");
}

/** Drill by hand to a depth: keep the line right, bail and dress on time, fish when stuck. */
function drillTo(w: WorldState, ft: number): void {
  for (let k = 0; k < 288 * 120; k++) {
    const well = ops(w).well!;
    if (well.status === "gusher" || well.status === "dry" || well.depthFt >= ft) return;
    if (well.status === "rigging" || well.busy) { gameEngine.advance(w, Math.max(well.busy?.until ?? w.time, w.time) + 5); continue; }
    if (well.status === "stuck") { cmd(w, "rig.fish"); gameEngine.advance(w, w.time + 485); continue; }
    if (well.fillFt > 3) { cmd(w, "rig.bail"); continue; }
    if (well.sharp < 0.4) { cmd(w, "rig.dress"); continue; }
    cmd(w, "rig.feed", { on: well.reachFt - well.depthFt < 1.5 });
    gameEngine.advance(w, w.time + 5);
  }
}

/** Set the next string at the bottom and wait for it to be run. */
function runString(w: WorldState): void {
  expect(rejected(cmd(w, "rig.case"))).toBeUndefined();
  gameEngine.advance(w, ops(w).well!.busy!.until + 5);
}

/** Set the next string, drill a little, and bail once so the crew sees how it does. */
function setString(w: WorldState): void {
  runString(w);
  drillTo(w, ops(w).well!.depthFt + 3);
  if (!ops(w).well!.busy) cmd(w, "rig.bail");
  gameEngine.advance(w, Math.max(ops(w).well!.busy?.until ?? w.time, w.time) + 5);
}

function start(s: ReturnType<typeof site>): WorldState {
  const w = gameEngine.createWorld(s.seed, CAMPAIGN_START);
  // Capital enough to drill and case freely (test only): these tests are about the pipe, not the purse.
  const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
  post(o.ledger, w.time, "opening", "Test: more capital", [{ account: "cash", cents: 1_000_000 }, { account: "equity", cents: -1_000_000 }]);
  cmd(w, "lease.take", { surveyId: SURVEYS.find((x) => insidePoly(x.poly, s.x, s.y))!.id, offer: "asking" });
  expect(rejected(cmd(w, "rig.spud", { x: s.x, y: s.y }))).toBeUndefined();
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  return w;
}

describe("casing strings", () => {
  const s = site();
  const sand = s.col.find((iv) => iv.lithology === "sand" && iv.fluid === "water" && iv.baseFt < s.oilFt - 100)!;
  const clayBelow = s.col.find((iv) => iv.lithology === "clay" && iv.topFt >= sand.baseFt - 1 && iv.baseFt < s.oilFt)!;

  it("telescope: three at most, each smaller, priced by its length; a fourth will not go in", () => {
    const w = start(s);
    for (let k = 0; k < MAX_STRINGS; k++) {
      drillTo(w, ops(w).well!.depthFt + 25);
      const depth = Math.round(ops(w).well!.depthFt);
      const cash = ops(w).cash;
      setString(w);
      const str = ops(w).well!.strings[k]!;
      expect(str.size).toBe(k);
      expect(str.seatFt).toBe(depth);
      expect(str.costCents).toBe(stringCostCents(k, depth));
      expect(cash - ops(w).cash).toBeGreaterThanOrEqual(str.costCents / 100);
    }
    drillTo(w, ops(w).well!.depthFt + 25);
    expect(rejected(cmd(w, "rig.case"))?.data).toMatchObject({ reason: expect.stringMatching(new RegExp(`inside the ${PIPE[2]!.name}`)) });
    expect(recompute(ops(w).ledger)).toEqual(ops(w).ledger.balances);
  });

  it("pipe landed in clay below a water sand shuts off the water, and the crew sees the hole bail dry", () => {
    const w = start(s);
    drillTo(w, clayBelow.topFt + 12);
    expect(ops(w).well!.openSandFt).toBeGreaterThan(0);
    runString(w);
    expect(ops(w).well!.openSandFt).toBe(0);
    expect(ops(w).well!.leakFt).toBe(0);
    expect(ops(w).well!.strings[0]!.observed).toBe("pending");
    drillTo(w, ops(w).well!.depthFt + 3);
    cmd(w, "rig.bail");
    gameEngine.advance(w, Math.max(ops(w).well!.busy?.until ?? w.time, w.time) + 5);
    const str = ops(w).well!.strings[0]!;
    expect(str.seatCall).toMatch(/clay/);
    expect(str.observed).toBe("dry");
  });

  it("pipe seated in sand steadies the walls but shuts off nothing; sand keeps coming in under the shoe", () => {
    const w = start(s);
    drillTo(w, (sand.topFt + sand.baseFt) / 2);
    runString(w);
    expect(ops(w).well!.leakFt).toBeGreaterThan(0); // hydraulic: not isolated
    expect(ops(w).well!.openSandFt).toBe(0); // mechanical: the walls above are held
    drillTo(w, ops(w).well!.depthFt + 3);
    cmd(w, "rig.bail");
    gameEngine.advance(w, Math.max(ops(w).well!.busy?.until ?? w.time, w.time) + 5);
    const str = ops(w).well!.strings[0]!;
    expect(str.seatCall).toMatch(/sand/);
    expect(str.observed).toBe("water");
  });

  it("water sands above the pay that no sealed string shuts off cut the oil; a sound seat does not", () => {
    const sealed = start(s);
    drillTo(sealed, clayBelow.topFt + 12);
    setString(sealed);
    drillTo(sealed, s.oilFt + 40);
    const open = start(s);
    drillTo(open, s.oilFt + 40);
    for (const w of [sealed, open]) {
      expect(ops(w).well!.outcome).toMatch(/^OIL/);
      expect(rejected(cmd(w, "prod.cap"))).toBeUndefined();
    }
    const cut = (w: WorldState) => ops(w).production.producers[0]!.waterCut;
    expect(cut(open)).toBeGreaterThan(0);
    // The sealed well may still have water sands below its shoe; it is never worse than the open hole.
    expect(cut(sealed)).toBeLessThan(cut(open));
    gameEngine.advance(open, open.time + 3 * MINUTES_PER_DAY);
    gameEngine.advance(sealed, sealed.time + 3 * MINUTES_PER_DAY);
    expect(ops(open).production.producers[0]!.lastDayBbl).toBeLessThan(ops(sealed).production.producers[0]!.lastDayBbl);
  });

  it("bails the hole before pipe goes in, so the seat is what the bailer saw; what it seals is never stored", () => {
    const w = start(s);
    drillTo(w, 60);
    const samples = (w.systems.operations as unknown as { samples: unknown[] }).samples.length;
    runString(w);
    expect((w.systems.operations as unknown as { samples: unknown[] }).samples.length).toBe(samples + 1);
    expect(ops(w).well!.strings[0]!.seatCall).not.toBeNull();
    expect(JSON.stringify(ops(w).well!.strings)).not.toMatch(/seal/);
  });
});

describe("pulling casing", () => {
  const s = site();
  it("costs rig days, returns part of the pipe's cost, keeps the books, and holds the rig meanwhile", () => {
    const w = start(s);
    drillTo(w, 200);
    setString(w);
    drillTo(w, 320);
    setString(w);
    cmd(w, "rig.abandon");
    expect(ops(w).well!.status).toBe("dry");
    const pull = recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time)).find((p) => p.kind === "pull");
    const cost = ops(w).well!.strings.reduce((a, x) => a + x.costCents, 0);
    const cash = ops(w).cash;
    expect(rejected(cmd(w, "rig.pull"))).toBeUndefined();
    expect(ops(w).well!.pullingUntil).toBeGreaterThan(w.time);
    expect(rejected(cmd(w, "rig.spud", { x: s.x, y: s.y }))?.data).toMatchObject({ reason: expect.stringMatching(/pulling casing/) });
    expect(rejected(cmd(w, "rig.pull"))).toBeDefined();
    gameEngine.advance(w, ops(w).well!.pullingUntil! + 1);
    expect(ops(w).well!.strings.every((x) => x.pulled)).toBe(true);
    const back = ops(w).ledger.entries.find((e) => e.memo.startsWith("Casing pulled"))!;
    const got = back.lines.find((l) => l.account === "cash")!.cents;
    expect(got).toBeGreaterThan(cost * 0.29);
    expect(got).toBeLessThanOrEqual(cost * 0.5 + 1);
    expect(ops(w).cash).toBeGreaterThan(cash - 100); // the sale more than covers the days, as the path promised
    if (pull) expect(pull.valueCents).toBeGreaterThan(pull.costCents);
    expect(recompute(ops(w).ledger)).toEqual(ops(w).ledger.balances);
    expect(rejected(cmd(w, "rig.pull"))).toBeDefined(); // nothing left
  });

  it("is identical however time is stepped", () => {
    const run = (step: number) => {
      const w = start(s);
      drillTo(w, 200);
      setString(w);
      cmd(w, "rig.abandon");
      cmd(w, "rig.pull");
      const end = w.time + 6 * MINUTES_PER_DAY + 7;
      while (w.time < end) gameEngine.advance(w, Math.min(end, w.time + step));
      return canonicalJson(ops(w).ledger as never);
    };
    const ref = run(MINUTES_PER_DAY);
    for (const step of [7, 1_439, 3 * MINUTES_PER_DAY]) expect(run(step)).toBe(ref);
  });
});
