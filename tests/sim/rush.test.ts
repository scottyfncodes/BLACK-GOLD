import { describe, expect, it } from "vitest";
import { gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, type NewsEvidence, type WorldState } from "../../src/sim";
import { excitement, chooseSite } from "../../src/sim/rush/decide";
import { v8ToV9 } from "../../src/sim/migrations";
import type { FieldState } from "../../src/sim/hidden/reservoir";
import { columnAt, generateGeology, isCharged } from "../../src/sim/geology/truth/model";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { printedMap } from "../../src/sim/surface/print";

/**
 * M8b, the Rush: only a public strike brings other operators; they decide from public facts;
 * their wells meet the same ground and draw the same tanks; their strikes and dry holes are news.
 * Truth is read here only to set up worlds and to check the accounting.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const field = (w: WorldState) => (w.systems.operations as unknown as { field: FieldState }).field;

/** Drill to the end at (x, y) with the driller, declining money counsel; cap if oil. */
function drillAt(w: WorldState, x: number, y: number): string | undefined {
  const s = SURVEYS.find((v) => insidePoly(v.poly, x, y))!;
  cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
  if (cmd(w, "rig.spud", { x, y }).events.some((e) => e.type === "command.rejected")) return undefined;
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let k = 0; k < 300 && !["gusher", "dry"].includes(operationsOf(w).well!.status); k++) {
    gameEngine.advance(w, w.time + MINUTES_PER_DAY, { stopOnInterrupt: true });
    const p = operationsOf(w).crew.pending;
    if (p) cmd(w, p.kind === "quit" || p.kind === "decide" ? "crew.decline" : "crew.accept", { id: p.id });
    if (operationsOf(w).well!.status === "stuck" && !operationsOf(w).crew.pending) cmd(w, "rig.fish");
  }
  const out = operationsOf(w).well!.outcome;
  if (out?.startsWith("OIL")) cmd(w, "prod.cap");
  return out;
}

/** A world and a site over shallow oil at a dome's crest (truth, test only). */
function strikeWorld(): WorldState {
  for (let i = 0; i < 400; i++) {
    const seed = (0x0b10000 + i).toString(16).padStart(16, "0");
    const t = generateGeology(seed);
    for (const d of t.domes.filter(isCharged)) {
      if (!SURVEYS.some((s) => insidePoly(s.poly, d.x, d.y))) continue;
      if (columnAt(t, d.x, d.y, 300).find((iv) => iv.fluid === "oil" || iv.fluid === "gas")?.fluid !== "oil") continue;
      const w = gameEngine.createWorld(seed, 0);
      if (drillAt(w, d.x, d.y)?.startsWith("OIL") && operationsOf(w).production.producers.length) return w;
    }
  }
  throw new Error("no strike");
}

describe("the Rush", () => {
  it("does not come without a public strike: dry holes alone draw nobody", () => {
    const w = gameEngine.createWorld("b1ac6017d0000001", 0);
    const s = SURVEYS[3]!;
    const [x, y] = [s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length];
    drillAt(w, x, y);
    gameEngine.advance(w, w.time + 720 * MINUTES_PER_DAY);
    expect(operationsOf(w).rush.wells).toHaveLength(0);
    expect(knowledgeOf(w).evidence.some((e) => e.kind === "news")).toBe(false);
  });

  it("comes after a strike: derricks, news, leases the company cannot take, and wells on the same oil", () => {
    const w = strikeWorld();
    const before = field(w).taps.length;
    gameEngine.advance(w, w.time + 540 * MINUTES_PER_DAY);
    const r = operationsOf(w).rush;
    expect(r.wells.length).toBeGreaterThan(2);
    expect(r.operators.length).toBeGreaterThan(0);
    const news = knowledgeOf(w).evidence.filter((e): e is NewsEvidence => e.kind === "news");
    expect(news.some((n) => n.event === "spud")).toBe(true);
    // Every finished rival well is in the news, dry holes as well as strikes.
    for (const rv of r.wells.filter((x) => x.status !== "drilling")) expect(news.some((n) => n.wellId === rv.id && n.event === rv.status)).toBe(true);
    // A lease another operator holds cannot be taken.
    const held = r.leases.find((l) => l.until > w.time);
    if (held) expect(cmd(w, "lease.take", { surveyId: held.surveyId, offer: "asking" }).events.find((e) => e.type === "command.rejected")).toBeDefined();
    // Rival oil wells are open on the field's tanks, alongside the company's, and no tank gives more than it held.
    expect(field(w).taps.length).toBe(before + r.wells.filter((x) => x.status === "oil").length);
    for (const t of Object.values(field(w).tanks)) expect(t.drawnBbl).toBeLessThanOrEqual(t.originalBbl);
  });

  it("keeps a rival well's outcome hidden until it is done", () => {
    const w = strikeWorld();
    for (let d = 0; d < 400 && !operationsOf(w).rush.wells.some((x) => x.status === "drilling"); d++) gameEngine.advance(w, w.time + MINUTES_PER_DAY);
    const drilling = operationsOf(w).rush.wells.find((x) => x.status === "drilling")!;
    expect(drilling.depthFt).toBeNull();
    expect(operationsOf(w) as unknown as Record<string, unknown>).not.toHaveProperty("field");
    expect(knowledgeOf(w).evidence.some((e) => e.kind === "news" && e.wellId === drilling.id && e.event !== "spud")).toBe(false);
    gameEngine.advance(w, drilling.doneAt + 1);
    expect(operationsOf(w).rush.wells.find((x) => x.id === drilling.id)!.status).not.toBe("drilling");
  });

  it("a finished rival well's driller can be asked: his log is hearsay, in the company's records", () => {
    const w = strikeWorld();
    for (let d = 0; d < 600 && !operationsOf(w).rush.wells.some((x) => x.status !== "drilling"); d++) gameEngine.advance(w, w.time + MINUTES_PER_DAY);
    const done = operationsOf(w).rush.wells.find((x) => x.status !== "drilling")!;
    expect(cmd(w, "fieldwork.inquire", { wellId: done.id }).events.find((e) => e.type === "command.rejected")).toBeUndefined();
    gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY);
    const rec = knowledgeOf(w).evidence.find((e) => e.kind === "wellRecord" && e.wellId === done.id);
    expect(rec).toMatchObject({ provenance: "hearsay", depthFt: done.depthFt });
  });
});

describe("what draws operators", () => {
  const strike = { x: 10, y: 10, t: 0, result: "oil" as const, depthFt: 700 };
  it("a strike draws them, fading with time; dry holes around it cool them; gas draws less than oil", () => {
    expect(excitement([], 0)).toBe(0);
    expect(excitement([strike], 0)).toBeCloseTo(1);
    expect(excitement([strike], 240 * MINUTES_PER_DAY)).toBeLessThan(0.4);
    const dries = [1, 2, 3].map((k) => ({ x: 10 + k * 0.3, y: 10, t: 10, result: "dry" as const, depthFt: 900 }));
    expect(excitement([strike, ...dries], 20)).toBeLessThan(excitement([strike], 20));
    expect(excitement([{ ...strike, result: "gas" }], 0)).toBeLessThan(excitement([strike], 0));
    expect(excitement(dries, 20)).toBe(0);
  });

  it("never sites a well on the company's lease, another operator's lease, or on top of a well", () => {
    const seed = "b1ac6017d0000001";
    const s = SURVEYS[3]!;
    const [x, y] = [s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length];
    let u = 0.123;
    const rand = () => (u = (u * 9301 + 0.49297) % 1);
    for (let k = 0; k < 200; k++) {
      const site = chooseSite({ wells: [{ x, y, t: 0, result: "oil", depthFt: 700 }], allWells: [{ x, y }], print: printedMap(seed), companyLeased: [s.id], rivalLeases: [], operator: "the Gulf Coast Oil Co." }, rand);
      if (!site) continue;
      expect(site.surveyId).not.toBe(s.id);
      expect(Math.hypot(site.x - x, site.y - y)).toBeGreaterThanOrEqual(0.25);
    }
  });
});

describe("v8 → v9", () => {
  it("starts the field empty of rivals, idempotently", () => {
    const w = gameEngine.createWorld("b1ac6017d0000001", 0);
    const old = structuredClone(w) as unknown as { systems: { operations: Record<string, unknown> & { field: Record<string, unknown> } } };
    delete old.systems.operations.rush;
    delete old.systems.operations.field.pending;
    const up = v8ToV9(old as never) as unknown as WorldState;
    expect(operationsOf(up).rush.wells).toEqual([]);
    expect(field(up).pending).toEqual({});
    expect(v8ToV9(up as never)).toEqual(up);
  });
});
