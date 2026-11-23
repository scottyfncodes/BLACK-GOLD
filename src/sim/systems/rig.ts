/**
 * Cable-tool drilling (docs/DESIGN.md §4.3), simplified for play but driven by the real ground.
 *
 * Every five game minutes the walking beam has struck a few hundred blows. How much hole they
 * make depends on:
 *   - contact: whether the temper screw has the tools just touching bottom (the player's
 *     rhythm), short of it (wasted blows) or with slack in the line (weak blows, crooked
 *     hole, stuck tools);
 *   - the rock at the bit (truth), the bit's sharpness, and the cuttings cushioning it.
 * Sands left uncased heave into the hole. Hydrocarbons are reached only where the truth has
 * them, and then the well comes in.
 */
import { CommandRejected, type Command, type Json, type System, type SystemContext } from "../core/engine";
import { MINUTES_PER_DAY, toCalendar } from "../core/time";
import { ftToM } from "../math/units";
import { SURVEYS, insidePoly } from "../../content/geography/surveys";
import { generateGeology, rockAt, type Lithology, type RockAt } from "../geology/truth/model";
import type { SampleEvidence } from "../knowledge/types";
import { accruedCents, COSTS, RIG_VALUE, STARTING_CASH, type Operation, type OperationsState, type Well } from "../operations";
import { cashCents, dollarsToCents, emptyLedger, pay, post } from "../company/ledger";

type Ctx = SystemContext<Json>;
const S = (ctx: Ctx) => ctx.state as unknown as OperationsState;

export const TICK_MINUTES = 5;
const H = TICK_MINUTES / 60;

/** Penetration (ft/hour) with a sharp bit, square blows and a clean hole. */
export const ROP: Record<Lithology, number> = { clay: 9, sand: 13, gravel: 7, caprock: 2.2, salt: 5 };
const WEAR: Record<Lithology, number> = { clay: 0.0016, sand: 0.003, gravel: 0.005, caprock: 0.02, salt: 0.002 };
/** How fast the temper screw lets out line while the driller feeds (ft/hour). */
export const FEED_RATE = 12;
/** The tools strike squarely while the line is let out up to this far past bottom (ft). */
export const SWEET_FT = 3;
export const MAX_DEPTH_FT = 2500;
const RIGUP_DAYS = 3;

const rock = (ctx: Ctx, w: Well, ft: number): RockAt => rockAt(generateGeology(ctx.seed), w.x, w.y, ftToM(ft));

/** How squarely the tools strike, from how far the line is let out past bottom. */
export function contactFor(slackFt: number): number {
  if (slackFt < 0) return Math.max(0, 1 + slackFt / 0.6);
  if (slackFt <= SWEET_FT) return 1;
  return Math.max(0.12, 1 - (slackFt - SWEET_FT) / 4);
}

function opMinutes(op: Operation, depthFt: number): number {
  const trip = depthFt / 100; // hundreds of feet of line to pull and run
  switch (op) {
    case "bail": return 20 + trip * 7;
    case "dress": return 90 + trip * 10;
    case "case": return 240 + trip * 25;
    case "fish": return 8 * 60;
    case "rigup": return RIGUP_DAYS * MINUTES_PER_DAY;
  }
}

function report(ctx: Ctx, kind: string, message: string, interrupt: boolean): void {
  ctx.emit({ type: "rig.report", severity: interrupt ? "notice" : "info", interrupt, data: { kind, message } });
}

function words(r: RockAt, near: { gas: boolean }): Pick<SampleEvidence, "lith" | "call" | "show"> {
  const lith = r.lithology === "caprock" ? "rock" : r.lithology === "gravel" ? "gravel" : r.lithology;
  let call = { clay: "blue clay", sand: "grey sand", gravel: "sand and gravel", caprock: "hard rock, gypsum and lime", salt: "rock salt" }[r.lithology];
  let show: SampleEvidence["show"];
  if (r.fluid === "sulphurWater") { call += ", sulphur water"; show = "sulphur"; }
  else if (r.fluid === "water" && r.lithology !== "clay") call += ", water";
  if (near.gas) { call += ", gas bubbling in the bailer"; show = "gas"; }
  return { lith: lith as SampleEvidence["lith"], call, ...(show ? { show } : {}) };
}

/** Gas leaks a little way up from a charged trap: a show before the pay. */
function gasBelow(ctx: Ctx, w: Well): boolean {
  for (let ft = w.depthFt; ft < w.depthFt + 40; ft += 5) {
    const r = rock(ctx, w, ft);
    if (r.fluid === "gas" || r.fluid === "oil") return true;
  }
  return false;
}

function bail(ctx: Ctx, w: Well): void {
  const st = S(ctx);
  const at = Math.max(w.lastBailFt, w.depthFt - 1);
  const r = rock(ctx, w, at);
  const sample: SampleEvidence = {
    id: `rs-${st.next++}`, t: ctx.now, provenance: "observed", kind: "sample", wellId: w.id, x: w.x, y: w.y,
    topFt: Math.round(w.lastBailFt), baseFt: Math.round(w.depthFt), ...words(r, { gas: gasBelow(ctx, w) }),
  };
  if (sample.baseFt > sample.topFt) st.samples.push(sample);
  w.fillFt = 0;
  w.lastBailFt = w.depthFt;
  w.reachFt = w.depthFt + 1;
  report(ctx, "bailed", `Bailed at ${Math.round(w.depthFt)} ft: ${sample.call}.`, false);
}

function finish(ctx: Ctx, w: Well, status: "gusher" | "dry", outcome: string): void {
  w.status = status;
  w.outcome = outcome;
  w.busy = null;
  w.feeding = false;
  report(ctx, status, outcome, true);
}

function drill(ctx: Ctx, w: Well): void {
  const here = rock(ctx, w, w.depthFt + 0.5);
  // The driller (if delegated) works the temper screw by feel, with a skilled hand's error.
  if (w.auto) {
    const want = w.depthFt + 1.2 + (ctx.random("rig:auto") - 0.5) * 2.4;
    w.reachFt = Math.min(w.reachFt + FEED_RATE * H, Math.max(w.reachFt, want));
    if (w.fillFt > 5.5) return startOp(ctx, w, "bail");
    if (w.sharp < 0.35) return startOp(ctx, w, "dress");
  } else if (w.feeding) w.reachFt += FEED_RATE * H;

  const slack = w.reachFt - w.depthFt;
  w.contact = contactFor(slack);
  const rop = (ROP[here.lithology] * (0.25 + 0.75 * w.sharp) * w.contact) / (1 + w.fillFt / 5);
  // The bit cannot cut below where the line lets it fall.
  const cut = Math.max(0, Math.min(rop * H, w.reachFt + 0.6 - w.depthFt));
  w.rop = cut / H;
  w.depthFt += cut;
  w.fillFt += cut * 0.12;
  w.sharp = Math.max(0, w.sharp - cut * WEAR[here.lithology]);
  if ((here.lithology === "sand" || here.lithology === "gravel") && w.depthFt > w.casedFt) w.openSandFt += cut;
  // Uncased sand heaves into the hole.
  w.fillFt += (w.openSandFt / 60) * 0.7 * H;

  // Stuck tools: slack line, heaving sand, a hole full of cuttings.
  const hazard = 0.0004 + 0.05 * Math.max(0, slack - SWEET_FT - 1) + 0.004 * (w.openSandFt / 40) + (w.fillFt > 10 ? 0.04 : 0);
  if (ctx.random("rig:stuck") < hazard * H) {
    w.status = "stuck";
    w.feeding = false;
    report(ctx, "stuck", `The tools are stuck at ${Math.round(w.depthFt)} ft${slack > SWEET_FT + 1 ? ": too much slack in the line" : w.openSandFt > 40 ? ": the sand has caved in on them" : ""}.`, true);
    return;
  }
  const atBit = rock(ctx, w, w.depthFt);
  if (atBit.fluid === "oil" || atBit.fluid === "gas") {
    finish(ctx, w, "gusher", atBit.fluid === "oil" ? `OIL. The ${w.name} came in at ${Math.round(w.depthFt)} ft and is flowing over the crown block.` : `GAS. The ${w.name} blew in a gas sand at ${Math.round(w.depthFt)} ft. Where there is gas, there may be oil.`);
    return;
  }
  if (w.depthFt >= MAX_DEPTH_FT) finish(ctx, w, "dry", `The ${w.name} reached ${MAX_DEPTH_FT} ft, as deep as these tools will go. A dry hole.`);
}

function startOp(ctx: Ctx, w: Well, op: Operation): void {
  w.busy = { op, until: ctx.now + Math.round(opMinutes(op, w.depthFt)) };
  w.feeding = false;
}

function complete(ctx: Ctx, w: Well, op: Operation): void {
  w.busy = null;
  switch (op) {
    case "rigup":
      w.status = "drilling";
      report(ctx, "rigged", `The derrick is up over the ${w.name}. Time to make hole.`, true);
      return;
    case "bail": return bail(ctx, w);
    case "dress":
      w.sharp = 1;
      w.reachFt = w.depthFt + 1;
      report(ctx, "dressed", "The bit is dressed and back on bottom.", false);
      return;
    case "case": {
      const st = S(ctx);
      const ft = Math.max(0, w.depthFt - w.casedFt);
      pay(st.ledger, ctx.now, "drilling", `Casing set from ${Math.round(w.casedFt)} to ${Math.round(w.depthFt)} ft in the ${w.name}`, "drilling", dollarsToCents(ft * COSTS.casingPerFt), { wellId: w.id, surveyId: w.surveyId });
      w.casedFt = w.depthFt;
      w.openSandFt = 0;
      w.reachFt = w.depthFt + 1;
      report(ctx, "cased", `Casing set to ${Math.round(w.depthFt)} ft. The sands above are shut off.`, false);
      return;
    }
    case "fish":
      if (ctx.random("rig:fish") < 0.6) {
        w.status = "drilling";
        w.reachFt = w.depthFt + 1;
        w.fillFt = Math.max(0, w.fillFt - 4);
        report(ctx, "fished", "The jars broke them loose. The tools are free.", true);
      } else report(ctx, "fishfail", "The fishing job failed. The tools are still fast in the hole.", true);
      return;
  }
}

/** Cash that can be spent now: the books less rig time run today and not yet entered. */
function available(st: OperationsState): number {
  return cashCents(st.ledger) - accruedCents(st);
}

export function nextMidnight(t: number): number {
  return (Math.floor(t / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** Enter the rig time run since the last posting as one line in the books. */
function flushRigTime(ctx: Ctx, dayOf: number): void {
  const st = S(ctx);
  const cents = accruedCents(st);
  const hours = Math.round((st.accrued.ticks * TICK_MINUTES) / 60);
  st.accrued.ticks = 0;
  if (cents <= 0) return;
  const c = toCalendar(Math.max(0, dayOf));
  const w = st.well ?? st.past[st.past.length - 1];
  pay(st.ledger, ctx.now, "operating", `Rig crew, fuel and water, ${c.day} ${MONTHS[c.month - 1]} (${hours} h)`, "operating", cents, w ? { wellId: w.id, surveyId: w.surveyId } : undefined);
}

function well(ctx: Ctx): Well {
  const w = S(ctx).well;
  if (!w || w.status === "gusher" || w.status === "dry") throw new CommandRejected("There is no well being drilled.");
  return w;
}

export const rig: System<Json> = {
  id: "operations",
  initialState: () => ({ ledger: emptyLedger(), accrued: { ticks: 0 }, well: null, past: [], samples: [], next: 1 }) as unknown as Json,
  init(ctx) {
    const st = S(ctx);
    post(st.ledger, ctx.now, "opening", "Capital paid in", [{ account: "cash", cents: dollarsToCents(STARTING_CASH) }, { account: "equity", cents: -dollarsToCents(STARTING_CASH) }]);
    post(st.ledger, ctx.now, "opening", "Cable-tool rig and tools, owned", [{ account: "equipment", cents: dollarsToCents(RIG_VALUE) }, { account: "equity", cents: -dollarsToCents(RIG_VALUE) }]);
    ctx.schedule(nextMidnight(ctx.now), "company.day");
  },
  events: {
    "company.day"(ctx) {
      // Rig time is entered in the books once a day, for the day just ended.
      flushRigTime(ctx, ctx.now - 1);
      ctx.schedule(nextMidnight(ctx.now), "company.day");
    },
    "rig.tick"(ctx) {
      const st = S(ctx);
      const w = st.well;
      if (!w || w.status === "gusher" || w.status === "dry") return;
      // The money is gone when today's rig time can no longer be paid.
      const perTick = (COSTS.perDay * 100) / 288;
      if (cashCents(st.ledger) - accruedCents(st) - perTick < 0) {
        flushRigTime(ctx, ctx.now);
        finish(ctx, w, "dry", `The money is gone. The ${w.name} is abandoned at ${Math.round(w.depthFt)} ft.`);
        return;
      }
      st.accrued.ticks++;
      if (w.busy && ctx.now >= w.busy.until) complete(ctx, w, w.busy.op);
      else if (!w.busy && w.status === "drilling") drill(ctx, w);
      // complete() and drill() may have ended the well; re-read its status.
      const status = w.status as Well["status"];
      if (status !== "gusher" && status !== "dry") ctx.schedule(ctx.now + TICK_MINUTES, "rig.tick");
    },
  },
  commands: {
    "rig.spud"(ctx, c: Command) {
      const st = S(ctx);
      if (st.well && st.well.status !== "gusher" && st.well.status !== "dry") throw new CommandRejected("You already have a well going.");
      const p = c.payload as { x?: unknown; y?: unknown };
      if (typeof p?.x !== "number" || typeof p?.y !== "number") throw new CommandRejected("Choose a place to drill.");
      const survey = SURVEYS.find((s) => insidePoly(s.poly, p.x as number, p.y as number));
      if (!survey) throw new CommandRejected("Drill on surveyed land.");
      if (available(st) < dollarsToCents(COSTS.rigUp)) throw new CommandRejected(`Raising a derrick costs $${COSTS.rigUp}. You have $${Math.floor(available(st) / 100)}.`);
      if (st.well) st.past.push(st.well);
      const n = st.past.length + 1;
      pay(st.ledger, ctx.now, "drilling", `Derrick raised for the ${survey.name} No. ${n}`, "drilling", dollarsToCents(COSTS.rigUp), { wellId: `ours-${n}`, surveyId: survey.id });
      st.well = {
        id: `ours-${n}`, name: `${survey.name} No. ${n}`, x: p.x, y: p.y, surveyId: survey.id, spudAt: ctx.now,
        status: "rigging", depthFt: 0, reachFt: 1, fillFt: 0, sharp: 1, casedFt: 0, openSandFt: 0,
        feeding: false, auto: false, busy: null, lastBailFt: 0, rop: 0, contact: 0,
      };
      startOp(ctx, st.well, "rigup");
      ctx.schedule(ctx.now + TICK_MINUTES, "rig.tick");
    },
    "rig.feed"(ctx, c: Command) {
      const w = well(ctx);
      w.feeding = (c.payload as { on?: unknown })?.on === true && w.status === "drilling" && !w.busy && !w.auto;
    },
    "rig.auto"(ctx, c: Command) {
      const w = well(ctx);
      w.auto = (c.payload as { on?: unknown })?.on === true;
      w.feeding = false;
    },
    "rig.bail"(ctx) {
      const w = well(ctx);
      if (w.busy || w.status !== "drilling") throw new CommandRejected("Not now.");
      startOp(ctx, w, "bail");
    },
    "rig.dress"(ctx) {
      const w = well(ctx);
      if (w.busy || w.status !== "drilling") throw new CommandRejected("Not now.");
      startOp(ctx, w, "dress");
    },
    "rig.case"(ctx) {
      const w = well(ctx);
      if (w.busy || w.status !== "drilling") throw new CommandRejected("Not now.");
      if (w.depthFt - w.casedFt < 20) throw new CommandRejected("The hole is already cased almost to bottom.");
      const cost = (w.depthFt - w.casedFt) * COSTS.casingPerFt;
      if (available(S(ctx)) < dollarsToCents(cost)) throw new CommandRejected(`Casing to bottom costs $${Math.ceil(cost)}.`);
      startOp(ctx, w, "case");
    },
    "rig.fish"(ctx) {
      const w = well(ctx);
      if (w.status !== "stuck" || w.busy) throw new CommandRejected("The tools are not stuck.");
      const st = S(ctx);
      if (available(st) < dollarsToCents(COSTS.fishing)) throw new CommandRejected(`A fishing job costs $${COSTS.fishing}.`);
      pay(st.ledger, ctx.now, "drilling", `Fishing job on the ${w.name}`, "drilling", dollarsToCents(COSTS.fishing), { wellId: w.id, surveyId: w.surveyId });
      startOp(ctx, w, "fish");
    },
    "rig.abandon"(ctx) {
      const w = well(ctx);
      finish(ctx, w, "dry", `The ${w.name} is plugged and abandoned at ${Math.round(w.depthFt)} ft.`);
    },
  },
};
