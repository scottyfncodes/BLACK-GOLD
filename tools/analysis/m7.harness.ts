/*
 * M7, Reading the Ground: paired before-and-after campaigns. Analysis only; not part of CI.
 * Run: OUT=/path/results.jsonl WORLDS=240 SHARD=0 SHARDS=1 \
 *   npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/m7.harness.ts
 * Then compare two result files (before, after): node tools/analysis/m7-compare.mjs before.jsonl after.jsonl
 *
 * The same harness runs on the build before M7 and on M7. Four profiles play matched three-year
 * campaigns on the same seeded worlds:
 *  - Blind Speculator, Informed Operator and Omniscient bound exactly as in the PR #11 audit.
 *  - Disciplined Operator: as in PR #11 on a build without M7. With M7 it also weighs the new
 *    evidence, which the player sees in the field notes: the geologist's depth readings, the
 *    accounts of its own ended holes (rock, salt, shows), and gypsum in the bailer. It ranks rises by
 *    signs and depth, skips ground its evidence has ruled out or cannot afford, declines counsel to
 *    quit only when its evidence puts the rock within its means, steps out on what a hole proved, and
 *    stops drilling when nothing worth a hole is left.
 * The first three profiles read only what the game shows the player (`knowledgeOf`, the printed
 * map, the books, the position and recovery paths). Truth is read only to measure afterwards
 * (`truth*`, `diagnose`) and by the Omniscient bound.
 */
import { it } from "vitest";
import { appendFileSync } from "node:fs";
import * as sim from "../../src/sim";
import { CAMPAIGN_START, gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, recoveryPaths, type Evidence, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { JEFFERSON_1890, projectKm } from "../../src/content/geography/jefferson1890";
// Truth: for measurement and the Omniscient bound only.
import { generateGeology, columnAt, rockAt } from "../../src/sim/geology/truth/model";
import { runningProfile, RUN_STEP_FT } from "../../src/sim/hidden/quicksand";

const M7 = typeof (sim as Record<string, unknown>).readSpot === "function";
const MONTHS = Number(process.env.MONTHS ?? 36);
const N = Number(process.env.WORLDS ?? 240);
const SHARD = Number(process.env.SHARD ?? 0), SHARDS = Number(process.env.SHARDS ?? 1);
const OUT = process.env.OUT;
const ONLY = process.env.PROFILES?.split(",");
// Diagnosis only: scale the provisional fieldwork costs (0 = free) to separate their effect from the rest of M7.
if (M7 && process.env.FIELD_SCALE !== undefined) {
  const costs = (sim as unknown as { FIELD_COSTS: Record<string, number> }).FIELD_COSTS;
  for (const k of Object.keys(costs)) costs[k] = Math.round(costs[k]! * Number(process.env.FIELD_SCALE));
}
const FT = 3.2808;
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rej = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
type Str = { size: number; method?: string; damage?: string | null; hung?: boolean };
type W = { id: string; name: string; x: number; y: number; surveyId: string; spudAt: number; status: string; depthFt: number; casedFt: number; outcome?: string; strings: Str[]; collapse?: unknown; fishCount: number; busy?: unknown };
type Ops = { cash: number; debt: number; dayRate: number; well: W | null; past: W[]; crew: { pending: { id: number; kind: string; text: string } | null; candidates: { id: string; wageCents: number; years: number; remark: string }[] }; outcome: { endedAt: number | null; firstOilAt: number | null }; production: { producers: { wellId: string; since: number }[] }; ledger: { entries: { t: number; category: string; ref?: { wellId?: string }; lines: { account: string; cents: number }[] }[] } };
const ops = (w: WorldState) => operationsOf(w) as unknown as Ops;
const pos = (w: WorldState) => positionOf(w.systems.operations as never, w.seed, w.time) as unknown as { cashCents: number; creditRoomCents: number; heldLeases: string[] };
const paths = (w: WorldState) => recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time)) as unknown as { kind: string; borrowCents?: number; surveyId?: string }[];
const active = (w: WorldState) => { const s = ops(w).well?.status; return s === "rigging" || s === "drilling" || s === "stuck"; };
const surveyAt = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y));
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ───────────────────────────────────────────── public-information play
type Site = { x: number; y: number; payHintFt: number | null; why: string; toward?: { x: number; y: number }; oilSigns?: boolean; rise?: { x: number; y: number }; strong?: boolean; score?: number };
type Ev = Evidence & Record<string, unknown>;
const evidence = (w: WorldState) => knowledgeOf(w).evidence as Ev[];

const MARSH = JEFFERSON_1890.areas.filter((a) => a.kind === "marsh").map((a) => a.points.map((p) => { const k = projectKm(JEFFERSON_1890, p); return [k.x, k.y] as [number, number]; }));
const inMarsh = (x: number, y: number) => MARSH.some((poly) => insidePoly(poly, x, y));

function errand(w: WorldState, type: string, payload: unknown): void {
  if (rej(cmd(w, type, payload))) return;
  for (let k = 0; k < 20 && knowledgeOf(w).task; k++) gameEngine.advance(w, w.time + MINUTES_PER_DAY);
}

/** PR #11's reading of the country, from evidence only. Unchanged, so the profiles stay comparable. */
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

function doFieldwork(w: WorldState): void {
  for (const s of SURVEYS) errand(w, "fieldwork.walk", { surveyId: s.id });
  const rises = readCountry(w);
  for (let pass = 0; pass < 2; pass++) for (const s of SURVEYS) {
    const c = { x: s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, y: s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length };
    if (rises.some((r) => dist(r, c) < 2)) errand(w, "fieldwork.walk", { surveyId: s.id });
  }
  const consulted = new Set<string>();
  for (const r of readCountry(w).slice(0, 5)) { const sv = surveyAt(r.x, r.y); if (sv && !consulted.has(sv.id)) { consulted.add(sv.id); errand(w, "fieldwork.consult", { surveyId: sv.id, who: "geologist" }); } }
  const top = readCountry(w).slice(0, 3);
  const asked = new Set<string>();
  for (const site of top) for (const well of printedMap(w.seed).wells) {
    if (dist(site, well) < 2 && !asked.has(well.id)) { asked.add(well.id); errand(w, "fieldwork.inquire", { wellId: well.id }); }
  }
}

/**
 * The disciplined operator's own reading of the rock at a spot, from evidence the field notes show:
 * its own holes nearby (rock met, rock dry to the salt), the latest geologist's reading of the rise,
 * a settler's hard rock. (The game's own reading follows the same order; this one is the harness's,
 * written from the evidence fields, not borrowed.)
 */
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


// ───────────────────────────────────────────── drilling
type Profile = "blind" | "informed" | "disciplined" | "omniscient";
interface Rec { quitAdvice: { depthFt: number; cash: number; credit: number; payFt: number | null; accepted: boolean }[]; capFailed: number; withdrew: boolean }

function drillOut(w: WorldState, prof: Profile, site: Site, rec: Rec): void {
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  const disciplined = prof === "disciplined" || prof === "omniscient";
  const reads = M7 && prof === "disciplined";
  for (let k = 0; k < 4000 && active(w); k++) {
    const r = gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    if (!active(w)) break;
    const well = ops(w).well!;
    // Where the operator expects the pay: PR #11's settler-only hint, or (with M7) its reading of the rock.
    const ex = reads ? expectAt(w, well.x, well.y) : null;
    const target = reads ? (ex && !ex.rockDry ? (ex.hi ?? ex.lo + 300) + 150 : null) : site.payHintFt !== null ? site.payHintFt + 150 : null;
    const reach = target !== null && well.depthFt < target;
    if (disciplined && reach && r.events.some((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === "lowfunds")) {
      const room = pos(w).creditRoomCents;
      if (room >= 5_000) cmd(w, "bank.borrow", { cents: Math.floor(room / 5_000) * 5_000 });
    }
    const q = ops(w).crew.pending;
    if (q) {
      let accept = true;
      if (q.kind === "quit") {
        const p = pos(w);
        const daysLeft = (p.cashCents + (disciplined ? p.creditRoomCents : 0)) / 1_200;
        const inSalt = /rock salt/.test(q.text);
        accept = inSalt || !(disciplined && reach && (target! - well.depthFt) / 40 < daysLeft);
        rec.quitAdvice.push({ depthFt: well.depthFt, cash: p.cashCents, credit: p.creditRoomCents, payFt: truthPay(w.seed, well.x, well.y), accepted: accept });
      }
      cmd(w, accept ? "crew.accept" : "crew.decline", { id: q.id });
    }
    const now = ops(w).well!;
    if (now.status === "stuck" && !ops(w).crew.pending && !now.busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
  }
  const well = ops(w).well;
  if (well && well.status === "gusher" && well.outcome?.startsWith("OIL")) {
    if (prof === "blind") { if (rej(cmd(w, "prod.cap"))) rec.capFailed++; }
    else {
      const cap = paths(w).find((p) => p.kind === "cap");
      if (cap?.borrowCents) cmd(w, "bank.borrow", { cents: cap.borrowCents });
      if (rej(cmd(w, "prod.cap"))) rec.capFailed++;
    }
  }
}

function spudAt(w: WorldState, at: { x: number; y: number }, end: number, prof: Profile): boolean {
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
    if (drill && prof === "blind") {
      borrow(drill.borrowCents);
      if (drill.kind === "leaseAndDrill") cmd(w, "lease.take", { surveyId: drill.surveyId, offer: "asking" });
      const t = SURVEYS.find((x) => x.id === drill.surveyId)!;
      const spot = s.id === t.id ? at : { x: t.poly.reduce((a, p) => a + p[0], 0) / t.poly.length, y: t.poly.reduce((a, p) => a + p[1], 0) / t.poly.length };
      if (!rej(cmd(w, "rig.spud", spot))) return true;
    }
    if (drill && held && drill.borrowCents) { borrow(drill.borrowCents); if (!rej(cmd(w, "rig.spud", at))) return true; }
    const c = ps.find((p) => p.kind === "contract");
    if (c) { borrow(c.borrowCents); cmd(w, "company.contract"); gameEngine.advance(w, w.time + 31 * MINUTES_PER_DAY); continue; }
    const pl = ps.find((p) => p.kind === "pull");
    if (pl) { borrow(pl.borrowCents); cmd(w, "rig.pull"); gameEngine.advance(w, w.time + 6 * MINUTES_PER_DAY); continue; }
    const b = ps.find((p) => p.kind === "buyRig");
    if (b) { borrow(b.borrowCents); cmd(w, "company.buyRig"); continue; }
    if (ps.some((p) => p.kind === "contracted")) { gameEngine.advance(w, w.time + 31 * MINUTES_PER_DAY); continue; }
    if (!held && pos(w).cashCents > 0) {
      const any = ps.find((p) => p.kind === "leaseAndDrill" || p.kind === "drill");
      if (any) { borrow(any.borrowCents); if (any.kind === "leaseAndDrill") cmd(w, "lease.take", { surveyId: any.surveyId, offer: "asking" }); const t = SURVEYS.find((x) => x.id === any.surveyId)!; if (!rej(cmd(w, "rig.spud", { x: t.poly.reduce((a, p) => a + p[0], 0) / t.poly.length, y: t.poly.reduce((a, p) => a + p[1], 0) / t.poly.length }))) return true; }
    }
    return false;
  }
  return false;
}

/**
 * With M7, the disciplined operator's choice of the next site, from its evidence: skip ground its
 * evidence has ruled out (a rise whose rock its own hole found dry to the salt, unless the signs are
 * strong enough for one flank step-out; rock read as deeper than the tools can reach), and step
 * back toward the crest when a hole missed the rock it expected. Money is not a reason to skip:
 * the game's recovery paths (contract work) rebuild it. Returns null only when nothing worth a hole
 * is left: it stops drilling and keeps what it has.
 */
function nextSiteM7(w: WorldState, sites: Site[], tried: Site[]): Site | null {
  const last = tried[tried.length - 1];
  if (last) {
    const lastWell = ops(w).past.concat(ops(w).well ? [ops(w).well!] : []).slice(-1)[0];
    const acct = evidence(w).find((e) => e.kind === "account" && e.wellId === lastWell?.id) as unknown as { rock: unknown; rockDry: boolean; deepestFt: number; result: string } | undefined;
    const ex = last.rise ? expectAt(w, last.rise.x, last.rise.y) : null;
    const onRise = last.rise ? tried.filter((t) => t.rise && dist(t.rise, last.rise!) < 0.2) : [];
    // Rock dry to the salt: one step out onto the flank, toward the strongest sign, where the signs are strong.
    if (acct?.rockDry && last.strong && last.rise && onRise.length < 2) {
      const toward = last.toward ?? { x: last.rise.x + 0.8, y: last.rise.y - 0.6 };
      const d = dist(toward, last.rise) || 1;
      const flank = { ...last, x: last.rise.x + ((toward.x - last.rise.x) / d) * 1.1, y: last.rise.y + ((toward.y - last.rise.y) / d) * 1.1, why: "flank step-out" };
      if (surveyAt(flank.x, flank.y)) return flank;
    }
    // Missed the rock it expected, a fair way off the crest: try nearer the crest once.
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
    // Rock read as deeper than these tools go: not worth a hole.
    if (ex && !ex.rockDry && ex.lo > 2_300) continue;
    return s;
  }
  return null;
}

/** Re-rank the rises by evidence of depth as well as signs: shallower rock is cheaper to test. */
function rankM7(w: WorldState, sites: Site[]): Site[] {
  const key = (s: Site) => {
    const ex = s.rise ? expectAt(w, s.rise.x, s.rise.y) : null;
    const depth = ex && !ex.rockDry ? (ex.hi ?? ex.lo + 600) : 1_600;
    return s.score! - depth / 1_000;
  };
  return [...sites].sort((a, b) => key(b) - key(a));
}

// ───────────────────────────────────────────── truth (measurement and the Omniscient bound only)
function truthPay(seed: string, x: number, y: number): number | null {
  const hc = columnAt(generateGeology(seed), x, y, 800).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
  return hc && hc.top * FT <= 2500 && hc.fluid === "oil" ? hc.top * FT : null;
}
function truthSaltFt(seed: string, x: number, y: number): number | null {
  const iv = columnAt(generateGeology(seed), x, y, 800).find((i) => i.lithology === "salt");
  return iv ? iv.top * FT : null;
}
function truthLens(seed: string, x: number, y: number, toFt: number): number {
  const prof = runningProfile(seed, x, y);
  let lens = 0, run = 0;
  for (let i = 0; i * RUN_STEP_FT < toFt; i++) { if (prof[i]! > 0.35) { run += RUN_STEP_FT; lens = Math.max(lens, run); } else run = 0; }
  return lens;
}
function omniscientSites(seed: string): Site[] {
  const t = generateGeology(seed);
  const out: (Site & { cost: number })[] = [];
  for (const s of SURVEYS) {
    const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.25) {
      if (!insidePoly(s.poly, x, y)) continue;
      const hc = columnAt(t, x, y, 500).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
      if (!hc || hc.fluid !== "oil") continue;
      const ft = hc.top * FT, lens = truthLens(seed, x, y, ft);
      out.push({ x, y, payHintFt: ft, why: "truth", cost: ft + 4 * lens });
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

function diagnose(seed: string, w: W): string {
  if (w.status === "gusher") return w.outcome?.startsWith("OIL") ? "struck oil" : "struck gas";
  const pay = truthPay(seed, w.x, w.y);
  if (pay === null) return "no oil within reach (site)";
  if (w.collapse || w.strings.some((s) => s.damage === "collapsed") || /swage|nothing left/.test(w.outcome ?? "")) return "mechanical";
  const prof = runningProfile(seed, w.x, w.y);
  let near = false;
  for (let f = Math.max(0, w.depthFt - 25); f <= w.depthFt + 10; f += RUN_STEP_FT) if ((prof[Math.floor(f / RUN_STEP_FT)] ?? 0) > 0.2) near = true;
  const inSand = near && w.depthFt < pay;
  if (inSand && w.strings.length >= 3) return "casing sizes exhausted";
  if (inSand || w.strings.some((s) => s.hung)) return "running sand";
  if (/abandoned at|plugged and abandoned/.test(w.outcome ?? "") && w.fishCount >= 2) return "mechanical";
  if (/^The money/.test(w.outcome ?? "")) return "capital exhausted";
  if (/save the company's money/.test(w.outcome ?? "")) return "plugged on advice short of the pay";
  return "other";
}

// ───────────────────────────────────────────── the campaign
function campaign(seed: string, prof: Profile) {
  const w = gameEngine.createWorld(seed, CAMPAIGN_START);
  const end = CAMPAIGN_START + MONTHS * 30 * MINUTES_PER_DAY;
  const hill = printedMap(seed).hills[0]!;
  const rec: Rec = { quitAdvice: [], capFailed: 0, withdrew: false };
  let sites: Site[];
  if (prof === "blind") {
    sites = [[0.15, 0.1], [-0.15, -0.1], [0.3, -0.2], [-0.3, 0.2], [0, 0.35], [0.35, 0], [-0.35, 0], [0, -0.35]].map(([dx, dy]) => ({ x: hill.x + dx!, y: hill.y + dy!, payHintFt: null, why: "the obvious guess" })).filter((s) => surveyAt(s.x, s.y));
  } else if (prof === "omniscient") {
    sites = omniscientSites(seed);
  } else {
    doFieldwork(w);
    sites = readCountry(w);
    if (M7 && prof === "disciplined") sites = rankM7(w, sites);
  }
  const fieldDays = (w.time - CAMPAIGN_START) / MINUTES_PER_DAY;
  if (prof === "disciplined" || prof === "omniscient") {
    const c = ops(w).crew.candidates.filter((d) => /Well spoken of/.test(d.remark)).sort((a, b) => b.years - a.years)[0];
    if (c) cmd(w, "crew.hire", { id: c.id });
  }
  if (!sites.length) sites = [{ x: hill.x + 0.15, y: hill.y + 0.1, payHintFt: null, why: "no evidence: the obvious guess" }];
  const firstSite = sites[0]!;
  let wells = 0, k = 0;
  const tried: Site[] = [];
  while (w.time < end && ops(w).outcome.endedAt === null && wells < 12) {
    if (ops(w).production.producers.length) { gameEngine.advance(w, Math.min(end, w.time + 30 * MINUTES_PER_DAY)); continue; }
    let at: Site;
    if (prof === "blind") at = sites[k++ % sites.length]!;
    else if (M7 && prof === "disciplined") {
      const next = nextSiteM7(w, sites, tried);
      if (!next) { rec.withdrew = true; break; }
      at = next;
    } else {
      const last = tried[tried.length - 1];
      const disc = prof === "disciplined" || prof === "omniscient";
      const stepped = last && tried.filter((t) => dist(t, last) < 1.2).length >= 2;
      if (disc && last && last.oilSigns && !stepped) {
        const dir = last.toward && dist(last.toward, last) > 0.05 ? { x: (last.toward.x - last.x) / dist(last.toward, last), y: (last.toward.y - last.y) / dist(last.toward, last) } : { x: 0.8, y: -0.6 };
        const off = { x: last.x + dir.x * 0.6, y: last.y + dir.y * 0.6 };
        at = surveyAt(off.x, off.y) ? { ...last, ...off } : sites[Math.min(k++, sites.length - 1)]!;
      } else at = sites[Math.min(k++, sites.length - 1)]!;
    }
    if (!spudAt(w, at, end, prof)) break;
    tried.push(at);
    wells++;
    drillOut(w, prof, at, rec);
  }
  if (w.time < end && ops(w).outcome.endedAt === null) gameEngine.advance(w, end);
  const o = ops(w);
  const all = [...o.past, ...(o.well ? [o.well] : [])];
  const first = all[0];
  const prodOf = (id: string) => o.ledger.entries.filter((e) => e.category === "production" && e.ref?.wellId === id).reduce((a, e) => a - e.lines.filter((l) => l.account === "oilSales" || l.account === "hauling" || l.account === "royalty").reduce((b, l) => b + l.cents, 0), 0);
  const costOf = (id: string) => o.ledger.entries.filter((e) => e.ref?.wellId === id && e.category !== "production").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash").reduce((b, l) => b + l.cents, 0), 0);
  const outCents = (f: (e: Ops["ledger"]["entries"][number]) => boolean) => o.ledger.entries.filter(f).reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0);
  const capped = o.production.producers[0];
  const spentBefore = capped ? outCents((e) => e.t <= capped.since && e.category !== "opening" && e.category !== "bank") : null;
  // Footage: in holes with no oil within reach below them (truth), in salt, and oil left within 400 ft below an abandoned hole.
  let footage = 0, barrenFt = 0, saltFt = 0, abandonedReachable = 0, abandonedFtToPay = 0;
  for (const x of all) {
    footage += x.depthFt;
    const pay = truthPay(seed, x.x, x.y);
    if (pay === null) barrenFt += x.depthFt;
    const salt = truthSaltFt(seed, x.x, x.y);
    if (salt !== null && x.depthFt > salt) saltFt += x.depthFt - salt;
    if (x.status === "dry" && pay !== null && pay > x.depthFt && pay - x.depthFt <= 400) { abandonedReachable++; abandonedFtToPay += pay - x.depthFt; }
  }
  const oilWells = all.filter((x) => x.status === "gusher" && x.outcome?.startsWith("OIL")).length;
  return {
    seed, profile: prof, m7: M7,
    survived: o.outcome.endedAt === null,
    fieldDays,
    firstOil: !!first && first.status === "gusher" && !!first.outcome?.startsWith("OIL"),
    firstCommercial: !!first && o.production.producers.some((p) => p.wellId === first.id) && prodOf(first.id) >= costOf(first.id),
    anyOil: oilWells > 0,
    oilWells,
    producing: o.production.producers.length > 0,
    monthsToProduction: capped ? (capped.since - CAMPAIGN_START) / MINUTES_PER_DAY / 30 : null,
    spentToProduction: spentBefore === null ? null : spentBefore / 100,
    bankruptBeforeProduction: o.outcome.endedAt !== null && !o.production.producers.length,
    bankruptAfterOil: o.outcome.endedAt !== null && oilWells > 0,
    endWorth: o.cash - o.debt,
    wells: all.length,
    footage: Math.round(footage), barrenFt: Math.round(barrenFt), saltFt: Math.round(saltFt), abandonedReachable, abandonedFtToPay: Math.round(abandonedFtToPay),
    drillingSpend: outCents((e) => !!e.ref?.wellId && e.category !== "production") / 100,
    fieldworkSpend: outCents((e) => e.category === "fieldwork") / 100,
    withdrew: rec.withdrew,
    causes: all.map((x) => diagnose(seed, x)),
    firstSiteHasOil: truthPay(seed, firstSite.x, firstSite.y) !== null,
    quitAdvice: rec.quitAdvice,
    capFailed: rec.capFailed,
  };
}

function seedsFor(): string[] {
  const seeds: string[] = [];
  for (let i = 0; seeds.length < N && i < N * 3; i++) if (printedMap(seedN(i)).hills[0]) seeds.push(seedN(i));
  return seeds.filter((_, i) => i % SHARDS === SHARD);
}

it("campaigns", () => {
  const profiles = (["blind", "informed", "disciplined", "omniscient"] as Profile[]).filter((p) => !ONLY || ONLY.includes(p));
  for (const s of seedsFor()) for (const p of profiles) {
    const r = campaign(s, p);
    if (OUT) appendFileSync(OUT, JSON.stringify(r) + "\n");
  }
});

/**
 * With M7: is the geologist's range honest (does it contain the true depth to the rock under the
 * rise he judged?), and how often does gypsum in the bailer mean rock below? Truth is read here
 * only to score the game's evidence.
 */
it("calibration", () => {
  if (!M7 || !OUT || ONLY) return;
  const cal = { readings: 0, contained: 0, below: 0, above: 0, deep: 0, deepRight: 0, flat: 0, gypsumNear: 0, gypsumFar: 0, samplesNear: 0, samplesFar: 0 };
  for (const s of seedsFor()) {
    const w = gameEngine.createWorld(s, CAMPAIGN_START);
    const t = generateGeology(s);
    // The geologist on every survey (in a world of its own: his fees would leave nothing to drill with).
    const wg = gameEngine.createWorld(s, CAMPAIGN_START);
    for (const sv of SURVEYS) { (wg.systems.operations as unknown as { ledger: { balances: Record<string, number> } }).ledger.balances.cash = 1_000_000; errand(wg, "fieldwork.consult", { surveyId: sv.id, who: "geologist" }); }
    for (const e of evidence(wg)) {
      if (e.kind !== "reading") continue;
      const r = e as unknown as { verdict: string; rockFt: [number, number | null] | null; x: number; y: number };
      const dome = t.domes.filter((d) => Math.hypot(d.x - r.x, d.y - r.y) < 1.2).sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y))[0];
      const crestFt = dome ? dome.crest * FT : null;
      if (r.verdict === "flat") { cal.flat++; continue; }
      if (r.verdict === "deep") { cal.deep++; if (crestFt === null || crestFt >= r.rockFt![0]) cal.deepRight++; continue; }
      if (r.verdict !== "range" || crestFt === null) continue;
      cal.readings++;
      const [lo, hi] = r.rockFt as [number, number];
      if (crestFt >= lo && crestFt <= hi) cal.contained++; else if (crestFt > hi) cal.below++; else cal.above++;
    }
    // Gypsum: drill one hole on each printed hill's crest with the driller, and score every sample.
    const hill = printedMap(s).hills[0]!;
    if (rej(cmd(w, "lease.take", { surveyId: surveyAt(hill.x, hill.y)!.id, offer: "asking" })) || rej(cmd(w, "rig.spud", { x: hill.x, y: hill.y }))) continue;
    drillOut(w, "informed", { x: hill.x, y: hill.y, payHintFt: null, why: "" }, { quitAdvice: [], capFailed: 0, withdrew: false });
    for (const e of evidence(w)) {
      if (e.kind !== "sample") continue;
      const sm = e as unknown as { baseFt: number; gypsum?: boolean; lith: string };
      if (sm.lith === "rock" || sm.lith === "salt") continue;
      let near = false;
      for (let f = 5; f <= 100; f += 5) if (rockAt(t, hill.x, hill.y, (sm.baseFt + f) / FT).lithology === "caprock") { near = true; break; }
      if (near) { cal.samplesNear++; if (sm.gypsum) cal.gypsumNear++; } else { cal.samplesFar++; if (sm.gypsum) cal.gypsumFar++; }
    }
  }
  appendFileSync(OUT, JSON.stringify({ calibration: cal, shard: SHARD }) + "\n");
});
