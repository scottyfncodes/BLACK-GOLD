import { assertGameTime, type GameTime } from "./time";
import { isSeed, streamInit, streamNextU32, type Seed, type StreamState } from "./rng";

/**
 * The simulation engine: a discrete-event scheduler over plain, serializable state.
 *
 * - The world is plain data (JSON-safe). It is owned by the engine and mutated in place
 *   by `advance`; callers clone or serialize it when they need a copy.
 * - Commands are the only way anything outside the sim changes the world.
 * - Systems never read the wall clock, `Math.random` or the DOM (enforced by lint).
 * - Advancing to T in one call or in many smaller calls gives the identical world.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Severity = "info" | "notice" | "warning" | "critical";

/** Something that happened, reported outward to the UI and kept in the world log. */
export interface SimEvent {
  t: GameTime;
  type: string;
  severity: Severity;
  /** True when the player should be asked to look: fast-forward stops here. */
  interrupt: boolean;
  data?: Json;
}

/** Something that will happen: an entry in the scheduler queue. */
export interface ScheduledEvent {
  at: GameTime;
  /** Tie-breaker: events at the same minute run in the order they were scheduled. */
  seq: number;
  type: string;
  payload: Json;
}

export interface Command {
  t: GameTime;
  actor: string;
  type: string;
  payload: Json;
}

export interface WorldState {
  seed: Seed;
  time: GameTime;
  seq: number;
  /** Binary min-heap ordered by (at, seq). */
  queue: ScheduledEvent[];
  rng: Record<string, StreamState>;
  log: SimEvent[];
  systems: Record<string, Json>;
}

export const LOG_LIMIT = 200;

export interface SystemContext<S extends Json> {
  readonly now: GameTime;
  readonly seed: Seed;
  state: S;
  schedule(at: GameTime, type: string, payload?: Json): void;
  emit(event: Omit<SimEvent, "t">): void;
  /** Uniform float in [0, 1) from the named, persisted stream. */
  random(stream: string): number;
}

export interface System<S extends Json = Json> {
  id: string;
  initialState(): S;
  /** Runs once when a new world is created. */
  init?(ctx: SystemContext<S>): void;
  events?: Record<string, (ctx: SystemContext<S>, payload: Json) => void>;
  commands?: Record<string, (ctx: SystemContext<S>, command: Command) => void>;
}

/** A system of any state type (handlers are contravariant in their state, so this is `any`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySystem = System<any>;

/** Thrown by a command handler to reject a command the player is not allowed to issue. */
export class CommandRejected extends Error {}

export interface AdvanceOptions {
  commands?: readonly Command[];
  /** Stop right after the first event or command that emits an interrupt. */
  stopOnInterrupt?: boolean;
}

export interface AdvanceResult {
  events: SimEvent[];
  interrupted: boolean;
}

export interface Engine {
  readonly systems: readonly AnySystem[];
  createWorld(seed: Seed, start: GameTime): WorldState;
  advance(world: WorldState, until: GameTime, options?: AdvanceOptions): AdvanceResult;
}

type Route = { system: AnySystem; handler: (ctx: SystemContext<Json>, arg: never) => void };

export function createEngine(systems: readonly AnySystem[]): Engine {
  const eventRoutes = new Map<string, Route>();
  const commandRoutes = new Map<string, Route>();
  const ids = new Set<string>();

  for (const system of systems) {
    if (ids.has(system.id)) throw new Error(`Duplicate system id "${system.id}"`);
    ids.add(system.id);
    for (const [type, handler] of Object.entries(system.events ?? {})) {
      if (eventRoutes.has(type)) throw new Error(`Event type "${type}" is handled twice`);
      eventRoutes.set(type, { system, handler });
    }
    for (const [type, handler] of Object.entries(system.commands ?? {})) {
      if (commandRoutes.has(type)) throw new Error(`Command type "${type}" is handled twice`);
      commandRoutes.set(type, { system, handler });
    }
  }

  function context(world: WorldState, system: AnySystem, out: SimEvent[]): SystemContext<Json> {
    return {
      get now() {
        return world.time;
      },
      seed: world.seed,
      get state() {
        return world.systems[system.id] as Json;
      },
      set state(value: Json) {
        world.systems[system.id] = value;
      },
      schedule(at, type, payload = null) {
        assertGameTime(at);
        if (at < world.time) throw new Error(`Cannot schedule "${type}" in the past (${at} < ${world.time})`);
        if (!eventRoutes.has(type)) throw new Error(`No system handles event "${type}"`);
        heapPush(world.queue, { at, seq: world.seq++, type, payload });
      },
      emit(event) {
        const e: SimEvent = { t: world.time, ...event };
        out.push(e);
        world.log.push(e);
        if (world.log.length > LOG_LIMIT) world.log.splice(0, world.log.length - LOG_LIMIT);
      },
      random(stream) {
        const s = (world.rng[stream] ??= streamInit(world.seed, stream));
        return streamNextU32(s) / 0x100000000;
      },
    };
  }

  return {
    systems,

    createWorld(seed, start) {
      if (!isSeed(seed)) throw new Error(`Invalid seed "${seed}"`);
      assertGameTime(start);
      const world: WorldState = { seed, time: start, seq: 0, queue: [], rng: {}, log: [], systems: {} };
      const out: SimEvent[] = [];
      for (const system of systems) {
        world.systems[system.id] = system.initialState();
        system.init?.(context(world, system, out));
      }
      return world;
    },

    advance(world, until, options = {}) {
      assertGameTime(until);
      if (until < world.time) throw new Error(`Cannot advance backwards (${until} < ${world.time})`);
      const commands = [...(options.commands ?? [])];
      if (options.stopOnInterrupt && commands.length > 0) {
        throw new Error("stopOnInterrupt cannot be combined with commands");
      }
      for (const c of commands) {
        assertGameTime(c.t);
        if (c.t < world.time || c.t > until) throw new Error(`Command "${c.type}" at ${c.t} is outside [${world.time}, ${until}]`);
        if (!commandRoutes.has(c.type)) throw new Error(`Unknown command "${c.type}"`);
      }
      // Stable sort keeps the caller's order for commands issued in the same minute.
      commands.sort((a, b) => a.t - b.t);

      const out: SimEvent[] = [];
      let ci = 0;
      for (;;) {
        const nextEvent = world.queue[0];
        const nextCommand = commands[ci];
        const eventDue = nextEvent !== undefined && nextEvent.at <= until;
        // An event at minute t runs before a command at minute t.
        const takeEvent = eventDue && (nextCommand === undefined || nextEvent.at <= nextCommand.t);

        const before = out.length;
        if (takeEvent) {
          const ev = heapPop(world.queue)!;
          world.time = ev.at;
          const route = eventRoutes.get(ev.type);
          if (!route) throw new Error(`No system handles event "${ev.type}"`);
          (route.handler as (ctx: SystemContext<Json>, p: Json) => void)(context(world, route.system, out), ev.payload);
        } else if (nextCommand !== undefined) {
          ci++;
          world.time = nextCommand.t;
          const route = commandRoutes.get(nextCommand.type)!;
          const ctx = context(world, route.system, out);
          try {
            (route.handler as (ctx: SystemContext<Json>, c: Command) => void)(ctx, nextCommand);
          } catch (err) {
            if (!(err instanceof CommandRejected)) throw err;
            ctx.emit({
              type: "command.rejected",
              severity: "warning",
              interrupt: false,
              data: { command: nextCommand.type, reason: err.message },
            });
          }
        } else {
          break;
        }

        if (options.stopOnInterrupt && out.slice(before).some((e) => e.interrupt)) {
          return { events: out, interrupted: true };
        }
      }
      world.time = until;
      return { events: out, interrupted: false };
    },
  };
}

function before(a: ScheduledEvent, b: ScheduledEvent): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq);
}

/** Schedule an event directly on a world (for save migrations, outside any system). */
export function insertScheduled(world: WorldState, at: GameTime, type: string, payload: Json = null): void {
  assertGameTime(at);
  heapPush(world.queue, { at, seq: world.seq++, type, payload });
}

function heapPush(h: ScheduledEvent[], e: ScheduledEvent): void {
  h.push(e);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!before(h[i]!, h[p]!)) break;
    [h[i], h[p]] = [h[p]!, h[i]!];
    i = p;
  }
}

function heapPop(h: ScheduledEvent[]): ScheduledEvent | undefined {
  const top = h[0];
  const last = h.pop();
  if (h.length === 0 || last === undefined) return top;
  h[0] = last;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < h.length && before(h[l]!, h[m]!)) m = l;
    if (r < h.length && before(h[r]!, h[m]!)) m = r;
    if (m === i) break;
    [h[i], h[m]] = [h[m]!, h[i]!];
    i = m;
  }
  return top;
}
