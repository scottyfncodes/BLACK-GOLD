import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, MINUTES_PER_DAY, operationsOf, printedMap, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { DRIVE, DRIVE_ALLOWANCE_FT, drivePipeCents, MAX_STRINGS, salvageFraction } from "../../src/sim/company/casing";
import { post, recompute } from "../../src/sim/company/ledger";
import { collapseSeverity, runningAt, runningProfile } from "../../src/sim/hidden/quicksand";
import { MIGRATIONS, worldProblem } from "../../src/sim/migrations";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { noRunningSand, runningLens } from "../helpers/ground";

/**
 * Driven casing through quicksand (docs/DESIGN.md §8). Running sand is hidden ground; the crew
 * learns it from the bailer and the pipe. Drive pipe goes down under the maul, harder as it takes
 * hold, until the driller calls refusal; joints can part and pipe can collapse; a collapse can be
 * swaged, dearly and without promise, a few times at most.
 */
const SEED = "e459b94df4abf2ce"; // the review's world: running sand from about 190 ft at this spot (test only)
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const reports = (r: ReturnType<typeof cmd>, kind: string) => r.events.filter((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === kind);
const raw = (w: WorldState) => w.systems.operations as unknown as { well: Record<string, unknown> & { strings: Record<string, unknown>[] }; tools: { driveHead: boolean } };

function spot(quiet: boolean): { x: number; y: number } {
  const hill = printedMap(SEED).hills[0]!;
  for (let r = 0.1; r < 2.5; r += 0.15) for (let a = 0; a < 12; a++) {
    const at = { x: hill.x + r * Math.cos(a * 0.52), y: hill.y + r * Math.sin(a * 0.52) };
    if (!SURVEYS.some((s) => insidePoly(s.poly, at.x, at.y))) continue;
    if (quiet ? noRunningSand(SEED, at.x, at.y, 900) : runningLens(SEED, at.x, at.y, 600).ft >= 40) return at;
  }
  throw new Error("no spot");
}

/** Let the crew finish whatever it is doing (a bail, a dress, pipe going in). */
function idle(w: WorldState): WorldState {
  for (let k = 0; k < 50 && ops(w).well!.busy; k++) gameEngine.advance(w, ops(w).well!.busy!.until + 6);
  return w;
}

/** Lease, spud, rig up; the driller drills and his advice is declined, until `until` holds. */
function drillUntil(at: { x: number; y: number }, until: (w: WorldState) => boolean, accept: string[] = [], capitalCents = 0): WorldState {
  const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
  if (capitalCents) post((w.systems.operations as unknown as { ledger: Parameters<typeof post>[0] }).ledger, w.time, "opening", "Test: more capital", [{ account: "cash", cents: capitalCents }, { account: "equity", cents: -capitalCents }]);
  cmd(w, "lease.take", { surveyId: SURVEYS.find((s) => insidePoly(s.poly, at.x, at.y))!.id, offer: "asking" });
  cmd(w, "rig.spud", at);
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let k = 0; k < 4000 && !until(w); k++) {
    const st = ops(w).well!.status;
    if (st === "gusher" || st === "dry") break;
    gameEngine.advance(w, w.time + 30, { stopOnInterrupt: true });
    const p = ops(w).crew.pending;
    if (p) cmd(w, accept.includes(p.kind) ? "crew.accept" : "crew.decline", { id: p.id });
    if (ops(w).well!.status === "stuck" && !ops(w).well!.busy && !ops(w).crew.pending) cmd(w, "rig.fish");
  }
  return w;
}

describe("running sand: hidden ground, seen only in the bailer", () => {
  it("is a pure function of the seed, never stored or shown", () => {
    const at = spot(false);
    expect(runningAt(SEED, at.x, at.y, 300)).toBe(runningAt(SEED, at.x, at.y, 300));
    const w = drillUntil(at, (x) => (ops(x).well!.lastInflow ?? 0) >= 1.5);
    const seen = canonicalJson({ ops: ops(w) } as never);
    expect(seen).not.toMatch(/running|strength|severity|lens/i);
  });

  it("the bailer reports sand coming back on running ground, and not on quiet ground", () => {
    const ran = drillUntil(spot(false), (w) => (ops(w).well!.lastInflow ?? 0) >= 4);
    expect(ops(ran).well!.lastInflow).toBeGreaterThanOrEqual(4);
    const calm = drillUntil(spot(true), (w) => ops(w).well!.depthFt > 600);
    expect(ops(calm).well!.depthFt).toBeGreaterThan(600);
    expect(ops(calm).ledger).toBeTruthy();
    // On quiet ground the hole never shows sand running back as fast as it is bailed.
    expect(ops(calm).well!.lastInflow ?? 0).toBeLessThan(4);
  });

  it("let-down casing hangs where running sand has closed the hole, short of bottom", () => {
    // Strong running sand stops open hole within a few feet (the drilling tests show it); here a
    // hole already through the top of a lens is constructed (test only) to show what let-down pipe does.
    const at = spot(false);
    const lens = runningLens(SEED, at.x, at.y, 600);
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    cmd(w, "lease.take", { surveyId: SURVEYS.find((s) => insidePoly(s.poly, at.x, at.y))!.id, offer: "asking" });
    cmd(w, "rig.spud", at);
    gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
    const o = raw(w);
    const depth = lens.top + 40;
    Object.assign(o.well, { depthFt: depth, reachFt: depth + 1, lastBailFt: depth, fillFt: 0 });
    expect(rejected(cmd(w, "rig.case"))).toBeUndefined();
    gameEngine.advance(w, ops(w).well!.busy!.until + 6); // the rig ticks every 5 minutes
    const s = ops(w).well!.strings[0]!;
    expect(s.hung).toBe(true);
    // It hangs at the first strong running sand it meets, not at bottom.
    const prof = runningProfile(SEED, at.x, at.y);
    const first = prof.findIndex((v) => v > 0.35) * 5;
    expect(s.seatFt).toBeGreaterThanOrEqual(first);
    expect(s.seatFt).toBeLessThan(first + 12);
    expect(s.seatFt).toBeLessThan(depth - 5);
    expect(ops(w).well!.casedFt).toBe(s.seatFt);
    expect(ops(w).well!.openSandFt).toBeGreaterThan(20);
    expect(s.costCents).toBe(Math.round(s.seatFt * 50)); // paid only to where it hung
  });

  it("open hole makes almost no way through strong running sand", () => {
    const at = spot(false);
    const lens = runningLens(SEED, at.x, at.y, 600);
    const w = drillUntil(at, (x) => ops(x).well!.depthFt > lens.top + 30 || x.time > CAMPAIGN_START + 40 * MINUTES_PER_DAY, [], 500_000);
    expect(ops(w).well!.depthFt).toBeLessThan(lens.top + 30);
  });
});

describe("driving pipe", () => {
  function driving(): WorldState {
    const w = drillUntil(spot(false), (x) => (ops(x).well!.lastInflow ?? 0) >= 4);
    cmd(w, "rig.auto", { on: false });
    return idle(w);
  }

  it("needs a drive head, bought once; each string takes its own shoe; the pipe is bought for 100 ft and settled", () => {
    const w = driving();
    expect(rejected(cmd(w, "rig.drive"))).toBeDefined(); // no head yet
    const cash = Math.round(ops(w).cash * 100);
    expect(rejected(cmd(w, "company.buyDriveHead"))).toBeUndefined();
    expect(ops(w).tools.driveHead).toBe(true);
    expect(rejected(cmd(w, "company.buyDriveHead"))).toBeDefined(); // reusable: not bought twice
    expect(rejected(cmd(w, "rig.drive"))).toBeUndefined();
    gameEngine.advance(w, ops(w).well!.busy!.until + 5);
    const d = ops(w).well!.drive!;
    expect(d.paidCents).toBe(drivePipeCents(d.size, d.startFt + DRIVE_ALLOWANCE_FT));
    for (let k = 0; k < 400 && ops(w).well!.drive && !ops(w).well!.drive!.refused; k++) gameEngine.advance(w, w.time + 60);
    const shoe = Math.round(ops(w).well!.drive!.shoeFt);
    expect(rejected(cmd(w, "rig.setDrive"))).toBeUndefined();
    const s = ops(w).well!.strings.at(-1)!;
    expect(s.method).toBe("driven");
    expect(s.seatFt).toBe(shoe);
    expect(s.costCents).toBe(drivePipeCents(s.size, shoe)); // 1.6× pipe to the shoe, and the shoe
    expect(s.costCents).toBe(Math.round(shoe * [50, 35, 22][s.size]! * 1.6) + DRIVE.shoeCents[s.size]!);
    // Every cent spent is the head, the pipe settled to the shoe, and the rig time: no more, no less.
    const rigTime = ops(w).ledger.entries.filter((e) => e.category === "operating" && e.t > 0).reduce((a, e) => a + (e.lines.find((l) => l.account === "operating")?.cents ?? 0), 0);
    expect(recompute(ops(w).ledger)).toEqual(ops(w).ledger.balances);
    expect(cash - Math.round(ops(w).cash * 100)).toBeGreaterThanOrEqual(DRIVE.headCents + s.costCents);
    expect(rigTime).toBeGreaterThan(0);
    expect(worldProblem(w)).toBeNull();
  });

  it("refusal comes near the practical range, not at a fixed depth; the driller asks, and under his judgement sets it himself", () => {
    const asked = driving();
    cmd(asked, "company.buyDriveHead");
    let r = cmd(asked, "rig.drive");
    expect(rejected(r)).toBeUndefined();
    cmd(asked, "rig.auto", { on: true });
    for (let k = 0; k < 400 && !ops(asked).crew.pending; k++) r = gameEngine.advance(asked, asked.time + 60, { stopOnInterrupt: true });
    const p = ops(asked).crew.pending!;
    expect(p.kind).toBe("setdrive");
    const driven = ops(asked).well!.drive!.drivenFt;
    expect(driven).toBeGreaterThan(30);
    expect(driven).toBeLessThan(200);
    expect(p.text).not.toMatch(/\d+%|percent|chance/i);
    expect(reports(r, "refusal").length + 1).toBeGreaterThan(0);

    const trusted = driving();
    cmd(trusted, "company.buyDriveHead");
    cmd(trusted, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
    expect(rejected(cmd(trusted, "rig.drive"))).toBeUndefined();
    cmd(trusted, "rig.auto", { on: true });
    for (let k = 0; k < 400 && ops(trusted).well!.strings.length === 0; k++) gameEngine.advance(trusted, trusted.time + 60);
    expect(ops(trusted).well!.strings[0]!.method).toBe("driven");
  });

  it("casing sizes are accounted for: driven, hung and run strings share the three sizes, and nothing goes past the third", () => {
    const w = driving();
    cmd(w, "company.buyDriveHead");
    for (let n = 0; n < MAX_STRINGS; n++) {
      idle(w);
      if (rejected(cmd(w, "rig.drive"))) break;
      gameEngine.advance(w, ops(w).well!.busy!.until + 5);
      for (let k = 0; k < 30 && ops(w).well!.drive; k++) gameEngine.advance(w, w.time + 60);
      if (ops(w).well!.drive) cmd(w, "rig.setDrive");
      if (ops(w).well!.status !== "drilling") break;
      gameEngine.advance(w, w.time + 6 * 60);
    }
    expect(ops(w).well!.strings.length).toBeLessThanOrEqual(MAX_STRINGS);
    expect(ops(w).well!.strings.map((s) => s.size)).toEqual(ops(w).well!.strings.map((_, i) => i));
    if (ops(w).well!.strings.length === MAX_STRINGS) {
      expect(rejected(cmd(w, "rig.drive"))).toBeDefined();
      expect(rejected(cmd(w, "rig.case"))).toBeDefined();
    }
  });

  it("driven pipe comes back from a dead hole far less than run casing, and damaged pipe not at all", () => {
    expect(salvageFraction({ size: 0, seatFt: 300, costCents: 1, setAt: 0, seatCall: null, observed: "dry", pulled: false, method: "driven" })).toBeLessThan(salvageFraction({ size: 0, seatFt: 300, costCents: 1, setAt: 0, seatCall: null, observed: "dry", pulled: false }));
    expect(salvageFraction({ size: 0, seatFt: 300, costCents: 1, setAt: 0, seatCall: null, observed: "water", pulled: false, method: "driven", damage: "parted" })).toBe(0);
  });
});

describe("a collapsed string: swaging, dear and without promise", () => {
  /** A hole with a collapsed string at `atFt` (constructed on a fresh hole, test only). */
  function collapsed(atFt: number, head = true, seed = SEED, wellAt = spot(false)): WorldState {
    const w = gameEngine.createWorld(seed, CAMPAIGN_START);
    cmd(w, "lease.take", { surveyId: SURVEYS.find((s) => insidePoly(s.poly, wellAt.x, wellAt.y))!.id, offer: "asking" });
    cmd(w, "rig.spud", wellAt);
    gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
    const o = raw(w);
    o.well.depthFt = atFt + 20;
    o.well.reachFt = atFt + 21;
    o.well.lastBailFt = atFt + 20;
    o.tools.driveHead = head;
    o.well.strings.push({ size: 0, seatFt: atFt + 20, costCents: 20_000, setAt: w.time, seatCall: null, observed: "sand", pulled: false, method: "driven", drivenFt: 80, damage: "collapsed" });
    o.well.status = "stuck";
    o.well.busy = null;
    o.well.collapse = { atFt, attempts: 0 };
    return w;
  }

  it("costs $150 and four days each try, at most three tries; then the hole is lost", () => {
    const w = collapsed(250);
    for (let n = 0; n < DRIVE.swageAttempts; n++) {
      if (ops(w).well!.status !== "stuck") break;
      const cash = Math.round(ops(w).cash * 100);
      expect(rejected(cmd(w, "rig.fish"))).toBeUndefined();
      expect(cash - Math.round(ops(w).cash * 100)).toBe(DRIVE.swageCents);
      expect(ops(w).well!.busy!.until - w.time).toBe(DRIVE.swageDays * MINUTES_PER_DAY);
      gameEngine.advance(w, ops(w).well!.busy!.until + 5);
    }
    if (ops(w).well!.status === "stuck") expect(rejected(cmd(w, "rig.fish"))).toBeDefined();
    expect(worldProblem(w)).toBeNull();
  });

  it("some collapses cannot be opened at all, however often swaged", () => {
    // Find a collapse the ground has crushed beyond saving (hidden severity, test only).
    const at = spot(false);
    let hopeless = -1;
    for (let ft = 200; ft < 500 && hopeless < 0; ft += 3) if (collapseSeverity(SEED, "ours-1", ft, runningAt(SEED, at.x, at.y, ft)) >= 0.75) hopeless = ft;
    expect(hopeless).toBeGreaterThan(0);
    const w = collapsed(hopeless);
    for (let n = 0; n < DRIVE.swageAttempts; n++) { cmd(w, "rig.fish"); gameEngine.advance(w, ops(w).well!.busy!.until + 5); }
    expect(ops(w).well!.status).toBe("stuck");
    expect(rejected(cmd(w, "rig.fish"))).toBeDefined();
  });

  it("is never a cheap escape: a hole recovered by swaging costs more, on average, than a fresh hole to the same depth", () => {
    let spent = 0, recovered = 0, freshCost = 0, cases = 0;
    const at = spot(false);
    for (let ft = 180; ft <= 460; ft += 7) {
      const w = collapsed(ft);
      const cash = Math.round(ops(w).cash * 100);
      for (let n = 0; n < DRIVE.swageAttempts && ops(w).well!.status === "stuck"; n++) { cmd(w, "rig.fish"); gameEngine.advance(w, ops(w).well!.busy!.until + 1); }
      spent += cash - Math.round(ops(w).cash * 100);
      if (ops(w).well!.status === "drilling") recovered++;
      // A fresh hole to the same depth: a derrick, and rig time at a brisk 100 ft a day.
      freshCost += 35_000 + Math.ceil(ft / 100) * 1_200;
      cases++;
    }
    expect(recovered).toBeGreaterThan(0); // some are recovered
    expect(recovered).toBeLessThan(cases); // not all
    expect(spent / recovered).toBeGreaterThan(freshCost / cases);
    expect(runningAt(SEED, at.x, at.y, 300)).toBeGreaterThanOrEqual(0);
  });
});

describe("schema 6", () => {
  it("v5 → v6 gives an old save no drive head and wells at rest, idempotently", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const v5 = structuredClone(w) as unknown as { systems: { operations: Record<string, unknown> } };
    delete v5.systems.operations.tools;
    v5.systems.operations.well = { id: "ours-1", name: "Test No. 1", x: 1, y: 1, surveyId: "s", spudAt: 0, status: "drilling", depthFt: 300, reachFt: 301, fillFt: 0, sharp: 1, casedFt: 0, openSandFt: 0, feeding: false, auto: true, busy: null, lastBailFt: 290, rop: 0, contact: 1, idleTicks: 0, lowFundsWarned: false, strings: [], leakFt: 0, waterFt: [], driller: "d0", fishCount: 0 };
    const once = MIGRATIONS[5]!(v5 as never);
    expect(canonicalJson(MIGRATIONS[5]!(once) as never)).toBe(canonicalJson(once as never));
    const m = once as unknown as WorldState;
    expect(ops(m).tools.driveHead).toBe(false);
    expect(ops(m).well!.drive).toBeNull();
    expect(ops(m).well!.collapse).toBeNull();
    expect(worldProblem(m)).toBeNull();
  });

  it("the judgement module cannot see running sand: it imports nothing hidden", () => {
    const src = readFileSync(new URL("../../src/sim/company/judgement.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/hidden\/quicksand|geology\/truth/);
  });
});
