#!/usr/bin/env node
/* Launcher. The only reason this exists instead of a plain `electron .` is
   that Linux needs --no-sandbox: Electron ships chrome-sandbox needing
   root-owned setuid 4755, which npm install cannot do, and without the flag
   the app aborts at launch. macOS and Windows do not need it and should not
   get it — passing it there would disable a sandbox that works fine. */
const { spawn } = require("child_process");
const electron = require("electron");

const args = [__dirname + "/.."];
if (process.platform === "linux") args.push("--no-sandbox");

spawn(electron, args.concat(process.argv.slice(2)), { stdio: "inherit" })
  .on("close", (code) => process.exit(code ?? 0));
