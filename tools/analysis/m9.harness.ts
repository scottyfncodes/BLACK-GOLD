/*
 * M9.0: is one rig the binding constraint on a company with money? Analysis only; not part of CI.
 * No game code is changed: this measures the game as it is (schema 9).
 * Run: OUT=/path/m9.jsonl WORLDS=240 SHARD=0 SHARDS=1 \
 *   npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/m9.harness.ts
 * Then: node tools/analysis/m9-compare.mjs /path/m9-*.jsonl
 *
 * Two cohorts of discoveries, each played on five years from the day the discovery well is capped,
 * two ways:
 *  - passive: produce, nothing more (in cohort A this is exactly M8b's passive play);
 *  - explorer: the same one rig keeps exploring other structures, as M7's disciplined operator
 *    does: it buys the fieldwork it needs, ranks rises by their signs and the depth its evidence
 *    reads, skips ground its evidence (its own holes, the geologist, settlers' logs, other
 *    operators' dry holes in the news) has ruled out, steps out on what a hole proved, and drills
 *    while it has money for a hole. It leaves the discovery's own structure alone (development is
 *    M8's question).
 * Cohort A ("scaffolded"): M8b's worlds. The first well is placed from truth at the cheapest oil
 *   site, so that most worlds have a strike to play from; the company has done no fieldwork.
 * Cohort B ("natural"): M7's disciplined operator from the start of the campaign, on public
 *   information throughout, in the worlds where it reaches production within 36 months.
 *
 * Every decision reads only what the player can see: the field notes (`knowledgeOf`), the printed
 * map, the books and position, the news. Truth is read only to measure afterwards (whether a hole
 * had oil below it, which reservoirs were left untouched) and, in cohort A, to place the first well.
 *
 * The reading of the country, the reading of the rock and the drilling rules are copied unchanged
 * from m7.harness.ts (which stays frozen as M7's reproducible baseline); the explorer adds only the
 * bookkeeping of why the rig is idle and what it skips.
 */
import { it } from "vitest";
import { appendFileSync } from "node:fs";
import { CAMPAIGN_START, gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, recoveryPaths, type Evidence, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { JEFFERSON_1890, projectKm } from "../../src/content/geography/jefferson1890";
import type { FieldState } from "../../src/sim/hidden/reservoir";
// Truth: scaffolding (cohort A's first site) and measurement only.
import { generateGeology, columnAt, isCharged } from "../../src/sim/geology/truth/model";
import { runningProfile, RUN_STEP_FT } from "../../src/sim/hidden/quicksand";

const N = Number(process.env.WORLDS ?? 240);
const SHARD = Number(process.env.SHARD ?? 0), SHARDS = Number(process.env.SHARDS ?? 1);
const OUT = process.env.OUT;
const COHORTS = (process.env.COHORTS ?? "A,B").split(",");
const FT = 3.2808;
const DAY = MINUTES_PER_DAY;
const YEAR = 365 * DAY;
/** Rises this near a company producer are the discovery's own structure: development, not exploration. */
const OWN_FIELD_KM = 1.5;
/** A cash reserve the explorer keeps to operate (cents). */
const RESERVE_CENTS = 30_000;
const cmd = (w: WorldState, type: string, payload: unknown = null) => gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rej = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
type Str = { size: number; method?: string; damage?: string | null; hung?: boolean };
type W = { id: string; name: string; x: number; y: number; surveyId: string; spudAt: number; status: string; depthFt: number; casedFt: number; outcome?: string; strings: Str[]; collapse?: unknown; fishCount: number; busy?: unknown; pullingUntil?: number | null };
type Ops = { cash: number; debt: number; dayRate: number; well: W | null; past: W[]; contract: { until: number } | null; crew: { pending: { id: number; kind: string; text: string } | null; candidates: { id: string; wageCents: number; years: number; remark: string }[] }; outcome: { endedAt: number | null; firstOilAt: number | null }; production: { producers: { wellId: string; since: number; x: number; y: number; cumBbl: number }[] }; ledger: { entries: { t: number; category: string; ref?: { wellId?: string }; lines: { account: string; cents: number }[] }[] } };
const ops = (w: WorldState) => operationsOf(w) as unknown as Ops;
const pos = (w: WorldState) => positionOf(w.systems.operations as never, w.seed, w.time) as unknown as { cashCents: number; creditRoomCents: number; heldLeases: string[] };
const paths = (w: WorldState) => recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time)) as unknown as { kind: string; borrowCents?: number; surveyId?: string }[];
const active = (w: WorldState) => { const s = ops(w).well?.status; return s === "rigging" || s === "drilling" || s === "stuck"; };
const field = (w: WorldState) => (w.systems.operations as unknown as { field: FieldState }).field;
const surveyAt = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y));
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ───────────────────────────────────────────── public-information play (copied from m7.harness.ts)
type Site = { x: number; y: number; payHintFt: number | null; why: string; toward?: { x: number; y: number }; oilSigns?: boolean; rise?: { x: number; y: number }; strong?: boolean; score?: number };
type Ev = Evidence & Record<string, unknown>;
const evidence = (w: WorldState) => knowledgeOf(w).evidence as Ev[];
const MARSH = JEFFERSON_1890.areas.filter((a) => a.kind === "marsh").map((a) => a.points.map((p) => { const k = projectKm(JEFFERSON_1890, p); return [k.x, k.y] as [number, number]; }));
const inMarsh = (x: number, y: number) => MARSH.some((poly) => insidePoly(poly, x, y));

/** Run a fieldwork errand to its end. Returns the days it took (0 if refused). */
function errand(w: WorldState, type: string, payload: unknown): number {
  const t0 = w.time;
  if (rej(cmd(w, type, payload))) return 0;
  for (let k = 0; k < 20 && knowledgeOf(w).task; k++) gameEngine.advance(w, w.time + DAY);
  return (w.time - t0) / DAY;
}

function readCountry(w: WorldState): Site[] {
  const ev = evidence(w);
  const rises: { x: number; y: number; relief: number }[] = printedMap(w.seed).hills.map((h) => ({ x: h.x, y: h.y, relief: h.reliefFt }));
  for (const e of ev) if (e.kind === "surfaceSign" && e.sign === "mound" && !rises.some((r) => dist(r, e) < 0.6)) rises.push({ x: e.x, y: e.y, relief: e.reliefFt ?? 3 });
  for (const e of ev) if (e.kind === "surfaceSign" && (e.sign === "gasSeep" || e.sign === "paraffinDirt") && !inMarsh(e.x, e.y) && !rises.some((r) => dist(r, e) < 1.6)) rises.push({ x: e.x, y: e.y, relief: 0 });
  const S = { faint: 0.4, clear: 0.7, strong: 1 } as const;
  const sites: Site[] = [];
  for (const r of rises) {
    let score = Math.min(0.3, r.relief / 50), seep: { x: number; y: number; s: number } | null = null, strong = false;
    const why: string[] = [r.relief ? `a rise of ${r.relief} ft` : "signs without a rise"];
    for (const e of ev) {
      if (e.kind === "surfaceSign" && e.sign !== "mound" && dist(r, e) < 1.6 && !(e.sign === "gasSeep" && inMarsh(e.x, e.y))) {
        const s = S[e.strength];
        score += e.sign === "paraffinDirt" ? 3 * s : e.sign === "gasSeep" ? 2 * s : 0.3 * s;
        if (e.sign !== "sourSpring") strong = true;
        if (e.sign !== "sourSpring" && (!seep || s > seep.s)) seep = { x: e.x, y: e.y, s };
        why.push(e.sign);
      }
    }
    const sv = surveyAt(r.x, r.y);
    for (const e of ev) if (e.kind === "opinion" && e.from === "geologist" && sv && e.surveyId === sv.id) {
      if (/waxy dirt/.test(e.text)) { score += 2; strong = true; why.push("the geologist noted waxy dirt"); }
      else if (/gas bubbling/.test(e.text)) { score += 1.5; strong = true; why.push("the geologist noted gas"); }
    }
    let hardRock: number | null = null;
    for (const e of ev) if (e.kind === "wellRecord" && dist(r, e) < 2) {
      for (const iv of e.intervals) {
        if (iv.show === "oil") { score += 3; strong = true; why.push("oily scum in a settler's well"); }
        else if (iv.show === "gas") { score += 2; strong = true; why.push("gas in a settler's well"); }
        else if (iv.show === "sulphur") score += 0.8;
        if (iv.lith === "rock" && (hardRock === null || iv.topFt < hardRock)) hardRock = iv.topFt;
      }
    }
    if (hardRock !== null) score += 1;
    const at = seep ? { x: r.x + (seep.x - r.x) * 0.3, y: r.y + (seep.y - r.y) * 0.3 } : { x: r.x, y: r.y };
    if (!surveyAt(at.x, at.y)) continue;
    sites.push({ ...at, payHintFt: hardRock, score, why: why.join(", "), toward: seep ? { x: seep.x, y: seep.y } : undefined, oilSigns: !!seep || why.some((x) => /geologist|oily|gas in/.test(x)), rise: { x: r.x, y: r.y }, strong });
  }
  return sites.sort((a, b) => b.score! - a.score!);
}

/** M7's fieldwork, unchanged. Returns the days spent. */
function doFieldwork(w: WorldState): number {
  let days = 0;
  for (const s of SURVEYS) days += errand(w, "fieldwork.walk", { surveyId: s.id });
  const rises = readCountry(w);
  for (let pass = 0; pass < 2; pass++) for (const s of SURVEYS) {
    const c = { x: s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, y: s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length };
    if (rises.some((r) => dist(r, c) < 2)) days += errand(w, "fieldwork.walk", { surveyId: s.id });
  }
  const consulted = new Set<string>();
  for (const r of readCountry(w).slice(0, 5)) { const sv = surveyAt(r.x, r.y); if (sv && !consulted.has(sv.id)) { consulted.add(sv.id); days += errand(w, "fieldwork.consult", { surveyId: sv.id, who: "geologist" }); } }
  const top = readCountry(w).slice(0, 3);
  const asked = new Set<string>();
  for (const site of top) for (const well of printedMap(w.seed).wells) {
    if (dist(site, well) < 2 && !asked.has(well.id)) { asked.add(well.id); days += errand(w, "fieldwork.inquire", { wellId: well.id }); }
  }
  return days;
}

function expectAt(w: WorldState, x: number, y: number): { lo: number; hi: number | null; from: string; rockDry: boolean } | null {
  const ev = evidence(w);
  const holes = ev.filter((e) => e.kind === "account" && dist(e as never, { x, y }) <= 1.0) as unknown as { rock: { topFt: number; withinFt: number } | null; rockDry: boolean; x: number; y: number }[];
  const rockDry = holes.some((h) => h.rockDry) || ev.some((e) => e.kind === "reading" && (e as unknown as { verdict: string }).verdict === "dry" && dist(e as never, { x, y }) <= 1.2);
  const hole = holes.filter((h) => h.rock).sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }))[0];
  if (hole) return { lo: hole.rock!.topFt - hole.rock!.withinFt - 25, hi: hole.rock!.topFt + 40, from: "hole", rockDry };
  const reading = (ev.filter((e) => e.kind === "reading" && dist(e as never, { x, y }) <= 1.2) as unknown as { t: number; verdict: string; rockFt: [number, number | null] | null }[]).filter((r) => r.rockFt && (r.verdict === "range" || r.verdict === "deep")).sort((a, b) => b.t - a.t)[0];
  if (reading) return { lo: reading.rockFt![0], hi: reading.verdict === "deep" ? null : reading.rockFt![1], from: "geologist", rockDry };
  for (const e of ev) if (e.kind === "wellRecord" && dist(e, { x, y }) <= 1.0) { const iv = e.intervals.find((i) => i.lith === "rock"); if (iv) return { lo: iv.topFt - 20, hi: iv.topFt + 40, from: "settler", rockDry }; }
  return rockDry ? { lo: 0, hi: 0, from: "none", rockDry } : null;
}

function rankM7(w: WorldState, sites: Site[]): Site[] {
  const key = (s: Site) => {
    const ex = s.rise ? expectAt(w, s.rise.x, s.rise.y) : null;
    const depth = ex && !ex.rockDry ? (ex.hi ?? ex.lo + 600) : 1_600;
    return s.score! - depth / 1_000;
  };
  return [...sites].sort((a, b) => key(b) - key(a));
}

/**
 * M7's disciplined drilling (decline counsel to stop only when its evidence puts the rock within
 * its means), with one rule M7 never needed: a hole that has made no footage for 30 days is
 * plugged. A poor company's money ran out first; a rich one's does not (see `stalls`).
 */
const STALL_DAYS = 30;
const stalls = { holes: 0, daysBurnt: 0 };
function drillOut(w: WorldState): void {
  gameEngine.advance(w, w.time + 3 * DAY + 10);
  cmd(w, "rig.auto", { on: true });
  let deepest = ops(w).well?.depthFt ?? 0, since = w.time;
  for (let k = 0; k < 4000 && active(w); k++) {
    const r = gameEngine.advance(w, w.time + 2 * DAY, { stopOnInterrupt: true });
    if (!active(w)) break;
    const well = ops(w).well!;
    if (well.depthFt > deepest + 0.5) { deepest = well.depthFt; since = w.time; }
    else if (w.time - since > STALL_DAYS * DAY && !ops(w).crew.pending) { stalls.holes++; stalls.daysBurnt += (w.time - since) / DAY; cmd(w, "rig.abandon"); break; }
    const ex = expectAt(w, well.x, well.y);
    const target = ex && !ex.rockDry ? (ex.hi ?? ex.lo + 300) + 150 : null;
    const reach = target !== null && well.depthFt < target;
    if (reach && r.events.some((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === "lowfunds")) {
      const room = pos(w).creditRoomCents;
      if (room >= 5_000) cmd(w, "bank.borrow", { cents: Math.floor(room / 5_000) * 5_000 });
    }
    const q = ops(w).crew.pending;
    if (q) {
      let accept = true;
      if (q.kind === "quit" || q.kind === "decide") {
        const p = pos(w);
        const daysLeft = (p.cashCents + p.creditRoomCents) / 1_200;
        accept = /rock salt/.test(q.text) || !(reach && (target! - well.depthFt) / 40 < daysLeft);
      }
      cmd(w, accept ? "crew.accept" : "crew.decline", { id: q.id });
    }
    const now = ops(w).well!;
    if (now.status === "stuck" && !ops(w).crew.pending && !now.busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
  }
  const well = ops(w).well;
  if (well && well.status === "gusher" && well.outcome?.startsWith("OIL")) {
    const cap = paths(w).find((p) => p.kind === "cap");
    if (cap?.borrowCents) cmd(w, "bank.borrow", { cents: cap.borrowCents });
    cmd(w, "prod.cap");
  }
}

/** M7's spudding with recovery paths, unchanged for the disciplined profile. */
function spudAt(w: WorldState, at: { x: number; y: number }, end: number): boolean {
  for (let guard = 0; guard < 60 && w.time < end; guard++) {
    if (ops(w).outcome.endedAt !== null) return false;
    const s = surveyAt(at.x, at.y);
    if (!s) return false;
    const held = pos(w).heldLeases.includes(s.id);
    if (!held) {
      if (!rej(cmd(w, "lease.take", { surveyId: s.id, offer: "asking" }))) continue;
    } else if (!rej(cmd(w, "rig.spud", at))) return true;
    const ps = paths(w);
    const borrow = (c?: number) => { if (c) cmd(w, "bank.borrow", { cents: c }); };
    const drill = ps.find((p) => p.kind === "drill" || p.kind === "leaseAndDrill");
    if (drill && held && drill.borrowCents) { borrow(drill.borrowCents); if (!rej(cmd(w, "rig.spud", at))) return true; }
    const c = ps.find((p) => p.kind === "contract");
    if (c) { borrow(c.borrowCents); cmd(w, "company.contract"); gameEngine.advance(w, w.time + 31 * DAY); continue; }
    const pl = ps.find((p) => p.kind === "pull");
    if (pl) { borrow(pl.borrowCents); cmd(w, "rig.pull"); gameEngine.advance(w, w.time + 6 * DAY); continue; }
    const b = ps.find((p) => p.kind === "buyRig");
    if (b) { borrow(b.borrowCents); cmd(w, "company.buyRig"); continue; }
    if (ps.some((p) => p.kind === "contracted")) { gameEngine.advance(w, w.time + 31 * DAY); continue; }
    return false;
  }
  return false;
}

// ───────────────────────────────────────────── the explorer's choice of site, with its reasons
type Skip = "ownField" | "ruledOut" | "tooDeep" | "rivalDry" | "rivalField" | "tried";
type Choice = { site: Site; kind: "stepOut" | "backToCrest" | "rise"; skips: Record<Skip, number> } | { site: null; skips: Record<Skip, number> };

/** Other operators' wells, from the news only: where they are, how they ended, how deep. */
function newsWells(w: WorldState): { x: number; y: number; event: string; depthFt: number | null }[] {
  return evidence(w).filter((e) => e.kind === "news" && (e.event === "oil" || e.event === "dry" || e.event === "gas") && e.x !== null).map((e) => ({ x: e.x as number, y: e.y as number, event: e.event as string, depthFt: e.depthFt as number | null }));
}

/**
 * M7's nextSiteM7, plus what a company with a field adds: it leaves its own field's rises alone, and
 * it reads the news (another operator's dry hole on a rise, drilled past the depth its evidence
 * expects the rock, counts against it unless the signs are strong; a rise where another operator
 * has struck oil is that operator's field).
 */
function nextSite(w: WorldState, sites: Site[], tried: Site[]): Choice {
  const skips: Record<Skip, number> = { ownField: 0, ruledOut: 0, tooDeep: 0, rivalDry: 0, rivalField: 0, tried: 0 };
  const producers = ops(w).production.producers;
  const mine = (p: { x: number; y: number }) => producers.some((q) => dist(q, p) < OWN_FIELD_KM);
  const last = tried[tried.length - 1];
  if (last && !(last.rise && mine(last.rise))) {
    const lastWell = ops(w).past.concat(ops(w).well ? [ops(w).well!] : []).slice(-1)[0];
    const acct = evidence(w).find((e) => e.kind === "account" && e.wellId === lastWell?.id) as unknown as { rock: unknown; rockDry: boolean; deepestFt: number; result: string } | undefined;
    const ex = last.rise ? expectAt(w, last.rise.x, last.rise.y) : null;
    const onRise = last.rise ? tried.filter((t) => t.rise && dist(t.rise, last.rise!) < 0.2) : [];
    if (acct?.rockDry && last.strong && last.rise && onRise.length < 2) {
      const toward = last.toward ?? { x: last.rise.x + 0.8, y: last.rise.y - 0.6 };
      const d = dist(toward, last.rise) || 1;
      const flank = { ...last, x: last.rise.x + ((toward.x - last.rise.x) / d) * 1.1, y: last.rise.y + ((toward.y - last.rise.y) / d) * 1.1, why: "flank step-out" };
      if (surveyAt(flank.x, flank.y) && !tried.some((t) => dist(t, flank) < 0.3)) return { site: flank, kind: "stepOut", skips };
    }
    if (acct && !acct.rock && ex && ex.hi !== null && acct.deepestFt > ex.hi && last.rise && dist(last, last.rise) > 0.25 && onRise.length < 2) {
      const back = { ...last, x: last.rise.x, y: last.rise.y, why: "back to the crest" };
      if (surveyAt(back.x, back.y) && !tried.some((t) => dist(t, back) < 0.3)) return { site: back, kind: "backToCrest", skips };
    }
  }
  const news = newsWells(w);
  for (const s of sites) {
    if (s.rise && mine(s.rise)) { skips.ownField++; continue; }
    if (tried.some((t) => dist(t, s) < 0.3)) { skips.tried++; continue; }
    const ex = s.rise ? expectAt(w, s.rise.x, s.rise.y) : null;
    if (ex?.rockDry && !s.strong) { skips.ruledOut++; continue; }
    if (ex?.rockDry && tried.some((t) => t.rise && s.rise && dist(t.rise, s.rise) < 0.2)) { skips.ruledOut++; continue; }
    if (ex && !ex.rockDry && ex.lo > 2_300) { skips.tooDeep++; continue; }
    const r = s.rise ?? s;
    if (news.some((n) => n.event === "oil" && dist(n, r) < 1.0)) { skips.rivalField++; continue; }
    const expectHi = ex && !ex.rockDry ? (ex.hi ?? ex.lo + 300) : 1_600;
    if (!s.strong && news.some((n) => n.event === "dry" && dist(n, r) < 0.6 && (n.depthFt ?? 0) > expectHi + 150)) { skips.rivalDry++; continue; }
    return { site: s, kind: "rise", skips };
  }
  return { site: null, skips };
}

/** What a hole costs, as the company's own books show it: its drilling spend per foot, times the depth it expects plus 150 ft. */
function holeCostCents(w: WorldState, site: Site): number {
  const o = ops(w);
  const wells = [...o.past, ...(o.well ? [o.well] : [])].filter((x) => x.status === "dry" || x.status === "gusher");
  const ft = wells.reduce((a, x) => a + x.depthFt, 0);
  const spent = o.ledger.entries.filter((e) => e.ref?.wellId && e.category !== "production").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0);
  const perFt = ft > 100 ? spent / ft : 150;
  const ex = site.rise ? expectAt(w, site.rise.x, site.rise.y) : null;
  const depth = ex && !ex.rockDry ? (ex.hi ?? ex.lo + 300) + 150 : 1_600;
  return Math.round(perFt * depth);
}

// ───────────────────────────────────────────── a timeline of the rig
type State = "drilling" | "fieldwork" | "capital" | "land" | "noProspect" | "passive";
interface Log { spans: { state: State; days: number; capitalCents: number; cashCents: number; prospects: number }[] }
let cashNow = 0;
function span(log: Log, state: State, fromT: number, toT: number, capitalCents: number, prospects: number) {
  const days = (toT - fromT) / DAY;
  if (days > 0) log.spans.push({ state, days, capitalCents, cashCents: cashNow, prospects });
}

/** Viable prospects the company's evidence shows now (a pure read). */
function prospectsNow(w: WorldState, tried: Site[]): number {
  const sites = rankM7(w, readCountry(w));
  let n = 0;
  const t = [...tried];
  for (let i = 0; i < 40; i++) { const c = nextSite(w, sites, t); if (!c.site) break; n++; t.push(c.site); }
  return n;
}

type Strategy = "passive" | "explorer";

function play(start: WorldState, strategy: Strategy, triedBefore: Site[], fieldworkDone: boolean) {
  const w = structuredClone(start);
  const t0 = w.time;
  const log: Log = { spans: [] };
  const tried = [...triedBefore];
  const skipTotals: Record<Skip, number> = { ownField: 0, ruledOut: 0, tooDeep: 0, rivalDry: 0, rivalField: 0, tried: 0 };
  const holes: { x: number; y: number; id: string; kind: string; costCents: number; t: number }[] = [];
  const decisions = { drill: 0, capital: 0, land: 0, noProspect: 0 };
  let fieldworkDays = 0, refreshed = 0, landRefusals = 0;
  const snaps: Record<string, ReturnType<typeof measure>> = {};
  let didFieldwork = fieldworkDone;
  const capitalNow = () => { const p = pos(w); cashNow = p.cashCents; return p.cashCents + p.creditRoomCents; };
  const stalls0 = stalls.holes;
  for (const [label, at] of [["y1", YEAR], ["y3", 3 * YEAR], ["y5", 5 * YEAR]] as const) {
    while (w.time < t0 + at && ops(w).outcome.endedAt === null) {
      const before = w.time;
      if (strategy === "passive") {
        // Passive play, as M8b: let the months pass. Sampled: what its evidence would have shown it.
        gameEngine.advance(w, Math.min(t0 + at, w.time + 15 * DAY));
        span(log, "passive", before, w.time, capitalNow(), prospectsNow(w, tried));
        continue;
      }
      if (!didFieldwork) {
        didFieldwork = true;
        const d = doFieldwork(w);
        fieldworkDays += d;
        span(log, "fieldwork", before, w.time, capitalNow(), 0);
        continue;
      }
      const sites = rankM7(w, readCountry(w));
      const choice = nextSite(w, sites, tried);
      for (const k of Object.keys(choice.skips) as Skip[]) skipTotals[k] += choice.skips[k];
      if (!choice.site) {
        // Nothing worth a hole by its evidence. Buy more, once a year at most: the geologist on every
        // rise not yet read, and the settlers' logs near the best of them.
        if (refreshed < Math.floor((w.time - t0) / YEAR) + 1) {
          refreshed++;
          let d = 0;
          const consulted = new Set(evidence(w).filter((e) => e.kind === "reading").map((e) => e.surveyId as string));
          for (const r of readCountry(w)) { const sv = surveyAt(r.x, r.y); if (sv && !consulted.has(sv.id)) { consulted.add(sv.id); d += errand(w, "fieldwork.consult", { surveyId: sv.id, who: "geologist" }); } }
          const asked = new Set(evidence(w).filter((e) => e.kind === "wellRecord").map((e) => e.wellId as string));
          for (const site of readCountry(w).slice(0, 6)) for (const well of printedMap(w.seed).wells) if (dist(site, well) < 2 && !asked.has(well.id)) { asked.add(well.id); d += errand(w, "fieldwork.inquire", { wellId: well.id }); }
          fieldworkDays += d;
          if (d > 0) { span(log, "fieldwork", before, w.time, capitalNow(), 0); continue; }
        }
        decisions.noProspect++;
        gameEngine.advance(w, Math.min(t0 + at, w.time + 30 * DAY));
        span(log, "noProspect", before, w.time, capitalNow(), 0);
        continue;
      }
      const cost = holeCostCents(w, choice.site);
      if (pos(w).cashCents + pos(w).creditRoomCents < cost + RESERVE_CENTS) {
        decisions.capital++;
        gameEngine.advance(w, Math.min(t0 + at, w.time + 15 * DAY));
        span(log, "capital", before, w.time, capitalNow(), prospectsNow(w, tried));
        continue;
      }
      const s = surveyAt(choice.site.x, choice.site.y)!;
      if (!pos(w).heldLeases.includes(s.id) && rej(cmd(w, "lease.take", { surveyId: s.id, offer: "asking" }))) {
        // Refused (another operator holds it, or the money is short of the bonus): mark it tried.
        decisions.land++;
        landRefusals++;
        tried.push(choice.site);
        gameEngine.advance(w, w.time + DAY);
        span(log, "land", before, w.time, capitalNow(), 0);
        continue;
      }
      const spent0 = spentOnWells(w);
      if (!spudAt(w, choice.site, t0 + at)) { decisions.land++; tried.push(choice.site); gameEngine.advance(w, Math.min(t0 + at, w.time + DAY)); span(log, "land", before, w.time, capitalNow(), 0); continue; }
      decisions.drill++;
      tried.push(choice.site);
      const id = ops(w).well!.id;
      drillOut(w);
      holes.push({ x: choice.site.x, y: choice.site.y, id, kind: choice.kind, costCents: spentOnWells(w) - spent0, t: (before - t0) / DAY });
      span(log, "drilling", before, w.time, capitalNow(), 0);
    }
    if (w.time < t0 + at) gameEngine.advance(w, t0 + at);
    snaps[label] = measure(w, t0, holes);
  }
  return { strategy, stalledHoles: stalls.holes - stalls0, fieldworkDays, decisions, landRefusals, skips: skipTotals, holes: holes.map((h) => ({ ...h, ...holeTruth(w, h) })), spans: summarise(log), ...snaps };
}

/** Collapse the timeline: days in each state, and idle days with money and a prospect in hand. */
function summarise(log: Log) {
  const days: Record<string, number> = {};
  let idleRichWithProspect = 0, idleRich = 0, idleCashRich = 0, idleCashRichWithProspect = 0;
  for (const s of log.spans) {
    days[s.state] = (days[s.state] ?? 0) + s.days;
    if (s.state === "drilling" || s.state === "fieldwork") continue;
    // "Rich": capital to fund another complete campaign, at M7's measured cost per discovery: with
    // the bank's credit, and on cash alone.
    if (s.capitalCents >= CAMPAIGN_CENTS) { idleRich += s.days; if (s.prospects > 0) idleRichWithProspect += s.days; }
    if (s.cashCents >= CAMPAIGN_CENTS) { idleCashRich += s.days; if (s.prospects > 0) idleCashRichWithProspect += s.days; }
  }
  return { days, idleRich, idleRichWithProspect, idleCashRich, idleCashRichWithProspect };
}

/**
 * The cost of a complete drilling campaign: what M7's disciplined operator spent, on fieldwork and
 * holes, per oil well found (240 worlds × 36 months, docs/DESIGN.md §8): $7,324.
 */
const CAMPAIGN_CENTS = 732_400;

function spentOnWells(w: WorldState): number {
  return ops(w).ledger.entries.filter((e) => e.ref?.wellId && e.category !== "production").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0);
}

// ───────────────────────────────────────────── truth: measurement only
function truthPay(seed: string, x: number, y: number): number | null {
  const hc = columnAt(generateGeology(seed), x, y, 800).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
  return hc && hc.top * FT <= 2500 && hc.fluid === "oil" ? hc.top * FT : null;
}
function holeTruth(w: WorldState, h: { id: string; x: number; y: number }) {
  const all = [...ops(w).past, ...(ops(w).well ? [ops(w).well!] : [])];
  const well = all.find((x) => x.id === h.id);
  return { oil: !!well && well.status === "gusher" && !!well.outcome?.startsWith("OIL"), depthFt: Math.round(well?.depthFt ?? 0), oilBelow: truthPay(w.seed, h.x, h.y) !== null };
}

/** Charged domes with oil reachable (≤ 2,500 ft) somewhere on their structure, and whether anyone has tapped them. */
function opportunities(w: WorldState, explored: { x: number; y: number }[]) {
  const t = generateGeology(w.seed);
  const f = field(w);
  const tappedDomes = new Set<string>();
  for (const tap of f.taps) {
    const p = [...ops(w).production.producers.map((q) => ({ id: q.wellId, x: q.x, y: q.y })), ...ops(w).past.map((q) => ({ id: q.id, x: q.x, y: q.y })), ...(w.systems.operations as unknown as { rush: { wells: { id: string; x: number; y: number }[] } }).rush.wells];
    const at = p.find((q) => q.id === tap.wellId);
    if (!at) continue;
    const d = t.domes.map((dm) => ({ dm, d: Math.hypot(dm.x - at.x, dm.y - at.y) })).sort((a, b) => a.d - b.d)[0];
    if (d && d.d < d.dm.upliftR + 0.5) tappedDomes.add(d.dm.id);
  }
  let reachable = 0, untapped = 0, untappedNeverTried = 0;
  for (const dm of t.domes) {
    if (!isCharged(dm)) continue;
    let has = false;
    for (let a = 0; a < 16 && !has; a++) for (const r of [0.1, dm.saltR + 0.2, dm.saltR + dm.flankW * 0.5]) {
      const x = dm.x + Math.cos((a * Math.PI) / 8) * r, y = dm.y + Math.sin((a * Math.PI) / 8) * r;
      if (surveyAt(x, y) && truthPay(w.seed, x, y) !== null) { has = true; break; }
    }
    if (!has) continue;
    reachable++;
    if (!tappedDomes.has(dm.id)) { untapped++; if (!explored.some((e) => Math.hypot(e.x - dm.x, e.y - dm.y) < dm.upliftR + 0.5)) untappedNeverTried++; }
  }
  return { reachableFields: reachable, untappedFields: untapped, untappedNeverTried };
}

function measure(w: WorldState, t0: number, holes: { x: number; y: number }[]) {
  const o = ops(w), f = field(w);
  const discoveryDome = (() => { const p = o.production.producers[0]; return p ? { x: p.x, y: p.y } : null; })();
  const newFields = new Set<string>();
  for (const p of o.production.producers) if (discoveryDome && dist(p, discoveryDome) >= OWN_FIELD_KM) newFields.add(f.taps.find((t) => t.wellId === p.wellId)?.tank ?? p.wellId);
  const explored = [...o.past, ...(o.well ? [o.well] : [])].map((x) => ({ x: x.x, y: x.y }));
  return {
    value: o.cash - o.debt,
    cash: o.cash,
    debt: o.debt,
    solvent: o.outcome.endedAt === null,
    barrels: o.production.producers.reduce((a, p) => a + p.cumBbl, 0),
    producers: o.production.producers.length,
    newFields: newFields.size,
    holesAfter: holes.length,
    spentAfter: (o.ledger.entries.filter((e) => e.t > t0 && e.category !== "production" && e.category !== "bank" && e.category !== "opening").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0)) / 100,
    ...opportunities(w, explored),
  };
}

// ───────────────────────────────────────────── cohorts
function seedsFor(): string[] {
  const seeds: string[] = [];
  for (let i = 0; seeds.length < N && i < N * 3; i++) if (printedMap(seedN(i)).hills[0]) seeds.push(seedN(i));
  return seeds.filter((_, i) => i % SHARDS === SHARD);
}

function lens(seed: string, x: number, y: number, toFt: number): number {
  const prof = runningProfile(seed, x, y);
  let best = 0, run = 0;
  for (let i = 0; i * RUN_STEP_FT < toFt; i++) { if (prof[i]! > 0.35) { run += RUN_STEP_FT; best = Math.max(best, run); } else run = 0; }
  return best;
}
/** Cohort A's scaffolding, as m8.harness.ts: truth's cheapest oil site. */
function firstSite(seed: string): { x: number; y: number } | null {
  const t = generateGeology(seed);
  let best: { x: number; y: number; cost: number } | null = null;
  for (const s of SURVEYS) {
    const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.25) {
      if (!insidePoly(s.poly, x, y)) continue;
      const hc = columnAt(t, x, y, 450).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
      if (!hc || hc.fluid !== "oil") continue;
      const ft = hc.top * FT, cost = ft + 4 * lens(seed, x, y, ft);
      if (!best || cost < best.cost) best = { x, y, cost };
    }
  }
  return best;
}
/** m8.harness.ts's first-well drilling, unchanged, so that cohort A's worlds are M8b's. */
function drillOutM8(w: WorldState, quitBelowFt: number): "oil" | "other" {
  gameEngine.advance(w, w.time + 3 * DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let k = 0; k < 2000; k++) {
    const s = ops(w).well?.status;
    if (s !== "rigging" && s !== "drilling" && s !== "stuck") break;
    gameEngine.advance(w, w.time + DAY, { stopOnInterrupt: true });
    const q = ops(w).crew.pending;
    if (q) {
      const stop = q.kind === "quit" || q.kind === "decide" || q.kind === "abandon";
      const keep = stop && ops(w).well!.depthFt < quitBelowFt && q.kind !== "abandon";
      if (q.kind === "quit" && keep) { const room = pos(w).creditRoomCents; if (room >= 5_000) cmd(w, "bank.borrow", { cents: Math.floor(room / 5_000) * 5_000 }); }
      cmd(w, keep ? "crew.decline" : "crew.accept", { id: q.id });
    }
    const now = ops(w).well!;
    if (now.status === "stuck" && !ops(w).crew.pending && !now.busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
  }
  const well = ops(w).well;
  if (well?.status === "gusher" && well.outcome?.startsWith("OIL")) {
    const room = pos(w).creditRoomCents;
    if (pos(w).cashCents < 8_000 && room >= 5_000) cmd(w, "bank.borrow", { cents: 5_000 });
    if (!rej(cmd(w, "prod.cap"))) return "oil";
  }
  return "other";
}

function cohortA(seed: string) {
  const site = firstSite(seed);
  if (!site) return { cohort: "A", seed, strike: false, why: "no oil site" };
  const w = gameEngine.createWorld(seed, 0);
  cmd(w, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
  cmd(w, "lease.take", { surveyId: surveyAt(site.x, site.y)!.id, offer: "asking" });
  if (rej(cmd(w, "rig.spud", site))) return { cohort: "A", seed, strike: false, why: "no spud" };
  if (drillOutM8(w, 2500) !== "oil") return { cohort: "A", seed, strike: false, why: "first well failed" };
  const first: Site = { x: site.x, y: site.y, payHintFt: null, why: "discovery" };
  return { cohort: "A", seed, strike: true, strikeDay: Math.round(w.time / DAY), cashAtStrike: ops(w).cash, rows: (["passive", "explorer"] as Strategy[]).map((st) => play(w, st, [first], false)) };
}

/** M7's disciplined campaign to its first production (36 months at most), unchanged. */
function cohortB(seed: string) {
  const w = gameEngine.createWorld(seed, CAMPAIGN_START);
  const end = CAMPAIGN_START + 36 * 30 * DAY;
  doFieldwork(w);
  const sites = rankM7(w, readCountry(w));
  const c = ops(w).crew.candidates.filter((d) => /Well spoken of/.test(d.remark)).sort((a, b) => b.years - a.years)[0];
  if (c) cmd(w, "crew.hire", { id: c.id });
  const tried: Site[] = [];
  let wells = 0;
  while (w.time < end && ops(w).outcome.endedAt === null && wells < 12 && !ops(w).production.producers.length) {
    const next = nextSiteM7(w, sites, tried);
    if (!next) break;
    if (!spudAt(w, next, end)) break;
    tried.push(next);
    wells++;
    drillOut(w);
  }
  if (!ops(w).production.producers.length) return { cohort: "B", seed, strike: false, why: ops(w).outcome.endedAt !== null ? "bankrupt" : "no production in 36 months" };
  return { cohort: "B", seed, strike: true, strikeDay: Math.round((w.time - CAMPAIGN_START) / DAY), cashAtStrike: ops(w).cash, holesBefore: wells, rows: (["passive", "explorer"] as Strategy[]).map((st) => play(w, st, tried, true)) };
}

/** m7.harness.ts's nextSiteM7, unchanged (cohort B before its discovery). */
function nextSiteM7(w: WorldState, sites: Site[], tried: Site[]): Site | null {
  const last = tried[tried.length - 1];
  if (last) {
    const lastWell = ops(w).past.concat(ops(w).well ? [ops(w).well!] : []).slice(-1)[0];
    const acct = evidence(w).find((e) => e.kind === "account" && e.wellId === lastWell?.id) as unknown as { rock: unknown; rockDry: boolean; deepestFt: number; result: string } | undefined;
    const ex = last.rise ? expectAt(w, last.rise.x, last.rise.y) : null;
    const onRise = last.rise ? tried.filter((t) => t.rise && dist(t.rise, last.rise!) < 0.2) : [];
    if (acct?.rockDry && last.strong && last.rise && onRise.length < 2) {
      const toward = last.toward ?? { x: last.rise.x + 0.8, y: last.rise.y - 0.6 };
      const d = dist(toward, last.rise) || 1;
      const flank = { ...last, x: last.rise.x + ((toward.x - last.rise.x) / d) * 1.1, y: last.rise.y + ((toward.y - last.rise.y) / d) * 1.1, why: "flank step-out" };
      if (surveyAt(flank.x, flank.y)) return flank;
    }
    if (acct && !acct.rock && ex && ex.hi !== null && acct.deepestFt > ex.hi && last.rise && dist(last, last.rise) > 0.25 && onRise.length < 2) {
      const back = { ...last, x: last.rise.x, y: last.rise.y, why: "back to the crest" };
      if (surveyAt(back.x, back.y)) return back;
    }
  }
  for (const s of sites) {
    if (tried.some((t) => dist(t, s) < 0.3)) continue;
    const ex = s.rise ? expectAt(w, s.rise.x, s.rise.y) : null;
    if (ex?.rockDry && !s.strong) continue;
    if (ex?.rockDry && tried.some((t) => t.rise && s.rise && dist(t.rise, s.rise) < 0.2)) continue;
    if (ex && !ex.rockDry && ex.lo > 2_300) continue;
    return s;
  }
  return null;
}

it("one rig after a discovery", () => {
  for (const seed of seedsFor()) {
    for (const cohort of COHORTS) {
      const r = cohort === "A" ? cohortA(seed) : cohortB(seed);
      if (OUT) appendFileSync(OUT, JSON.stringify(r) + "\n");
    }
  }
});
