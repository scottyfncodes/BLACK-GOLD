import { CommandRejected, type Json, type System } from "../../src/sim";

/**
 * Test-only system that exercises everything the engine guarantees: two persisted
 * random streams, self-rescheduling events at random intervals, commands that change
 * state, schedule follow-ups and can be rejected, and occasional interrupts.
 * It is never registered in the shipping game.
 */
export interface StressState {
  [key: string]: Json;
  ticks: number;
  sum: number;
  bumps: number;
  echoes: number;
  history: number[];
}

export function stressSystem(options: { meanIntervalMinutes: number; interruptEvery?: number }): System<StressState> {
  const span = Math.max(2, Math.round(options.meanIntervalMinutes * 2));
  return {
    id: "stress",
    initialState: () => ({ ticks: 0, sum: 0, bumps: 0, echoes: 0, history: [] }),
    init(ctx) {
      ctx.schedule(ctx.now + 1 + Math.floor(ctx.random("stress:interval") * span), "stress.tick");
    },
    events: {
      "stress.tick"(ctx) {
        const s = ctx.state;
        s.ticks++;
        const v = ctx.random("stress:value");
        s.sum += v;
        if (s.ticks % 97 === 0) {
          s.history.push(Math.floor(v * 1e6));
          if (s.history.length > 20) s.history.shift();
        }
        const interrupt = options.interruptEvery !== undefined && s.ticks % options.interruptEvery === 0;
        if (interrupt) ctx.emit({ type: "stress.alarm", severity: "warning", interrupt: true, data: { tick: s.ticks } });
        ctx.schedule(ctx.now + 1 + Math.floor(ctx.random("stress:interval") * span), "stress.tick");
      },
      "stress.echo"(ctx, payload) {
        ctx.state.echoes++;
        ctx.state.sum += typeof payload === "number" ? payload : 0;
      },
    },
    commands: {
      "stress.bump"(ctx, cmd) {
        const amount = typeof cmd.payload === "number" ? cmd.payload : NaN;
        if (!(amount >= 0)) throw new CommandRejected("amount must be a non-negative number");
        ctx.state.bumps++;
        ctx.state.sum += amount;
        // Commands can schedule consequences; their timing uses the world's own stream.
        ctx.schedule(ctx.now + 60 + Math.floor(ctx.random("stress:echo") * 600), "stress.echo", amount / 2);
      },
    },
  };
}

/** A deterministic, timestamped script of commands spread over `years`. */
export function commandScript(start: number, years: number) {
  const out = [];
  const minutes = years * 365 * 1440;
  for (let i = 0; i < 60; i++) {
    const t = start + Math.floor(((i * 7919) % 1000) / 1000 * minutes);
    out.push({ t, actor: "player", type: "stress.bump", payload: i % 11 === 0 ? -1 : (i % 7) + 0.25 });
  }
  return out.sort((a, b) => a.t - b.t);
}
