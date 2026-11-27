// Analysis harnesses: long-running, never part of CI. Run one with
//   npx vitest run --config tools/analysis/vitest.config.mjs --disableConsoleIntercept tools/analysis/<name>.harness.ts
export default {
  test: { include: ["tools/analysis/*.harness.ts"], environment: "node", testTimeout: 0, hookTimeout: 0 },
};
