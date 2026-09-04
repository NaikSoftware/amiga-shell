// AmigaTerm — Electron main process.
//
// Two jobs, nothing else: put a frameless window on screen and own the PTY.
// The byte stream between the child process and the renderer is NEVER
// inspected, filtered, buffered or rewritten here — Ctrl-C, alternate-screen
// apps, mouse reporting and truecolour all depend on that.

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- config ---
// Kept free of any Electron import so `require("./main.js")` works from plain
// node — test.js exercises normalizeConfig() directly.

const DEFAULTS = {
  shell: null,
  shellArgs: [],
  fontSize: 16,
  bootSequence: true,
  hud: true,
  effects: { scanlines: 45, bloom: 30, curvature: 15, glitchRate: 8, flicker: 5 }
};

// 0-100, or the default. Anything that cannot become a finite number — missing,
// null, "banana", NaN, an object — falls back rather than reaching CSS as NaN.
function clampPct(v, def) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : def;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeConfig(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const e = isPlainObject(r.effects) ? r.effects : {};

  const effects = {};
  for (const key of Object.keys(DEFAULTS.effects)) {
    effects[key] = clampPct(e[key], DEFAULTS.effects[key]);
  }

  const fontSize = typeof r.fontSize === "number" || typeof r.fontSize === "string"
    ? Number(r.fontSize)
    : NaN;

  return {
    // null means "use $SHELL, else /bin/bash" — resolved at spawn time.
    shell: typeof r.shell === "string" && r.shell.trim() ? r.shell.trim() : null,
    shellArgs: Array.isArray(r.shellArgs) ? r.shellArgs.filter((a) => typeof a === "string") : [],
    fontSize: Number.isFinite(fontSize) ? Math.min(72, Math.max(6, fontSize)) : DEFAULTS.fontSize,
    bootSequence: typeof r.bootSequence === "boolean" ? r.bootSequence : DEFAULTS.bootSequence,
    hud: typeof r.hud === "boolean" ? r.hud : DEFAULTS.hud,
    // "webgl" (default) or "dom" — the escape hatch when a GPU path misbehaves
    /* Default "dom": the WebGL addon draws a cursor that TUIs have hidden
       with ?25l, producing a phantom second cursor next to the one the app
       draws itself. Opt into "webgl" for speed if that doesn't bother you. */
    renderer: r.renderer === "webgl" ? "webgl" : "dom",
    cursorStyle: ["block", "underline", "bar"].includes(r.cursorStyle) ? r.cursorStyle : "block",
    cursorBlink: typeof r.cursorBlink === "boolean" ? r.cursorBlink : true,
    fontFamily: typeof r.fontFamily === "string" && r.fontFamily.trim() ? r.fontFamily.trim() : null,
    effects
  };
}

// A missing or malformed config.json is not an error — it is the defaults.
function loadConfig(dir) {
  const file = path.join(dir || __dirname, "config.json");
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.error(`[amiga] ignoring unreadable config.json: ${err.message}`);
    }
    return normalizeConfig({});
  }
}

// ----------------------------------------------------------------- shell ---

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function onPath(cmd) {
  if (cmd.includes("/")) return isExecutable(cmd);
  return (process.env.PATH || "").split(path.delimiter).some((d) => d && isExecutable(path.join(d, cmd)));
}

// Returns {shell, args, error}. A configured shell that is not on PATH falls
// back to the login shell and reports the failure instead of dying silently.
function resolveShell(cfg) {
  const fallback = process.env.SHELL || "/bin/bash";
  if (!cfg.shell) return { shell: fallback, args: cfg.shellArgs, error: null };
  if (onPath(cfg.shell)) return { shell: cfg.shell, args: cfg.shellArgs, error: null };
  return {
    shell: fallback,
    args: [],
    error: `shell "${cfg.shell}" not found on PATH — fell back to ${fallback}`
  };
}

module.exports = { DEFAULTS, normalizeConfig, loadConfig, resolveShell, clampPct };

// ------------------------------------------------------------- electron ----
// Everything below only runs under `electron .`; importing this file from node
// stops here.

if (!process.versions.electron) return;

const { app, BrowserWindow, ipcMain } = require("electron");
const pty = require("node-pty");

const config = loadConfig(__dirname);
const shellSpec = resolveShell(config);

let win = null;
let term = null;

// Synchronous so window.amiga.config is a plain value at renderer start-up,
// as the contract requires — no promise, no race with xterm mounting.
ipcMain.on("amiga:bootstrap", (event) => {
  event.returnValue = { config, shellError: shellSpec.error };
});

function spawnPty() {
  term = pty.spawn(shellSpec.shell, shellSpec.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: "xterm-256color" }
  });

  // Straight through. No transform, no buffering, no line handling.
  term.onData((data) => {
    // Debug hatch: AMIGATERM_DUMP=/path/to/file appends the raw PTY stream.
    // Off unless the env var is set; the terminal path is untouched either way.
    if (process.env.AMIGATERM_DUMP) {
      try { require("fs").appendFileSync(process.env.AMIGATERM_DUMP, data); } catch (e) {}
    }
    if (win && !win.isDestroyed()) win.webContents.send("pty:data", data);
  });

  term.onExit(({ exitCode }) => {
    term = null;
    if (win && !win.isDestroyed()) win.webContents.send("pty:exit", { exitCode });
    app.quit();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    frame: false,
    backgroundColor: "#0055AA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "index.html"));

  win.on("closed", () => {
    win = null;
    if (term) { try { term.kill(); } catch { /* already gone */ } term = null; }
  });
}

// ------------------------------------------------------------------ ipc ----

ipcMain.on("pty:write", (_e, data) => {
  if (term && typeof data === "string") term.write(data);
});

ipcMain.on("pty:resize", (_e, cols, rows) => {
  // A zero or NaN size throws inside node-pty and would take the app with it.
  const c = Math.max(1, Math.floor(Number(cols) || 0));
  const r = Math.max(1, Math.floor(Number(rows) || 0));
  if (term && c > 0 && r > 0) {
    try { term.resize(c, r); } catch { /* child died between check and call */ }
  }
});

ipcMain.on("win:minimize", () => win && win.minimize());
ipcMain.on("win:maximize", () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on("win:close", () => win && win.close());

// ----------------------------------------------------------- lifecycle -----

app.whenReady().then(() => {
  spawnPty();
  createWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  if (term) { try { term.kill(); } catch { /* already gone */ } term = null; }
});

// Belt and braces: no orphaned shell if the main process is signalled.
process.on("exit", () => { if (term) { try { term.kill(); } catch {} } });
