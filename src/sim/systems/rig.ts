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
import { accruedCents, COSTS, emptyOutcome, RIG_VALUE, STARTING_CASH, type Operation, type OperationsState, type Well } from "../operations";
import { cashCents, debtCents, dollarsToCents, emptyLedger, pay, post, receive } from "../company/ledger";
import { rngKey } from "../core/rng";
import { activeLease, askingTerms, emptyLeaseBook, ownerAccepts, REFUSAL_DAYS, surveyById, termEnd, type PublicNews } from "../company/leases";
import { printedMap } from "../surface/print";
import { CAP_COST, dayBarrels, emptyProductionBook, HAULING_CENTS, OIL_PRICE_CENTS } from "../company/production";
import { ACCRUAL_UNITS, RATE_PERCENT, BORROW_STEP_CENTS, creditLimitCents, dayAccrual, emptyBank, STRIKES_TO_FORECLOSE, USED_RIG_PRICE } from "../company/bank";
import { CONTRACT_DAYS, CONTRACT_PAY, CONTRACT_WAGES, contractOffered, recoveryPaths, type Position } from "../company/recovery";
import { candidatesFor, dayRateCents, emptyCrew, emptyRecord, type Driller, type DrillerRecord } from "../company/crew";
import { abilityOf } from "../hidden/drillers";
import { MAX_STRINGS, MIN_STRING_FT, PIPE, pullDays, SALVAGE, stringCostCents, waterCut } from "../company/casing";
import { seatSeals } from "../hidden/casing";
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
  observeStrings(ctx, w);
  w.fillFt = 0;
  w.lastBailFt = w.depthFt;
  w.reachFt = w.depthFt + 1;
  report(ctx, "bailed", `Bailed at ${Math.round(w.depthFt)} ft: ${sample.call}.`, false);
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
    const sealed = seatSeals(ctx.seed, w.x, w.y, s.seatFt);
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
  const sealed = w.strings.filter((s) => !s.pulled && seatSeals(ctx.seed, w.x, w.y, s.seatFt));
  return w.waterFt.filter(([, base]) => base <= payFt && !sealed.some((s) => s.seatFt >= base)).length;
}

/** What the company can reckon pulling this hole's casing would cost and fetch: from what it has seen. */
function pullReckoning(st: OperationsState): { wellId: string; costCents: number; valueCents: number } | null {
  const w = st.well;
  if (!w || (w.status !== "dry" && w.status !== "gusher") || w.pullingUntil) return null;
  if (st.production.producers.some((p) => p.wellId === w.id)) return null;
  const left = w.strings.filter((s) => !s.pulled);
  if (!left.length) return null;
  const valueCents = left.reduce((a, s) => a + Math.round(s.costCents * (s.observed === "dry" ? SALVAGE.sealedFraction : SALVAGE.sandFraction)), 0);
  return { wellId: w.id, costCents: pullDays(left) * dayRateCents(st.crew), valueCents };
}

function finish(ctx: Ctx, w: Well, status: "gusher" | "dry", outcome: string): void {
  const rec = recordOf(S(ctx), w);
  if (status === "gusher" && outcome.startsWith("OIL")) rec.oil++;
  else rec.dry++;
  w.status = status;
  w.outcome = outcome;
  w.busy = null;
  w.feeding = false;
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
  if (cut > 0 && (here.lithology === "sand" || here.lithology === "gravel") && (here.fluid === "water" || here.fluid === "sulphurWater")) {
    const last = w.waterFt[w.waterFt.length - 1];
    if (last && w.depthFt - cut - last[1] < 5) last[1] = w.depthFt;
    else w.waterFt.push([w.depthFt - cut, w.depthFt]);
  }
  // Uncased sand heaves into the hole, and so does sand working in under a shoe seated in sand.
  const loose = w.openSandFt + w.leakFt;
  w.fillFt += (loose / 60) * 0.7 * H;

  // Stuck tools: slack line, heaving sand, a hole full of cuttings.
  const hazard = 0.0004 + 0.05 * Math.max(0, slack - SWEET_FT - 1) + 0.004 * (loose / 40) + (w.fillFt > 10 ? 0.04 : 0);
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
      const size = w.strings.length, seatFt = Math.round(w.depthFt);
      const cost = stringCostCents(size, seatFt);
      // The hole is bailed clean before pipe goes in, so the crew always sees what the shoe sits on.
      if (w.depthFt - w.lastBailFt >= 1) bail(ctx, w);
      const seatCall = seatCallAt(st, w, seatFt);
      pay(st.ledger, ctx.now, "drilling", `Ran the ${PIPE[size]!.name} casing to ${seatFt} ft in the ${w.name}${seatCall ? `, landed in ${seatCall.split(",")[0]}` : ""}`, "drilling", cost, { wellId: w.id, surveyId: w.surveyId });
      w.strings.push({ size, seatFt, costCents: cost, setAt: ctx.now, seatCall, observed: "pending", pulled: false });
      recordOf(st, w).strings++;
      // Mechanical: the pipe holds up every wall above its shoe. Hydraulic: only a seal stops the leak beneath.
      w.casedFt = w.depthFt;
      w.openSandFt = 0;
      w.leakFt = seatSeals(ctx.seed, w.x, w.y, seatFt) ? 0 : LEAK_FT;
      w.reachFt = w.depthFt + 1;
      report(ctx, "cased", `The ${PIPE[size]!.name} is set to ${seatFt} ft. The next bail will show whether it shuts off the water.`, false);
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
    creditRoomCents: Math.max(0, creditLimitCents(st.bank, st.production, dollarsToCents(RIG_VALUE)) - debt),
    creditRoomWithRigCents: Math.max(0, creditLimitCents({ ...st.bank, rigOwned: true }, st.production, dollarsToCents(RIG_VALUE)) - debt),
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

/** The bank takes the rig. The company keeps its land and wells; the way back stays open. */
function foreclose(ctx: Ctx): void {
  const st = S(ctx);
  const w = st.well;
  if (w && (w.status === "rigging" || w.status === "drilling" || w.status === "stuck")) {
    flushRigTime(ctx, ctx.now);
    finish(ctx, w, "dry", `The bank has seized the rig. The ${w.name} is abandoned at ${Math.round(w.depthFt)} ft.`);
  }
  const rig = dollarsToCents(RIG_VALUE), debt = debtCents(st.ledger);
  const credited = Math.min(rig, debt);
  // The rig leaves the books; its value is set against the loan, any surplus paid to the company.
  post(st.ledger, ctx.now, "bank", "Rig seized by the bank and set against the loan", [
    { account: "loan", cents: credited },
    { account: "cash", cents: rig - credited },
    { account: "equipment", cents: -rig },
  ]);
  st.bank.rigOwned = false;
  st.bank.strikes = 0;
  st.bank.lien = debtCents(st.ledger) > 0;
  ctx.emit({ type: "company.notice", severity: "critical", interrupt: true, data: { message: st.bank.lien ? "The bank has foreclosed and taken the rig. It will take oil revenue until the loan is clear. Your land is still yours." : "The bank has foreclosed and taken the rig; the loan is clear. Your land is still yours." } });
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
    const room = creditLimitCents(st.bank, st.production, dollarsToCents(RIG_VALUE)) - debtCents(st.ledger);
    report(ctx, "lowfunds", room >= BORROW_STEP_CENTS
      ? `Money for less than ${LOW_FUNDS_DAYS} more days of rig time. Borrow from the bank to keep drilling, or plan to stop.`
      : `Money for less than ${LOW_FUNDS_DAYS} more days of rig time, and the bank will lend no more. Decide whether to stop.`, true);
  }
}

/** One day's oil from every capped well. */
function produceDay(ctx: Ctx): void {
  const pb = S(ctx).production;
  for (const p of pb.producers) {
    const flow = dayBarrels(p, pb.drawn[p.trap] ?? 0);
    // Water from sands never shut off comes up with the oil and is let run to the pit.
    const bbl = Math.floor(flow * (1 - p.waterCut));
    p.lastDayBbl = bbl;
    p.cumBbl += bbl;
    p.monthBbl += bbl;
    pb.drawn[p.trap] = (pb.drawn[p.trap] ?? 0) + flow;
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
    if (bbl <= 0) continue;
    const gross = bbl * OIL_PRICE_CENTS;
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
  return { strikes: wells.filter((w) => w.status === "gusher" && w.outcome?.startsWith("OIL")).map((w) => ({ x: w.x, y: w.y })) };
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
  initialState: () => ({ ledger: emptyLedger(), accrued: { ticks: 0 }, leases: emptyLeaseBook(), production: emptyProductionBook(), bank: emptyBank(), contract: null, outcome: emptyOutcome(), crew: null, well: null, past: [], samples: [], next: 1 }) as unknown as Json,
  init(ctx) {
    const st = S(ctx);
    st.crew = emptyCrew(ctx.seed);
    refreshCandidates(ctx);
    post(st.ledger, ctx.now, "opening", "Capital paid in", [{ account: "cash", cents: dollarsToCents(STARTING_CASH) }, { account: "equity", cents: -dollarsToCents(STARTING_CASH) }]);
    post(st.ledger, ctx.now, "opening", "Cable-tool rig and tools, owned", [{ account: "equipment", cents: dollarsToCents(RIG_VALUE) }, { account: "equity", cents: -dollarsToCents(RIG_VALUE) }]);
    ctx.schedule(nextMidnight(ctx.now), "company.day");
  },
  events: {
    "company.day"(ctx) {
      // Rig time is entered in the books once a day, for the day just ended.
      // One event, one fixed order: the day's rig time, the day's oil, then (on the first of
      // the month) the month's settlement.
      flushRigTime(ctx, ctx.now - 1);
      produceDay(ctx);
      // Interest accrues daily on the loan, in exact integer units.
      S(ctx).bank.accrued += dayAccrual(debtCents(S(ctx).ledger));
      contractDue(ctx);
      if (toCalendar(ctx.now).day === 1) settleMonth(ctx, ctx.now - 1);
      refreshCandidates(ctx);
      review(ctx);
      ctx.schedule(nextMidnight(ctx.now), "company.day");
    },
    "rig.pulled"(ctx, payload) {
      const st = S(ctx);
      const w = st.well;
      if (!w || w.id !== (payload as { wellId?: string })?.wellId || !w.pullingUntil) return;
      let cents = 0;
      for (const s of w.strings) {
        if (s.pulled) continue;
        cents += Math.round(s.costCents * (seatSeals(ctx.seed, w.x, w.y, s.seatFt) ? SALVAGE.sealedFraction : SALVAGE.sandFraction));
        s.pulled = true;
      }
      w.pullingUntil = null;
      if (cents > 0) receive(st.ledger, ctx.now, "equipment", `Casing pulled from the ${w.name}, sold`, "equipment", cents, { wellId: w.id, surveyId: w.surveyId });
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
      else if (!w.busy && w.status === "drilling") drill(ctx, w);
      guard(ctx, w, before);
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
        feeding: false, auto: false, busy: null, lastBailFt: 0, rop: 0, contact: 0, idleTicks: 0, lowFundsWarned: false, strings: [], leakFt: 0, waterFt: [], driller: st.crew.driller.id,
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
      const room = creditLimitCents(st.bank, st.production, dollarsToCents(RIG_VALUE)) - debtCents(st.ledger);
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
      notice(ctx, "The company owns a rig again.");
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
      const r = rock(ctx, w, w.depthFt);
      const t = r.trap;
      const dome = generateGeology(ctx.seed).domes.find((d) => d.id === t?.domeId);
      // The flow and the oil in reach come from the ground the well drains.
      const fill = dome?.charge.fill ?? 0.3;
      const initialBbl = Math.round(220 + 1600 * fill);
      const reserveBbl = Math.round((t?.kind === "caprock" ? 160_000 : 90_000) * (0.4 + fill));
      const trap = rngKey(ctx.seed, "trap", t ? `${t.domeId}:${t.formation}` : w.id).toString(16);
      pay(st.ledger, ctx.now, "production", `Capping the ${w.name}`, "drilling", dollarsToCents(CAP_COST), { wellId: w.id, surveyId: w.surveyId });
      const cut = waterCut(openWaterSands(ctx, w, w.depthFt));
      st.production.producers.push({ wellId: w.id, name: w.name, surveyId: w.surveyId, x: w.x, y: w.y, since: ctx.now, trap, initialBbl, reserveBbl, cumBbl: 0, monthBbl: 0, lastDayBbl: 0, waterCut: cut });
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
      if (w.strings.length >= MAX_STRINGS) throw new CommandRejected(`No smaller pipe will go inside the ${PIPE[MAX_STRINGS - 1]!.name}. The rest of this hole is open.`);
      if (w.depthFt - w.casedFt < MIN_STRING_FT) throw new CommandRejected("The hole is cased almost to bottom already.");
      const cost = stringCostCents(w.strings.length, Math.round(w.depthFt));
      if (available(S(ctx)) < cost) throw new CommandRejected(`The ${PIPE[w.strings.length]!.name} to ${Math.round(w.depthFt)} ft costs $${Math.ceil(cost / 100)}.`);
      startOp(ctx, w, "case");
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
      const w = well(ctx);
      if (w.status !== "stuck" || w.busy) throw new CommandRejected("The tools are not stuck.");
      const st = S(ctx);
      if (available(st) < dollarsToCents(COSTS.fishing)) throw new CommandRejected(`A fishing job costs $${COSTS.fishing}.`);
      pay(st.ledger, ctx.now, "drilling", `Fishing job on the ${w.name}`, "drilling", dollarsToCents(COSTS.fishing), { wellId: w.id, surveyId: w.surveyId });
      recordOf(st, w).fishing++;
      startOp(ctx, w, "fish");
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
