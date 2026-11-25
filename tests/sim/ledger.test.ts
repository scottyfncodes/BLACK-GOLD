import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, hashState, MINUTES_PER_DAY, operationsOf, STARTING_CASH, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { emptyLedger, LedgerError, pay, post, recompute } from "../../src/sim/company/ledger";
import { v1ToV2, worldProblem } from "../../src/sim/migrations";
import { decodeSave } from "../../src/app/save/format";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const books = (w: WorldState) => operationsOf(w).ledger;

describe("the ledger", () => {
  it("refuses entries that do not balance or are not whole cents", () => {
    const l = emptyLedger();
    expect(() => post(l, 0, "opening", "bad", [{ account: "cash", cents: 100 }, { account: "equity", cents: -99 }])).toThrow(LedgerError);
    expect(() => post(l, 0, "opening", "bad", [{ account: "cash", cents: 0.5 }, { account: "equity", cents: -0.5 }])).toThrow(LedgerError);
    expect(l.entries).toHaveLength(0);
  });

  it("derives balances from entries", () => {
    const l = emptyLedger();
    post(l, 0, "opening", "in", [{ account: "cash", cents: 10_000 }, { account: "equity", cents: -10_000 }]);
    pay(l, 1, "drilling", "out", "drilling", 2_550);
    expect(l.balances.cash).toBe(7_450);
    expect(recompute(l)).toEqual(l.balances);
  });

  it("opens a campaign with capital paid in and the rig on the books", () => {
    const w = gameEngine.createWorld("1edfe11edfe11edf", CAMPAIGN_START);
    expect(operationsOf(w).cash).toBe(STARTING_CASH);
    expect(books(w).entries.map((e) => e.memo)).toEqual(["Capital paid in", "Cable-tool rig and tools, owned"]);
  });
});

describe("rig costs in the books", () => {
  const survey = SURVEYS[7]!;
  const [x, y] = centroid(survey.poly);
  const drilling = () => {
    const w = gameEngine.createWorld("1edfe11edfe11edf", CAMPAIGN_START);
    cmd(w, "lease.take", { surveyId: survey.id, offer: "asking" });
    cmd(w, "rig.spud", { x, y });
    return w;
  };

  it("enters rig time once a day, at midnight, in whole cents", () => {
    const w = drilling();
    gameEngine.advance(w, w.time + 5 * MINUTES_PER_DAY);
    const days = books(w).entries.filter((e) => e.memo.startsWith("Rig crew"));
    expect(days.length).toBeGreaterThanOrEqual(5);
    for (const e of days) {
      expect(e.t % MINUTES_PER_DAY).toBe(0);
      expect(e.category).toBe("operating");
    }
    // A full day of rig time is exactly $12.00.
    expect(days.some((e) => e.lines.some((l) => l.account === "operating" && l.cents === 1200))).toBe(true);
    expect(recompute(books(w))).toEqual(books(w).balances);
  });

  it("gives identical books however time is stepped, across days and months", () => {
    const whole = drilling();
    gameEngine.advance(whole, whole.time + 40 * MINUTES_PER_DAY);
    for (const step of [1, 7, 61, 1439, 1440, 1441, 9 * MINUTES_PER_DAY]) {
      const w = drilling();
      const until = w.time + 40 * MINUTES_PER_DAY;
      while (w.time < until) gameEngine.advance(w, Math.min(until, w.time + step));
      expect(canonicalJson(books(w)), `step ${step}`).toBe(canonicalJson(books(whole)));
      expect(hashState(w), `step ${step}`).toBe(hashState(whole));
    }
  });

  it("a large jump in time still posts every day, and the money running out still ends the well", () => {
    const w = drilling();
    gameEngine.advance(w, w.time + 400 * MINUTES_PER_DAY);
    const o = operationsOf(w);
    expect(o.well!.status).toBe("dry");
    expect(o.cash).toBeGreaterThanOrEqual(0);
    expect(recompute(books(w))).toEqual(books(w).balances);
  });
});

describe("version 1 saves", () => {
  const text = readFileSync(new URL("../fixtures/save-v1.json", import.meta.url), "utf8");
  const raw = JSON.parse(text) as { schemaVersion: number; world: Record<string, unknown> & WorldState };

  it("load, with cash carried into the books and the game state untouched", () => {
    expect(raw.schemaVersion).toBe(1);
    const before = raw.world;
    const opsBefore = before.systems.operations as unknown as { cash: number; well: unknown; samples: unknown };
    const save = decodeSave(text, gameEngine);
    const w = save.world;
    expect(save.schemaVersion).toBeGreaterThanOrEqual(2);
    expect(worldProblem(w)).toBeNull();
    const o = operationsOf(w);
    expect(Math.abs(o.cash - opsBefore.cash)).toBeLessThan(0.01);
    // The well is untouched apart from the fields schemas 3 and 4 add, which start at rest.
    expect(canonicalJson(o.well)).toBe(canonicalJson({ ...(opsBefore.well as object), idleTicks: 0, lowFundsWarned: false, strings: [], leakFt: 0, waterFt: [], driller: "d0" }));
    expect(canonicalJson((w.systems.operations as unknown as { samples: unknown }).samples)).toBe(canonicalJson(opsBefore.samples));
    expect(canonicalJson(w.systems.knowledge)).toBe(canonicalJson(before.systems.knowledge));
    expect(w.time).toBe(before.time);
    expect(canonicalJson(w.rng)).toBe(canonicalJson(before.rng));
  });

  it("the migration is idempotent", () => {
    const once = v1ToV2(structuredClone(raw.world));
    const twice = v1ToV2(structuredClone(once));
    expect(canonicalJson(twice)).toBe(canonicalJson(once));
  });

  it("a migrated game plays on: the stuck well can be fished and drilled", () => {
    const w = decodeSave(text, gameEngine).world;
    const well = operationsOf(w).well!;
    expect(well.status).toBe("stuck");
    cmd(w, "rig.fish");
    gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY);
    expect(books(w).entries.some((e) => e.memo.startsWith("Fishing job"))).toBe(true);
    expect(books(w).entries.some((e) => e.memo.startsWith("Rig crew"))).toBe(true);
    expect(recompute(books(w))).toEqual(books(w).balances);
  });
});
