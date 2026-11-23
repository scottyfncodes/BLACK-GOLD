import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/sim/core/hash";
import { rngUnit } from "../../src/sim/core/rng";
import { ftToM } from "../../src/sim/math/units";
import { columnAt, formationTop, generateGeology, isCharged, rockAt, shallowestOil, STACK } from "../../src/sim/geology/truth/model";
import { surfaceSigns } from "../../src/sim/geology/truth/surface";
import { printedMap, PRINT_RELIEF_FT } from "../../src/sim/surface/print";

/** M1 acceptance (docs/DESIGN.md §6): the generated ground is plausible and self-consistent. */
const seeds = Array.from({ length: 1000 }, (_, i) => (0x5eed0000 + i).toString(16).padStart(16, "0"));
/** Era I reach: cable-tool wells of the 1890s routinely went to 2,000–2,500 ft. */
const ERA_I_REACH = ftToM(2500);

describe("geological truth", () => {
  it("is a pure function of the seed", () => {
    expect(canonicalJson(generateGeology(seeds[0]!))).toBe(canonicalJson(generateGeology(seeds[0]!)));
    expect(canonicalJson(generateGeology(seeds[0]!).domes)).not.toBe(canonicalJson(generateGeology(seeds[1]!).domes));
  });

  it("across 1,000 seeds, every hydrocarbon lies inside a trap, above its contact, in reservoir rock", () => {
    let oilSamples = 0;
    for (const seed of seeds) {
      const t = generateGeology(seed);
      for (let k = 0; k < 60; k++) {
        const d = t.domes[k % t.domes.length]!;
        // Two thirds of samples in the flank annulus (where traps are), the rest anywhere nearby.
        const r = k % 3 ? d.saltR + rngUnit(seed, "test", k, 0) * d.flankW : rngUnit(seed, "test", k, 0) * (d.saltR + d.flankW + 0.3);
        const a = rngUnit(seed, "test", k, 1) * Math.PI * 2;
        const x = d.x + Math.cos(a) * r, y = d.y + Math.sin(a) * r;
        const z = d.crest - 20 + rngUnit(seed, "test", k, 2) * 700;
        const rock = rockAt(t, x, y, z);
        if (rock.fluid !== "oil" && rock.fluid !== "gas") continue;
        oilSamples++;
        expect(rock.trap, `${seed} ${rock.formation} @${z}`).toBeDefined();
        expect(z).toBeLessThan(rock.trap!.owc);
        if (rock.fluid === "gas") expect(z).toBeLessThan(rock.trap!.goc);
        expect(["sand", "caprock"]).toContain(rock.lithology);
        const dome = t.domes.find((dd) => dd.id === rock.trap!.domeId)!;
        expect(isCharged(dome)).toBe(true);
      }
      // Targeted pass: just below each reservoir top in every charged dome's flank, where oil sits.
      for (const d of t.domes.filter(isCharged)) {
        STACK.forEach((f, i) => {
          if (!f.reservoir) return;
          for (let a = 0; a < 6; a++) {
            const th = (a / 6) * Math.PI * 2, r = d.saltR + d.flankW * 0.25;
            const x = d.x + Math.cos(th) * r, y = d.y + Math.sin(th) * r;
            const z = formationTop(t, i, x, y) + 1 + rngUnit(seed, "test2", a, i) * 8;
            const rock = rockAt(t, x, y, z);
            if (rock.fluid !== "oil" && rock.fluid !== "gas") continue;
            oilSamples++;
            expect(rock.trap && z < rock.trap.owc && rock.lithology === "sand").toBe(true);
          }
        });
      }
    }
    expect(oilSamples).toBeGreaterThan(1000); // the test actually exercised traps
  });

  it("charges 20–35% of domes, and at least 85% of seeds hold a field within Era I reach", () => {
    let domes = 0, charged = 0, withField = 0;
    for (const seed of seeds) {
      const t = generateGeology(seed);
      domes += t.domes.length;
      charged += t.domes.filter(isCharged).length;
      if (t.domes.some((d) => (shallowestOil(t, d) ?? Infinity) < ERA_I_REACH)) withField++;
    }
    expect(charged / domes).toBeGreaterThanOrEqual(0.2);
    expect(charged / domes).toBeLessThanOrEqual(0.35);
    expect(withField / seeds.length).toBeGreaterThanOrEqual(0.85);
  });

  it("builds an ordered column with no gaps", () => {
    const t = generateGeology(seeds[3]!);
    const d = t.domes[0]!;
    const col = columnAt(t, d.x + d.saltR + 0.1, d.y, 900);
    expect(col[0]!.top).toBe(0);
    for (let i = 1; i < col.length; i++) expect(col[i]!.top).toBe(col[i - 1]!.base);
    expect(col.at(-1)!.base).toBe(900);
    expect(STACK.map((f) => f.id)).toContain(col[0]!.formation);
  });

  it("only charged structures leak gas and paraffin; marsh gas is a false positive", () => {
    for (const seed of seeds.slice(0, 200)) {
      const t = generateGeology(seed);
      for (const s of surfaceSigns(t)) {
        if (s.falsePositive) continue;
        if (s.kind === "gasSeep" || s.kind === "paraffinDirt") {
          const dome = t.domes.find((d) => s.id.startsWith(`${d.id}:`))!;
          expect(isCharged(dome)).toBe(true);
        }
      }
      expect(surfaceSigns(t).some((s) => s.falsePositive)).toBe(true);
    }
  });

  it("prints only hills of 10 ft or more, never springs, seeps or anything underground", () => {
    for (const seed of seeds.slice(0, 200)) {
      const map = printedMap(seed);
      expect(Object.keys(map).sort()).toEqual(["hills", "wells"]);
      for (const h of map.hills) {
        expect(h.reliefFt).toBeGreaterThanOrEqual(PRINT_RELIEF_FT);
        expect(Object.keys(h).sort()).toEqual(["id", "name", "radius", "reliefFt", "x", "y"]);
      }
    }
  });
});
