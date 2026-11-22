import { defineConfig } from "vite";

// Build identity is stamped into every save file so a bug report can name the build.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { target: "es2022", sourcemap: true },
});
