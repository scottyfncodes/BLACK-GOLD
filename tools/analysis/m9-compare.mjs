// M9.0: one rig after a discovery, passive vs exploring, paired by world. Analysis only; not part of CI.
// Usage: node tools/analysis/m9-compare.mjs file.jsonl[,more]
import { readFileSync } from "node:fs";

const rows = process.argv[2].split(",").flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const usd = (v) => (v < 0 ? "−$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (k, n) => `${k}/${n} (${n ? Math.round((100 * k) / n) : 0}%)`;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "–");
function signP(a, b) { const m = a + b; if (!m) return 1; const k = Math.min(a, b); let p = 0, c = 1; for (let i = 0; i <= m; i++) { if (i > 0) c = (c * (m - i + 1)) / i; if (i <= k) p += c; } return Math.min(1, (2 * p) / 2 ** m); }
function boot(d) { const ds = []; let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); for (let b = 0; b < 2000; b++) { let t = 0; for (let i = 0; i < d.length; i++) t += d[Math.floor(rnd() * d.length)]; ds.push(t / d.length); } ds.sort((a, b) => a - b); return [ds[50], ds[1949]]; }
const CAMPAIGN = 7_324;

for (const cohort of ["A", "B"]) {
  const all = rows.filter((r) => r.cohort === cohort);
  const worlds = all.filter((r) => r.strike);
  if (!all.length) continue;
  const why = {};
  for (const r of all.filter((r) => !r.strike)) why[r.why] = (why[r.why] ?? 0) + 1;
  console.log(`\n# Cohort ${cohort} (${cohort === "A" ? "scaffolded first well, as M8b" : "M7's disciplined operator, public information throughout"}): ${worlds.length} worlds with a discovery of ${all.length} (${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  if (!worlds.length) continue;
  const get = (w, st) => w.rows.find((r) => r.strategy === st);
  console.log(`  at the discovery: cash mean ${usd(mean(worlds.map((w) => w.cashAtStrike)))}, day ${Math.round(mean(worlds.map((w) => w.strikeDay)))}${cohort === "B" ? `, holes before it ${f1(mean(worlds.map((w) => w.holesBefore)))}` : ""}`);
  for (const st of ["passive", "explorer"]) {
    console.log(`\n## ${st}`);
    for (const y of ["y1", "y3", "y5"]) {
      const xs = worlds.map((w) => get(w, st)[y]);
      const v = xs.map((x) => x.value), cash = xs.map((x) => x.cash);
      console.log(`  ${y}: capital mean ${usd(mean(v))}, p10 ${usd(q(v, 0.1))}, median ${usd(q(v, 0.5))}, p90 ${usd(q(v, 0.9))} | cash ÷ a campaign (${usd(CAMPAIGN)}): median ${f1(q(cash, 0.5) / CAMPAIGN)}× | solvent ${pct(xs.filter((x) => x.solvent).length, xs.length)} | producers ${f1(mean(xs.map((x) => x.producers)))}, new fields ${pct(xs.filter((x) => x.newFields > 0).length, xs.length)} | holes after ${f1(mean(xs.map((x) => x.holesAfter)))} | spent after ${usd(mean(xs.map((x) => x.spentAfter)))}`);
    }
    const rs = worlds.map((w) => get(w, st));
    const D = (k) => mean(rs.map((r) => r.spans.days[k] ?? 0));
    const tot = 5 * 365;
    console.log(`  rig days over 5 years (mean): drilling ${Math.round(D("drilling"))} (${Math.round((100 * D("drilling")) / tot)}%), fieldwork ${Math.round(D("fieldwork"))}, idle: no prospect ${Math.round(D("noProspect"))}, waiting for money ${Math.round(D("capital"))}, land refused ${f1(D("land"))}, passive ${Math.round(D("passive"))}`);
    console.log(`  idle with capital (cash + credit) for a whole campaign: ${Math.round(mean(rs.map((r) => r.spans.idleRich)))} days, of which with a prospect its evidence shows: ${Math.round(mean(rs.map((r) => r.spans.idleRichWithProspect)))} | on cash alone: ${Math.round(mean(rs.map((r) => r.spans.idleCashRich)))} days, with a prospect ${Math.round(mean(rs.map((r) => r.spans.idleCashRichWithProspect)))}`);
    if (st === "explorer") {
      const dec = (k) => mean(rs.map((r) => r.decisions[k]));
      console.log(`  decisions (mean per world): drill ${f1(dec("drill"))}; not drill: no prospect ${f1(dec("noProspect"))} (monthly checks), short of money ${f1(dec("capital"))} (fortnightly), land refused ${f1(dec("land"))}`);
      const sk = (k) => mean(rs.map((r) => r.skips[k]));
      console.log(`  prospects passed over (summed over checks): the company's own field ${f1(sk("ownField"))}, already tried ${f1(sk("tried"))}, ruled out by its evidence ${f1(sk("ruledOut"))}, too deep ${f1(sk("tooDeep"))}, another operator's field ${f1(sk("rivalField"))}, another operator's dry hole ${f1(sk("rivalDry"))}`);
      const holes = rs.flatMap((r) => r.holes);
      const firstNone = rs.map((r) => { const s = r.spans; return s; });
      void firstNone;
      console.log(`  holes: ${holes.length} (${f1(holes.length / rs.length)} a world; ${pct(rs.filter((r) => r.holes.length === 0).length, rs.length)} drilled none) | oil ${holes.filter((h) => h.oil).length}, oil below the bottom (truth) ${holes.filter((h) => !h.oil && h.oilBelow).length}, barren ${holes.filter((h) => !h.oilBelow && !h.oil).length} | by kind: ${["rise", "stepOut", "backToCrest"].map((k) => `${k} ${holes.filter((h) => h.kind === k).length}`).join(", ")} | mean cost ${usd(mean(holes.map((h) => h.costCents / 100)))}, mean depth ${Math.round(mean(holes.map((h) => h.depthFt)))} ft | stalled and plugged ${rs.reduce((a, r) => a + r.stalledHoles, 0)}`);
      const fw = mean(rs.map((r) => r.fieldworkDays));
      console.log(`  fieldwork days ${Math.round(fw)}`);
    }
    const y5 = worlds.map((w) => get(w, st).y5);
    console.log(`  opportunity left (truth, at 5 years): charged structures with oil within reach ${f1(mean(y5.map((x) => x.reachableFields)))} a world; untapped by anyone ${f1(mean(y5.map((x) => x.untappedFields)))}; untapped and never drilled by the company ${f1(mean(y5.map((x) => x.untappedNeverTried)))}; worlds with any untapped ${pct(y5.filter((x) => x.untappedFields > 0).length, y5.length)}`);
  }
  console.log(`\n## explorer paired against passive (same worlds)`);
  for (const y of ["y3", "y5"]) {
    const d = worlds.map((w) => get(w, "explorer")[y].value - get(w, "passive")[y].value);
    const better = d.filter((x) => x > 0).length, worse = d.filter((x) => x < 0).length;
    const [lo, hi] = boot(d);
    const base = mean(worlds.map((w) => get(w, "passive")[y].value));
    console.log(`  ${y}: capital ${usd(mean(d))} (95% CI ${usd(lo)} to ${usd(hi)}; ${((100 * mean(d)) / Math.abs(base)).toFixed(0)}% of passive's ${usd(base)}), median ${usd(q(d, 0.5))}; better in ${better}, worse in ${worse} (sign test p=${signP(better, worse).toFixed(3)}); worst decile ${usd(q(d, 0.1))}, best decile ${usd(q(d, 0.9))}`);
  }
  const nf = worlds.filter((w) => get(w, "explorer").y5.newFields > 0);
  if (nf.length) console.log(`  worlds where exploring found a second field: ${nf.length}; their capital gain vs passive ${usd(mean(nf.map((w) => get(w, "explorer").y5.value - get(w, "passive").y5.value)))}; the rest ${usd(mean(worlds.filter((w) => !nf.includes(w)).map((w) => get(w, "explorer").y5.value - get(w, "passive").y5.value)))}`);
}
