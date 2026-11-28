import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, createEngine, fromCalendar, GAME_SYSTEMS, hashState, type Command, type WorldState } from "../../src/sim";
import { createSave, decodeSave, encodeSave } from "../../src/app/save/format";
import { gunzip, gzip } from "../../src/app/save/gzip";
import { commandScript, stressSystem } from "../fixtures/stress-system";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

/**
 * M0 acceptance: identical seed + identical command log ⇒ identical world, and a save
 * taken mid-run continues exactly as if it had never been saved.
 */
const SEED = "b1ac6017d0000001";
const TEN_YEARS = fromCalendar(1900, 1, 1, 6, 0);
const engine = createEngine([...GAME_SYSTEMS, stressSystem({ meanIntervalMinutes: 36 * 60 })]);
/**
 * The company's own play, so the golden run exercises the game and M7's reading of the ground:
 * fieldwork (paid for), a settler's account, the geologist's depth reading, a hole drilled with the
 * driller and abandoned (its account), and the geologist again once the company has a log of its own.
 */
const DAY = 24 * 60;
const survey = SURVEYS[3]!, [sx, sy] = centroid(survey.poly);
const game: Command[] = [
  [1, "fieldwork.walk", { surveyId: survey.id }],
  [5, "fieldwork.inquire", { wellId: "well-0" }],
  [8, "fieldwork.consult", { surveyId: survey.id, who: "geologist" }],
  [16, "lease.take", { surveyId: survey.id, offer: "asking" }],
  [16, "rig.spud", { x: sx, y: sy }],
  [20, "rig.auto", { on: true }],
  [70, "rig.abandon", null],
  [72, "fieldwork.consult", { surveyId: survey.id, who: "geologist" }],
  [80, "fieldwork.consult", { surveyId: survey.id, who: "gossip" }],
].map(([d, type, payload]) => ({ t: CAMPAIGN_START + (d as number) * DAY + 7 * 60, actor: "player", type: type as string, payload: payload as Command["payload"] }));
const script = [...commandScript(CAMPAIGN_START, 10), ...game].sort((a, b) => a.t - b.t);

function run(until: number): WorldState {
  const w = engine.createWorld(SEED, CAMPAIGN_START);
  engine.advance(w, until, { commands: script.filter((c) => c.t <= until) });
  return w;
}

describe("determinism", () => {
  it("matches the golden hash after ten simulated years", () => {
    const w = run(TEN_YEARS);
    const stress = w.systems.stress as { ticks: number; bumps: number; echoes: number };
    // Sanity: the run actually exercised randomness, commands, rejections and follow-ups.
    expect(stress.ticks).toBeGreaterThan(2000);
    expect(stress.bumps).toBe(54);
    expect(stress.echoes).toBe(54);
    expect(w.log.some((e) => e.type === "command.rejected")).toBe(true);
    // ... and the company's play: a reading, an account of the hole, and fieldwork in the books.
    const k = w.systems.knowledge as { evidence: { kind: string }[] };
    expect(k.evidence.filter((e) => e.kind === "reading").length).toBe(2);
    expect(k.evidence.some((e) => e.kind === "account")).toBe(true);
    expect((w.systems.operations as { ledger: { entries: { category: string }[] } }).ledger.entries.filter((e) => e.category === "fieldwork").length).toBe(5);
    // If this changes, simulation behaviour changed. Update it only on purpose.
    expect(hashState(w)).toBe(GOLDEN_TEN_YEAR_HASH);
  });

  it("is reproducible run to run", () => {
    expect(hashState(run(TEN_YEARS))).toBe(hashState(run(TEN_YEARS)));
  });

  it("gives the identical world however time is sliced", () => {
    const whole = run(TEN_YEARS);
    for (const slicer of [() => 1440, (i: number) => 1 + ((i * 7919) % 50_000), () => 17]) {
      const w = engine.createWorld(SEED, CAMPAIGN_START);
      const pending = [...script];
      while (w.time < TEN_YEARS) {
        const to = Math.min(TEN_YEARS, w.time + slicer(pending.length + w.time));
        const due: Command[] = [];
        while (pending.length && pending[0]!.t <= to) due.push(pending.shift()!);
        engine.advance(w, to, { commands: due });
      }
      expect(hashState(w)).toBe(hashState(whole));
    }
  });

  it("depends on the seed", () => {
    const other = engine.createWorld("b1ac6017d0000002", CAMPAIGN_START);
    engine.advance(other, TEN_YEARS, { commands: script });
    expect(hashState(other)).not.toBe(hashState(run(TEN_YEARS)));
  });

  it("continues identically after save → gzip → load", async () => {
    const midpoint = fromCalendar(1894, 7, 15, 13, 7);
    const saved = engine.createWorld(SEED, CAMPAIGN_START);
    engine.advance(saved, midpoint, { commands: script.filter((c) => c.t <= midpoint) });

    const bytes = await gzip(encodeSave(createSave(saved, "test", "1890-01-01T00:00:00Z")));
    const loaded = decodeSave(await gunzip(bytes), engine).world;
    expect(hashState(loaded)).toBe(hashState(saved));

    engine.advance(loaded, TEN_YEARS, { commands: script.filter((c) => c.t > midpoint) });
    expect(hashState(loaded)).toBe(hashState(run(TEN_YEARS)));
  });
});

describe("performance", () => {
  it("simulates one busy year headless in under a second", () => {
    // An event every ~30 game minutes: ~17,500 events, far denser than M0's real load.
    const busy = createEngine([...GAME_SYSTEMS, stressSystem({ meanIntervalMinutes: 30 })]);
    const w = busy.createWorld(SEED, CAMPAIGN_START);
    const start = performance.now();
    busy.advance(w, fromCalendar(1891, 1, 1, 6, 0));
    const ms = performance.now() - start;
    expect((w.systems.stress as { ticks: number }).ticks).toBeGreaterThan(15_000);
    expect(ms).toBeLessThan(1000);
  });
});

// Re-pinned on purpose: M1 (geology, knowledge), the rig, the company's books (ledger), its leases, production, the bank, and the idle-rig guard and recovery review, the crew and his habits, and period economics (rig at $1,500, 10% interest, crude by the year), and running sand with driven casing.
// M7 (Reading the Ground) re-pinned it again, deliberately: the golden run now plays the company too
// (fieldwork paid for, a geologist's depth reading, a hole drilled and abandoned with its account),
// and the world carries the driller's notebook. The baseline before M7, for main at 65a7053, was
// "1e3c8857be2e29" (the stress-only run, no company play). The M7 refinement (a rainbow of oil on the
// bailer water, drawn from its own stream) moved it once more, from "06ce6a7704aa28".
// M8a (the hidden field: tanks shared by every well) moved it from "1a1dfac96d01af", the M7 baseline.
// M8b (the Rush's state in the world; no strike in this run, so no rival comes) moved it from "10b5a4766fa733".
// The field's own golden run, with a strike, an offset and the Rush, is tests/determinism/field.test.ts.
const GOLDEN_TEN_YEAR_HASH = "08458440c940d3";
