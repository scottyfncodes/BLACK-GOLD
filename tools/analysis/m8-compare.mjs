// M8b: strategies after a strike, paired by world. Analysis only; not part of CI.
// Usage: node tools/analysis/m8-compare.mjs file.jsonl[,more]
import { readFileSync } from "node:fs";

const rows = process.argv[2].split(",").flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const worlds = rows.filter((r) => r.strike);
const failed = rows.filter((r) => !r.strike);
const STRATS = ["passive", "defend", "offsets", "combined", "alone"];
const NAME = { passive: "Passive", defend: "Defensive leasing", offsets: "Quick offsets", combined: "Combined", alone: "Passive, no Rush (counterfactual)" };
const usd = (v) => (v < 0 ? "−$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (k, n) => `${k}/${n} (${n ? Math.round((100 * k) / n) : 0}%)`;
function signP(a, b) { const m = a + b; if (!m) return 1; const k = Math.min(a, b); let p = 0, c = 1; for (let i = 0; i <= m; i++) { if (i > 0) c = (c * (m - i + 1)) / i; if (i <= k) p += c; } return Math.min(1, (2 * p) / 2 ** m); }
function boot(d) { const ds = []; let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); for (let b = 0; b < 2000; b++) { let t = 0; for (let i = 0; i < d.length; i++) t += d[Math.floor(rnd() * d.length)]; ds.push(t / d.length); } ds.sort((a, b) => a - b); return [ds[50], ds[1949]]; }
const get = (w, st) => w.rows.find((r) => r.strategy === st);

console.log(`# Strategies after a strike: ${worlds.length} worlds with a strike (of ${rows.length}; first well failed or no oil site in ${failed.length})`);
for (const y of ["y3", "y5"]) {
  console.log(`\n## at ${y === "y3" ? "3" : "5"} years after the strike`);
  for (const st of STRATS) {
    const xs = worlds.map((w) => get(w, st)[y]);
    const v = xs.map((x) => x.value);
    const capital = worlds.map((w) => get(w, st)[y].leaseSpend + get(w, st)[y].drillingAfter);
    console.log(`\n### ${NAME[st]}`);
    console.log(`  capital (cash − debt): mean ${usd(mean(v))}, p10 ${usd(q(v, 0.1))}, median ${usd(q(v, 0.5))}, p90 ${usd(q(v, 0.9))} | solvent ${pct(xs.filter((x) => x.solvent).length, xs.length)}`);
    console.log(`  barrels sold: mean ${Math.round(mean(xs.map((x) => x.barrels))).toLocaleString("en-US")} | share of the oil drawn from the company's tanks: mean ${(100 * mean(xs.map((x) => x.share))).toFixed(0)}%, median ${(100 * q(xs.map((x) => x.share), 0.5)).toFixed(0)}% | other operators' wells on those tanks: mean ${mean(xs.map((x) => x.rivalsOnOurTanks)).toFixed(1)}`);
    console.log(`  committed after the strike: leases ${usd(mean(xs.map((x) => x.leaseSpend)))} (includes the discovery lease's renewals), offset wells ${usd(mean(xs.map((x) => x.drillingAfter)))}; total mean ${usd(mean(capital))}, p90 ${usd(q(capital, 0.9))}`);
    console.log(`  land: ${mean(xs.map((x) => x.leasesTaken)).toFixed(1)} more surveys, ${Math.round(mean(xs.map((x) => x.acres)))} acres a company, of which with no oil under them (truth) ${Math.round(mean(xs.map((x) => x.dryAcres)))} acres (${(100 * mean(xs.map((x) => x.dryAcres))) / Math.max(1, mean(xs.map((x) => x.acres))) | 0}%) | offsets drilled ${mean(worlds.map((w) => get(w, st).offsets)).toFixed(2)}, of which oil ${mean(worlds.map((w) => get(w, st).offsetOil)).toFixed(2)}`);
    console.log(`  the Rush: other operators' wells ${mean(xs.map((x) => x.rivalWells)).toFixed(1)} (oil ${mean(xs.map((x) => x.rivalOil)).toFixed(1)}, dry ${mean(xs.map((x) => x.rivalDry)).toFixed(1)})`);
  }
  console.log(`\n### paired against passive play (same worlds)`);
  for (const st of STRATS.filter((s) => s !== "passive")) {
    const d = worlds.map((w) => get(w, st)[y].value - get(w, "passive")[y].value);
    const ds = worlds.map((w) => get(w, st)[y].share - get(w, "passive")[y].share);
    const better = d.filter((x) => x > 0).length, worse = d.filter((x) => x < 0).length;
    const [lo, hi] = boot(d);
    const base = mean(worlds.map((w) => get(w, "passive")[y].value));
    console.log(`  ${NAME[st]}: capital ${usd(mean(d))} (95% CI ${usd(lo)} to ${usd(hi)}; ${(100 * mean(d) / Math.abs(base)).toFixed(0)}% of passive's mean ${usd(base)}), median difference ${usd(q(d, 0.5))}; better in ${better}, worse in ${worse} worlds (sign test p=${signP(better, worse).toFixed(3)}); downside: worst decile difference ${usd(q(d, 0.1))}, worse than passive by over $1,000 in ${pct(d.filter((x) => x < -1000).length, d.length)} | field share ${(100 * mean(ds)).toFixed(1)} pts`);
  }
}
