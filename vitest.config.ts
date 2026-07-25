import { defineConfig } from "vitest/config";

// Vitest uses its own config so the coverage gate stays independent of the
// Vite dev/build config (vite.config.ts). Coverage is scoped to the PURE CORE
// — src/domain/ and src/net/ — which is deterministic and unit-testable.
// src/render/** and src/main.ts are verified live in the browser, not here
// (see CLAUDE.md / docs/architecture), so they are excluded from the gate.
export default defineConfig({
  test: {
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
