/* How surface evidence relates to oil (truth; analysis only, outside CI). Findings: docs/DESIGN.md §8, "Player agency audit".
 * Run: npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/evidence.harness.ts */
import { it } from "vitest";
import { printedMap } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { generateGeology, columnAt, isCharged } from "../../src/sim/geology/truth/model";
import { surfaceSigns } from "../../src/sim/geology/truth/surface";
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
it("evidence vs oil", () => {
  const rows: Record<string, { domes: number; charged: number; oilDomes: number }> = {};
  const ringRel: number[] = [];
  let worlds = 0, oilInSurveys = 0;
  for (let i = 0; i < 300 && worlds < 120; i++) {
    const seed = seedN(i);
    if (!printedMap(seed).hills[0]) continue;
    worlds++;
    const t = generateGeology(seed);
    const signs = surfaceSigns(t);
    let any = false;
    for (const d of t.domes) {
      const near = signs.filter((s) => !s.falsePositive && Math.hypot(s.x - d.x, s.y - d.y) < d.saltR * 2 + 0.5);
      const kinds = [...new Set(near.map((s) => s.kind))].filter((k) => k !== "mound").sort().join("+") || "none";
      const key = `${d.relief > 0.4 ? "mound" : "no mound"} | ${kinds}`;
      rows[key] ??= { domes: 0, charged: 0, oilDomes: 0 };
      rows[key].domes++;
      if (isCharged(d)) rows[key].charged++;
      // Oil within the rig's reach anywhere inside the surveys near this dome; and where, relative to the salt radius.
      let hasOil = false;
      for (let r = 0; r <= d.saltR * 2.5; r += 0.1) for (let a = 0; a < 24; a++) {
        const x = d.x + r * Math.cos((a / 24) * 2 * Math.PI), y = d.y + r * Math.sin((a / 24) * 2 * Math.PI);
        if (!SURVEYS.some((s) => insidePoly(s.poly, x, y))) continue;
        const hc = columnAt(t, x, y, 800).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
        if (hc?.fluid === "oil" && hc.top * 3.28 <= 2000) { hasOil = true; ringRel.push(r / d.saltR); }
      }
      if (hasOil) { rows[key].oilDomes++; any = true; }
    }
    if (any) oilInSurveys++;
  }
  console.log(`worlds ${worlds}, with oil within 2,000 ft somewhere in the surveys ${oilInSurveys}`);
  for (const [k, v] of Object.entries(rows).sort((a, b) => b[1].domes - a[1].domes)) console.log(`${k.padEnd(48)} domes ${v.domes}, charged ${v.charged}, oil within reach ${v.oilDomes}`);
  const h: Record<string, number> = {};
  for (const r of ringRel) { const b = (Math.floor(r * 4) / 4).toFixed(2); h[b] = (h[b] ?? 0) + 1; }
  console.log("where oil lies, distance from the dome centre in salt radii (oil points):", JSON.stringify(h));
});
it("where to drill on a charged dome", () => {
  const hit: Record<string, [number, number]> = {};
  const add = (k: string, ok: boolean) => { hit[k] ??= [0, 0]; hit[k][1]++; if (ok) hit[k][0]++; };
  let n = 0;
  for (let i = 0; i < 300 && n < 120; i++) {
    const seed = seedN(i);
    if (!printedMap(seed).hills[0]) continue;
    n++;
    const t = generateGeology(seed);
    const signs = surfaceSigns(t);
    const oilAt = (x: number, y: number) => SURVEYS.some((q) => insidePoly(q.poly, x, y)) ? !!columnAt(t, x, y, 700).find((iv) => iv.fluid === "oil" && iv.top * 3.28 < 2200) : null;
    for (const d of t.domes.filter(isCharged)) {
      const seeps = signs.filter((s) => (s.kind === "gasSeep" || s.kind === "paraffinDirt") && s.id.startsWith(d.id + ":"));
      if (!seeps.length) continue;
      const c = oilAt(d.x, d.y); if (c !== null) add("dome crest", c);
      for (const s of seeps) {
        const at = oilAt(s.x, s.y); if (at !== null) add(`at the ${s.kind}`, at);
        const mid = oilAt((s.x + d.x) / 2, (s.y + d.y) / 2); if (mid !== null) add("halfway crest to sign", mid);
        const r = Math.hypot(s.x - d.x, s.y - d.y) || 0.01;
        for (const k of [0.6, 0.9, 1.2]) { const x = d.x + ((s.x - d.x) / r) * k, y = d.y + ((s.y - d.y) / r) * k; const o = oilAt(x, y); if (o !== null) add(`${k} km from the crest toward the sign`, o); }
      }
      for (const k of [0.5, 0.8, 1.1]) for (let a = 0; a < 8; a++) { const o = oilAt(d.x + k * Math.cos(a * 0.785), d.y + k * Math.sin(a * 0.785)); if (o !== null) add(`${k} km from the crest, any direction`, o); }
    }
  }
  for (const [k, [a, b]] of Object.entries(hit)) console.log(`${k.padEnd(44)} oil below at ${a}/${b} (${Math.round((100 * a) / b)}%)`);
});
