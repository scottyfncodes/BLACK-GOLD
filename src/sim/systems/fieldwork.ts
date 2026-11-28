/**
 * Fieldwork: the company's party rides out, and what it finds becomes evidence.
 * This is the one place where truth turns into knowledge, through explicit noise models:
 * walking a survey (signs noticed with a probability), asking a settler for his well's log
 * (remembered imperfectly), and consulting the gossip or a geologist (opinion, with bias).
 * Interpretations (section lines, prospects) are the player's own and touch no truth.
 */
import { CommandRejected, type Command, type Json, type System, type SystemContext } from "../core/engine";
import { rngKey } from "../core/rng";
import { MINUTES_PER_DAY, toCalendar } from "../core/time";
import { mToFt } from "../math/units";
import { SURVEYS, insidePoly, surveyAt } from "../../content/geography/surveys";
import { generateGeology } from "../geology/truth/model";
import { surfaceSigns, type SurfaceSign } from "../geology/truth/surface";
import { waterWells, type WaterWell } from "../geology/truth/waterWells";
import type { AccountEvidence, Evidence, FieldTask, KnowledgeState, NewsEvidence, OpinionEvidence, ReadingEvidence, ReportedInterval, Strength, WellRecordEvidence } from "../knowledge/types";
import { columnAt } from "../geology/truth/model";
import { ftToM } from "../math/units";
import { SAME_RISE_KM } from "../knowledge/reading";
import { printedMap } from "../surface/print";

type Ctx = SystemContext<Json>;
const S = (ctx: Ctx) => ctx.state as unknown as KnowledgeState;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Errands end at six in the evening of their last day. */
function returnTime(now: number, days: number): number {
  const startOfDay = Math.floor(now / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  return startOfDay + Math.max(0, days - 1) * MINUTES_PER_DAY + 18 * 60 + (now - startOfDay >= 18 * 60 ? MINUTES_PER_DAY : 0);
}

export const WALK_DAYS = (acres: number) => (acres < 450 ? 1 : acres < 800 ? 2 : 3);
export const CONSULT_DAYS = { gossip: 1, geologist: 6 } as const;
export const INQUIRE_DAYS = 1;

/**
 * What fieldwork costs (cents). PROVISIONAL gameplay values, pending period evidence: a man and a
 * horse on the company's errand by the day; a settler's time and a gift for it; drinks in
 * Beaumont; a consulting geologist's fee with his fare from Austin. Calibrated (docs/DESIGN.md §8,
 * M7) so that a thorough survey programme keeps at least 80% of its value: they are low for the
 * period, and say so.
 */
export const FIELD_COSTS = { walkDayCents: 50, inquireCents: 50, gossipCents: 25, geologistCents: 1_000 } as const;

/** The cost of an errand, and how the books describe it. */
export function errandCost(task: FieldTask, acres = 0): { cents: number; memo: string } {
  if (task.kind === "walk") {
    const d = WALK_DAYS(acres);
    const name = SURVEYS.find((s) => s.id === task.surveyId)?.name ?? "";
    return { cents: d * FIELD_COSTS.walkDayCents, memo: `Field party walking the ${name} survey, ${d} day${d > 1 ? "s" : ""}` };
  }
  if (task.kind === "inquire") return { cents: FIELD_COSTS.inquireCents, memo: "A day's ride to ask a settler about his well, and a gift for his time" };
  return task.who === "geologist"
    ? { cents: FIELD_COSTS.geologistCents, memo: "A consulting geologist from Austin: his fee and his fare" }
    : { cents: FIELD_COSTS.gossipCents, memo: "Asking around Beaumont: drinks and a day" };
}

function busy(ctx: Ctx): void {
  const t = S(ctx).task;
  if (t) throw new CommandRejected("The party is still out on an errand.");
}

type NewEvidence = Evidence extends infer E ? (E extends Evidence ? Omit<E, "id" | "t"> : never) : never;

function record(ctx: Ctx, e: NewEvidence): Evidence {
  const st = S(ctx);
  const full = { ...e, id: `ev-${st.next++}`, t: ctx.now } as Evidence;
  st.evidence.push(full);
  return full;
}

function opaque(ctx: Ctx, id: string): string {
  return rngKey(ctx.seed, "seen", id).toString(16);
}

function strengthWord(v: number): Strength {
  return v < 0.4 ? "faint" : v < 0.7 ? "clear" : "strong";
}

function walk(ctx: Ctx, surveyId: string): string {
  const st = S(ctx);
  const survey = SURVEYS.find((s) => s.id === surveyId)!;
  const visit = (st.visits[surveyId] = (st.visits[surveyId] ?? 0) + 1);
  const signs = surfaceSigns(generateGeology(ctx.seed)).filter((s) => insidePoly(survey.poly, s.x, s.y));
  const found: string[] = [];
  for (const sign of signs) {
    const key = opaque(ctx, sign.id);
    if (st.seen.includes(key)) continue;
    // Each visit is a fresh look: the more pronounced and visible, the likelier it is noticed.
    const p = sign.kind === "mound" ? Math.min(1, 0.15 + (sign.relief ?? 0) / 3.5) : Math.min(0.95, sign.visibility * (0.35 + sign.strength));
    if (ctx.random(`field:walk:${surveyId}`) >= p) continue;
    st.seen.push(key);
    const observed = Math.max(0, Math.min(1, sign.strength + (ctx.random("field:noise") - 0.5) * 0.3));
    record(ctx, {
      kind: "surfaceSign",
      provenance: "observed",
      sign: sign.kind,
      x: sign.x + (ctx.random("field:pos") - 0.5) * 0.05,
      y: sign.y + (ctx.random("field:pos") - 0.5) * 0.05,
      strength: strengthWord(observed),
      surveyId,
      ...(sign.kind === "mound" ? { reliefFt: Math.max(1, Math.round(mToFt(sign.relief ?? 0) * (0.85 + ctx.random("field:noise") * 0.3))) } : {}),
    });
    found.push(describe(sign));
  }
  record(ctx, { kind: "walked", provenance: "observed", surveyId, found: found.length });
  const where = `the ${survey.name} survey`;
  if (found.length === 0) return visit > 1 ? `Walked ${where} again. Nothing new.` : `Walked ${where}. Nothing out of the ordinary.`;
  return `Walked ${where}: ${found.join(", ")}.`;
}

function describe(s: SurfaceSign): string {
  return { mound: "a low rise", gasSeep: "gas bubbling", sourSpring: "a sour spring", paraffinDirt: "waxy dirt" }[s.kind];
}

/** What the owner remembers of his well: merged, rounded, sometimes wrong, in his own words. */
function remember(ctx: Ctx, w: WaterWell): WellRecordEvidence["intervals"] {
  const key = (...k: (string | number)[]) => rngKey(ctx.seed, "memory", w.id, ...k) / 0x100000000;
  const memory = 0.55 + key("memory") * 0.4;
  // Thin beds are forgotten into their neighbours.
  const merged = w.log.filter((iv) => iv.base - iv.top >= 3 || iv.fluid === "gas" || iv.fluid === "oil" || iv.lithology === "caprock");
  const out: ReportedInterval[] = [];
  merged.forEach((iv, i) => {
    const err = (key("err", i) - 0.5) * 2 * (1 - memory) * 0.25;
    const topFt = i === 0 ? 0 : Math.max(0, Math.round((mToFt(iv.top) * (1 + err)) / 5) * 5);
    const lith = iv.lithology === "caprock" ? "rock" : iv.lithology === "gravel" ? "gravel" : iv.lithology;
    let call: string;
    let show: ReportedInterval["show"];
    if (iv.lithology === "clay") call = iv.top < 10 ? "yellow clay" : key("clay", i) < 0.5 ? "blue clay" : "gumbo";
    else if (iv.lithology === "gravel") call = "sand and gravel";
    else if (iv.lithology === "salt") call = "rock salt";
    else if (iv.lithology === "caprock") { call = "hard rock, smelled of sulphur"; show = "sulphur"; }
    else call = "sand";
    if (iv.fluid === "water") call += ", water";
    if (iv.fluid === "sulphurWater") { call += ", sulphur water"; show = "sulphur"; }
    if (iv.fluid === "gas") { call += ", gas bubbled up"; show = "gas"; }
    if (iv.fluid === "oil") { call += ", an oily scum on the water"; show = "oil"; }
    const prev = out[out.length - 1];
    if (prev && prev.lith === lith && prev.call === call) return;
    if (prev) prev.baseFt = Math.max(prev.topFt + 5, topFt);
    out.push({ topFt, baseFt: topFt, call, lith: lith as ReportedInterval["lith"], ...(show ? { show } : {}) });
  });
  const last = out[out.length - 1];
  if (last) last.baseFt = Math.max(last.topFt + 5, Math.round(mToFt(w.depth) / 5) * 5);
  return out;
}

/** The finished rival well the company has heard of, by its id. */
const rivalNews = (st: KnowledgeState, wellId: string): NewsEvidence | undefined =>
  st.evidence.find((e): e is NewsEvidence => e.kind === "news" && e.wellId === wellId && (e.event === "oil" || e.event === "gas" || e.event === "dry"));

/**
 * Asking another operator's driller about a finished well: his log as he tells it, remembered
 * fairly well (a driller keeps a log), within what he drilled. Hearsay, like a settler's account.
 */
function inquireRival(ctx: Ctx, n: NewsEvidence): string {
  const depthM = ftToM(n.depthFt ?? 0);
  const log = columnAt(generateGeology(ctx.seed), n.x!, n.y!, Math.max(1, Math.ceil(depthM)));
  const w: WaterWell = { id: n.wellId!, x: n.x!, y: n.y!, owner: n.name ?? n.operator ?? "another operator", year: toCalendar(ctx.now).year, depth: depthM, log };
  const intervals = remember(ctx, w);
  const memory = 0.8 + (rngKey(ctx.seed, "memory", w.id, "memory") / 0x100000000) * 0.15;
  const rec = record(ctx, { kind: "wellRecord", provenance: "hearsay", wellId: w.id, x: w.x, y: w.y, owner: w.owner, year: w.year, depthFt: Math.round(n.depthFt ?? 0), intervals, memory });
  ctx.schedule(ctx.now, "ops.learn", rec as unknown as Json);
  return `Their driller told what ${w.owner} went through, to ${Math.round(n.depthFt ?? 0)} ft.`;
}

function inquire(ctx: Ctx, wellId: string): string {
  const rival = rivalNews(S(ctx), wellId);
  if (rival) return inquireRival(ctx, rival);
  const w = waterWells(generateGeology(ctx.seed)).find((x) => x.id === wellId)!;
  const memory = 0.55 + (rngKey(ctx.seed, "memory", w.id, "memory") / 0x100000000) * 0.4;
  const intervals = remember(ctx, w);
  const rec = record(ctx, {
    kind: "wellRecord", provenance: "hearsay", wellId: w.id, x: w.x, y: w.y, owner: w.owner, year: w.year,
    depthFt: Math.round(mToFt(w.depth) / 5) * 5, intervals, memory,
  });
  ctx.schedule(ctx.now, "ops.learn", rec as unknown as Json);
  const show = intervals.find((i) => i.show);
  return `${w.owner} described his well, ${Math.round(mToFt(w.depth) / 5) * 5} ft deep${show ? `. He mentioned ${show.show === "gas" ? "gas" : show.show === "oil" ? "an oily scum" : "sulphur"}` : ""}.`;
}

const ftWords = (n: number) => Math.round(n).toLocaleString("en-US");
const round50 = (n: number) => Math.round(n / 50) * 50;

/**
 * His rule of thumb for the depth to the rock under a rise of `reliefFt` (ft): the lower the rise,
 * the deeper the rock. He states the rule's own spread (rises of one height stand over rock at
 * different depths) but trusts his own measure of the rise, so the range is sometimes wrong: an
 * honest guess, not a promise. A rise may have no rock under it at all.
 */
export function rockRule(reliefFt: number): [number, number] {
  const at = (k: number) => 500 + 620 * Math.log((17 * k) / Math.max(0.5, reliefFt));
  return [Math.max(300, round50(at(0.8))), round50(at(1.2))];
}

/**
 * The geologist's reading of the depth to the rock under the most prominent rise on a survey:
 * from the company's own holes on it if there are any (he trusts a log over a guess), else a
 * settler's account of hard rock nearby, else his own rough measure of the rise.
 */
function readRise(ctx: Ctx, surveyId: string, noticed: SurfaceSign[]): Omit<ReadingEvidence, "id" | "t"> {
  const survey = SURVEYS.find((s) => s.id === surveyId)!;
  const ev = S(ctx).evidence;
  const printed = printedMap(ctx.seed).hills.filter((h) => insidePoly(survey.poly, h.x, h.y)).sort((a, b) => b.reliefFt - a.reliefFt)[0];
  const mound = noticed.filter((m) => m.kind === "mound").sort((a, b) => (b.relief ?? 0) - (a.relief ?? 0))[0];
  const rise = printed ? { x: printed.x, y: printed.y, relief: printed.reliefFt } : mound ? { x: mound.x, y: mound.y, relief: mToFt(mound.relief ?? 0) } : null;
  const base = { kind: "reading" as const, provenance: "opinion" as const, from: "geologist" as const, surveyId };
  if (!rise) {
    const [cx, cy] = [survey.poly.reduce((a, p) => a + p[0], 0) / survey.poly.length, survey.poly.reduce((a, p) => a + p[1], 0) / survey.poly.length];
    return { ...base, x: cx, y: cy, verdict: "flat", rockFt: null, basis: ["he found no rise on the survey"], text: "He found no rise on this survey to judge the depth of anything by. \"Flat ground tells a geologist nothing.\"" };
  }
  const near = (e: { x: number; y: number }) => Math.hypot(e.x - rise.x, e.y - rise.y) <= SAME_RISE_KM;
  const holes = ev.filter((e): e is AccountEvidence => e.kind === "account" && near(e));
  const dry = holes.find((h) => h.rockDry);
  if (dry) {
    return { ...base, x: rise.x, y: rise.y, verdict: "dry", rockFt: dry.rock ? [dry.rock.topFt, dry.rock.topFt] : null, basis: [`the log of the ${dry.name}`],
      text: `He read the log of the ${dry.name}: rock at about ${ftWords(dry.rock!.topFt)} ft, dry all the way to the salt at ${ftWords(dry.saltFt!)} ft. He would not look for oil in the rock of this rise again. The flanks of the rise are another matter: deeper, and harder to find.` };
  }
  const logged = holes.find((h) => h.rock);
  if (logged) {
    const top = logged.rock!.topFt;
    return { ...base, x: rise.x, y: rise.y, verdict: "range", rockFt: [Math.max(0, round50(top - logged.rock!.withinFt - 25)), round50(top + 50)], basis: [`the log of the ${logged.name}`],
      text: `He takes the log of the ${logged.name} for his guide: it met the rock at about ${ftWords(top)} ft, and the top of such rock lies nearly level under a rise. "Off the rock, you will be on its flank, and the sands there lie deeper."` };
  }
  const told = ev.filter((e): e is WellRecordEvidence => e.kind === "wellRecord" && near(e)).map((e) => ({ e, rock: e.intervals.find((iv) => iv.lith === "rock") })).find((x) => x.rock);
  if (told) {
    const top = told.rock!.topFt;
    return { ...base, x: rise.x, y: rise.y, verdict: "range", rockFt: [Math.max(0, round50(top - 30)), round50(top + 60)], basis: [`${told.e.owner}'s account of his well`],
      text: `${told.e.owner}'s well struck hard rock at ${ftWords(top)} ft, by his account. He would sooner trust that than any guess of his own, though a settler's memory is no driller's log.` };
  }
  // His own measure of the rise: a level and a rod, done in an afternoon. Rough.
  const measured = Math.max(1, Math.round(rise.relief * (0.88 + ctx.random("field:measure") * 0.24)));
  const [lo, hi] = rockRule(measured);
  const basis = [`a rise he measured at about ${measured} ft`];
  if (measured < 3) {
    return { ...base, x: rise.x, y: rise.y, verdict: "deep", rockFt: [lo, null], basis,
      text: `The rise is barely ${measured} ft. If there is rock under it at all, he reckons it deeper than ${ftWords(lo)} ft: "Low ground hides its rock deep."` };
  }
  return { ...base, x: rise.x, y: rise.y, verdict: "range", rockFt: [lo, hi], basis,
    text: `He measured the rise at about ${measured} ft. If there is rock under it, he reckons it at ${ftWords(lo)} to ${ftWords(hi)} ft: "a guess from the lie of the land, no more." Rock is no promise of oil.` };
}

function consult(ctx: Ctx, surveyId: string, who: "geologist" | "gossip"): string {
  const survey = SURVEYS.find((s) => s.id === surveyId)!;
  const signs = surfaceSigns(generateGeology(ctx.seed)).filter((s) => insidePoly(survey.poly, s.x, s.y));
  const r = ctx.random(`field:consult:${who}`);
  let stance: OpinionEvidence["stance"];
  let text: string;
  if (who === "geologist") {
    // A trained eye finds most signs, but the theory of 1890 says the coastal plain holds no oil.
    const noticed = signs.filter(() => ctx.random("field:geologist") < 0.8);
    const score = noticed.reduce((a, s) => a + s.strength * (s.kind === "mound" ? 0.6 : 1), 0);
    stance = score > 1.1 && r < 0.3 ? "favourable" : score > 0.6 ? "doubtful" : "unfavourable";
    const seen = [...new Set(noticed.map(describe))];
    const saw = seen.length ? `He noted ${seen.join(" and ")}` : "He found nothing of note";
    text = {
      favourable: `${saw}, and allows that a test well would not be wasted.`,
      doubtful: `${saw}, but holds that the young clays of the coast cannot hold oil in quantity.`,
      unfavourable: `${saw}. "There is no oil in this country," he says.`,
    }[stance];
  } else {
    const seep = signs.some((s) => s.kind === "gasSeep" || s.kind === "sourSpring");
    stance = r < (seep ? 0.55 : 0.3) ? "favourable" : r < 0.75 ? "doubtful" : "unfavourable";
    const lines = seep
      ? ["They say the cattle on that place won't drink from the spring.", "A boy says he lit the bubbles in a pond out there and they burned blue."]
      : ["Old men in the saloon swear there's oil under every hill.", "Nobody in Beaumont has a good word for that land."];
    text = lines[Math.floor(ctx.random("field:gossip") * lines.length)]!;
  }
  record(ctx, { kind: "opinion", provenance: "opinion", surveyId, from: who, stance, text });
  if (who === "geologist") {
    const reading = record(ctx, readRise(ctx, surveyId, signs.filter(() => ctx.random("field:geologist:rise") < 0.8)));
    // The company's driller is told what the geologist made of the ground.
    ctx.schedule(ctx.now, "ops.learn", reading as unknown as Json);
  }
  return who === "geologist" ? "The geologist from Austin has given his opinion." : "You heard what Beaumont is saying.";
}

/** The party sets out; the books pay for it (the company's operations may call it back if they cannot). */
function startTask(ctx: Ctx, task: FieldTask, acres = 0): void {
  S(ctx).task = task;
  ctx.schedule(task.until, "fieldwork.return");
  ctx.schedule(ctx.now, "ops.fieldExpense", errandCost(task, acres) as unknown as Json);
}

const pt = (v: unknown): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) throw new CommandRejected("A point needs two coordinates.");
  return [v[0], v[1]];
};

export const fieldwork: System<Json> = {
  id: "knowledge",
  initialState: () => ({ evidence: [], interp: { sections: [], prospects: [] }, task: null, seen: [], visits: {}, next: 1 }) as unknown as Json,
  events: {
    /** The company could not pay for the errand: the party stays at home. */
    "fieldwork.recall"(ctx, payload) {
      const st = S(ctx);
      if (!st.task) return;
      st.task = null;
      const { day, month } = toCalendar(ctx.now);
      ctx.emit({ type: "fieldwork.report", severity: "notice", interrupt: true, data: { message: (payload as { message?: string })?.message ?? "The party could not be paid and stayed at home.", day, month } });
    },
    /** News of the field reaches the company. */
    "knowledge.news"(ctx, payload) {
      record(ctx, payload as unknown as Omit<NewsEvidence, "id" | "t">);
    },
    /** One of the company's holes has ended: its account joins the evidence. */
    "knowledge.account"(ctx, payload) {
      record(ctx, payload as unknown as Omit<AccountEvidence, "id" | "t">);
    },
    "fieldwork.return"(ctx) {
      const st = S(ctx);
      const task = st.task;
      if (!task) return;
      st.task = null;
      let message: string;
      if (task.kind === "walk") message = walk(ctx, task.surveyId);
      else if (task.kind === "inquire") message = inquire(ctx, task.wellId);
      else message = consult(ctx, task.surveyId, task.who);
      const { day, month } = toCalendar(ctx.now);
      ctx.emit({ type: "fieldwork.report", severity: "notice", interrupt: true, data: { message, day, month } });
    },
  },
  commands: {
    "fieldwork.walk"(ctx, c: Command) {
      busy(ctx);
      const survey = SURVEYS.find((s) => s.id === (c.payload as { surveyId?: string })?.surveyId);
      if (!survey) throw new CommandRejected("No such survey.");
      startTask(ctx, { kind: "walk", surveyId: survey.id, until: returnTime(ctx.now, WALK_DAYS(survey.acres)) }, survey.acres);
    },
    "fieldwork.inquire"(ctx, c: Command) {
      busy(ctx);
      const wellId = (c.payload as { wellId?: string })?.wellId;
      if (!waterWells(generateGeology(ctx.seed)).some((w) => w.id === wellId) && !rivalNews(S(ctx), wellId ?? "")) throw new CommandRejected("No such well, or none finished that its driller could tell of.");
      if (S(ctx).evidence.some((e) => e.kind === "wellRecord" && e.wellId === wellId)) throw new CommandRejected("You already have his account of that well.");
      startTask(ctx, { kind: "inquire", wellId: wellId!, until: returnTime(ctx.now, INQUIRE_DAYS) });
    },
    "fieldwork.consult"(ctx, c: Command) {
      busy(ctx);
      const p = c.payload as { surveyId?: string; who?: string };
      const survey = SURVEYS.find((s) => s.id === p?.surveyId);
      if (!survey || (p.who !== "geologist" && p.who !== "gossip")) throw new CommandRejected("Consult whom, about which survey?");
      startTask(ctx, { kind: "consult", surveyId: survey.id, who: p.who, until: returnTime(ctx.now, CONSULT_DAYS[p.who]) });
    },
    "interp.section.add"(ctx, c: Command) {
      const p = c.payload as { a?: unknown; b?: unknown };
      const a = pt(p?.a), b = pt(p?.b);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3) throw new CommandRejected("Draw the section line at least a quarter of a mile long.");
      const st = S(ctx);
      const letter = LETTERS[st.interp.sections.length % LETTERS.length]!;
      st.interp.sections.push({ id: `sec-${st.next++}`, letter, a, b });
    },
    "interp.section.remove"(ctx, c: Command) {
      const st = S(ctx);
      st.interp.sections = st.interp.sections.filter((s) => s.id !== (c.payload as { id?: string })?.id);
    },
    "interp.prospect.add"(ctx, c: Command) {
      const p = c.payload as { at?: unknown; r?: unknown };
      const [x, y] = pt(p?.at);
      const r = typeof p?.r === "number" && p.r > 0.1 && p.r < 3 ? p.r : 0.8;
      const st = S(ctx);
      st.interp.prospects.push({ id: `pro-${st.next++}`, numeral: ROMAN[st.interp.prospects.length % ROMAN.length]!, x, y, r });
    },
    "interp.prospect.remove"(ctx, c: Command) {
      const st = S(ctx);
      st.interp.prospects = st.interp.prospects.filter((s) => s.id !== (c.payload as { id?: string })?.id);
    },
  },
};

/** Exposed for the UI's labels only (no truth): where a point falls among the surveys. */
export { surveyAt };
