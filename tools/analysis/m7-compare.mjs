// M7 results: within each build and paired across builds (same seeds). Analysis only; not part of CI.
// Usage: node tools/analysis/m7-compare.mjs before.jsonl[,more] after.jsonl[,more]
import { readFileSync } from "node:fs";

const load = (arg) => arg.split(",").flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const [before, after] = [load(process.argv[2]), load(process.argv[3])];
const PROFILES = ["blind", "informed", "disciplined", "omniscient"];
const runs = (rows) => rows.filter((r) => r.profile);
const by = (rows, p) => new Map(runs(rows).filter((r) => r.profile === p).map((r) => [r.seed, r]));
const present = (rows) => PROFILES.filter((p) => runs(rows).some((r) => r.profile === p));
const common = present(before).filter((p) => present(after).includes(p));
const seeds = [...by(before, common[0]).keys()].filter((s) => by(after, common[0]).has(s)).sort();
const n = seeds.length;
const pct = (k, d = n) => `${k}/${d} (${d ? Math.round((100 * k) / d) : 0}%)`;
const med = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");

function signP(a, b) {
  const m = a + b; if (!m) return 1;
  const k = Math.min(a, b); let p = 0, c = 1;
  for (let i = 0; i <= m; i++) { if (i > 0) c = (c * (m - i + 1)) / i; if (i <= k) p += c; }
  return Math.min(1, (2 * p) / 2 ** m);
}
function boot(xs, ys) {
  const ds = []; let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let b = 0; b < 2000; b++) { let d = 0; for (let i = 0; i < xs.length; i++) { const j = Math.floor(rnd() * xs.length); d += ys[j] - xs[j]; } ds.push(d / xs.length); }
  ds.sort((p, q) => p - q);
  return [ds[50], ds[1949]];
}
function paired(label, A, B, f, kind = "rate") {
  const xs = seeds.map((s) => f(A.get(s))), ys = seeds.map((s) => f(B.get(s)));
  const [lo, hi] = boot(xs.map(Number), ys.map(Number));
  if (kind === "rate") {
    const onlyA = xs.filter((v, i) => v && !ys[i]).length, onlyB = ys.filter((v, i) => v && !xs[i]).length;
    const d = (100 * (ys.filter(Boolean).length - xs.filter(Boolean).length)) / n;
    return `${label}: +${onlyB} / −${onlyA} worlds, ${d >= 0 ? "+" : ""}${d.toFixed(1)} pts (95% CI ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)}), sign test p=${signP(onlyA, onlyB).toFixed(3)}`;
  }
  const better = xs.filter((v, i) => ys[i] > v).length, worse = xs.filter((v, i) => ys[i] < v).length;
  return `${label}: mean ${usd(mean(xs))} → ${usd(mean(ys))}, difference ${usd(mean(ys) - mean(xs))} (95% CI ${usd(lo)} to ${usd(hi)}); better in ${better}, worse in ${worse}, sign test p=${signP(worse, better).toFixed(3)}`;
}

function summary(rows, tag) {
  console.log(`\n# ${tag} (${n} worlds, ${runs(rows)[0]?.m7 ? "M7" : "before M7"})`);
  for (const p of present(rows)) {
    const m = by(rows, p), r = seeds.map((s) => m.get(s));
    const prod = r.filter((x) => x.producing);
    const oil = r.reduce((a, x) => a + x.oilWells, 0);
    const spend = r.reduce((a, x) => a + x.drillingSpend + x.fieldworkSpend, 0);
    const qa = r.flatMap((x) => x.quitAdvice);
    const reach = (q) => q.payFt !== null && (q.payFt - q.depthFt) / 40 < (q.cash + q.credit) / 1200;
    console.log(`\n## ${p}`);
    console.log(`  solvent at 3 years ${pct(r.filter((x) => x.survived).length)} | producing ${pct(prod.length)} | any oil ${pct(r.filter((x) => x.anyOil).length)} | first site on oil (truth) ${pct(r.filter((x) => x.firstSiteHasOil).length)} | stopped drilling by choice ${pct(r.filter((x) => x.withdrew).length)}`);
    console.log(`  capital (cash − debt) at the end: median ${usd(med(r.map((x) => x.endWorth)))}, mean ${usd(mean(r.map((x) => x.endWorth)))}; of companies without oil: median ${usd(med(r.filter((x) => !x.anyOil).map((x) => x.endWorth)))}`);
    console.log(`  wells ${(r.reduce((a, x) => a + x.wells, 0) / n).toFixed(2)} a company | footage ${Math.round(mean(r.map((x) => x.footage)))} ft a company, of which with no oil below within reach ${Math.round(mean(r.map((x) => x.barrenFt)))} ft, in salt ${Math.round(mean(r.map((x) => x.saltFt)))} ft`);
    console.log(`  abandoned with oil within 400 ft below (truth): ${r.reduce((a, x) => a + x.abandonedReachable, 0)} holes, ${r.reduce((a, x) => a + x.abandonedFtToPay, 0)} ft short in all`);
    console.log(`  spend: drilling ${usd(mean(r.map((x) => x.drillingSpend)))}, fieldwork ${usd(mean(r.map((x) => x.fieldworkSpend)))} a company | oil discoveries ${oil} | cost per discovery ${oil ? usd(spend / oil) : "n/a"}`);
    if (prod.length) console.log(`  to production: months median ${med(prod.map((x) => x.monthsToProduction)).toFixed(1)}, cash spent median ${usd(med(prod.map((x) => x.spentToProduction)))}`);
    if (qa.length) console.log(`  counsel to quit ${qa.length}: with oil below and within reach (truth) ${pct(qa.filter(reach).length, qa.length)}; no oil below ${pct(qa.filter((q) => q.payFt === null).length, qa.length)}; declined ${qa.filter((q) => !q.accepted).length}`);
  }
  const cal = rows.filter((r) => r.calibration).map((r) => r.calibration);
  if (cal.length) {
    const c = cal.reduce((a, x) => { for (const k of Object.keys(x)) a[k] = (a[k] ?? 0) + x[k]; return a; }, {});
    console.log(`\n## calibration`);
    console.log(`  geologist's ranges: ${c.readings}; containing the true rock depth ${pct(c.contained, c.readings)}; rock deeper than his range ${c.below}, shallower ${c.above} | "deeper than" readings ${c.deep}, right ${pct(c.deepRight, c.deep)} | "flat" ${c.flat}`);
    console.log(`  gypsum in the bailer: within 100 ft above the rock ${pct(c.gypsumNear, c.samplesNear)} of samples; elsewhere ${pct(c.gypsumFar, c.samplesFar)}`);
  }
}

summary(before, "BEFORE");
summary(after, "AFTER");
console.log(`\n# paired comparisons, same ${n} worlds`);
const B = (p) => by(before, p), A = (p) => by(after, p);
for (const [label, f, kind] of [["solvent", (x) => x.survived], ["producing", (x) => x.producing], ["capital at the end", (x) => x.endWorth, "money"]]) {
  console.log(`\n## ${label}`);
  for (const [a, b] of [["blind", "informed"], ["informed", "disciplined"], ["disciplined", "omniscient"]].filter(([a, b]) => common.includes(a) && common.includes(b))) {
    console.log("  before: " + paired(`${b} vs ${a}`, B(a), B(b), f, kind));
    console.log("  after:  " + paired(`${b} vs ${a}`, A(a), A(b), f, kind));
  }
  for (const p of common) console.log("  " + paired(`${p}, after vs before`, B(p), A(p), f, kind));
}
