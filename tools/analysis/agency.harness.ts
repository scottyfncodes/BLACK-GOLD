/*
 * Player agency audit (PR #11). Analysis only; not part of CI.
 * Run: npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/agency.harness.ts
 *   WORLDS=120 (default) seeded worlds with a printed hill; MONTHS=36.
 *
 * Four player profiles play matched three-year campaigns on the same worlds:
 *  - Blind Speculator: the existing scripted player (hill flank first, the game's recovery
 *    paths after a failure, caps without borrowing, accepts every recommendation).
 *  - Informed Operator: fieldwork first (walks every survey, asks settlers near the likeliest
 *    rises about their wells), then drills the best-evidenced rise; otherwise as Blind.
 *  - Disciplined Operator: the same information, plus deliberate decisions: hires a
 *    well-spoken-of driller, caps with the bank's help, declines counsel to quit only when the
 *    settlers' wells put the pay within reach, borrows to finish then, keeps a contract reserve,
 *    and moves between sites on what its own bailer showed.
 *  - Omniscient Operator: the Disciplined Operator's play, its sites chosen from hidden truth
 *    (an analytical upper bound, not a strategy).
 * The first three read only what the game shows the player: `knowledgeOf` (evidence), the
 * printed map, the company's books and position, and the game's recovery paths. Hidden truth
 * is read only by `diagnose*` (to explain outcomes after the fact) and by the Omniscient bound.
 */
import { it } from "vitest";
import { CAMPAIGN_START, gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, recoveryPaths, type Evidence, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { JEFFERSON_1890, projectKm } from "../../src/content/geography/jefferson1890";
// Truth: for diagnosis and the Omniscient bound only.
import { generateGeology, columnAt } from "../../src/sim/geology/truth/model";
import { runningProfile, RUN_STEP_FT } from "../../src/sim/hidden/quicksand";

const MONTHS = Number(process.env.MONTHS ?? 36);
const N = Number(process.env.WORLDS ?? 120);
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rej = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
type Str = { size: number; method?: string; damage?: string | null; hung?: boolean };
type W = { id: string; x: number; y: number; surveyId: string; spudAt: number; status: string; depthFt: number; casedFt: number; outcome?: string; strings: Str[]; collapse?: unknown; fishCount: number; busy?: unknown };
type Ops = { cash: number; debt: number; well: W | null; past: W[]; crew: { pending: { id: number; kind: string; text: string } | null; candidates: { id: string; wageCents: number; years: number; remark: string }[] }; outcome: { endedAt: number | null; firstOilAt: number | null }; production: { producers: { wellId: string; since: number }[] }; ledger: { entries: { t: number; category: string; ref?: { wellId?: string }; lines: { account: string; cents: number }[] }[] } };
const ops = (w: WorldState) => operationsOf(w) as unknown as Ops;
const pos = (w: WorldState) => positionOf(w.systems.operations as never, w.seed, w.time) as unknown as { cashCents: number; creditRoomCents: number; heldLeases: string[] };
const paths = (w: WorldState) => recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time)) as unknown as { kind: string; borrowCents?: number; surveyId?: string }[];
const active = (w: WorldState) => { const s = ops(w).well?.status; return s === "rigging" || s === "drilling" || s === "stuck"; };
const surveyAt = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y));
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ───────────────────────────────────────────── public-information play
type Site = { x: number; y: number; payHintFt: number | null; why: string; toward?: { x: number; y: number }; oilSigns?: boolean };

/** The marsh, as the published map draws it: gas bubbling there is taken for marsh gas. */
const MARSH = JEFFERSON_1890.areas.filter((a) => a.kind === "marsh").map((a) => a.points.map((p) => { const k = projectKm(JEFFERSON_1890, p); return [k.x, k.y] as [number, number]; }));
const inMarsh = (x: number, y: number) => MARSH.some((poly) => insidePoly(poly, x, y));

/** Send the field party and wait for it to come back. */
function errand(w: WorldState, type: string, payload: unknown): void {
  if (rej(cmd(w, type, payload))) return;
  for (let k = 0; k < 20 && knowledgeOf(w).task; k++) gameEngine.advance(w, w.time + MINUTES_PER_DAY);
}

/**
 * The informed operator's reading of the country, from evidence only: rises (printed hills and
 * mounds found walking), gas seeps and waxy dirt near them (seeps far from any rise are taken
 * for marsh gas), sour springs, and settlers' wells nearby (shows, and the depth of hard rock).
 */
function readCountry(w: WorldState): Site[] {
  const ev = knowledgeOf(w).evidence as Evidence[];
  const rises: { x: number; y: number; relief: number }[] = printedMap(w.seed).hills.map((h) => ({ x: h.x, y: h.y, relief: h.reliefFt }));
  for (const e of ev) if (e.kind === "surfaceSign" && e.sign === "mound" && !rises.some((r) => dist(r, e) < 0.6)) rises.push({ x: e.x, y: e.y, relief: e.reliefFt ?? 3 });
  // A low rise is easily missed: a cluster of gas seeps or waxy dirt away from the marsh is a prospect in its own right.
  for (const e of ev) if (e.kind === "surfaceSign" && (e.sign === "gasSeep" || e.sign === "paraffinDirt") && !inMarsh(e.x, e.y) && !rises.some((r) => dist(r, e) < 1.6)) rises.push({ x: e.x, y: e.y, relief: 0 });
  const S = { faint: 0.4, clear: 0.7, strong: 1 } as const;
  const sites: (Site & { score: number })[] = [];
  for (const r of rises) {
    // An 1890 operator's reading: gas seeps and waxy dirt are oil signs; a sour spring speaks of caprock, not oil; a rise alone says little.
    let score = Math.min(0.3, r.relief / 50), seep: { x: number; y: number; s: number } | null = null;
    const why: string[] = [r.relief ? `a rise of ${r.relief} ft` : "signs without a rise"];
    for (const e of ev) {
      if (e.kind === "surfaceSign" && e.sign !== "mound" && dist(r, e) < 1.6 && !(e.sign === "gasSeep" && inMarsh(e.x, e.y))) {
        const s = S[e.strength];
        score += e.sign === "paraffinDirt" ? 3 * s : e.sign === "gasSeep" ? 2 * s : 0.3 * s;
        if (e.sign !== "sourSpring" && (!seep || s > seep.s)) seep = { x: e.x, y: e.y, s };
        why.push(e.sign);
      }
    }
    // A geologist's opinion names the signs he noticed in a survey; they count for the rises in it.
    const sv = surveyAt(r.x, r.y);
    for (const e of ev) if (e.kind === "opinion" && e.from === "geologist" && sv && e.surveyId === sv.id) {
      if (/waxy dirt/.test(e.text)) { score += 2; why.push("the geologist noted waxy dirt"); }
      else if (/gas bubbling/.test(e.text)) { score += 1.5; why.push("the geologist noted gas"); }
    }
    let hardRock: number | null = null;
    for (const e of ev) if (e.kind === "wellRecord" && dist(r, e) < 2) {
      for (const iv of e.intervals) {
        if (iv.show === "oil") { score += 3; why.push("oily scum in a settler's well"); }
        else if (iv.show === "gas") { score += 2; why.push("gas in a settler's well"); }
        else if (iv.show === "sulphur") score += 0.8;
        if (iv.lith === "rock" && (hardRock === null || iv.topFt < hardRock)) hardRock = iv.topFt;
      }
    }
    if (hardRock !== null) score += 1;
    // Where to drill: on the crest, drawn a little toward the strongest seep.
    const at = seep ? { x: r.x + (seep.x - r.x) * 0.3, y: r.y + (seep.y - r.y) * 0.3 } : { x: r.x, y: r.y };
    if (!surveyAt(at.x, at.y)) continue;
    sites.push({ ...at, payHintFt: hardRock, score, why: why.join(", "), toward: seep ? { x: seep.x, y: seep.y } : undefined, oilSigns: !!seep || why.some((x) => /geologist|oily|gas in/.test(x)) });
  }
  return sites.sort((a, b) => b.score - a.score);
}

/**
 * Fieldwork, as a diligent operator does it: walk every survey once; walk the ground around each
 * rise twice more (signs are easily missed); have the geologist look at the surveys under the
 * five likeliest rises; then ask the settlers near the three likeliest about their wells.
 */
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

// ───────────────────────────────────────────── drilling
/** Plus two for the PR #10 question (combinations of decisions at the same, truth-chosen best site): "bestBlind" plays it as PR #10 did, "bestCombo" with every disciplined decision. */
type Profile = "blind" | "informed" | "disciplined" | "omniscient" | "bestBlind" | "bestCombo";
interface Rec { quitAdvice: { depthFt: number; cash: number; credit: number; payFt: number | null; accepted: boolean }[]; capFailed: number }

function drillOut(w: WorldState, prof: Profile, payHintFt: number | null, rec: Rec): void {
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  const disciplined = prof === "disciplined" || prof === "omniscient" || prof === "bestCombo";
  for (let k = 0; k < 4000 && active(w); k++) {
    const r = gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    if (!active(w)) break;
    const well = ops(w).well!;
    const reach = payHintFt !== null && well.depthFt < payHintFt + 150;
    // Borrow to finish when the evidence puts the pay within reach.
    if (disciplined && reach && r.events.some((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === "lowfunds")) {
      const room = pos(w).creditRoomCents;
      if (room >= 5_000) cmd(w, "bank.borrow", { cents: Math.floor(room / 5_000) * 5_000 });
    }
    const q = ops(w).crew.pending;
    if (q) {
      let accept = true;
      if (q.kind === "quit") {
        // The disciplined operator declines it only when the settlers' wells put the pay close and the money can reach it.
        const p = pos(w);
        const daysLeft = (p.cashCents + (disciplined ? p.creditRoomCents : 0)) / 1_200;
        accept = !(disciplined && reach && (payHintFt! + 150 - well.depthFt) / 40 < daysLeft);
        rec.quitAdvice.push({ depthFt: well.depthFt, cash: p.cashCents, credit: p.creditRoomCents, payFt: truthPay(w.seed, well.x, well.y), accepted: accept });
      }
      cmd(w, accept ? "crew.accept" : "crew.decline", { id: q.id });
    }
    const now = ops(w).well!;
    if (now.status === "stuck" && !ops(w).crew.pending && !now.busy && rej(cmd(w, "rig.fish"))) cmd(w, "rig.abandon");
  }
  const well = ops(w).well;
  if (well && well.status === "gusher" && well.outcome?.startsWith("OIL")) {
    if (prof === "blind" || prof === "bestBlind") { if (rej(cmd(w, "prod.cap"))) rec.capFailed++; }
    else {
      // Cap with the bank's help if need be: the game's own path.
      const cap = paths(w).find((p) => p.kind === "cap");
      if (cap?.borrowCents) cmd(w, "bank.borrow", { cents: cap.borrowCents });
      if (rej(cmd(w, "prod.cap"))) rec.capFailed++;
    }
  }
}

/** Get the company to a spud at `at` (lease it if needed), by the game's own recovery paths for money. */
function spudAt(w: WorldState, at: { x: number; y: number }, end: number, prof: Profile): boolean {
  for (let guard = 0; guard < 60 && w.time < end; guard++) {
    if (ops(w).outcome.endedAt !== null) return false;
    const s = surveyAt(at.x, at.y)!;
    const held = pos(w).heldLeases.includes(s.id);
    if (!held) {
      if (!rej(cmd(w, "lease.take", { surveyId: s.id, offer: "asking" }))) continue;
    } else if (!rej(cmd(w, "rig.spud", at))) return true;
    const ps = paths(w);
    const borrow = (c?: number) => { if (c) cmd(w, "bank.borrow", { cents: c }); };
    const drill = ps.find((p) => p.kind === "drill" || p.kind === "leaseAndDrill");
    if (drill && (prof === "blind" || prof === "bestBlind")) {
      // The blind speculator drills wherever the recovery path points.
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
      // Cannot lease the target: take the cheapest lease the paths offer, and drill at its centre.
      const any = ps.find((p) => p.kind === "leaseAndDrill" || p.kind === "drill");
      if (any) { borrow(any.borrowCents); if (any.kind === "leaseAndDrill") cmd(w, "lease.take", { surveyId: any.surveyId, offer: "asking" }); const t = SURVEYS.find((x) => x.id === any.surveyId)!; if (!rej(cmd(w, "rig.spud", { x: t.poly.reduce((a, p) => a + p[0], 0) / t.poly.length, y: t.poly.reduce((a, p) => a + p[1], 0) / t.poly.length }))) return true; }
    }
    return false;
  }
  return false;
}

// ───────────────────────────────────────────── truth (diagnosis and the Omniscient bound only)
function truthPay(seed: string, x: number, y: number): number | null {
  const hc = columnAt(generateGeology(seed), x, y, 800).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
  return hc && hc.top * 3.2808 <= 2500 && hc.fluid === "oil" ? hc.top * 3.2808 : null;
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
      const ft = hc.top * 3.2808, lens = truthLens(seed, x, y, ft);
      out.push({ x, y, payHintFt: ft, why: "truth", cost: ft + 4 * lens });
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

type Cause = "struck oil" | "struck gas" | "no oil within reach (site)" | "running sand" | "casing sizes exhausted" | "mechanical" | "capital exhausted" | "plugged on advice short of the pay" | "other";
function diagnose(seed: string, w: W): Cause {
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
  const rec: Rec = { quitAdvice: [], capFailed: 0 };
  let sites: Site[];
  if (prof === "blind") {
    sites = [[0.15, 0.1], [-0.15, -0.1], [0.3, -0.2], [-0.3, 0.2], [0, 0.35], [0.35, 0], [-0.35, 0], [0, -0.35]].map(([dx, dy]) => ({ x: hill.x + dx!, y: hill.y + dy!, payHintFt: null, why: "the obvious guess" })).filter((s) => surveyAt(s.x, s.y));
  } else if (prof === "omniscient") {
    sites = omniscientSites(seed);
  } else if (prof === "bestBlind" || prof === "bestCombo") {
    // PR #10's best site: truth's shallowest oil, whatever lies above it; then the hill-flank guesses.
    const best = omniscientSites(seed).sort((a, b) => a.payHintFt! - b.payHintFt!)[0];
    sites = [...(best ? [{ ...best, payHintFt: prof === "bestCombo" ? best.payHintFt : null }] : []), ...[[0.15, 0.1], [-0.15, -0.1], [0.3, -0.2]].map(([dx, dy]) => ({ x: hill.x + dx!, y: hill.y + dy!, payHintFt: null, why: "the obvious guess" })).filter((q) => surveyAt(q.x, q.y))];
  } else {
    doFieldwork(w);
    sites = readCountry(w);
    if (process.env.DEBUG_SITES && prof === "informed") {
      const ev = knowledgeOf(w).evidence.filter((e) => e.kind === "surfaceSign") as { sign: string; x: number; y: number; strength: string }[];
      console.log(seed, "signs:", ev.map((e) => `${e.sign}${inMarsh(e.x, e.y) ? "(marsh)" : ""}@${e.x.toFixed(1)},${e.y.toFixed(1)}`).join(" "));
      console.log(seed, "sites:", sites.slice(0, 4).map((q) => `${q.why} @${q.x.toFixed(1)},${q.y.toFixed(1)} oil=${truthPay(seed, q.x, q.y) !== null}`).join(" | "));
    }
  }
  const fieldDays = (w.time - CAMPAIGN_START) / MINUTES_PER_DAY;
  if (prof === "disciplined" || prof === "omniscient" || prof === "bestCombo") {
    // Contractor selection: a man well spoken of, if one is looking for work.
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
    if (prof === "blind" || prof === "bestBlind") at = sites[k++ % sites.length]!;
    else {
      // Move between sites on what the wells showed. On a rise with oil signs, a dry hole calls for one step out
      // toward the strongest sign (about 0.6 km from the first hole); otherwise go on to the next rise.
      const last = tried[tried.length - 1];
      const disc = prof === "disciplined" || prof === "omniscient" || prof === "bestCombo";
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
    drillOut(w, prof, at.payHintFt, rec);
  }
  if (w.time < end && ops(w).outcome.endedAt === null) gameEngine.advance(w, end);
  const o = ops(w);
  const all = [...o.past, ...(o.well ? [o.well] : [])];
  const first = all[0];
  const prodOf = (id: string) => o.ledger.entries.filter((e) => e.category === "production" && e.ref?.wellId === id).reduce((a, e) => a - e.lines.filter((l) => l.account === "oilSales" || l.account === "hauling" || l.account === "royalty").reduce((b, l) => b + l.cents, 0), 0);
  const costOf = (id: string) => o.ledger.entries.filter((e) => e.ref?.wellId === id && e.category !== "production").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash").reduce((b, l) => b + l.cents, 0), 0);
  const capped = o.production.producers[0];
  const spentBefore = capped ? o.ledger.entries.filter((e) => e.t <= capped.since && e.category !== "opening" && e.category !== "bank").reduce((a, e) => a - e.lines.filter((l) => l.account === "cash" && l.cents < 0).reduce((b, l) => b + l.cents, 0), 0) : null;
  return {
    survived: o.outcome.endedAt === null,
    fieldDays,
    firstOil: !!first && first.status === "gusher" && !!first.outcome?.startsWith("OIL"),
    firstCommercial: !!first && o.production.producers.some((p) => p.wellId === first.id) && prodOf(first.id) >= costOf(first.id),
    anyOil: all.some((x) => x.status === "gusher" && x.outcome?.startsWith("OIL")),
    producing: o.production.producers.length > 0,
    monthsToProduction: capped ? (capped.since - CAMPAIGN_START) / MINUTES_PER_DAY / 30 : null,
    spentToProduction: spentBefore === null ? null : spentBefore / 100,
    bankruptBeforeProduction: o.outcome.endedAt !== null && !o.production.producers.length,
    bankruptAfterOil: o.outcome.endedAt !== null && all.some((x) => x.status === "gusher" && x.outcome?.startsWith("OIL")),
    endWorth: o.cash - o.debt,
    wells: all.length,
    causes: all.map((x) => diagnose(seed, x)),
    firstCause: first ? diagnose(seed, first) : "other",
    firstSiteHasOil: truthPay(seed, firstSite.x, firstSite.y) !== null,
    firstSiteWhy: firstSite.why,
    rec,
  };
}

// ───────────────────────────────────────────── statistics
const pct = (k: number, n: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)]! : NaN; };
/** Exact two-sided sign (McNemar) test on discordant pairs. */
function signP(a: number, b: number): number {
  const n = a + b; if (!n) return 1;
  const k = Math.min(a, b); let p = 0, c = 1;
  for (let i = 0; i <= n; i++) { if (i > 0) c = (c * (n - i + 1)) / i; if (i <= k) p += c; }
  return Math.min(1, (2 * p) / 2 ** n);
}
/** Paired bootstrap 95% interval of the difference in rates (deterministic resampling). */
function bootDiff(xs: boolean[], ys: boolean[]): [number, number] {
  const n = xs.length, ds: number[] = [];
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let b = 0; b < 2000; b++) { let d = 0; for (let i = 0; i < n; i++) { const j = Math.floor(rnd() * n); d += (ys[j] ? 1 : 0) - (xs[j] ? 1 : 0); } ds.push(d / n); }
  ds.sort((p, q) => p - q);
  return [ds[50]!, ds[1949]!];
}

it("player agency", () => {
  const seeds: string[] = [];
  for (let i = 0; seeds.length < N && i < N * 3; i++) if (printedMap(seedN(i)).hills[0]) seeds.push(seedN(i));
  const profiles: Profile[] = ["blind", "informed", "disciplined", "omniscient", "bestBlind", "bestCombo"];
  const res: Record<Profile, ReturnType<typeof campaign>[]> = { blind: [], informed: [], disciplined: [], omniscient: [], bestBlind: [], bestCombo: [] };
  for (const s of seeds) for (const p of profiles) res[p].push(campaign(s, p));
  const n = seeds.length;
  const tally = (xs: string[]) => { const t: Record<string, number> = {}; for (const x of xs) t[x] = (t[x] ?? 0) + 1; return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "); };
  console.log(`\nworlds ${n} (seeds with a printed hill), ${MONTHS} months each`);
  for (const p of profiles) {
    const r = res[p];
    const prod = r.filter((x) => x.producing);
    console.log(`\n## ${p}`);
    console.log(`survived ${pct(r.filter((x) => x.survived).length, n)} | first-well oil ${pct(r.filter((x) => x.firstOil).length, n)} | first-well commercial ${pct(r.filter((x) => x.firstCommercial).length, n)} | any oil ${pct(r.filter((x) => x.anyOil).length, n)} | producing ${pct(prod.length, n)}`);
    console.log(`first site holds oil (truth) ${pct(r.filter((x) => x.firstSiteHasOil).length, n)} | fieldwork days median ${med(r.map((x) => x.fieldDays)).toFixed(0)} | wells a company ${(r.reduce((a, x) => a + x.wells, 0) / n).toFixed(2)}`);
    console.log(`to production: months median ${med(prod.map((x) => x.monthsToProduction!)).toFixed(1)}, cash spent median $${med(prod.map((x) => x.spentToProduction!)).toFixed(0)}`);
    console.log(`bankrupt before production ${pct(r.filter((x) => x.bankruptBeforeProduction).length, n)} | bankrupt after finding oil ${pct(r.filter((x) => x.bankruptAfterOil).length, n)} | uncapped strikes (cap refused) ${r.reduce((a, x) => a + x.rec.capFailed, 0)}`);
    console.log(`end cash − debt median: all $${med(r.map((x) => x.endWorth)).toFixed(0)}, producers $${med(prod.map((x) => x.endWorth)).toFixed(0)}`);
    console.log(`failed companies' first-well cause: ${tally(r.filter((x) => !x.survived).map((x) => x.firstCause))}`);
    console.log(`all wells' ends: ${tally(r.flatMap((x) => x.causes))}`);
    const qa = r.flatMap((x) => x.rec.quitAdvice);
    if (qa.length) {
      const reachable = (q: typeof qa[number]) => q.payFt !== null && (q.payFt - q.depthFt) / 40 < (q.cash + q.credit) / 1_200;
      console.log(`counsel to quit: ${qa.length} times; pay below and within reach of cash+credit at ~40 ft/day (truth) ${qa.filter(reachable).length}; no pay below ${qa.filter((q) => q.payFt === null).length}; pay below but out of reach ${qa.filter((q) => q.payFt !== null && !reachable(q)).length}; declined ${qa.filter((q) => !q.accepted).length}`);
    }
  }
  console.log("\n## paired comparisons (same worlds)");
  const pairs: [Profile, Profile][] = [["blind", "informed"], ["informed", "disciplined"], ["blind", "disciplined"], ["disciplined", "omniscient"], ["bestBlind", "bestCombo"]];
  for (const [a, b] of pairs) for (const [label, f] of [["survival", (x: ReturnType<typeof campaign>) => x.survived], ["first-well oil", (x: ReturnType<typeof campaign>) => x.firstOil], ["producing", (x: ReturnType<typeof campaign>) => x.producing]] as const) {
    const xs = res[a].map(f), ys = res[b].map(f);
    const onlyA = xs.filter((v, i) => v && !ys[i]).length, onlyB = ys.filter((v, i) => v && !xs[i]).length;
    const [lo, hi] = bootDiff(xs, ys);
    console.log(`${b} vs ${a}, ${label}: +${onlyB} / −${onlyA} worlds (sign test p=${signP(onlyA, onlyB).toFixed(3)}); difference ${(100 * (ys.filter(Boolean).length - xs.filter(Boolean).length) / n).toFixed(1)} pts, 95% CI ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)}`);
  }
  // Fieldwork as information: does the evidence score separate rises that hold oil?
  console.log("\n## does the informed reading pick oil? (first site)");
  const inf = res.informed;
  console.log(`informed first site on oil (truth): ${pct(inf.filter((x) => x.firstSiteHasOil).length, n)}; blind: ${pct(res.blind.filter((x) => x.firstSiteHasOil).length, n)}`);
  console.log(`informed reasons, first site: ${tally(inf.map((x) => x.firstSiteWhy.split(", ").slice(1).join("+") || "a rise only"))}`);
});
