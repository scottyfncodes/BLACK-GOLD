// M0 acceptance: the initial JavaScript a player downloads stays under budget (gzipped).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 150;
const dir = "dist/assets";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error("No built JavaScript found. Run `vite build` first.");
  process.exit(1);
}
// The dev-only god view of hidden geology must never ship.
for (const f of readdirSync(dir)) {
  const text = readFileSync(join(dir, f), "utf8");
  if (/BLACK-GOLD-DEV-GOD-VIEW|__blackGoldGodView|geology\/truth\/surface|DEV · TRUTH/.test(text) && !f.endsWith(".map")) {
    console.error(`${f}: contains the development god view. It must never be in a production build.`);
    process.exit(1);
  }
}
let total = 0;
for (const f of files) {
  const kb = gzipSync(readFileSync(join(dir, f))).length / 1024;
  total += kb;
  console.log(`${f.padEnd(32)} ${kb.toFixed(1)} KB gzip`);
}
console.log(`Total: ${total.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error("Over budget.");
  process.exit(1);
}
