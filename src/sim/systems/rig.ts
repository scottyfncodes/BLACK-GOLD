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
import { readSpot } from "../knowledge/reading";
import { accountOf, wellSpent } from "../company/account";
import { accruedCents, COSTS, emptyOutcome, RIG_VALUE, STARTING_CASH, type Operation, type OperationsState, type Well } from "../operations";
import { cashCents, debtCents, dollarsToCents, emptyLedger, pay, post, receive } from "../company/ledger";
import { rngUnit } from "../core/rng";
import { activeLease, askingTerms, emptyLeaseBook, ownerAccepts, REFUSAL_DAYS, surveyById, termEnd, type PublicNews } from "../company/leases";
import { printedMap } from "../surface/print";
import { CAP_COST, emptyProductionBook, HAULING_CENTS, oilPriceCents } from "../company/production";
import { drawDay, emptyField, openTap } from "../hidden/reservoir";
import { resolveRival } from "../hidden/rivals";
import { chooseSite, excitement, OPERATORS, RUSH } from "../rush/decide";
import { emptyRush, rivalHolder, type PublicWell, type RivalWell } from "../rush/types";
import { ACCRUAL_UNITS, RATE_PERCENT, BORROW_STEP_CENTS, creditLimitCents, dayAccrual, emptyBank, RIG_RESALE, STRIKES_TO_FORECLOSE, USED_RIG_PRICE } from "../company/bank";
import { CONTRACT_DAYS, CONTRACT_PAY, CONTRACT_WAGES, contractOffered, recoveryPaths, type Position } from "../company/recovery";
import { candidatesFor, dayRateCents, emptyCrew, emptyRecord, type Driller, type DrillerRecord } from "../company/crew";
import { abilityOf } from "../hidden/drillers";
import { assess, type Advice, type Observations } from "../company/judgement";
import { MAX_NOTES, type DeclineMemo, type DrillerNote, type Recommendation } from "../company/crew";
import { DRIVE, DRIVE_ALLOWANCE_FT, drivePipeCents, MAX_STRINGS, MIN_STRING_FT, PIPE, pullDays, SALVAGE, salvageFraction, stringCostCents, waterCut, type DriveJob } from "../company/casing";
import { seatSeals } from "../hidden/casing";
import { collapseSeverity, openRunning, runningAt } from "../hidden/quicksand";
import { SURVEYS as ALL_SURVEYS } from "../../content/geography/surveys";

type Ctx = SystemContext<Json>;
const S = (ctx: Ctx) => ctx.state as unknown as OperationsState;

export const TICK_MINUTES = 5;
/** Dollars and cents, as the books write them ("$12" or "$12.50"). */
const usd = (cents: number) => "$" + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
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
/** Sand working in under a shoe seated in sand counts as this much open sand (provisional). */
export const LEAK_FT = 18;
/**
 * Driving pipe (provisional rates; the practice is documented, docs/research §0). Feet an hour
 * the shoe goes down under the maul with no friction yet, by the ground at the shoe; running
 * sand gives way faster. Friction builds with the length driven: past a practical length of
 * about 80–100 ft (Isler 1902) the pipe goes down ever harder, a range, not a wall, set by the
 * pipe's size, the driller's hand and the ground.
 */
const DRIVE_RATE: Record<Lithology, number> = { sand: 3.2, gravel: 1.3, clay: 1.1, caprock: 0.12, salt: 0.25 };
const DRIVE_REACH_FT = 90;
/** Bigger pipe grips more ground. */
const DRIVE_DIAMETER = [0.85, 1.0, 1.15];
/** When he calls refusal (feet made in two hours, times this): a habit of temperament. */
const REFUSAL_CALL: Record<string, number> = { cautious: 1.5, economical: 1.15, methodical: 1.0, aggressive: 0.5 };
/** Running sand: how fast it flows into open hole (ft/hour at full strength), and how far it heaves up as the bailer comes out (ft). Provisional. */
const RUN_INFLOW = 14;
const RUN_HEAVE = 45;

/** An idle rig (nobody on the line, or stuck tools left waiting) stops the clock every three hours. */
export const IDLE_WARN_TICKS = 36;
/** Warn once a well when cash covers only this many more days of rig time. */
export const LOW_FUNDS_DAYS = 3;

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
    case "drive": return 240 + trip * 25;
    case "swage": return DRIVE.swageDays * MINUTES_PER_DAY;
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

/**
 * Chips of gypsum in the cuttings: over a salt stock they come more often as the rock nears
 * (within about a hundred feet), but the clays of the coast carry a little gypsum anywhere, so the
 * sign is no proof. Observation, with misses and false alarms.
 */
export const GYPSUM = { reachFt: 100, near: 0.25, close: 0.85, stray: 0.03 } as const;
function gypsumChips(ctx: Ctx, w: Well, here: RockAt): boolean {
  if (here.lithology === "caprock" || here.lithology === "salt") return false;
  let to: number | null = null;
  for (let ft = 5; ft <= GYPSUM.reachFt; ft += 5) if (rock(ctx, w, w.depthFt + ft).lithology === "caprock") { to = ft; break; }
  const p = to === null ? GYPSUM.stray : GYPSUM.near + (GYPSUM.close - GYPSUM.near) * (1 - to / GYPSUM.reachFt);
  return ctx.random("rig:gypsum") < p;
}

/**
 * A rainbow of oil on the bailer water: oil leaks up a little way from an oil-bearing bed into the
 * waters above it, so the film comes more often as the bit nears oil (within about 150 ft). Lignite
 * and old wood in the clays leave a stray film now and then, so it is no proof. Observation, with
 * misses and false alarms; the bed itself is never named.
 */
export const SHEEN = { reachFt: 150, near: 0.15, close: 0.7, stray: 0.02 } as const;
function oilSheen(ctx: Ctx, w: Well, here: RockAt): boolean {
  if (here.lithology === "salt" || here.fluid === "oil" || here.fluid === "gas") return false;
  let to: number | null = null;
  for (let ft = 5; ft <= SHEEN.reachFt; ft += 5) if (rock(ctx, w, w.depthFt + ft).fluid === "oil") { to = ft; break; }
  const p = to === null ? SHEEN.stray : SHEEN.near + (SHEEN.close - SHEEN.near) * (1 - to / SHEEN.reachFt);
  return ctx.random("rig:sheen") < p;
}

function bail(ctx: Ctx, w: Well): void {
  const st = S(ctx);
  const at = Math.max(w.lastBailFt, w.depthFt - 1);
  const r = rock(ctx, w, at);
  const said = words(r, { gas: gasBelow(ctx, w) });
  const gyp = gypsumChips(ctx, w, r);
  const sheen = oilSheen(ctx, w, r);
  const call = `${said.call}${gyp ? ", a few chips of gypsum" : ""}${sheen ? ", a rainbow of oil on the water" : ""}`;
  const sample: SampleEvidence = {
    id: `rs-${st.next++}`, t: ctx.now, provenance: "observed", kind: "sample", wellId: w.id, x: w.x, y: w.y,
    topFt: Math.round(w.lastBailFt), baseFt: Math.round(w.depthFt), ...said, call, ...(gyp ? { gypsum: true } : {}), ...(sheen ? { sheen: true } : {}),
  };
  if (sample.baseFt > sample.topFt) st.samples.push(sample);
  observeStrings(ctx, w);
  // How much sand came in beyond the cuttings since the last bail: the crew sees it in the bailer.
  const hours = Math.max(0.5, (ctx.now - (w.lastBailAt ?? w.spudAt)) / 60);
  w.lastInflow = Math.round(((w.sandInFt ?? 0) / hours) * 10) / 10;
  w.lastBailAt = ctx.now;
  // Running sand heaves up the hole as the bailer comes out (Isler: 30–40 ft at a touch of the tools).
  const run = openRunning(ctx.seed, w.x, w.y, w.casedFt, w.depthFt);
  const heave = run.peak > 0.2 ? Math.min(35, RUN_HEAVE * run.peak * run.peak * Math.min(1, run.ft / 30)) : 0;
  w.fillFt = heave;
  w.sandInFt = heave;
  w.lastBailFt = w.depthFt;
  w.reachFt = w.depthFt + 1;
  const tell = w.lastInflow >= 4 ? " The sand comes back in as fast as it is bailed." : w.lastInflow >= 1.5 ? " Sand keeps coming back into the hole." : "";
  const heaved = heave >= 6 ? ` It heaved up about ${Math.max(5, Math.round(heave / 5) * 5)} ft as the bailer came out.` : "";
  report(ctx, "bailed", `Bailed at ${Math.round(w.depthFt)} ft: ${sample.call}.${tell}${heaved}`, false);
}

/**
 * How the company's driller works the line: from his hidden ability and his temperament.
 * Temperament is a tendency (how far he leads the line, how soon he bails), not a skill.
 */
function habits(ctx: Ctx): { lead: number; spread: number; lapse: number; bailAt: number; dressAt: number } {
  const d = S(ctx).crew.driller, a = abilityOf(ctx.seed, d.id);
  const t = d.temperament;
  return {
    lead: 1.2 + (t === "aggressive" ? 0.5 : t === "cautious" ? -0.3 : 0),
    spread: 0.8 + 3.0 * (1 - a.feel),
    lapse: (1 - a.reliability) * 0.002,
    bailAt: 7.5 - 4 * a.judgement + (t === "methodical" ? -1.2 : t === "aggressive" ? 1 : 0),
    dressAt: 0.15 + 0.4 * a.judgement + (t === "cautious" ? 0.05 : t === "economical" ? -0.05 : 0),
  };
}

/** Unanswered advice lapses after this much play (minutes). */
export const ADVICE_LAPSE_MINUTES = 60;

/** Run the next string now (the player's order, his accepted advice, or his own judgement). */
function caseNow(ctx: Ctx, w: Well): void {
  if (w.busy || w.status !== "drilling" || w.drive) throw new CommandRejected("Not now.");
  if (w.strings.length >= MAX_STRINGS) throw new CommandRejected(`No smaller pipe will go inside the ${PIPE[MAX_STRINGS - 1]!.name}. The rest of this hole is open.`);
  if (w.depthFt - w.casedFt < MIN_STRING_FT) throw new CommandRejected("The hole is cased almost to bottom already.");
  const cost = stringCostCents(w.strings.length, Math.round(w.depthFt));
  if (available(S(ctx)) < cost) throw new CommandRejected(`The ${PIPE[w.strings.length]!.name} to ${Math.round(w.depthFt)} ft costs $${Math.ceil(cost / 100)}.`);
  startOp(ctx, w, "case");
}

/** Run a fishing job now. */
function fishNow(ctx: Ctx, w: Well, memo = ""): void {
  if (w.status !== "stuck" || w.busy) throw new CommandRejected("The tools are not stuck.");
  const st = S(ctx);
  if (w.collapse) {
    // Swaging the crushed pipe: dear, slow, and never a sure thing; after a few tries there is nothing to hold.
    if (w.collapse.attempts >= DRIVE.swageAttempts) throw new CommandRejected("There is nothing left in the hole to take hold of. The hole is lost.");
    if (available(st) < DRIVE.swageCents) throw new CommandRejected(`A swaging job costs $${DRIVE.swageCents / 100}.`);
    pay(st.ledger, ctx.now, "drilling", `Swaging job on the collapsed pipe in the ${w.name}${memo}`, "drilling", DRIVE.swageCents, { wellId: w.id, surveyId: w.surveyId });
    recordOf(st, w).fishing++;
    w.fishCount++;
    startOp(ctx, w, "swage");
    return;
  }
  if (available(st) < dollarsToCents(COSTS.fishing)) throw new CommandRejected(`A fishing job costs $${COSTS.fishing}.`);
  pay(st.ledger, ctx.now, "drilling", `Fishing job on the ${w.name}${memo}`, "drilling", dollarsToCents(COSTS.fishing), { wellId: w.id, surveyId: w.surveyId });
  recordOf(st, w).fishing++;
  w.fishCount++;
  startOp(ctx, w, "fish");
}

/** The drive head and clamps: reusable, bought once. */
function buyDriveHead(ctx: Ctx): void {
  const st = S(ctx);
  if (st.tools.driveHead) return;
  if (available(st) < DRIVE.headCents) throw new CommandRejected(`A drive head and clamps cost $${DRIVE.headCents / 100}.`);
  pay(st.ledger, ctx.now, "equipment", "Drive head and clamps, bought", "equipment", DRIVE.headCents);
  st.tools.driveHead = true;
}

/** What the pipe for driving the next string about 100 ft below the present bottom costs (cents). */
function driveEstimateCents(st: OperationsState, w: Well): number {
  return w.strings.length < MAX_STRINGS ? drivePipeCents(w.strings.length, Math.round(w.depthFt) + DRIVE_ALLOWANCE_FT) : 0;
}

/** Start driving the next string (the player's order, his accepted advice, or his own judgement). */
function driveNow(ctx: Ctx, w: Well): void {
  if (w.busy || w.status !== "drilling" || w.drive) throw new CommandRejected("Not now.");
  if (w.strings.length >= MAX_STRINGS) throw new CommandRejected(`No smaller pipe will go inside the ${PIPE[MAX_STRINGS - 1]!.name}. The rest of this hole is open.`);
  const st = S(ctx);
  if (!st.tools.driveHead) throw new CommandRejected(`Driving pipe needs a drive head and clamps ($${DRIVE.headCents / 100}).`);
  const est = driveEstimateCents(st, w);
  if (available(st) < est) throw new CommandRejected(`Drive pipe for about ${DRIVE_ALLOWANCE_FT} ft of driving, with its shoe, costs about $${Math.ceil(est / 100)}.`);
  startOp(ctx, w, "drive");
}

/** Feet the shoe has made in about the last two hours of driving. */
function madeLately(d: DriveJob): number {
  const back = d.log[Math.max(0, d.log.length - 3)];
  return back ? Math.max(0, d.shoeFt - back.ft) : 0;
}

/** The crew sees water rise wherever new hole is made through a water sand. */
function noteWater(w: Well, here: RockAt, cut: number): void {
  if (cut <= 0 || (here.lithology !== "sand" && here.lithology !== "gravel") || (here.fluid !== "water" && here.fluid !== "sulphurWater")) return;
  const last = w.waterFt[w.waterFt.length - 1];
  if (last && w.depthFt - cut - last[1] < 5) last[1] = w.depthFt;
  else w.waterFt.push([w.depthFt - cut, w.depthFt]);
}

/** One rig tick of driving: the shoe goes down, harder as the pipe takes hold; the joints and the pipe take the strain. */
function driveTick(ctx: Ctx, w: Well): void {
  const st = S(ctx);
  const d = w.drive!;
  if (d.refused && !d.pounding) return; // waiting on the call: rig time runs on
  const man = st.crew.driller, a = abilityOf(ctx.seed, man.id);
  const here = rock(ctx, w, d.shoeFt + 0.5);
  const s = runningAt(ctx.seed, w.x, w.y, d.shoeFt);
  const reach = DRIVE_REACH_FT * DRIVE_DIAMETER[d.size]! * (0.6 + 0.8 * a.feel) * (0.85 + 0.3 * rngUnit(ctx.seed, "drive", w.id, d.size));
  const fric = d.drivenFt / reach;
  const rate = (DRIVE_RATE[here.lithology] * (1 + 1.2 * s) * (0.8 + 0.3 * a.reliability)) / (1 + fric ** 4);
  const cut = rate * H;
  d.shoeFt += cut;
  d.drivenFt += cut;
  if (d.shoeFt > w.depthFt) {
    const made = d.shoeFt - w.depthFt;
    w.depthFt = d.shoeFt;
    noteWater(w, here, made);
    if (w.auto) recordOf(st, w).feet += made;
  }
  if (w.auto) recordOf(st, w).ticks++;
  w.rop = rate;
  w.fillFt = 0;
  const last = d.log[d.log.length - 1];
  if (!last || ctx.now - last.t >= 60) { d.log.push({ t: ctx.now, ft: Math.round(d.shoeFt * 10) / 10 }); if (d.log.length > 12) d.log.shift(); }
  const pipe = PIPE[d.size]!.name;
  // Every blow strains the joints a little; pounding past refusal strains them far more, and may crush the pipe.
  const excess = Math.max(0, fric - 1);
  const joint = (0.0015 * fric + (d.pounding ? 0.08 : 0.02) * excess) * (1.3 - a.reliability);
  const crush = (d.pounding ? 0.015 : 0.002) * excess * (0.4 + s + d.shoeFt / 1000) * (1.2 - 0.4 * a.reliability);
  if (ctx.random("rig:joint") < joint * H) {
    report(ctx, "parted", `The maul came down dead on the ${pipe}: a joint has parted somewhere above the shoe. It will drive no further.`, true);
    setDrive(ctx, w, true);
    return;
  }
  if (ctx.random("rig:crush") < crush * H) return collapseNow(ctx, w);
  const atShoe = rock(ctx, w, d.shoeFt);
  if (atShoe.fluid === "oil" || atShoe.fluid === "gas") {
    setDrive(ctx, w, false);
    finish(ctx, w, "gusher", atShoe.fluid === "oil" ? `OIL. The ${w.name} came in at ${Math.round(w.depthFt)} ft as the pipe went down, and is flowing over the crown block.` : `GAS. The ${w.name} blew in a gas sand at ${Math.round(w.depthFt)} ft as the pipe went down.`);
    return;
  }
  const lately = madeLately(d);
  if (d.log.length >= 3) d.peak = Math.max(d.peak ?? 0, lately);
  // Past refusal the pipe can stop altogether: then it is set where it stands.
  if (d.pounding && d.log.length >= 3 && lately < 0.1) {
    report(ctx, "refused", `The ${pipe} will not go another inch at ${Math.round(d.shoeFt)} ft. It is set there.`, true);
    setDrive(ctx, w, false);
    return;
  }
  // He calls refusal when the pipe has all but stopped: when, depends on his judgement and temper.
  if (!d.refused && d.drivenFt >= 10 && d.log.length >= 3) {
    // By the feel of the maul: the pipe going down a quarter as fast as it did, or barely at all.
    const callAt = Math.max(0.35, 0.25 * (d.peak ?? 0)) * (REFUSAL_CALL[man.temperament] ?? 1) * (1 + (rngUnit(ctx.seed, "refusal", w.id, d.size) - 0.5) * (1 - a.judgement) * 1.2);
    if (lately < callAt) {
      d.refused = true;
      report(ctx, "refusal", `The ${pipe} is going down hard: ${lately < 1 ? `${Math.max(1, Math.round(lately * 12))} inches` : `${lately.toFixed(1)} ft`} in two hours, ${Math.round(d.drivenFt)} ft driven. ${man.name} calls it refusal.`, !w.auto);
    }
  }
  if (w.depthFt >= MAX_DEPTH_FT) setDrive(ctx, w, false);
}

/** Settle the drive pipe against what was bought: unused joints go back; pipe driven past the allowance is paid for. */
function settleDrivePipe(ctx: Ctx, w: Well, shoe: number): number {
  const st = S(ctx), d = w.drive!;
  const cost = drivePipeCents(d.size, shoe);
  const diff = cost - d.paidCents, ref = { wellId: w.id, surveyId: w.surveyId };
  const pipe = PIPE[d.size]!.name;
  if (diff > 0) pay(st.ledger, ctx.now, "drilling", `${pipe} drive pipe driven past the joints brought out, to ${shoe} ft`, "drilling", diff, ref);
  else if (diff < 0) receive(st.ledger, ctx.now, "drilling", `Unused ${pipe} drive pipe returned to the supply house`, "drilling", -diff, ref);
  return cost;
}

/** The driven pipe is set where its shoe stands: paid for, and tested at the next bail. */
function setDrive(ctx: Ctx, w: Well, parted: boolean, quiet = false): void {
  const st = S(ctx);
  const d = w.drive!;
  const shoe = Math.round(d.shoeFt);
  const cost = settleDrivePipe(ctx, w, shoe);
  const pipe = PIPE[d.size]!.name;
  const seatCall = seatCallAt(st, w, shoe);
  w.strings.push({ size: d.size, seatFt: shoe, costCents: cost, setAt: ctx.now, seatCall, observed: "pending", pulled: false, method: "driven", drivenFt: Math.round(d.drivenFt), damage: parted ? "parted" : null });
  recordOf(st, w).strings++;
  w.drive = null;
  w.casedFt = shoe;
  w.depthFt = Math.max(w.depthFt, shoe);
  w.openSandFt = Math.max(0, w.depthFt - shoe);
  w.leakFt = parted ? LEAK_FT * 1.5 : seatSeals(ctx.seed, w.x, w.y, shoe) ? 0 : LEAK_FT;
  w.reachFt = w.depthFt + 1;
  w.fillFt = 0;
  w.sandInFt = 0;
  w.lastInflow = 0;
  w.lastBailAt = ctx.now;
  if (!parted && !quiet) report(ctx, "cased", `The ${pipe} drive pipe is set at ${shoe} ft, ${Math.round(d.drivenFt)} ft of it driven. The next bail will show whether it shuts off the water.`, false);
}

/** The pipe is crushed in the hole: the tools stop above the collapse. */
function collapseNow(ctx: Ctx, w: Well): void {
  const st = S(ctx);
  const d = w.drive!;
  const shoe = Math.round(d.shoeFt);
  const at = Math.max(Math.round(w.casedFt) + 1, Math.round(d.shoeFt - (0.2 + 0.6 * ctx.random("rig:crushAt")) * d.drivenFt));
  const cost = settleDrivePipe(ctx, w, shoe);
  const pipe = PIPE[d.size]!.name;
  w.strings.push({ size: d.size, seatFt: shoe, costCents: cost, setAt: ctx.now, seatCall: seatCallAt(st, w, shoe), observed: "sand", pulled: false, method: "driven", drivenFt: Math.round(d.drivenFt), damage: "collapsed" });
  recordOf(st, w).strings++;
  recordOf(st, w).stuck++;
  w.drive = null;
  w.status = "stuck";
  w.feeding = false;
  w.collapse = { atFt: at, attempts: 0 };
  report(ctx, "collapsed", `The ${pipe} has collapsed in the hole. The tools stop at about ${at} ft and will not pass. A swaging job might open it out; it might not.`, true);
}

function note(ctx: Ctx, wellId: string, kind: DrillerNote["kind"], text: string): void {
  const notes = S(ctx).crew.notes;
  notes.push({ t: ctx.now, wellId, kind, text });
  if (notes.length > MAX_NOTES) notes.splice(0, notes.length - MAX_NOTES);
}

/** What the driller can see of this hole and the purse: never the ground below the bit. */
function observe(st: OperationsState, w: Well, now: number): Observations {
  const own = st.samples.filter((s) => s.wellId === w.id);
  const last = own[own.length - 1];
  const lastWater = w.waterFt[w.waterFt.length - 1];
  const size = w.strings.length;
  return {
    depthFt: w.depthFt,
    casedFt: w.casedFt,
    stringsLeft: MAX_STRINGS - size,
    nextPipe: size < MAX_STRINGS ? PIPE[size]!.name : null,
    nextCostCents: size < MAX_STRINGS ? stringCostCents(size, Math.round(w.depthFt)) : 0,
    openSandFt: w.openSandFt,
    bottom: last ? { lith: last.lith, call: last.call, ft: last.baseFt } : null,
    waterSeen: w.waterFt.length > 0,
    waterShutOff: !!lastWater && w.strings.some((s) => !s.pulled && s.observed === "dry" && s.seatFt >= lastWater[1]),
    stuck: w.status === "stuck",
    fishCount: w.fishCount,
    cashCents: available(st),
    dayCents: dayRateCents(st.crew),
    fishingCents: dollarsToCents(COSTS.fishing),
    creditRoomCents: Math.max(0, creditLimitCents(st.bank, st.production, oilPriceCents(now)) - debtCents(st.ledger)),
    wellSpentCents: wellSpent(st, w),
    lastShow: lastShow(own),
    inflowFtHr: w.lastInflow ?? 0,
    driving: w.drive ? { pipe: PIPE[w.drive.size]!.name, shoeFt: w.drive.shoeFt, drivenFt: w.drive.drivenFt, lastTwoHoursFt: madeLately(w.drive), refused: w.drive.refused && !w.drive.pounding } : null,
    collapse: w.collapse ?? null,
    driveHead: st.tools.driveHead,
    nextDriveCents: driveEstimateCents(st, w) + (st.tools.driveHead ? 0 : DRIVE.headCents),
    swageCents: DRIVE.swageCents,
    ...groundOf(st, w, own, now),
  };
}

/** What the company's evidence says about this hole's ground, and what the bailer has shown of the rock. */
function groundOf(st: OperationsState, w: Well, own: readonly SampleEvidence[], now: number): Pick<Observations, "expect" | "rockDry" | "rockFt" | "inSalt" | "gypsumFt" | "sheenFt" | "paceFtDay"> {
  const r = readSpot(st.notebook, w.x, w.y);
  const rockS = own.find((s) => s.lith === "rock");
  const last = own[own.length - 1];
  const gyp = [...own].reverse().find((s) => s.gypsum);
  const sheen = [...own].reverse().find((s) => s.sheen);
  const drillingDays = Math.max(1, (now - w.spudAt) / MINUTES_PER_DAY - RIGUP_DAYS);
  return {
    expect: r.expect ? { lo: r.expect.rockFt[0], hi: r.expect.rockFt[1], basis: r.expect.basis } : null,
    rockDry: r.rockDry,
    rockFt: rockS ? rockS.topFt : null,
    inSalt: last?.lith === "salt",
    gypsumFt: gyp ? gyp.baseFt : null,
    sheenFt: sheen ? sheen.baseFt : null,
    paceFtDay: Math.max(10, w.depthFt / drillingDays),
  };
}

/** The deepest show the bailer has brought up in this hole. */
function lastShow(own: readonly SampleEvidence[]): Observations["lastShow"] {
  for (let i = own.length - 1; i >= 0; i--) {
    const s = own[i]!;
    if (s.show) return { kind: s.show, ft: s.baseFt };
  }
  return null;
}

/** The circumstances a recommendation was made in, to tell when they have materially changed. */
function circumstances(st: OperationsState, w: Well): DeclineMemo {
  // Cash in hand, as he judges it: credit counts only once it is borrowed.
  const capital = available(st);
  return { depthFt: w.depthFt, openSandFt: w.openSandFt, strings: w.strings.length, stuckCount: w.fishCount + (w.status === "stuck" ? 1 : 0), capitalCents: capital, drivenFt: w.drive?.drivenFt ?? 0 };
}

/** A declined recommendation stays declined until the hole has changed enough to matter. */
function stillDeclined(m: DeclineMemo | undefined, now: DeclineMemo, kind: Advice["kind"]): boolean {
  if (!m) return false;
  if (kind === "case" || kind === "drive") return m.strings === now.strings && now.depthFt < m.depthFt + 100 && now.openSandFt < m.openSandFt + 50;
  // Told to drive on past refusal, he lets the pipe go another 15 ft before he calls it again.
  if (kind === "setdrive") return (now.drivenFt ?? 0) < (m.drivenFt ?? 0) + 15;
  // Told once to drill on, he raises money again only when the cash in hand has fallen by a third, or the hole is 300 ft deeper.
  if (kind === "quit" || kind === "decide") return now.depthFt < m.depthFt + 300 && (now.capitalCents ?? 0) > (m.capitalCents ?? 0) * (2 / 3);
  return m.stuckCount === now.stuckCount && m.strings === now.strings;
}

function decline(ctx: Ctx, r: Recommendation): void {
  const st = S(ctx);
  const w = st.well;
  st.crew.pending = null;
  if (w) st.crew.declined[r.kind] = circumstances(st, w);
  if (r.kind === "setdrive" && w?.drive) w.drive.pounding = true;
  note(ctx, r.wellId, "advice", r.kind === "case" ? "No pipe, then. I'll drill on." : r.kind === "drive" ? "No drive pipe, then. I'll drill on." : r.kind === "setdrive" ? "Drive on, then. I'll keep the maul going." : r.kind === "fish" ? "No fishing job, then." : "We'll keep at it, then.");
}

/** The recovery reserve: his own spending never leaves less than this in hand. */
function reserveCents(st: OperationsState): number {
  return CONTRACT_WAGES * 100 + 3 * dayRateCents(st.crew);
}

/**
 * The driller with the tools looks at the hole and, when he sees cause, recommends: asking
 * first, or acting within the month's budget if trusted to. He does not repeat himself.
 */
function consult(ctx: Ctx, w: Well): void {
  const st = S(ctx);
  const crew = st.crew;
  const status = w.status as Well["status"];
  // Advice left unanswered while an hour of play ran on is taken as "drill on"; so is advice the hole has outrun.
  if (crew.pending && (crew.pending.wellId !== w.id || ctx.now > crew.pending.t + ADVICE_LAPSE_MINUTES || status === "gusher" || status === "dry" || !w.auto)) decline(ctx, crew.pending);
  if (crew.pending) return;
  if (!w.auto || w.busy || (status !== "drilling" && status !== "stuck")) return;
  const a = abilityOf(ctx.seed, crew.driller.id);
  const bucket = Math.floor(w.depthFt / 25);
  const advice = assess(observe(st, w, ctx.now), a, crew.driller.temperament, rngUnit(ctx.seed, "judge", w.id, bucket), rngUnit(ctx.seed, "judge2", w.id, bucket));
  if (!advice) return;
  if (stillDeclined(crew.declined[advice.kind], circumstances(st, w), advice.kind)) return;
  // Trusted to judge: act within this month's budget, never below the recovery reserve.
  const c = toCalendar(ctx.now), month = c.year * 12 + (c.month - 1);
  if (crew.orders.month !== month) { crew.orders.month = month; crew.orders.spentCents = 0; }
  const within = crew.orders.spentCents + advice.costCents <= crew.orders.budgetCents;
  const reserve = available(st) - advice.costCents >= reserveCents(st);
  const spends = advice.kind === "case" || advice.kind === "fish" || advice.kind === "drive";
  // Setting driven pipe at refusal costs nothing more: trusted, he makes that call himself.
  if (crew.orders.authority === "judgement" && advice.kind === "setdrive") {
    setDrive(ctx, w, false);
    note(ctx, w.id, "acted", `${advice.text} Done, on my own judgement.`);
    return;
  }
  if (crew.orders.authority === "judgement" && spends && within && reserve) {
    try {
      const pipe = PIPE[w.strings.length]?.name ?? "pipe";
      if (advice.kind === "case") caseNow(ctx, w);
      else if (advice.kind === "drive") { buyDriveHead(ctx); driveNow(ctx, w); }
      else fishNow(ctx, w, " (on the driller's judgement)");
      crew.orders.spentCents += advice.costCents;
      note(ctx, w.id, "acted", `${advice.text} Done, on my own judgement.`);
      notice(ctx, `${crew.driller.name}: ${advice.kind === "case" ? `ran the ${pipe}` : advice.kind === "drive" ? `began driving the ${pipe}` : "a fishing job"} on his own judgement, about $${Math.ceil(advice.costCents / 100)}.`);
      return;
    } catch (err) {
      if (!(err instanceof CommandRejected)) throw err;
    }
  }
  const why = crew.orders.authority === "judgement" && spends ? (!within ? " That is past this month's allowance, so I'm asking." : !reserve ? " That would leave too little in hand, so I'm asking." : "") : "";
  crew.pending = { id: crew.nextId++, kind: advice.kind, t: ctx.now, wellId: w.id, text: advice.text + why, costCents: advice.costCents };
  note(ctx, w.id, "advice", advice.text);
  ctx.emit({ type: "driller.advice", severity: "notice", interrupt: true, data: { id: crew.pending.id, kind: advice.kind, message: `${crew.driller.name}: ${advice.text}${why}` } });
}

/** Men looking for work in Beaumont: a fresh handful each month. */
function refreshCandidates(ctx: Ctx): void {
  const st = S(ctx);
  const c = toCalendar(ctx.now), month = c.year * 12 + (c.month - 1);
  if (st.crew.candidatesMonth === month) return;
  st.crew.candidatesMonth = month;
  st.crew.candidates = candidatesFor(ctx.seed, month).filter((d: Driller) => d.id !== st.crew.driller.id);
}

/** The record of the driller in charge of a well. */
function recordOf(st: OperationsState, w: Well): DrillerRecord {
  return (st.crew.records[w.driller] ??= emptyRecord());
}

/** The rock at a depth as this well's bailer described it, or null if that depth was never bailed. */
function seatCallAt(st: OperationsState, w: Well, ft: number): string | null {
  for (let i = st.samples.length - 1; i >= 0; i--) {
    const s = st.samples[i]!;
    if (s.wellId === w.id && s.topFt - 2 <= ft && ft <= s.baseFt + 2) return s.call;
  }
  return null;
}

/** The first bail after a string is set shows what it does: the hole bails dry, or it does not. */
function observeStrings(ctx: Ctx, w: Well): void {
  for (const s of w.strings) {
    if (s.observed !== "pending" || s.pulled) continue;
    const sealed = !s.damage && seatSeals(ctx.seed, w.x, w.y, s.seatFt);
    const waterAbove = w.waterFt.some(([top]) => top < s.seatFt);
    s.observed = sealed ? "dry" : waterAbove ? "water" : "sand";
    const rec = recordOf(S(ctx), w);
    if (sealed) rec.dryStrings++;
    else rec.leakyStrings++;
    report(ctx, "casing", sealed
      ? `The hole bails dry above the ${PIPE[s.size]!.name} shoe at ${s.seatFt} ft: the water behind it is shut off.`
      : waterAbove
        ? `Water still comes into the hole past the ${PIPE[s.size]!.name} at ${s.seatFt} ft. The pipe holds the walls up, but it is not shutting off the water.`
        : `Sand is still working in beneath the ${PIPE[s.size]!.name} shoe at ${s.seatFt} ft.`, false);
  }
}

/** Water sands the hole made water in above `payFt` that no sealed string shuts off. */
function openWaterSands(ctx: Ctx, w: Well, payFt: number): number {
  const sealed = w.strings.filter((s) => !s.pulled && !s.damage && seatSeals(ctx.seed, w.x, w.y, s.seatFt));
  return w.waterFt.filter(([, base]) => base <= payFt && !sealed.some((s) => s.seatFt >= base)).length;
}

/** What the company can reckon pulling this hole's casing would cost and fetch: from what it has seen. */
function pullReckoning(st: OperationsState): { wellId: string; costCents: number; valueCents: number } | null {
  const w = st.well;
  if (!w || (w.status !== "dry" && w.status !== "gusher") || w.pullingUntil) return null;
  if (st.production.producers.some((p) => p.wellId === w.id)) return null;
  const left = w.strings.filter((s) => !s.pulled);
  if (!left.length) return null;
  const valueCents = left.reduce((a, s) => a + Math.round(s.costCents * salvageFraction(s)), 0);
  return { wellId: w.id, costCents: pullDays(left) * dayRateCents(st.crew), valueCents };
}

function finish(ctx: Ctx, w: Well, status: "gusher" | "dry", outcome: string): void {
  const st0 = S(ctx);
  // The hole's account is written before the books close on it, and the company keeps it.
  const account = accountOf(st0, w, status === "dry" ? "dry" : outcome.startsWith("OIL") ? "oil" : "gas");
  st0.notebook.push({ ...account, id: `acct-${w.id}`, t: ctx.now });
  ctx.schedule(ctx.now, "knowledge.account", account as unknown as Json);
  const rec = recordOf(S(ctx), w);
  if (status === "gusher" && outcome.startsWith("OIL")) rec.oil++;
  else rec.dry++;
  w.status = status;
  w.outcome = outcome;
  w.busy = null;
  w.feeding = false;
  // Pipe being driven when the hole ends stays where it stands, settled against what was bought.
  if (w.drive) setDrive(ctx, w, false, true);
  // Advice about a hole that has ended is moot: it is withdrawn, not left waiting.
  const crew = S(ctx).crew;
  if (crew.pending?.wellId === w.id) crew.pending = null;
  report(ctx, status, outcome, true);
  review(ctx);
}

function drill(ctx: Ctx, w: Well): void {
  const here = rock(ctx, w, w.depthFt + 0.5);
  // The driller (if delegated) works the temper screw by his own feel and habits.
  if (w.auto) {
    const h = habits(ctx);
    let want = w.depthFt + h.lead + (ctx.random("rig:auto") - 0.5) * h.spread;
    // Now and then even a good man lets the line run slack for a spell.
    if (ctx.random("rig:lapse") < h.lapse) want += 4;
    w.reachFt = Math.min(w.reachFt + FEED_RATE * H, Math.max(w.reachFt, want));
    if (w.fillFt > h.bailAt) return startOp(ctx, w, "bail");
    if (w.sharp < h.dressAt) return startOp(ctx, w, "dress");
  } else if (w.feeding) w.reachFt += FEED_RATE * H;

  const slack = w.reachFt - w.depthFt;
  w.contact = contactFor(slack);
  if (w.auto) recordOf(S(ctx), w).ticks++;
  const rop = (ROP[here.lithology] * (0.25 + 0.75 * w.sharp) * w.contact) / (1 + w.fillFt / 5);
  // The bit cannot cut below where the line lets it fall.
  const cut = Math.max(0, Math.min(rop * H, w.reachFt + 0.6 - w.depthFt));
  w.rop = cut / H;
  w.depthFt += cut;
  if (w.auto) recordOf(S(ctx), w).feet += cut;
  w.fillFt += cut * 0.12;
  w.sharp = Math.max(0, w.sharp - cut * WEAR[here.lithology]);
  if ((here.lithology === "sand" || here.lithology === "gravel") && w.depthFt > w.casedFt) w.openSandFt += cut;
  // The crew sees water rise in the hole wherever it is drilled through a water sand.
  noteWater(w, here, cut);
  // Uncased sand heaves into the hole, and so does sand working in under a shoe seated in sand.
  // Running sand flows in besides, as fast as it is bailed where it is strong.
  const loose = w.openSandFt + w.leakFt;
  const run = openRunning(ctx.seed, w.x, w.y, w.casedFt, w.depthFt);
  const inflow = run.peak > 0.2 ? RUN_INFLOW * run.peak * Math.min(1.5, run.ft / 60) : 0;
  w.fillFt += ((loose / 60) * 0.7 + inflow) * H;
  w.sandInFt = (w.sandInFt ?? 0) + ((loose / 60) * 0.7 + inflow) * H;

  // Stuck tools: slack line, heaving sand, a hole full of cuttings; running sand buries them.
  const hazard = 0.0004 + 0.05 * Math.max(0, slack - SWEET_FT - 1) + 0.004 * (loose / 40) + (w.fillFt > 10 ? 0.04 : 0) + (inflow > 0 ? 0.008 * inflow + 0.004 * Math.max(0, w.fillFt - 10) : 0);
  if (ctx.random("rig:stuck") < hazard * H) {
    w.status = "stuck";
    w.feeding = false;
    recordOf(S(ctx), w).stuck++;
    report(ctx, "stuck", `The tools are stuck at ${Math.round(w.depthFt)} ft${slack > SWEET_FT + 1 ? ": too much slack in the line" : loose > 40 ? ": the sand has caved in on them" : ""}.`, true);
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
      report(ctx, "rigged", w.auto ? `The derrick is up over the ${w.name}. The driller is making hole.` : `The derrick is up over the ${w.name}. Take the controls, or let the driller work.`, true);
      return;
    case "bail": return bail(ctx, w);
    case "dress":
      w.sharp = 1;
      w.reachFt = w.depthFt + 1;
      report(ctx, "dressed", "The bit is dressed and back on bottom.", false);
      return;
    case "case": {
      const st = S(ctx);
      const size = w.strings.length;
      // The hole is bailed clean before pipe goes in, so the crew always sees what the shoe sits on.
      if (w.depthFt - w.lastBailFt >= 1) bail(ctx, w);
      // Let-down pipe hangs where running sand has closed the hole: it goes no further.
      const run = openRunning(ctx.seed, w.x, w.y, w.casedFt, w.depthFt);
      const hung = run.top !== null && run.top < w.depthFt - 5;
      const seatFt = hung ? Math.min(Math.round(w.depthFt), Math.round(run.top! + 2 + ctx.random("rig:hang") * 8)) : Math.round(w.depthFt);
      const cost = stringCostCents(size, seatFt);
      const seatCall = seatCallAt(st, w, seatFt);
      pay(st.ledger, ctx.now, "drilling", `Ran the ${PIPE[size]!.name} casing to ${seatFt} ft in the ${w.name}${hung ? ", where it hung up" : seatCall ? `, landed in ${seatCall.split(",")[0]}` : ""}`, "drilling", cost, { wellId: w.id, surveyId: w.surveyId });
      w.strings.push({ size, seatFt, costCents: cost, setAt: ctx.now, seatCall, observed: "pending", pulled: false, ...(hung ? { hung: true } : {}) });
      recordOf(st, w).strings++;
      // Mechanical: the pipe holds up every wall above its shoe. Hydraulic: only a seal stops the leak beneath.
      w.casedFt = seatFt;
      w.openSandFt = hung ? Math.max(0, w.depthFt - seatFt) : 0;
      w.leakFt = seatSeals(ctx.seed, w.x, w.y, seatFt) ? 0 : LEAK_FT;
      w.reachFt = w.depthFt + 1;
      // What the bailer showed before the pipe went in no longer describes the hole.
      if (!hung) w.lastInflow = 0;
      report(ctx, "cased", hung
        ? `The ${PIPE[size]!.name} hung up at ${seatFt} ft and would go no further: the sand has closed in on the hole below. It is set there.`
        : `The ${PIPE[size]!.name} is set to ${seatFt} ft. The next bail will show whether it shuts off the water.`, hung);
      return;
    }
    case "drive": {
      // The drive pipe is let down to where it stands (bottom, or where running sand has closed the hole), and the maul goes on it.
      const run = openRunning(ctx.seed, w.x, w.y, w.casedFt, w.depthFt);
      const stand = run.top !== null && run.top < w.depthFt - 5 ? Math.min(Math.round(w.depthFt), Math.round(run.top + 2 + ctx.random("rig:hang") * 8)) : Math.round(w.depthFt);
      // The pipe is bought for about 100 ft of driving below where it stands; what is not used goes back.
      const st = S(ctx), size = w.strings.length;
      const paid = drivePipeCents(size, stand + DRIVE_ALLOWANCE_FT);
      pay(st.ledger, ctx.now, "drilling", `Drive pipe and shoe for the ${PIPE[size]!.name} in the ${w.name}, to ${stand + DRIVE_ALLOWANCE_FT} ft`, "drilling", paid, { wellId: w.id, surveyId: w.surveyId });
      w.drive = { size, startFt: stand, shoeFt: stand, drivenFt: 0, log: [{ t: ctx.now, ft: stand }], refused: false, pounding: false, paidCents: paid };
      w.fillFt = 0;
      report(ctx, "driving", `The ${PIPE[w.drive.size]!.name} drive pipe is down to ${stand} ft${stand < w.depthFt - 5 ? ", where it hangs in the sand" : ""}, with the shoe on. The maul is on it.`, false);
      return;
    }
    case "swage": {
      const st = S(ctx);
      const c = w.collapse!;
      const a = abilityOf(ctx.seed, st.crew.driller.id);
      // How badly it is crushed is the ground's and the blow's doing (hidden); past a point nothing opens it.
      const sev = collapseSeverity(ctx.seed, w.id, c.atFt, runningAt(ctx.seed, w.x, w.y, c.atFt));
      const chance = sev >= 0.75 ? 0 : (1 - sev / 0.75) ** 0.6 * (0.45 + 0.5 * a.feel) * (1 - c.atFt / 3000) * (st.tools.driveHead ? 1 : 0.75) * 0.6 ** c.attempts;
      c.attempts++;
      if (rngUnit(ctx.seed, "swage", w.id, c.attempts) < chance) {
        w.status = "drilling";
        w.collapse = null;
        w.depthFt = c.atFt;
        w.lastBailFt = c.atFt;
        w.reachFt = c.atFt + 1;
        w.casedFt = c.atFt;
        w.openSandFt = 0;
        w.leakFt = LEAK_FT * 1.5;
        w.fillFt = 0;
        report(ctx, "swaged", `The swage has opened the crushed pipe at about ${c.atFt} ft. The hole below it is lost, but drilling can go on down inside the old pipe${w.strings.length < MAX_STRINGS ? `, with the ${PIPE[w.strings.length]!.name} next` : ", in open hole"}.`, true);
      } else {
        report(ctx, "swagefail", c.attempts >= DRIVE.swageAttempts ? "The swage would not open it, and there is nothing left in the hole to take hold of. The hole is lost." : "The swage would not open the crushed pipe. It is still shut.", true);
      }
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

/** A contract job ends: the operator pays, and the rig is the company's own again. */
function contractDue(ctx: Ctx): void {
  const st = S(ctx);
  if (!st.contract || ctx.now < st.contract.until) return;
  st.contract = null;
  receive(st.ledger, ctx.now, "operating", "Contract drilling for another operator, paid", "wages", dollarsToCents(CONTRACT_PAY));
  ctx.emit({ type: "company.notice", severity: "notice", interrupt: true, data: { message: `The contract is done: the operator paid $${CONTRACT_PAY}, and the rig is back.` } });
}

/** The company's position, for recovery and advice. Public information only. */
export function positionOf(st: OperationsState, seed: string, now: number): Position {
  const debt = debtCents(st.ledger);
  const w = st.well;
  const active = !!w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck");
  return {
    cashCents: available(st),
    creditRoomCents: Math.max(0, creditLimitCents(st.bank, st.production, oilPriceCents(now)) - debt),
    creditRoomWithRigCents: Math.max(0, creditLimitCents({ ...st.bank, rigOwned: true, rigBookCents: dollarsToCents(USED_RIG_PRICE) }, st.production, oilPriceCents(now)) - debt),
    rigOwned: st.bank.rigOwned,
    producers: st.production.producers.length,
    wellActive: active,
    uncappedOil: !!w && w.status === "gusher" && !!w.outcome?.startsWith("OIL") && !st.production.producers.some((p) => p.wellId === w.id),
    contractUntil: st.contract?.until ?? null,
    heldLeases: st.leases.leases.filter((l) => l.status === "active" && l.expiresAt > now).map((l) => l.surveyId),
    pull: pullReckoning(st),
    cheapestLease: () => {
      const print = printedMap(seed), nw = news(st);
      let best: { surveyId: string; cents: number } | null = null;
      for (const s of ALL_SURVEYS) {
        if (rivalHolder(st.rush, s.id, now)) continue;
        const t = askingTerms(s, print, nw);
        if (!best || t.askingCents < best.cents) best = { surveyId: s.id, cents: t.askingCents };
      }
      return best;
    },
    derrickCents: dollarsToCents(COSTS.rigUp),
    dayCents: dayRateCents(st.crew),
  };
}

/** If the company has no way forward left, the campaign ends here, and says so. */
function review(ctx: Ctx): void {
  const st = S(ctx);
  if (st.outcome.endedAt !== null) return;
  if (recoveryPaths(positionOf(st, ctx.seed, ctx.now)).length > 0) return;
  st.outcome.endedAt = ctx.now;
  st.outcome.ended = "bankrupt";
  ctx.emit({ type: "company.concluded", severity: "critical", interrupt: true, data: { message: "The company is finished: no oil, no money, and no credit left to try again." } });
}

/** Month end, bank: a lien takes oil revenue first; then the month's interest is charged. */
function settleBank(ctx: Ctx, month: string, oilNetCents: number): void {
  const st = S(ctx);
  if (st.bank.lien && oilNetCents > 0 && debtCents(st.ledger) > 0) {
    const take = Math.min(oilNetCents, debtCents(st.ledger), Math.max(0, cashCents(st.ledger) - accruedCents(st)));
    if (take > 0) pay(st.ledger, ctx.now, "bank", `Oil revenue taken by the bank under its lien, ${month}`, "loan", take);
    if (debtCents(st.ledger) === 0) { st.bank.lien = false; notice(ctx, "The bank's lien is lifted: the loan is clear."); }
  }
  const interest = Math.floor(st.bank.accrued / ACCRUAL_UNITS);
  st.bank.accrued -= interest * ACCRUAL_UNITS;
  if (interest <= 0) return;
  if (available(st) >= interest) {
    pay(st.ledger, ctx.now, "bank", `Interest to the bank, ${month}, at ${RATE_PERCENT}% a year`, "interest", interest);
    st.bank.strikes = 0;
    return;
  }
  // Unpaid: the interest is added to the loan, and the bank counts it against the company.
  post(st.ledger, ctx.now, "bank", `Interest unpaid, ${month}: added to the loan`, [{ account: "interest", cents: interest }, { account: "loan", cents: -interest }]);
  st.bank.strikes++;
  if (st.bank.strikes >= STRIKES_TO_FORECLOSE) foreclose(ctx);
  else ctx.emit({ type: "company.notice", severity: "warning", interrupt: true, data: { message: `The bank warns: ${month}'s interest went unpaid. Another month unpaid and it will foreclose on the rig.` } });
}

/**
 * The rig leaves the company, sold for what a used outfit fetches in Beaumont. `toLoanCents` of
 * the proceeds go to the bank first, the rest to cash, and the part of its book value the sale
 * does not recover is a loss against the company's capital.
 */
function disposeOfRig(st: OperationsState, t: number, category: "bank" | "equipment", memo: string, toLoanCents: number): void {
  const book = st.bank.rigBookCents, proceeds = dollarsToCents(RIG_RESALE);
  const lines: { account: "loan" | "cash" | "equipment" | "equity"; cents: number }[] = [];
  if (toLoanCents > 0) lines.push({ account: "loan", cents: toLoanCents });
  if (proceeds - toLoanCents !== 0) lines.push({ account: "cash", cents: proceeds - toLoanCents });
  lines.push({ account: "equipment", cents: -book });
  if (book - proceeds !== 0) lines.push({ account: "equity", cents: book - proceeds });
  post(st.ledger, t, category, memo, lines);
  st.bank.rigOwned = false;
  st.bank.rigBookCents = 0;
}

/** The bank takes the rig and sells it. The company keeps its land and wells; the way back stays open. */
function foreclose(ctx: Ctx): void {
  const st = S(ctx);
  const w = st.well;
  if (w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck")) {
    flushRigTime(ctx, ctx.now);
    finish(ctx, w, "dry", `The bank has seized the rig. The ${w.name} is abandoned at ${Math.round(w.depthFt)} ft.`);
  }
  // The bank sells the rig for what a used outfit fetches; the proceeds go against the loan,
  // any surplus to the company, and the rest of its book value is lost.
  const owed = debtCents(st.ledger);
  const hadRig = st.bank.rigOwned;
  if (hadRig) disposeOfRig(st, ctx.now, "bank", `Rig seized by the bank and sold for $${RIG_RESALE}`, Math.min(dollarsToCents(RIG_RESALE), owed));
  st.bank.strikes = 0;
  st.bank.lien = debtCents(st.ledger) > 0;
  const surplus = hadRig ? Math.max(0, dollarsToCents(RIG_RESALE) - owed) : 0;
  const sold = hadRig ? `The bank has foreclosed, taken the rig and sold it for $${RIG_RESALE}. ` : "The bank has foreclosed. ";
  ctx.emit({ type: "company.notice", severity: "critical", interrupt: true, data: { message: sold + (st.bank.lien ? "It will take oil revenue until the loan is clear. Your land is still yours." : `The loan is clear${surplus > 0 ? `, and $${(surplus / 100).toFixed(2)} left over was paid to the company` : ""}. Your land is still yours.`) } });
}

/**
 * Nobody may lose the company to a rig left standing. An idle rig (no hole made and nobody on
 * the line, or stuck tools left waiting) stops the clock every three hours, and the company is
 * warned once a well when only a few days of rig time are left.
 */
function guard(ctx: Ctx, w: Well, before: number): void {
  const st = S(ctx);
  const status = w.status as Well["status"];
  if (status === "gusher" || status === "dry") return;
  const idle = !w.busy && ((status === "drilling" && !w.auto && !w.feeding && w.depthFt - before < 1e-9) || status === "stuck");
  w.idleTicks = idle ? w.idleTicks + 1 : 0;
  if (idle && w.idleTicks % IDLE_WARN_TICKS === 0) {
    const hours = Math.round((w.idleTicks * TICK_MINUTES) / 60);
    report(ctx, "idle", status === "stuck"
      ? `The tools are still stuck in the ${w.name} and the crew is waiting (${hours} h). Rig time runs on at ${usd(dayRateCents(st.crew))} a day: fish for them or abandon the hole.`
      : `Nobody is working the line on the ${w.name} (${hours} h). Rig time runs on at ${usd(dayRateCents(st.crew))} a day: take the controls, or let the driller work.`, true);
  }
  const days = available(st) / dayRateCents(st.crew);
  if (!w.lowFundsWarned && status !== "rigging" && days < LOW_FUNDS_DAYS) {
    w.lowFundsWarned = true;
    const room = creditLimitCents(st.bank, st.production, oilPriceCents(ctx.now)) - debtCents(st.ledger);
    report(ctx, "lowfunds", room >= BORROW_STEP_CENTS
      ? `Money for less than ${LOW_FUNDS_DAYS} more days of rig time. Borrow from the bank to keep drilling, or plan to stop.`
      : `Money for less than ${LOW_FUNDS_DAYS} more days of rig time, and the bank will lend no more. Decide whether to stop.`, true);
  }
}

/** One day's oil from every capped well. */
function produceDay(ctx: Ctx): void {
  const st = S(ctx);
  // Every open well on the field draws on its tank together; the company sees only its own barrels.
  const flows = drawDay(st.field);
  // Other operators' oil goes to the same railhead: Beaumont's shipments are public.
  for (const w of st.rush.wells) if (w.status === "oil") st.rush.monthOthersBbl += flows[w.id] ?? 0;
  for (const p of st.production.producers) {
    const flow = flows[p.wellId] ?? 0;
    // Water from sands never shut off comes up with the oil and is let run to the pit.
    const bbl = Math.floor(flow * (1 - p.waterCut));
    if (p.cumBbl === 0 && p.lastDayBbl === 0) p.firstDayBbl = bbl;
    p.lastDayBbl = bbl;
    p.cumBbl += bbl;
    p.monthBbl += bbl;
  }
}

/** Month end. Oil: sold at the railhead, hauling and royalty paid, one entry each per well. */
function settleMonth(ctx: Ctx, dayOf: number): void {
  const st = S(ctx);
  const c = toCalendar(Math.max(0, dayOf));
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][c.month - 1];
  let oilNet = 0;
  for (const p of st.production.producers) {
    const bbl = p.monthBbl;
    p.monthBbl = 0;
    p.months.push(bbl);
    if (bbl <= 0) continue;
    const gross = bbl * oilPriceCents(dayOf);
    const ref = { wellId: p.wellId, surveyId: p.surveyId };
    receive(st.ledger, ctx.now, "production", `Oil sold at Beaumont, ${month}: ${bbl.toLocaleString("en-US")} bbl from the ${p.name}`, "oilSales", gross, ref);
    pay(st.ledger, ctx.now, "production", `Hauling to the railhead, ${month}: ${bbl.toLocaleString("en-US")} bbl`, "hauling", bbl * HAULING_CENTS, ref);
    const lease = st.leases.leases.find((l) => l.surveyId === p.surveyId);
    const owner = surveyById(p.surveyId)?.owner ?? "the owner";
    const royalty = Math.round(gross * (lease?.royalty ?? 1 / 8));
    pay(st.ledger, ctx.now, "production", `Royalty to ${owner}, ${month}: one-eighth`, "royalty", royalty, ref);
    oilNet += gross - bbl * HAULING_CENTS - royalty;
  }
  settleBank(ctx, month!, oilNet);
  // Beaumont's shipments from the field by other operators: public, monthly.
  const others = st.rush.monthOthersBbl;
  st.rush.lastMonthOthersBbl = others;
  st.rush.monthOthersBbl = 0;
  if (others > 0) tellNews(ctx, { event: "shipments", wellId: null, operator: null, surveyId: null, x: null, y: null, depthFt: null, bbl: others, text: `Other operators shipped ${others.toLocaleString("en-US")} bbl from the field to the railhead in ${month}.` });
}

// ── The Rush (M8b) ──────────────────────────────────────────────────────────────────────

/** A piece of news reaches Beaumont, and the company hears it. */
function tellNews(ctx: Ctx, n: { event: "spud" | "oil" | "gas" | "dry" | "shipments"; wellId: string | null; name?: string | null; operator: string | null; surveyId: string | null; x: number | null; y: number | null; depthFt: number | null; bbl: number | null; text: string }): void {
  ctx.schedule(ctx.now, "knowledge.news", { kind: "news", provenance: "hearsay", ...n, name: n.name ?? null } as unknown as Json);
  if (n.event !== "shipments") ctx.emit({ type: "rush.news", severity: "info", interrupt: n.event === "oil", data: { message: n.text } });
}

/** Every well whose end the county knows: the company's (from its accounts) and other operators'. */
function publicWells(st: OperationsState): PublicWell[] {
  const out: PublicWell[] = [];
  for (const e of st.notebook) if (e.kind === "account") out.push({ x: e.x, y: e.y, t: e.t, result: e.result, depthFt: e.deepestFt });
  for (const w of st.rush.wells) if (w.status !== "drilling") out.push({ x: w.x, y: w.y, t: w.doneAt, result: w.status, depthFt: w.depthFt ?? 0 });
  return out;
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One day of the Rush: rival leases lapse or are held; and, if the field draws them, an operator
 * spuds a new well where the public facts point. Its outcome is decided by the ground now and
 * kept hidden until the day the well is done. No strike, no Rush.
 */
function rushDay(ctx: Ctx): void {
  const st = S(ctx);
  const r = st.rush;
  const now = ctx.now;
  for (const l of r.leases) {
    if (l.until > now) continue;
    // Held while the operator has a well drilling or producing on it.
    if (r.wells.some((w) => w.surveyId === l.surveyId && w.operator === l.operator && (w.status === "drilling" || w.status === "oil"))) l.until = now + RUSH.leaseDays * MINUTES_PER_DAY;
  }
  r.leases = r.leases.filter((l) => l.until > now);
  const pw = publicWells(st);
  const heat = excitement(pw, now);
  if (heat <= 0) return;
  if (r.wells.filter((w) => w.status === "drilling").length >= RUSH.maxActive || r.wells.length >= RUSH.maxWells) return;
  if (ctx.random("rush:spud") >= Math.min(RUSH.maxPerDay, RUSH.perDay * heat)) return;
  // Who: a newcomer, or an operator already in the field.
  const fresh = OPERATORS.filter((o) => !r.operators.includes(o));
  const operator = r.operators.length === 0 || (fresh.length > 0 && ctx.random("rush:who") < RUSH.newcomer) ? fresh[Math.floor(ctx.random("rush:new") * fresh.length)]! : r.operators[Math.floor(ctx.random("rush:old") * r.operators.length)]!;
  const companyLeased = st.leases.leases.filter((l) => l.status === "active" && l.expiresAt > now).map((l) => l.surveyId);
  const wells = [...st.past, ...(st.well ? [st.well] : []), ...r.wells];
  const site = chooseSite({ wells: pw, allWells: wells, print: printedMap(ctx.seed), companyLeased, rivalLeases: r.leases, operator }, () => ctx.random("rush:site"));
  if (!site) return;
  if (!r.operators.includes(operator)) r.operators.push(operator);
  if (!rivalHolder(r, site.surveyId, now)) r.leases.push({ surveyId: site.surveyId, operator, since: now, until: now + RUSH.leaseDays * MINUTES_PER_DAY });
  const n = r.wells.filter((w) => w.operator === operator).length + 1;
  const id = `rv-${r.next++}`;
  const out = resolveRival(ctx.seed, site.x, site.y, ctx.random("rush:purse"), ctx.random("rush:luck"), ctx.random("rush:lost"));
  const doneAt = now + out.days * MINUTES_PER_DAY;
  const well: RivalWell = { id, name: `${operator}'s No. ${n}`, operator, surveyId: site.surveyId, x: site.x, y: site.y, spudAt: now, doneAt, status: "drilling", depthFt: null };
  r.wells.push(well);
  st.field.pending[id] = { result: out.result, depthFt: out.depthFt };
  ctx.schedule(doneAt, "rush.done", { id });
  const survey = surveyById(site.surveyId)?.name ?? "";
  tellNews(ctx, { event: "spud", wellId: id, name: well.name, operator, surveyId: site.surveyId, x: site.x, y: site.y, depthFt: null, bbl: null, text: `${cap1(operator)} is putting up a derrick on the ${survey} survey.` });
}

/** A rival well is done: what it found becomes known, and an oil well is opened on its tank. */
function rushDone(ctx: Ctx, id: string): void {
  const st = S(ctx);
  const w = st.rush.wells.find((x) => x.id === id);
  const out = st.field.pending[id];
  if (!w || !out || w.status !== "drilling") return;
  delete st.field.pending[id];
  w.status = out.result;
  w.depthFt = out.depthFt;
  if (out.result === "oil") openTap(st.field, ctx.seed, w.id, w.x, w.y, out.depthFt);
  const survey = surveyById(w.surveyId)?.name ?? "";
  const ft = out.depthFt.toLocaleString("en-US");
  const text = out.result === "oil" ? `${cap1(w.name)} on the ${survey} survey came in, flowing oil from ${ft} ft.` : out.result === "gas" ? `${cap1(w.name)} on the ${survey} survey blew in gas at ${ft} ft.` : `${cap1(w.name)} on the ${survey} survey was abandoned dry at ${ft} ft.`;
  tellNews(ctx, { event: out.result, wellId: w.id, name: w.name, operator: w.operator, surveyId: w.surveyId, x: w.x, y: w.y, depthFt: out.depthFt, bbl: null, text });
}

function notice(ctx: Ctx, message: string): void {
  ctx.emit({ type: "company.notice", severity: "notice", interrupt: false, data: { message } });
}

/** Extend a lease by one term, from its current expiry. */
function renew(ctx: Ctx, lease: { expiresAt: number; renewals: number; surveyId: string }, message: string): void {
  lease.expiresAt = termEnd(lease.expiresAt);
  lease.renewals++;
  ctx.schedule(lease.expiresAt, "lease.term", { surveyId: lease.surveyId });
  notice(ctx, message);
}

/** Public news: where the company's wells have come in with oil. */
function news(st: OperationsState): PublicNews {
  const wells = st.well ? [...st.past, st.well] : st.past;
  // Oil has come in nearby: the company's strikes and other operators' alike drive up the asking price.
  return { strikes: [...wells.filter((w) => w.status === "gusher" && w.outcome?.startsWith("OIL")).map((w) => ({ x: w.x, y: w.y })), ...st.rush.wells.filter((w) => w.status === "oil").map((w) => ({ x: w.x, y: w.y }))] };
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
  initialState: () => ({ ledger: emptyLedger(), accrued: { ticks: 0 }, leases: emptyLeaseBook(), production: emptyProductionBook(), bank: emptyBank(), contract: null, outcome: emptyOutcome(), crew: null, tools: { driveHead: false }, well: null, past: [], samples: [], notebook: [], field: emptyField(), rush: emptyRush(), next: 1 }) as unknown as Json,
  init(ctx) {
    const st = S(ctx);
    st.crew = emptyCrew(ctx.seed);
    refreshCandidates(ctx);
    post(st.ledger, ctx.now, "opening", "Capital paid in", [{ account: "cash", cents: dollarsToCents(STARTING_CASH) }, { account: "equity", cents: -dollarsToCents(STARTING_CASH) }]);
    post(st.ledger, ctx.now, "opening", "Cable-tool rig and tools, owned", [{ account: "equipment", cents: dollarsToCents(RIG_VALUE) }, { account: "equity", cents: -dollarsToCents(RIG_VALUE) }]);
    ctx.schedule(nextMidnight(ctx.now), "company.day");
  },
  events: {
    /** What fieldwork learned that bears on the company's holes: the driller is told. */
    "ops.learn"(ctx, payload) {
      const e = payload as unknown as OperationsState["notebook"][number];
      if (e && (e.kind === "reading" || e.kind === "wellRecord")) S(ctx).notebook.push(e);
    },
    /** The field party's errand is paid for as it sets out; if the money is not there, it stays home. */
    "ops.fieldExpense"(ctx, payload) {
      const st = S(ctx);
      const { cents, memo } = payload as { cents: number; memo: string };
      if (st.outcome.endedAt !== null || available(st) < cents) {
        ctx.schedule(ctx.now, "fieldwork.recall", { message: st.outcome.endedAt !== null ? "The company is finished; the party stays at home." : `The party stays at home: the errand costs ${usd(cents)}, and the company has not got it in hand.` });
        return;
      }
      pay(st.ledger, ctx.now, "fieldwork", memo, "fieldwork", cents);
    },
    "company.day"(ctx) {
      // Rig time is entered in the books once a day, for the day just ended.
      // One event, one fixed order: the day's rig time, the day's oil, then (on the first of
      // the month) the month's settlement.
      flushRigTime(ctx, ctx.now - 1);
      produceDay(ctx);
      rushDay(ctx);
      // Interest accrues daily on the loan, in exact integer units.
      S(ctx).bank.accrued += dayAccrual(debtCents(S(ctx).ledger));
      contractDue(ctx);
      if (toCalendar(ctx.now).day === 1) settleMonth(ctx, ctx.now - 1);
      refreshCandidates(ctx);
      review(ctx);
      ctx.schedule(nextMidnight(ctx.now), "company.day");
    },
    "rush.done"(ctx, payload) {
      rushDone(ctx, String((payload as { id?: string })?.id ?? ""));
    },
    "rig.pulled"(ctx, payload) {
      const st = S(ctx);
      const w = st.well;
      if (!w || w.id !== (payload as { wellId?: string })?.wellId || !w.pullingUntil) return;
      let cents = 0;
      for (const s of w.strings) {
        if (s.pulled) continue;
        cents += Math.round(s.costCents * (s.damage ? 0 : s.method === "driven" ? SALVAGE.drivenFraction : seatSeals(ctx.seed, w.x, w.y, s.seatFt) ? SALVAGE.sealedFraction : SALVAGE.sandFraction));
        s.pulled = true;
      }
      w.pullingUntil = null;
      // Casing was charged to drilling when it was run; what the pulled pipe fetches comes back there.
      if (cents > 0) receive(st.ledger, ctx.now, "equipment", `Casing pulled from the ${w.name}, sold`, "drilling", cents, { wellId: w.id, surveyId: w.surveyId });
      ctx.emit({ type: "company.notice", severity: "notice", interrupt: true, data: { message: `The casing is out of the ${w.name} and sold for $${(cents / 100).toFixed(2)}. The rig is free.` } });
    },
    "lease.term"(ctx, payload) {
      const st = S(ctx);
      const surveyId = (payload as { surveyId?: string })?.surveyId ?? "";
      const lease = st.leases.leases.find((l) => l.surveyId === surveyId && l.status === "active" && l.expiresAt === ctx.now);
      if (!lease) return;
      const name = surveyById(surveyId)?.name ?? "the";
      const w = st.well;
      // Held by operations: a well being drilled on the lease keeps it.
      if (w && w.surveyId === surveyId && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck")) {
        renew(ctx, lease, `The ${name} lease is held by the well being drilled on it.`);
        return;
      }
      // Held by production.
      if (st.production.producers.some((p) => p.surveyId === surveyId)) {
        renew(ctx, lease, `The ${name} lease is held by production.`);
        return;
      }
      const t = askingTerms(surveyById(surveyId)!, printedMap(ctx.seed), news(st));
      if (available(st) >= t.rentalCents) {
        pay(st.ledger, ctx.now, "lease", `Delay rental on the ${name} lease, one year`, "delayRental", t.rentalCents, { surveyId });
        renew(ctx, lease, `Paid $${t.rentalCents / 100} delay rental to keep the ${name} lease another year.`);
        return;
      }
      lease.status = "lapsed";
      notice(ctx, `The ${name} lease has lapsed: the delay rental of $${t.rentalCents / 100} could not be paid.`);
    },
    "rig.tick"(ctx) {
      const st = S(ctx);
      const w = st.well;
      if (!w || w.status === "gusher" || w.status === "dry") return;
      // The money is gone when today's rig time can no longer be paid.
      const perTick = dayRateCents(st.crew) / 288;
      if (cashCents(st.ledger) - accruedCents(st) - perTick < 0) {
        flushRigTime(ctx, ctx.now);
        finish(ctx, w, "dry", `The money is gone. The ${w.name} is abandoned at ${Math.round(w.depthFt)} ft.`);
        return;
      }
      st.accrued.ticks++;
      const before = w.depthFt;
      if (w.busy && ctx.now >= w.busy.until) complete(ctx, w, w.busy.op);
      else if (!w.busy && w.status === "drilling") (w.drive ? driveTick : drill)(ctx, w);
      guard(ctx, w, before);
      consult(ctx, w);
      // complete() and drill() may have ended the well; re-read its status.
      const status = w.status as Well["status"];
      if (status !== "gusher" && status !== "dry") ctx.schedule(ctx.now + TICK_MINUTES, "rig.tick");
    },
  },
  commands: guarded({
    "rig.spud"(ctx, c: Command) {
      const st = S(ctx);
      if (st.well && st.well.status !== "gusher" && st.well.status !== "dry") throw new CommandRejected("You already have a well going.");
      const p = c.payload as { x?: unknown; y?: unknown };
      if (typeof p?.x !== "number" || typeof p?.y !== "number") throw new CommandRejected("Choose a place to drill.");
      const survey = SURVEYS.find((s) => insidePoly(s.poly, p.x as number, p.y as number));
      if (!survey) throw new CommandRejected("Drill on surveyed land.");
      if (!activeLease(st.leases, survey.id, ctx.now)) throw new CommandRejected(`You hold no lease on the ${survey.name} survey. Lease it first.`);
      if (!st.bank.rigOwned) throw new CommandRejected("The company owns no rig. Buy a used one first.");
      if (st.well?.pullingUntil) throw new CommandRejected("The rig is pulling casing from the last hole.");
      if (st.contract) throw new CommandRejected(`The rig is out on contract until ${toCalendar(st.contract.until).day} ${MONTHS[toCalendar(st.contract.until).month - 1]}.`);
      if (available(st) < dollarsToCents(COSTS.rigUp)) throw new CommandRejected(`Raising a derrick costs $${COSTS.rigUp}. You have $${Math.floor(available(st) / 100)}.`);
      if (st.well) st.past.push(st.well);
      const n = st.past.length + 1;
      pay(st.ledger, ctx.now, "drilling", `Derrick raised for the ${survey.name} No. ${n}`, "drilling", dollarsToCents(COSTS.rigUp), { wellId: `ours-${n}`, surveyId: survey.id });
      st.well = {
        id: `ours-${n}`, name: `${survey.name} No. ${n}`, x: p.x, y: p.y, surveyId: survey.id, spudAt: ctx.now,
        status: "rigging", depthFt: 0, reachFt: 1, fillFt: 0, sharp: 1, casedFt: 0, openSandFt: 0,
        feeding: false, auto: false, busy: null, lastBailFt: 0, rop: 0, contact: 0, idleTicks: 0, lowFundsWarned: false, strings: [], leakFt: 0, waterFt: [], driller: st.crew.driller.id, fishCount: 0, drive: null, collapse: null, lastInflow: 0, lastBailAt: ctx.now, sandInFt: 0,
      };
      (st.crew.records[st.crew.driller.id] ??= emptyRecord()).wells++;
      startOp(ctx, st.well, "rigup");
      ctx.schedule(ctx.now + TICK_MINUTES, "rig.tick");
    },
    "lease.take"(ctx, c: Command) {
      const st = S(ctx);
      const p = c.payload as { surveyId?: string; offer?: string };
      const survey = surveyById(p?.surveyId ?? "");
      if (!survey) throw new CommandRejected("No such survey.");
      if (activeLease(st.leases, survey.id, ctx.now)) throw new CommandRejected(`You already hold the ${survey.name} lease.`);
      const rival = rivalHolder(st.rush, survey.id, ctx.now);
      if (rival) throw new CommandRejected(`${cap1(rival.operator)} holds the ${survey.name} lease.`);
      const lower = p.offer === "lower";
      const t = askingTerms(survey, printedMap(ctx.seed), news(st));
      if (lower && (st.leases.refusedUntil[survey.id] ?? -1) > ctx.now) throw new CommandRejected(`The owner has already refused a lower offer. The asking bonus is $${t.askingCents / 100}.`);
      const cents = lower ? t.lowerCents : t.askingCents;
      if (available(st) < cents) throw new CommandRejected(`The bonus is $${cents / 100}. You have $${Math.floor(available(st) / 100)}.`);
      if (lower && !ownerAccepts(ctx.seed, survey.id)) {
        st.leases.refusedUntil[survey.id] = ctx.now + REFUSAL_DAYS * MINUTES_PER_DAY;
        notice(ctx, `${survey.owner} refused $${cents / 100} for the ${survey.name} survey. The asking bonus stands at $${t.askingCents / 100}.`);
        return;
      }
      pay(st.ledger, ctx.now, "lease", `Lease bonus, ${survey.name} survey (${survey.acres} acres)`, "leaseBonus", cents, { surveyId: survey.id });
      const expiresAt = termEnd(ctx.now);
      st.leases.leases.push({ surveyId: survey.id, signedAt: ctx.now, expiresAt, acres: survey.acres, bonusCents: cents, royalty: t.royalty, status: "active", renewals: 0 });
      ctx.schedule(expiresAt, "lease.term", { surveyId: survey.id });
      notice(ctx, `Leased the ${survey.name} survey for $${cents / 100}: one year, one-eighth royalty to ${survey.owner}.`);
    },
    "bank.borrow"(ctx, c: Command) {
      const st = S(ctx);
      const cents = (c.payload as { cents?: unknown })?.cents;
      if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0 || cents % BORROW_STEP_CENTS !== 0) throw new CommandRejected("Borrow in steps of $50.");
      if (st.bank.lien) throw new CommandRejected("The bank will lend nothing more until the old loan is cleared.");
      const room = creditLimitCents(st.bank, st.production, oilPriceCents(ctx.now)) - debtCents(st.ledger);
      if (cents > room) throw new CommandRejected(room > 0 ? `The bank will lend up to $${room / 100} more.` : "The bank will lend nothing more on what the company owns.");
      receive(st.ledger, ctx.now, "bank", `Loan from the First National Bank of Beaumont`, "loan", cents);
      notice(ctx, `Borrowed $${cents / 100} at ${RATE_PERCENT}% a year. Interest is due at each month's end.`);
    },
    "bank.repay"(ctx, c: Command) {
      const st = S(ctx);
      const want = (c.payload as { cents?: unknown })?.cents;
      if (typeof want !== "number" || !Number.isSafeInteger(want) || want <= 0) throw new CommandRejected("Repay a sum in whole cents.");
      const cents = Math.min(want, debtCents(st.ledger), Math.max(0, available(st)));
      if (cents <= 0) throw new CommandRejected(debtCents(st.ledger) <= 0 ? "The company owes the bank nothing." : "There is no cash to repay with.");
      pay(st.ledger, ctx.now, "bank", "Repaid to the bank", "loan", cents);
      if (debtCents(st.ledger) === 0) st.bank.lien = false;
      notice(ctx, debtCents(st.ledger) === 0 ? "The loan is paid off." : `Repaid $${(cents / 100).toFixed(2)}.`);
    },
    "company.buyRig"(ctx) {
      const st = S(ctx);
      if (st.bank.rigOwned) throw new CommandRejected("The company already owns a rig.");
      if (available(st) < dollarsToCents(USED_RIG_PRICE)) throw new CommandRejected(`A used rig costs $${USED_RIG_PRICE}.`);
      pay(st.ledger, ctx.now, "equipment", "Used cable-tool rig and tools, bought", "equipment", dollarsToCents(USED_RIG_PRICE));
      st.bank.rigOwned = true;
      st.bank.rigBookCents = dollarsToCents(USED_RIG_PRICE);
      notice(ctx, "The company owns a rig again.");
    },
    "company.sellRig"(ctx) {
      const st = S(ctx);
      if (!st.bank.rigOwned) throw new CommandRejected("The company owns no rig to sell.");
      if (st.contract) throw new CommandRejected("The rig is out on contract. It can be sold when it is back.");
      const w = st.well;
      if (w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck")) throw new CommandRejected(`The rig is at work on the ${w.name}. Finish or abandon the hole first.`);
      if (w?.pullingUntil) throw new CommandRejected("The rig is pulling casing. It can be sold when that is done.");
      const toLoan = Math.min(dollarsToCents(RIG_RESALE), debtCents(st.ledger));
      const book = st.bank.rigBookCents;
      disposeOfRig(st, ctx.now, "equipment", `Rig and tools sold in Beaumont for $${RIG_RESALE}`, toLoan);
      if (debtCents(st.ledger) === 0) { st.bank.lien = false; st.bank.strikes = 0; }
      notice(ctx, `The rig and tools are sold for $${RIG_RESALE} (on the books at $${book / 100}).${toLoan > 0 ? ` $${(toLoan / 100).toFixed(2)} went to the bank first.` : ""} A used rig costs $${USED_RIG_PRICE} to buy back.`);
      review(ctx);
    },
    "company.contract"(ctx) {
      const st = S(ctx);
      if (!st.bank.rigOwned) throw new CommandRejected("Contract drilling needs a rig. Buy a used one first.");
      if (st.contract) throw new CommandRejected("The rig is already out on contract.");
      const w = st.well;
      if (w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck")) throw new CommandRejected("The rig is busy on the company's own well.");
      if (w?.pullingUntil) throw new CommandRejected("The rig is pulling casing from the last hole.");
      const p = positionOf(st, ctx.seed, ctx.now);
      if (!contractOffered(p)) throw new CommandRejected("Contract work is for lean times. With money for a well of your own, drill it.");
      if (available(st) < dollarsToCents(CONTRACT_WAGES)) throw new CommandRejected(`The crew's wages and fuel for the month come to $${CONTRACT_WAGES}, paid before the rig moves.`);
      pay(st.ledger, ctx.now, "operating", `Crew wages and fuel for a month's contract drilling`, "operating", dollarsToCents(CONTRACT_WAGES));
      st.contract = { until: nextMidnight(ctx.now) + (CONTRACT_DAYS - 1) * MINUTES_PER_DAY };
      notice(ctx, `The rig is out on contract for ${CONTRACT_DAYS} days. The operator pays $${CONTRACT_PAY} when the job is done.`);
    },
    "prod.cap"(ctx) {
      const st = S(ctx);
      const w = st.well;
      if (!w || w.status !== "gusher") throw new CommandRejected("There is no gusher to cap.");
      if (!w.outcome?.startsWith("OIL")) throw new CommandRejected("Gas has no buyer in 1890. There is nothing to sell.");
      if (st.production.producers.some((p) => p.wellId === w.id)) throw new CommandRejected("That well is already capped and selling.");
      if (available(st) < dollarsToCents(CAP_COST)) throw new CommandRejected(`Capping the well costs $${CAP_COST}.`);
      // The well is opened on the oil at its bottom: its flow and its tank are the ground's (hidden).
      openTap(st.field, ctx.seed, w.id, w.x, w.y, w.depthFt);
      pay(st.ledger, ctx.now, "production", `Capping the ${w.name}`, "drilling", dollarsToCents(CAP_COST), { wellId: w.id, surveyId: w.surveyId });
      const cut = waterCut(openWaterSands(ctx, w, w.depthFt));
      st.production.producers.push({ wellId: w.id, name: w.name, surveyId: w.surveyId, x: w.x, y: w.y, since: ctx.now, firstDayBbl: 0, cumBbl: 0, monthBbl: 0, lastDayBbl: 0, waterCut: cut, months: [] });
      if (cut > 0) recordOf(st, w).wet++;
      if (cut > 0) report(ctx, "wet", `Water comes up with the oil: about ${cut > 0.5 ? "half" : "a third"} of what flows from the ${w.name} is water from sands above the pay that no casing shuts off.`, false);
      notice(ctx, `The ${w.name} is capped. Teamsters will haul up to 150 barrels a day to the railhead.`);
      if (st.outcome.firstOilAt === null) {
        st.outcome.firstOilAt = ctx.now;
        st.outcome.firstOilWell = w.name;
        ctx.emit({ type: "company.milestone", severity: "notice", interrupt: true, data: { kind: "firstOil", wellId: w.id, message: `The ${w.name} is the company's first producing well.` } });
      }
    },
    "lease.release"(ctx, c: Command) {
      const st = S(ctx);
      const surveyId = (c.payload as { surveyId?: string })?.surveyId ?? "";
      const lease = activeLease(st.leases, surveyId, ctx.now);
      if (!lease) throw new CommandRejected("You hold no lease there.");
      const w = st.well;
      if (w && w.surveyId === surveyId && w.status !== "gusher" && w.status !== "dry") throw new CommandRejected("You are drilling on that lease.");
      if (st.production.producers.some((p) => p.surveyId === surveyId)) throw new CommandRejected("A producing well holds that lease.");
      lease.status = "released";
      notice(ctx, `Released the ${surveyById(surveyId)?.name ?? ""} lease.`);
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
      if (w.busy || w.status !== "drilling" || w.drive) throw new CommandRejected("Not now.");
      startOp(ctx, w, "bail");
    },
    "rig.dress"(ctx) {
      const w = well(ctx);
      if (w.busy || w.status !== "drilling" || w.drive) throw new CommandRejected("Not now.");
      startOp(ctx, w, "dress");
    },
    "rig.case"(ctx) {
      caseNow(ctx, well(ctx));
    },
    "rig.drive"(ctx) {
      driveNow(ctx, well(ctx));
    },
    "rig.setDrive"(ctx) {
      const w = well(ctx);
      if (!w.drive || w.busy || w.status !== "drilling") throw new CommandRejected("No pipe is being driven.");
      setDrive(ctx, w, false);
    },
    "rig.driveOn"(ctx) {
      const w = well(ctx);
      if (!w.drive?.refused) throw new CommandRejected("The pipe is still going down.");
      w.drive.pounding = true;
      if (S(ctx).crew.pending?.kind === "setdrive") decline(ctx, S(ctx).crew.pending!);
    },
    "company.buyDriveHead"(ctx) {
      if (S(ctx).tools.driveHead) throw new CommandRejected("The company has a drive head already.");
      buyDriveHead(ctx);
      notice(ctx, `The company owns a drive head and clamps, for driving pipe ($${DRIVE.headCents / 100}).`);
    },
    "crew.accept"(ctx, c: Command) {
      const st = S(ctx);
      const r = st.crew.pending;
      if (!r || r.id !== (c.payload as { id?: number })?.id) throw new CommandRejected("He has nothing waiting on you.");
      st.crew.pending = null;
      const w = well(ctx);
      if (r.kind === "case") caseNow(ctx, w);
      else if (r.kind === "drive") { buyDriveHead(ctx); driveNow(ctx, w); }
      else if (r.kind === "setdrive") { if (!w.drive) throw new CommandRejected("No pipe is being driven."); setDrive(ctx, w, false); }
      else if (r.kind === "fish") fishNow(ctx, w);
      else finish(ctx, w, "dry", r.kind === "quit" ? `The ${w.name} is plugged at ${Math.round(w.depthFt)} ft to save the company's money.` : r.kind === "decide" ? `The ${w.name} is plugged at ${Math.round(w.depthFt)} ft: the company chose to keep its money.` : `The ${w.name} is plugged and abandoned at ${Math.round(w.depthFt)} ft.`);
      note(ctx, w.id, "acted", r.kind === "case" ? "Running the pipe, as agreed." : r.kind === "drive" ? "Putting the drive head on, as agreed." : r.kind === "setdrive" ? "Setting it here, as agreed." : r.kind === "fish" ? (w.collapse ? "Rigging the swage, as agreed." : "Rigging the jars, as agreed.") : "Plugging the hole, as agreed.");
    },
    "crew.decline"(ctx, c: Command) {
      const st = S(ctx);
      const r = st.crew.pending;
      if (!r || r.id !== (c.payload as { id?: number })?.id) throw new CommandRejected("He has nothing waiting on you.");
      decline(ctx, r);
    },
    "crew.hire"(ctx, c: Command) {
      const st = S(ctx);
      const id = (c.payload as { id?: string })?.id;
      const man = st.crew.candidates.find((d) => d.id === id);
      if (!man) throw new CommandRejected("That man is not looking for work.");
      const w = st.well;
      if (w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck" || w.pullingUntil)) throw new CommandRejected("A driller is not changed in the middle of a job. Hire him between wells.");
      // Today's rig time is paid at the old man's rate before the new one starts.
      flushRigTime(ctx, ctx.now);
      const old = st.crew.driller;
      st.crew.driller = man;
      st.crew.candidates = st.crew.candidates.filter((d) => d.id !== man.id);
      st.crew.records[man.id] ??= emptyRecord();
      st.crew.pending = null;
      st.crew.declined = {};
      notice(ctx, `${man.name} is the company's driller now, at $${(man.wageCents / 100).toFixed(2)} a day. ${old.name} has gone.`);
    },
    "crew.orders"(ctx, c: Command) {
      const st = S(ctx);
      const p = c.payload as { authority?: unknown; budgetCents?: unknown };
      if (p?.authority !== "ask" && p?.authority !== "judgement") throw new CommandRejected("Ask first, or use his judgement.");
      const budget = p.budgetCents ?? st.crew.orders.budgetCents;
      if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget < 0 || budget > 100_000) throw new CommandRejected("A monthly budget in whole cents, up to $1,000.");
      st.crew.orders.authority = p.authority;
      st.crew.orders.budgetCents = budget;
      notice(ctx, p.authority === "ask" ? `${st.crew.driller.name} will ask before spending the company's money.` : `${st.crew.driller.name} may spend up to $${budget / 100} a month on his own judgement.`);
    },
    "rig.pull"(ctx) {
      const st = S(ctx);
      const r = pullReckoning(st);
      if (!r) throw new CommandRejected("There is no casing to pull from a dead hole.");
      if (!st.bank.rigOwned) throw new CommandRejected("Pulling casing needs a rig.");
      if (available(st) < r.costCents) throw new CommandRejected(`Pulling the casing takes rig time worth $${Math.ceil(r.costCents / 100)}.`);
      const w = st.well!;
      const days = pullDays(w.strings);
      pay(st.ledger, ctx.now, "operating", `Rig crew pulling casing from the ${w.name}, ${days} day${days > 1 ? "s" : ""}`, "operating", r.costCents, { wellId: w.id, surveyId: w.surveyId });
      w.pullingUntil = ctx.now + days * MINUTES_PER_DAY;
      ctx.schedule(w.pullingUntil, "rig.pulled", { wellId: w.id });
      notice(ctx, `The crew is pulling the casing from the ${w.name}: ${days} day${days > 1 ? "s" : ""}.`);
    },
    "rig.fish"(ctx) {
      fishNow(ctx, well(ctx));
    },
    "rig.abandon"(ctx) {
      const w = well(ctx);
      finish(ctx, w, "dry", `The ${w.name} is plugged and abandoned at ${Math.round(w.depthFt)} ft.`);
    },
  }),
};

/** Every company command: refused once the campaign has ended; the position reviewed after. */
function guarded(commands: Record<string, (ctx: Ctx, c: Command) => void>): Record<string, (ctx: Ctx, c: Command) => void> {
  const out: Record<string, (ctx: Ctx, c: Command) => void> = {};
  for (const [type, fn] of Object.entries(commands)) {
    out[type] = (ctx, c) => {
      if (S(ctx).outcome.endedAt !== null) throw new CommandRejected("The company is finished. Start a new campaign from the Campaign menu.");
      fn(ctx, c);
      review(ctx);
    };
  }
  return out;
}
