import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INK, LITH, WASH } from "../../src/render/plate/palette";

/** The canvas palette and the CSS tokens are one system (docs/ART-DIRECTION.md). */
describe("palette", () => {
  const css = readFileSync(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  it.each([
    ["paper", INK.paper], ["paper-deep", INK.paperDeep], ["paper-edge", INK.rule], ["ink", INK.ink], ["ink-soft", INK.inkSoft], ["accent", INK.carmine],
    ["water", INK.water], ["relief", INK.relief],
    ["wash-prairie", WASH.prairie], ["wash-wood", WASH.wood], ["wash-marsh", WASH.marsh], ["wash-water", WASH.water], ["wash-town", WASH.town],
    ["lith-sand", LITH.sand], ["lith-clay", LITH.clay], ["lith-salt", LITH.salt],
  ])("--%s matches the canvas palette", (name, value) => {
    expect(token(name)).toBe(value);
  });
});
