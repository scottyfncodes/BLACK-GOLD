import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Architecture boundaries (docs/DESIGN.md §3.1) are lint errors, not conventions:
 *  - sim/ is pure and deterministic: no UI, rendering, app or browser imports; no wall
 *    clock, Math.random or DOM globals.
 *  - ui/ and render/ may only learn about the subsurface through sim/knowledge. Geological
 *    truth (sim/geology/truth) is sealed from them.
 */
const TRUTH = ["**/sim/geology/truth", "**/sim/geology/truth/**", "**/geology/truth", "**/geology/truth/**"];

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report", "gitcraft-out"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/sim/**/*.ts"],
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/ui", "**/ui/**", "**/render", "**/render/**", "**/app", "**/app/**", "preact", "preact/**"], message: "sim/ must not depend on UI, rendering or the app layer." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "localStorage", "sessionStorage", "indexedDB", "performance", "crypto", "fetch", "requestAnimationFrame", "setTimeout", "setInterval", "Date"].map((name) => ({
          name,
          message: "sim/ is deterministic: no browser APIs, timers or wall clock. Pass time in through the engine.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use a seeded stream (ctx.random) or rngKey." },
      ],
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}", "src/render/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: TRUTH, message: "UI and rendering read the subsurface only through sim/knowledge, never geological truth." }] },
      ],
    },
  },
);
