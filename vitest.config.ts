import { defineConfig, configDefaults } from "vitest/config";

// Vitest uses its own config so the coverage gate stays independent of the
// Vite dev/build config (vite.config.ts). Coverage is scoped to the PURE CORE
// — src/domain/ and src/net/ — which is deterministic and unit-testable.
// src/render/** and src/main.ts are verified live in the browser, not here
// (see CLAUDE.md / docs/architecture), so they are excluded from the gate.
export default defineConfig({
  test: {
    // Only discover tests under src/. Agent worktrees live at
    // .claude/worktrees/agent-*/ INSIDE the repo, so the default "**" glob
    // would find each worktree's copy of src/**/*.test.ts and double (or worse)
    // the suite when run from the repo root. Anchoring to src/ and excluding
    // .claude/ keeps `npm test` (plain `vitest run`) counting the real suite.
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/domain/**", "src/net/**"],
      exclude: [
        "src/render/**",
        "src/main.ts",
        "**/*.test.ts",
        "scripts/**",
        "vite.config.ts",
        "vitest.config.ts",
        "**/*.config.*",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
