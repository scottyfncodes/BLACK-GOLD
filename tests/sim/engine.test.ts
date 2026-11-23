import { describe, expect, it } from "vitest";
import { CommandRejected, createEngine, fromCalendar, gameEngine, CAMPAIGN_START, toCalendar, type Json, type System } from "../../src/sim";

const SEED = "1890000000000001";

/** Records the order things happen in. */
function recorder(): System<{ order: string[] } & { [k: string]: Json }> {
  return {
    id: "rec",
    initialState: () => ({ order: [] }),
    init(ctx) {
      ctx.schedule(10, "rec.ev", "b");
      ctx.schedule(5, "rec.ev", "a");
      ctx.schedule(10, "rec.ev", "c");
    },
    events: {
      "rec.ev"(ctx, p) {
        ctx.state.order.push(`ev:${p}@${ctx.now}`);
      },
      "rec.alarm"(ctx) {
        ctx.emit({ type: "rec.alarm", severity: "critical", interrupt: true });
      },
    },
    commands: {
      "rec.cmd"(ctx, c) {
        if (c.payload === "bad") throw new CommandRejected("not allowed");
        ctx.state.order.push(`cmd:${c.payload}@${ctx.now}`);
      },
      "rec.arm"(ctx) {
        ctx.schedule(ctx.now + 100, "rec.alarm");
      },
    },
  };
}

describe("engine", () => {
  it("runs events in (time, scheduling order) and events before commands in the same minute", () => {
    const engine = createEngine([recorder()]);
    const w = engine.createWorld(SEED, 0);
    engine.advance(w, 20, {
      commands: [
        { t: 10, actor: "p", type: "rec.cmd", payload: "x" },
        { t: 7, actor: "p", type: "rec.cmd", payload: "y" },
      ],
    });
    expect((w.systems.rec as { order: string[] }).order).toEqual(["ev:a@5", "cmd:y@7", "ev:b@10", "ev:c@10", "cmd:x@10"]);
    expect(w.time).toBe(20);
  });

  it("turns a rejected command into a logged warning without changing state", () => {
    const engine = createEngine([recorder()]);
    const w = engine.createWorld(SEED, 0);
    const { events } = engine.advance(w, 1, { commands: [{ t: 1, actor: "p", type: "rec.cmd", payload: "bad" }] });
    expect(events).toEqual([{ t: 1, type: "command.rejected", severity: "warning", interrupt: false, data: { command: "rec.cmd", reason: "not allowed" } }]);
    expect(w.log).toHaveLength(1);
  });

  it("stops at the first interrupt when asked, and otherwise runs through it", () => {
    const engine = createEngine([recorder()]);
    const a = engine.createWorld(SEED, 0);
    engine.advance(a, 0, { commands: [{ t: 0, actor: "p", type: "rec.arm", payload: null }] });
    const b = structuredClone(a);

    const stopped = engine.advance(a, 1000, { stopOnInterrupt: true });
    expect(stopped.interrupted).toBe(true);
    expect(a.time).toBe(100);

    const through = engine.advance(b, 1000);
    expect(through.interrupted).toBe(false);
    expect(b.time).toBe(1000);
  });

  it("refuses to go backwards, schedule into the past, or run unknown commands", () => {
    const engine = createEngine([recorder()]);
    expect(() => engine.createWorld(SEED, 50)).toThrow(/Cannot schedule "rec.ev" in the past/);
    const w = engine.createWorld(SEED, 0);
    engine.advance(w, 50);
    expect(() => engine.advance(w, 49)).toThrow(/backwards/);
    expect(() => engine.advance(w, 60, { commands: [{ t: 60, actor: "p", type: "nope", payload: null }] })).toThrow(/Unknown command/);
    expect(() => engine.advance(w, 60, { commands: [{ t: 40, actor: "p", type: "rec.cmd", payload: 1 }] })).toThrow(/outside/);
    expect(() => createEngine([recorder(), recorder()])).toThrow(/Duplicate/);
  });

  it("keeps the world log bounded", () => {
    const engine = createEngine([recorder()]);
    const w = engine.createWorld(SEED, 0);
    const commands = Array.from({ length: 450 }, (_, i) => ({ t: i, actor: "p", type: "rec.cmd", payload: "bad" }));
    engine.advance(w, 500, { commands });
    expect(w.log).toHaveLength(200);
    expect(w.log.at(-1)!.t).toBe(449);
  });
});

describe("the shipping game's calendar", () => {
  it("announces exactly one new month, in order, for ten years", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const { events } = gameEngine.advance(w, fromCalendar(1900, 1, 1, 6, 0));
    const months = events.filter((e) => e.type === "calendar.newMonth").map((e) => e.data as { year: number; month: number });
    expect(months).toHaveLength(120);
    expect(months[0]).toEqual({ year: 1890, month: 2 });
    expect(months.at(-1)).toEqual({ year: 1900, month: 1 });
    for (const e of events) expect(toCalendar(e.t)).toMatchObject({ day: 1, hour: 0, minute: 0 });
  });
});
