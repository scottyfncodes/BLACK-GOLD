/**
 * What a casing seat really does. HIDDEN: sealed from ui/, render/ and app/ (eslint.config.js).
 *
 * Pipe landed in an impermeable bed (clay, caprock, salt) shuts off the water behind it. Pipe
 * landed in sand or gravel steadies the walls but seals nothing: water still comes in, and sand
 * works in beneath the shoe. The company learns which only by what the hole does afterwards.
 */
import { ftToM } from "../math/units";
import { generateGeology, rockAt } from "../geology/truth/model";

export function seatSeals(seed: string, x: number, y: number, seatFt: number): boolean {
  // The shoe sits on the last foot of hole.
  const r = rockAt(generateGeology(seed), x, y, ftToM(Math.max(0.5, seatFt - 0.5)));
  return r.lithology === "clay" || r.lithology === "caprock" || r.lithology === "salt";
}
