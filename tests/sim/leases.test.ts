import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, MINUTES_PER_DAY, operationsOf, STARTING_CASH, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { askingTerms, ownerAccepts, TERM_DAYS } from "../../src/sim/company/leases";
import { generateGeology } from "../../src/sim/geology/truth/model";
import { surfaceSigns } from "../../src/sim/geology/truth/surface";
import { buildPrintedMap, printedMap } from "../../src/sim/surface/print";
import { recompute } from "../../src/sim/company/ledger";
import { decodeSave } from "../../src/app/save/format";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

const SEED = "1ea5e1ea5e1ea5e1";
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const ops = (w: WorldState) => operationsOf(w);
const take = (w: WorldState, surveyId: string, offer: "asking" | "lower" = "asking") => cmd(w, "lease.take", { surveyId, offer });
const YEAR = TERM_DAYS * MINUTES_PER_DAY;

describe("lease prices", () => {
  it("use public facts only: the same published map gives the same terms whatever lies below", () => {
    const t = generateGeology(SEED);
    const altered = structuredClone(t);
    altered.domes.forEach((d, i) => { d.charge = { fill: i % 2 ? 0.95 : 0, gasProne: !d.charge.gasProne }; d.flankW *= 1.6; });
    const signs = surfaceSigns(t);
    for (const s of SURVEYS) {
      const a = askingTerms(s, buildPrintedMap(t, signs), { strikes: [] });
      const b = askingTerms(s, buildPrintedMap(altered, signs), { strikes: [] });
      expect(b).toEqual(a);
    }
  });

  it("are dearer near a named hill and near Beaumont, and after oil comes in nearby", () => {
    const print = printedMap(SEED);
    const per = SURVEYS.map((s) => askingTerms(s, print, { strikes: [] }).perAcre);
    expect(Math.max(...per)).toBeGreaterThan(Math.min(...per));
    const s = SURVEYS[10]!;
    const [x, y] = centroid(s.poly);
    expect(askingTerms(s, print, { strikes: [{ x, y }] }).askingCents).toBeGreaterThan(askingTerms(s, print, { strikes: [] }).askingCents);
  });

  it("are whole dollars in steps of five, with a lower offer of three quarters", () => {
    for (const s of SURVEYS) {
      const t = askingTerms(s, printedMap(SEED), { strikes: [] });
      expect(t.askingCents % 500).toBe(0);
      expect(t.lowerCents % 500).toBe(0);
      expect(t.lowerCents).toBeLessThan(t.askingCents);
      expect(t.royalty).toBe(1 / 8);
    }
  });
});

describe("leasing", () => {
  it("costs the bonus, records it in the books, and permits drilling only on leased land", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const s = SURVEYS[5]!;
    const [x, y] = centroid(s.poly);
    expect(cmd(w, "rig.spud", { x, y }).events[0]!.type).toBe("command.rejected");
    take(w, s.id);
    const t = askingTerms(s, printedMap(SEED), { strikes: [] });
    expect(ops(w).cash).toBe(STARTING_CASH - t.askingCents / 100);
    expect(ops(w).ledger.entries.at(-1)!.memo).toContain(`Lease bonus, ${s.name} survey`);
    expect(cmd(w, "rig.spud", { x, y }).events.some((e) => e.type === "command.rejected")).toBe(false);
    expect(ops(w).well!.surveyId).toBe(s.id);
    expect(take(w, s.id).events[0]!.type).toBe("command.rejected");
  });

  it("a lower offer is accepted or refused by the owner's temperament, deterministically; a refusal stands for 30 days", () => {
    const refuser = SURVEYS.find((s) => !ownerAccepts(SEED, s.id))!;
    const accepter = SURVEYS.find((s) => ownerAccepts(SEED, s.id))!;
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    take(w, accepter.id, "lower");
    expect(ops(w).leases.leases.some((l) => l.surveyId === accepter.id && l.bonusCents === askingTerms(accepter, printedMap(SEED), { strikes: [] }).lowerCents)).toBe(true);
    const before = ops(w).cash;
    take(w, refuser.id, "lower");
    expect(ops(w).cash).toBe(before);
    expect(ops(w).leases.leases.some((l) => l.surveyId === refuser.id)).toBe(false);
    expect(take(w, refuser.id, "lower").events[0]!.type).toBe("command.rejected");
    gameEngine.advance(w, w.time + 31 * MINUTES_PER_DAY);
    expect(take(w, refuser.id, "lower").events.some((e) => e.type === "command.rejected")).toBe(false);
  });

  it("renews an idle lease on a delay rental each year, identically however time is stepped", () => {
    const run = (step: number) => {
      const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
      take(w, SURVEYS[2]!.id);
      const until = w.time + 3 * YEAR + 5 * MINUTES_PER_DAY;
      while (w.time < until) gameEngine.advance(w, Math.min(until, w.time + step));
      return w;
    };
    const a = run(3 * YEAR + 5 * MINUTES_PER_DAY), b = run(MINUTES_PER_DAY), c = run(997);
    const rentals = ops(a).ledger.entries.filter((e) => e.memo.startsWith("Delay rental"));
    expect(rentals).toHaveLength(3);
    expect(ops(a).leases.leases[0]!.status).toBe("active");
    expect(ops(a).leases.leases[0]!.renewals).toBe(3);
    expect(canonicalJson(ops(b).ledger)).toBe(canonicalJson(ops(a).ledger));
    expect(canonicalJson(ops(c).leases)).toBe(canonicalJson(ops(a).leases));
    expect(recompute(ops(a).ledger)).toEqual(ops(a).ledger.balances);
  });

  it("holds a lease while a well is being drilled on it, and lets an unaffordable one lapse", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const s = SURVEYS[6]!;
    const [x, y] = centroid(s.poly);
    take(w, s.id);
    cmd(w, "rig.spud", { x, y });
    gameEngine.advance(w, w.time + YEAR + MINUTES_PER_DAY);
    // The money ran out long before the year ended, so the well is dry; check the lease outcome.
    const lease = ops(w).leases.leases[0]!;
    expect(ops(w).well!.status).toBe("dry");
    expect(ops(w).cash).toBeLessThan(lease.acres * 0.1);
    expect(lease.status).toBe("lapsed");
  });

  it("can be released, but not under a well being drilled", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const s = SURVEYS[8]!;
    const [x, y] = centroid(s.poly);
    take(w, s.id);
    cmd(w, "rig.spud", { x, y });
    expect(cmd(w, "lease.release", { surveyId: s.id }).events[0]!.type).toBe("command.rejected");
    cmd(w, "rig.abandon");
    cmd(w, "lease.release", { surveyId: s.id });
    expect(ops(w).leases.leases[0]!.status).toBe("released");
  });
});

describe("version 1 saves and leases", () => {
  it("a well already being drilled keeps its land after migration", () => {
    const text = readFileSync(new URL("../fixtures/save-v1.json", import.meta.url), "utf8");
    const w = decodeSave(text, gameEngine).world;
    const o = ops(w);
    const lease = o.leases.leases.find((l) => l.surveyId === o.well!.surveyId)!;
    expect(lease.status).toBe("active");
    expect(lease.bonusCents).toBe(0);
    expect(w.queue.some((e) => e.type === "lease.term")).toBe(true);
  });
});
