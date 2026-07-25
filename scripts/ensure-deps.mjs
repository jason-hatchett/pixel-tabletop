// Portable dependency bootstrap: if node_modules is missing, run `npm ci`.
// Pure Node (no shell operators), so it behaves identically on PowerShell,
// WSL, and macOS. Wired as pre* hooks in package.json so `npm run dev` (or
// test/build) works from a fresh clone in ONE command on any OS.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync("node_modules")) {
  console.log("[ensure-deps] node_modules missing — running `npm ci`…");
  execSync("npm ci", { stdio: "inherit" });
}
