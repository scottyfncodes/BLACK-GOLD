import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * M0 acceptance: the architecture boundaries in docs/DESIGN.md §3.1 are enforced by lint.
 * Each case lints a snippet as if it lived at the given path in the real project config.
 */
const eslint = new ESLint();

async function lintAs(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => `${m.ruleId}: ${m.message}`);
}

describe("architecture boundaries", () => {
  it("blocks UI from reading geological truth", async () => {
    const errors = await lintAs("src/ui/Prospect.tsx", `import { truth } from "../sim/geology/truth";\nexport const x = truth;\n`);
    expect(errors.join("\n")).toMatch(/no-restricted-imports: .*never geological truth/);
  });

  it("blocks rendering from reading geological truth through deeper paths", async () => {
    const errors = await lintAs("src/render/section.ts", `import { formationAt } from "../sim/geology/truth/formations";\nexport const x = formationAt;\n`);
    expect(errors.join("\n")).toMatch(/never geological truth/);
  });

  it("seals what the player must learn rather than be told: drillers' ability, what a seat seals", async () => {
    for (const path of ["src/ui/Hire.tsx", "src/render/rig/scene.ts", "src/app/runtime.ts"]) {
      const errors = await lintAs(path, `import { abilityOf } from "../sim/hidden/drillers";\nexport const x = abilityOf;\n`);
      expect(errors.join("\n"), path).toMatch(/never geological truth/);
    }
  });

  it("lets UI read the subsurface through knowledge", async () => {
    expect(await lintAs("src/ui/Prospect.tsx", `import { evidence } from "../sim/knowledge";\nexport const x = evidence;\n`)).toEqual([]);
  });

  it("blocks the sim from importing UI, rendering or the app layer", async () => {
    for (const target of ["../../ui/App", "../../render/map", "../../app/runtime", "preact"]) {
      const errors = await lintAs("src/sim/wells/drilling.ts", `import x from "${target}";\nexport const y = x;\n`);
      expect(errors.join("\n"), target).toMatch(/sim\/ must not depend on UI/);
    }
  });

  it("blocks nondeterminism in the sim", async () => {
    const cases = ["export const a = Math.random();", "export const b = Date.now();", "export const c = new Date();", "export const d = performance.now();", "export const e = window.innerWidth;"];
    for (const code of cases) {
      expect((await lintAs("src/sim/economy/price.ts", code + "\n")).length, code).toBeGreaterThan(0);
    }
  });

  it("blocks the app layer and the entry point from reading geological truth", async () => {
    for (const file of ["src/app/runtime.ts", "src/main.tsx"]) {
      const errors = await lintAs(file, `import { rockAt } from "./sim/geology/truth/model";\nexport const x = rockAt;\n`);
      expect(errors.join("\n"), file).toMatch(/never geological truth/);
    }
  });

  it("keeps truth out of the sim's public surface", async () => {
    const sim = await import("../../src/sim");
    const exported = Object.keys(sim);
    for (const name of ["generateGeology", "rockAt", "columnAt", "formationTop", "surfaceSigns", "waterWells", "shallowestOil", "flankTrapAt", "STACK"]) {
      expect(exported, name).not.toContain(name);
    }
  });

  it("allows the app layer to use the wall clock", async () => {
    expect(await lintAs("src/app/clock.ts", "export const t = Date.now();\n")).toEqual([]);
  });
});
