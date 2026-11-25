import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, hashState } from "../../src/sim";
import { createSave, decodeSave, encodeSave, SaveError, SCHEMA_VERSION, type Migration } from "../../src/app/save/format";
import { gunzip, gzip } from "../../src/app/save/gzip";
import { autosaveId } from "../../src/app/save/store";

const SEED = "5a7e000000000001";

function freshSaveText(): string {
  const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
  gameEngine.advance(w, CAMPAIGN_START + 90 * 1440);
  return encodeSave(createSave(w, "test", "2026-01-01T00:00:00Z"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests deliberately corrupt arbitrary fields
function edit(text: string, fn: (raw: Record<string, any>) => void): string {
  const raw = JSON.parse(text);
  fn(raw);
  return JSON.stringify(raw);
}

describe("save format", () => {
  it("round-trips through gzip unchanged", async () => {
    const text = freshSaveText();
    const back = decodeSave(await gunzip(await gzip(text)), gameEngine);
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
    expect(hashState(back.world)).toBe(hashState(JSON.parse(text).world));
  });

  it("snapshots the world: later changes to the live world don't leak into a save", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const save = createSave(w, "test", "");
    gameEngine.advance(w, CAMPAIGN_START + 1440 * 40);
    expect(save.world.time).toBe(CAMPAIGN_START);
  });

  it.each([
    ["not JSON", "{oops", /not valid JSON/],
    ["another file", JSON.stringify({ hello: "world" }), /not a BLACK GOLD save/],
    ["a newer game version", edit(freshSaveText(), (r) => (r.schemaVersion = SCHEMA_VERSION + 1)), /newer version/],
    ["a missing version", edit(freshSaveText(), (r) => delete r.schemaVersion), /schema version/],
    ["a bad seed", edit(freshSaveText(), (r) => (r.world.seed = "nope")), /damaged: bad seed/],
    ["fractional time", edit(freshSaveText(), (r) => (r.world.time = 1.5)), /damaged: bad time/],
    ["an event this build can't run", edit(freshSaveText(), (r) => (r.world.queue[0].type = "martian.landing")), /unknown scheduled event/],
    ["an event in the past", edit(freshSaveText(), (r) => (r.world.queue[0].at = 0)), /in the past/],
    ["a missing system", edit(freshSaveText(), (r) => delete r.world.systems.calendar), /missing state for system "calendar"/],
    ["a corrupt random stream", edit(freshSaveText(), (r) => (r.world.rng.x = [1, 2])), /bad random stream/],
  ])("rejects %s with a readable message", (_name, text, message) => {
    expect(() => decodeSave(text, gameEngine)).toThrow(SaveError);
    expect(() => decodeSave(text, gameEngine)).toThrow(message);
  });

  it("migrates old saves forward one version at a time", () => {
    const current = freshSaveText();
    const seen: number[] = [];
    const migrations: Record<number, Migration> = {
      4: (w) => (seen.push(4), { ...w, systems: { ...(w.systems as object), weather: null } }),
      5: (w) => (seen.push(5), { ...w, renamedInV4: true }),
    };
    const out = decodeSave(current, gameEngine, migrations, 6);
    expect(seen).toEqual([4, 5]);
    expect(out.schemaVersion).toBe(6);
    expect(out.world.systems.weather).toBeNull();
    expect((out.world as unknown as Record<string, unknown>).renamedInV4).toBe(true);
  });

  it("refuses to load when a migration is missing", () => {
    expect(() => decodeSave(freshSaveText(), gameEngine, {}, 5)).toThrow(/No migration from schema 4 to 5/);
  });
});

describe("autosave slots", () => {
  it("rotate through three slots by month", () => {
    const ids = Array.from({ length: 7 }, (_, m) => autosaveId(1890 * 12 + m));
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(ids[3]);
  });
});
