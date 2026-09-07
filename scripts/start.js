#!/usr/bin/env node
/* Launcher. The only reason this exists instead of a plain `electron .` is
   that Linux needs --no-sandbox: Electron ships chrome-sandbox needing
   root-owned setuid 4755, which npm install cannot do, and without the flag
   the app aborts at launch. macOS and Windows do not need it and should not
   get it — passing it there would disable a sandbox that works fine. */
const { spawn } = require("child_process");
const { chmodSync } = require("fs");
const electron = require("electron");

/* macOS: the published node-pty tarball ships its darwin prebuild's
   spawn-helper with mode 644, so posix_spawnp fails and no PTY ever starts —
   the app dies at launch with "posix_spawnp failed". Linux has no darwin
   prebuild, compiles from source and gets a correct +x helper, which is why
   this never shows there. Idempotent, and re-applied after every npm install
   that re-extracts the tarball. */
if (process.platform === "darwin") {
  const helper = `${__dirname}/../node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`;
  try { chmodSync(helper, 0o755); } catch { /* built from source: already +x */ }
}

const args = [__dirname + "/.."];
if (process.platform === "linux") args.push("--no-sandbox");

spawn(electron, args.concat(process.argv.slice(2)), { stdio: "inherit" })
  .on("close", (code) => process.exit(code ?? 0));
