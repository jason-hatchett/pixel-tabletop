import { defineConfig } from "vite";

// In a container (docker compose sets VITE_USE_POLLING=1), file events don't
// propagate across the WSL bind mount — poll so HMR works. Native dev leaves
// this off to stay fast. `open` is disabled under polling since there's no
// browser inside the container.
const polling = process.env.VITE_USE_POLLING === "1";

export default defineConfig({
  server: {
    port: 5173,
    open: !polling,
    // Don't watch large sample maps in test-fixtures — copying one in mid-session
    // locked the file and crashed the watcher (EBUSY). They aren't app sources.
    watch: {
      ignored: ["**/test-fixtures/**"],
      ...(polling ? { usePolling: true } : {}),
    },
  },
  build: { target: "es2022", sourcemap: true },
});
