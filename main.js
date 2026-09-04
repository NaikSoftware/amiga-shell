// AmigaTerm — Electron main process.
//
// Two jobs, nothing else: put a frameless window on screen and own the PTY.
// The byte stream between the child process and the renderer is NEVER
// inspected, filtered, buffered or rewritten here — Ctrl-C, alternate-screen
// apps, mouse reporting and truecolour all depend on that.

"use strict";

const { execFile } = require("child_process");
const os = require("os");
const netprobe = require("./netprobe.js");
const sysprobe = require("./sysprobe.js");

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
    // live headline panel: costs tokens per refresh, so it is easy to disable
    typingEffects: typeof r.typingEffects === "boolean" ? r.typingEffects : true,
    // real /proc/net telemetry in PACKET LOG; false keeps the fake generator
    realPackets: typeof r.realPackets === "boolean" ? r.realPackets : true,
    // real microphone in the WAVEFORM / SPECTRUM panels. Strict === true so a
    // missing key, "true" or 1 all read as OFF: a terminal must never open the
    // mic by accident, and off is the only safe default.
    micEqualizer: r.micEqualizer === true,
    // real CPU/mem/disk/GPU/battery telemetry in the HUD gauges; false leaves
    // the panels with nothing rather than with invented numbers
    sysTelemetry: typeof r.sysTelemetry === "boolean" ? r.sysTelemetry : true,
    sysIntervalMs: Number.isFinite(Number(r.sysIntervalMs))
      ? Math.max(250, Math.min(10000, Number(r.sysIntervalMs))) : 1000,
    news: typeof r.news === "boolean" ? r.news : true,
    newsIntervalMinutes: Number.isFinite(Number(r.newsIntervalMinutes))
      ? Math.max(10, Math.min(720, Number(r.newsIntervalMinutes))) : 30,
    // live news markers on the world map — same deal, its own slower timer
    newsMap: typeof r.newsMap === "boolean" ? r.newsMap : true,
    newsMapIntervalMinutes: Number.isFinite(Number(r.newsMapIntervalMinutes))
      ? Math.max(10, Math.min(720, Number(r.newsMapIntervalMinutes))) : 45,
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

// ------------------------------------------------------------ newsmap ---
// The map's live markers. `claude -p` is asked for LAT|LON|PLACE|SUMMARY
// lines and mostly obliges, but a chatty preamble or a stray markdown bullet
// is the normal failure, not the exception — so every line is parsed on its
// own and anything that does not fit is dropped. This never throws: a garbage
// response yields [] and the renderer simply keeps its last good markers.

const NEWSMAP_MAX = 7;

// finite number or null — "", "35N", undefined and NaN all fall through
function finiteOr(v, lo, hi) {
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

const asciiOnly = (v, max) => String(v).replace(/[^\x20-\x7e]/g, "").trim().slice(0, max);

// same, but a summary that has to be cut loses its last partial word rather
// than ending in "nuclear materia"
function asciiWords(v, max) {
  const s = String(v).replace(/[^\x20-\x7e]/g, "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).trim();
}

function parseNewsMarkers(text) {
  const out = [];
  if (typeof text !== "string" || !text) return out;
  // split's limit bounds the work on a runaway response; the per-line length
  // check bounds the other shape of runaway — one enormous line.
  for (const raw of text.split("\n", 400)) {
    if (out.length >= NEWSMAP_MAX) break;
    if (raw.length > 300) continue;
    // strip at most one markdown bullet or list number. The trailing \s+ is
    // required: without it a leading "-51.5" latitude would lose its sign.
    const parts = raw.trim().replace(/^(?:[-*\u2022>]|\d+[.)])\s+/, "").split("|");
    if (parts.length < 4) continue;
    const lat = finiteOr(parts[0], -90, 90);
    const lon = finiteOr(parts[1], -180, 180);
    if (lat === null || lon === null) continue;
    const place = asciiOnly(parts[2], 12).toUpperCase();
    const summary = asciiWords(parts.slice(3).join(" "), 44);
    if (!place || !summary) continue;
    out.push({ lat, lon, place, summary });
  }
  return out;
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

module.exports = { DEFAULTS, normalizeConfig, loadConfig, resolveShell, clampPct, parseNewsMarkers };

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
  /* Live headline feed. Runs `claude -p` on a long timer and pushes plain
     lines to the HUD. Costs tokens on every run, so the interval is long and
     config.news:false turns it off entirely. Failure is silent by design —
     no auth, no network, no claude on PATH all just mean the panel keeps
     showing its last content, and the terminal is never affected. */
  const NEWS_PROMPT =
    "Search the web for the most significant Ukraine-related world news from " +
    "the last 24 hours. Reply with ONLY 5 lines, nothing else. Each line at " +
    "most 34 characters, plain ASCII, no markdown, no bullets, no preamble. " +
    "Format each line as: HH:MM SOURCE headline fragment";

  /* Same deal for the world map: geolocated stories, so the map has
     something true on it when no scripted operation is running. Separate
     prompt, separate (longer) timer, same silent-degrade contract. */
  const NEWSMAP_PROMPT =
    "Search the web for the top world news stories right now. Reply with " +
    "ONLY 6 lines and nothing else: no preamble, no markdown, no bullets, " +
    "no numbering, no blank lines. Each line must be exactly " +
    "LAT|LON|PLACE|SUMMARY where LAT and LON are decimal degrees of the " +
    "place the story is about (LAT between -90 and 90, LON between -180 " +
    "and 180), PLACE is at most 12 characters of plain ASCII, and SUMMARY " +
    "is at most 8 words of plain ASCII. Example of one line: " +
    "50.4|30.5|KYIV|Ceasefire talks stall as strikes continue";

  // one shape for both feeds: run claude, hand stdout to `shape`, push
  // whatever comes back unless it is empty. An error is just "no update".
  function fetchFeed(prompt, channel, shape) {
    execFile("claude", ["-p", prompt],
      { timeout: 180000, maxBuffer: 1 << 20, cwd: os.homedir() },
      (err, stdout) => {
        if (err || !stdout) return;                       // silent degrade
        let payload;
        try { payload = shape(String(stdout)); } catch (e) { return; }
        if (payload && payload.length && win && !win.isDestroyed())
          win.webContents.send(channel, payload);
      });
  }

  // first run is delayed past the boot sequence, then it is the long timer
  function startFeed(enabled, minutes, def, delay, prompt, channel, shape) {
    if (enabled === false) return;
    setTimeout(() => fetchFeed(prompt, channel, shape), delay);
    const mins = Math.max(10, Math.min(720, Number(minutes) || def));
    const timer = setInterval(() => fetchFeed(prompt, channel, shape), mins * 60000);
    timer.unref?.();
  }

  startFeed(config.news, config.newsIntervalMinutes, 30, 20000,
    NEWS_PROMPT, "news:data", (out) => out
      .split("\n").map((s) => s.trim().replace(/[^\x20-\x7e]/g, ""))
      .filter(Boolean).slice(0, 6));

  startFeed(config.newsMap, config.newsMapIntervalMinutes, 45, 45000,
    NEWSMAP_PROMPT, "newsmap:data", parseNewsMarkers);

  /* Real network telemetry for the PACKET LOG panel. /proc/net is
     world-readable so this needs no root; on non-Linux netprobe reports
     unavailable and the HUD keeps its fake generator. Sampled once a second —
     fast enough to feel live, slow enough to be free. */
  let netTimer = null, netPrev = netprobe.readInterfaces(), netAt = Date.now();
  if (netprobe.AVAILABLE && config.realPackets !== false) {
    netTimer = setInterval(() => {
      try {
        const now = netprobe.readInterfaces();
        const t = Date.now();
        const lines = netprobe.format(
          netprobe.rates(netPrev, now, t - netAt),
          netprobe.readConnections().filter((c) => c.state === "ESTAB")
        );
        netPrev = now; netAt = t;
        if (win && !win.isDestroyed()) win.webContents.send("net:data", lines);
      } catch (e) { /* telemetry only; never disturb the terminal */ }
    }, 1000);
    netTimer.unref?.();
  }

  /* Real system telemetry for the gauges. Two timers because the two tiers
     cost very different amounts: os.cpus()/freemem is free, but statfs and
     nvidia-smi are not worth doing at 1 Hz. Both are fire-and-forget — a
     rejected sample is a skipped frame, never a thrown error near the PTY. */
  if (sysprobe.AVAILABLE && config.sysTelemetry !== false) {
    const push = (payload) => {
      if (win && !win.isDestroyed()) win.webContents.send("sys:data", payload);
    };
    const fastMs = config.sysIntervalMs || 1000;
    const fast = setInterval(() => { sysprobe.sample().then(push, () => {}); }, fastMs);
    const slow = setInterval(() => { sysprobe.refreshSlow().catch(() => {}); },
                             Math.max(5000, fastMs * 5));
    // seed the slow tier immediately so the first second is not all nulls
    sysprobe.refreshSlow().catch(() => {});
    fast.unref?.();
    slow.unref?.();
  }

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
