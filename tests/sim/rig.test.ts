import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, COSTS, gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, STARTING_CASH, SWEET_FT, type WorldState } from "../../src/sim";
import { ftToM } from "../../src/sim/math/units";
import { columnAt, generateGeology, isCharged, rockAt } from "../../src/sim/geology/truth/model";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";

const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });

/** A spot inside a survey over an oil-bearing column, if this seed has one. */
function oilSite(seed: string): { x: number; y: number } | undefined {
  const t = generateGeology(seed);
  for (const d of t.domes.filter(isCharged))
    for (let a = 0; a < 16; a++)
      for (const r of [0, d.saltR + 0.05, d.saltR + d.flankW * 0.4]) {
        const x = d.x + Math.cos((a / 16) * Math.PI * 2) * r, y = d.y + Math.sin((a / 16) * Math.PI * 2) * r;
        if (!SURVEYS.some((s) => insidePoly(s.poly, x, y))) continue;
        if (columnAt(t, x, y, 400).some((iv) => iv.fluid === "oil" || iv.fluid === "gas")) return { x, y };
      }
  return undefined;
}

function rigged(seed: string, at: { x: number; y: number }): WorldState {
  const w = gameEngine.createWorld(seed, CAMPAIGN_START);
  cmd(w, "rig.spud", at);
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  return w;
}

describe("cable-tool drilling", () => {
  it("raising a derrick costs money and three days", () => {
    const at = { x: SURVEYS[4]!.poly[0]![0] + 0.2, y: SURVEYS[4]!.poly[0]![1] + 0.2 };
    const w = gameEngine.createWorld("00000000000000aa", CAMPAIGN_START);
    cmd(w, "rig.spud", { x: (SURVEYS[4]!.poly[0]![0] + SURVEYS[4]!.poly[2]![0]) / 2, y: (SURVEYS[4]!.poly[0]![1] + SURVEYS[4]!.poly[2]![1]) / 2 });
    expect(operationsOf(w).cash).toBe(STARTING_CASH - COSTS.rigUp);
    expect(operationsOf(w).well!.status).toBe("rigging");
    const { interrupted } = gameEngine.advance(w, w.time + 4 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    expect(interrupted).toBe(true);
    expect(operationsOf(w).well!.status).toBe("drilling");
    expect(cmd(w, "rig.spud", at).events[0]!.type).toBe("command.rejected");
  });

  it("makes no hole unless the line is fed; feeding by feel makes hole fastest", () => {
    const at = { x: (SURVEYS[8]!.poly[0]![0] + SURVEYS[8]!.poly[2]![0]) / 2, y: (SURVEYS[8]!.poly[0]![1] + SURVEYS[8]!.poly[2]![1]) / 2 };
    const idle = rigged("00000000000000bb", at);
    gameEngine.advance(idle, idle.time + 12 * 60);
    expect(operationsOf(idle).well!.depthFt).toBeLessThan(2);

    const run = (policy: "feel" | "overfeed") => {
      const w = rigged("00000000000000bb", at);
      for (let m = 0; m < 12 * 60; m += 5) {
        const well = operationsOf(w).well!;
        const slack = well.reachFt - well.depthFt;
        const want = policy === "feel" ? slack < SWEET_FT * 0.5 : true;
        if (want !== well.feeding) cmd(w, "rig.feed", { on: want });
        gameEngine.advance(w, w.time + 5);
      }
      return operationsOf(w).well!.depthFt;
    };
    const feel = run("feel"), over = run("overfeed");
    expect(feel).toBeGreaterThan(20);
    expect(feel).toBeGreaterThan(over * 1.3);
  });

  it("bailer samples report the rock the bit was in, and bailing clears the cuttings", () => {
    const seed = "00000000000000cc";
    const at = { x: (SURVEYS[10]!.poly[0]![0] + SURVEYS[10]!.poly[2]![0]) / 2, y: (SURVEYS[10]!.poly[0]![1] + SURVEYS[10]!.poly[2]![1]) / 2 };
    const w = rigged(seed, at);
    cmd(w, "rig.auto", { on: true });
    gameEngine.advance(w, w.time + 5 * MINUTES_PER_DAY);
    const samples = knowledgeOf(w).evidence.filter((e) => e.kind === "sample");
    expect(samples.length).toBeGreaterThan(3);
    const t = generateGeology(seed);
    for (const s of samples) {
      if (s.kind !== "sample") continue;
      const truth = rockAt(t, at.x, at.y, ftToM(Math.max(s.topFt, s.baseFt - 1))).lithology;
      expect(s.lith).toBe(truth === "caprock" ? "rock" : truth);
    }
  });

  it("strikes oil or gas only where the ground truly holds it", () => {
    let gushers = 0;
    for (let i = 0; i < 40 && gushers < 6; i++) {
      const seed = (0x6e5e0000 + i).toString(16).padStart(16, "0");
      const site = oilSite(seed);
      if (!site) continue;
      const w = rigged(seed, site);
      cmd(w, "rig.auto", { on: true });
      for (let d = 0; d < 80; d++) {
        gameEngine.advance(w, w.time + MINUTES_PER_DAY);
        const well = operationsOf(w).well!;
        if (well.status === "stuck") cmd(w, "rig.fish");
        if (well.status === "gusher" || well.status === "dry") break;
      }
      const well = operationsOf(w).well!;
      if (well.status !== "gusher") continue;
      gushers++;
      const fluid = rockAt(generateGeology(seed), well.x, well.y, ftToM(well.depthFt)).fluid;
      expect(["oil", "gas"]).toContain(fluid);
    }
    expect(gushers).toBeGreaterThan(2);
  });

  it("ends the well when the money runs out", () => {
    const at = { x: (SURVEYS[6]!.poly[0]![0] + SURVEYS[6]!.poly[2]![0]) / 2, y: (SURVEYS[6]!.poly[0]![1] + SURVEYS[6]!.poly[2]![1]) / 2 };
    const w = rigged("00000000000000dd", at);
    gameEngine.advance(w, w.time + 200 * MINUTES_PER_DAY);
    expect(operationsOf(w).cash).toBe(0);
    expect(operationsOf(w).well!.status).toBe("dry");
  });
});
