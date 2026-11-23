import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, createEngine, fromCalendar, GAME_SYSTEMS, hashState, type Command, type WorldState } from "../../src/sim";
import { createSave, decodeSave, encodeSave } from "../../src/app/save/format";
import { gunzip, gzip } from "../../src/app/save/gzip";
import { commandScript, stressSystem } from "../fixtures/stress-system";

/**
 * M0 acceptance: identical seed + identical command log ⇒ identical world, and a save
 * taken mid-run continues exactly as if it had never been saved.
 */
const SEED = "b1ac6017d0000001";
const TEN_YEARS = fromCalendar(1900, 1, 1, 6, 0);
const engine = createEngine([...GAME_SYSTEMS, stressSystem({ meanIntervalMinutes: 36 * 60 })]);
const script = commandScript(CAMPAIGN_START, 10);

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

// Re-pinned on purpose: M1 (geology, knowledge), the rig, and the company's books (ledger).
const GOLDEN_TEN_YEAR_HASH = "0b607139f9e3b6";
