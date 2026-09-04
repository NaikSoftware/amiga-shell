/* AmigaTerm renderer — Amiga chrome, CRT screen, and the real terminal.
   This file owns the byte path: PTY -> xterm -> screen, and keyboard ->
   PTY. effects.js and hud.js are passengers. If either one fails to load
   or throws, the terminal keeps working; that is the whole point. */

import { Terminal } from "./node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "./node_modules/@xterm/addon-fit/lib/addon-fit.mjs";

const $ = id => document.getElementById(id);

/* ── config ────────────────────────────────────────────────── */

const DEFAULTS = {
  fontSize: 16, bootSequence: true, hud: true,
  effects: {scanlines:45, bloom:30, curvature:15, glitchRate:8, flicker:5}
};
const amiga = window.amiga || {};
const cfg = {
  ...DEFAULTS, ...(amiga.config || {}),
  effects: {...DEFAULTS.effects, ...((amiga.config || {}).effects || {})}
};

// ponytail: no-op shim so the page still renders if preload never ran
// (opened in a plain browser, or a main.js that failed to attach it).
const pty = window.pty || {onData(){}, onExit(){}, write(){}, resize(){}};

/* ── phosphor palette ──────────────────────────────────────── */
/* Everything is pulled toward green, but hue separation is preserved —
   `ls`, `git diff` and Claude Code's colored output must stay readable. */

const THEME = {
  background: "#07110A",
  foreground: "#3BFF6E",
  cursor: "#3BFF6E",
  cursorAccent: "#07110A",
  selectionBackground: "rgba(59,255,110,.30)",

  black:   "#06120A", red:     "#FF5F52", green:   "#3BFF6E", yellow:  "#C8FF4A",
  blue:    "#5AA8FF", magenta: "#E27BFF", cyan:    "#4FFFD0", white:   "#CFFFDD",

  brightBlack:   "#1B7A38", brightRed:     "#FF8A80",
  brightGreen:   "#96FFB0", brightYellow:  "#E6FF8A",
  brightBlue:    "#8FCBFF", brightMagenta: "#FFA8EA",
  brightCyan:    "#9FFFE8", brightWhite:   "#F2FFF6"
};

/* ── terminal ──────────────────────────────────────────────── */

const term = new Terminal({
  allowProposedApi: true,
  /* NOT Topaz by default, deliberately.

     Topaz's cmap stops at U+00FF and its .notdef glyph is a SOLID FILLED
     BLOCK. Modern TUIs emit box drawing and symbols constantly — Claude Code
     alone uses U+2500 U+2588 U+276F U+23F5 U+2733 — and every one of them
     painted as a stray block, which next to the real cursor read as a
     duplicate cursor. Confirmed by elimination: dropping Topaz from this
     stack fixes it; `unicode-range: U+0000-00FF` on the @font-face does NOT
     (xterm's renderer does not honour it).

     The Amiga identity lives in the Workbench chrome, the phosphor palette
     and the CRT layers — not in the one place that has to render arbitrary
     program output correctly. Set config.fontFamily to put Topaz back if you
     only ever run plain ASCII in here. */
  fontFamily: cfg.fontFamily ||
    "'Ubuntu Mono', 'DejaVu Sans Mono', 'Noto Sans Mono', monospace",
  fontSize: Math.max(8, Math.round(Number(cfg.fontSize) || DEFAULTS.fontSize)),
  lineHeight: 1.05,
  cursorBlink: cfg.cursorBlink !== false,
  cursorStyle: cfg.cursorStyle || "block",
  scrollback: 10000,
  theme: THEME
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open($("term"));

// WebGL is a big win and a common crash on Wayland/software GL — try it,
// shrug it off, keep the default renderer.
let webglOn = false;
try {
  // config.renderer: "dom" forces the default renderer. The WebGL one is
  // faster but can leave a stale cursor cell behind in some TUIs, which
  // reads as a second, static cursor next to the real blinking one.
  if (cfg.renderer === "dom") throw new Error("renderer forced to dom by config");
  const { WebglAddon } = await import("./node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs");
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => { webglOn = false; webgl.dispose(); });
  term.loadAddon(webgl);
  webglOn = true;
} catch (e) {
  console.warn("[amigaterm] WebGL renderer unavailable, using the default one:", e);
}

/* The WebGL renderer keeps roughly six canvases under .xterm-screen — the
   webgl2 one holding the text plus 2D overlays for cursor, selection and
   links. Only the text canvas is worth glitching, and losing the cursor
   overlay for a 400ms burst is invisible. The addon sets
   preserveDrawingBuffer, so drawImage off it reads back fine.
   Resolved fresh on every call: the element is replaced outright if the
   renderer falls back, so a cached reference goes stale. Null (no WebGL,
   or before mount) is a correct answer — effects.js degrades to CSS. */
function getSourceCanvas(){
  if (!webglOn || !term.element) return null;
  let best = null;
  for (const c of term.element.querySelectorAll(".xterm-screen canvas")){
    let gl = null;
    try { gl = c.getContext("webgl2"); } catch (e) {}   // null on the 2D overlays
    if (gl && (!best || c.width * c.height > best.width * best.height)) best = c;
  }
  return best;
}

/* ── sizing ────────────────────────────────────────────────── */
/* One rAF-coalesced refit, driven by a ResizeObserver on the xterm host.
   That single source covers window resize, the HUD toggle and the mission
   bar opening — no per-caller bookkeeping. pty.resize runs every time so
   SIGWINCH always reaches the child. */

let refitQueued = false;
function refit(){
  if (refitQueued) return;
  refitQueued = true;
  requestAnimationFrame(() => {
    refitQueued = false;
    try { fitAddon.fit(); } catch (e) { /* zero-sized host mid-transition */ }
    try { pty.resize(term.cols, term.rows); } catch (e) {}
  });
}
new ResizeObserver(refit).observe($("term"));
addEventListener("resize", refit);
if (document.fonts) document.fonts.ready.then(refit).catch(() => {});
refit();

/* ── the byte path ─────────────────────────────────────────── */

let hud = null;

term.onData(d => pty.write(d));
term.onBinary(d => pty.write(d));
pty.onData(d => {
  term.write(d);                              // screen first, always
  try { hud && hud.feed(d); } catch (e) {}    // then the read-only tap
});
pty.onExit(info => {
  term.write(`\r\n\x1b[33m[process exited: ${(info && info.exitCode) ?? "?"}]\x1b[0m\r\n`);
});

/* ── title ─────────────────────────────────────────────────── */

const cwd = amiga.cwd || cfg.cwd || "~";
const titleEl = $("titleOp");
function setTitle(t){
  const s = (t && String(t).trim()) || cwd;
  titleEl.textContent = s;
  document.title = "AmigaShell — " + s;
}
setTitle("");
term.onTitleChange(setTitle);

/* ── effects + HUD (optional passengers) ───────────────────── */

let effects = null;
try {
  const { initEffects } = await import("./effects.js");
  effects = initEffects({
    screenEl: $("screenwrap"),
    getSourceCanvas,
    config: cfg.effects
  });
  if (effects && effects.start) effects.start();
} catch (e) {
  console.warn("[amigaterm] effects.js unavailable, running without CRT effects:", e);
}

try {
  const { initHud } = await import("./hud.js");
  hud = initHud({ hudEl: $("hud"), missionBarEl: $("missionbar"), config: cfg, effects });
} catch (e) {
  console.warn("[amigaterm] hud.js unavailable, running without the HUD:", e);
}

/* A failed shell spawn is the one thing that would otherwise show a blank
   screen. Say so on the screen, and let the Guru say it louder. */
if (amiga.shellError) {
  term.write(`\x1b[31mSoftware Failure.  ${amiga.shellError}\x1b[0m\r\n`);
  try { effects && effects.guru(); } catch (e) {}
}

/* ── intensity presets ─────────────────────────────────────── */

const PRESETS = {
  calm:   {scanlines:12, bloom:14, curvature:6,  glitchRate:1,  flicker:1},
  medium: {scanlines:45, bloom:30, curvature:15, glitchRate:8,  flicker:5},
  max:    {scanlines:88, bloom:78, curvature:34, glitchRate:34, flicker:26}
};
const order = ["calm", "medium", "max"];
let presetIdx = 1;

function setPreset(name){
  if (!PRESETS[name]) return;
  presetIdx = order.indexOf(name);
  try { effects && effects.setConfig(PRESETS[name]); } catch (e) {}
  document.querySelectorAll("[data-preset]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.preset === name)));
}
document.querySelectorAll("[data-preset]").forEach(b =>
  b.addEventListener("click", () => setPreset(b.dataset.preset)));

/* ── HUD toggle ────────────────────────────────────────────── */

const hudEl = $("hud");
function toggleHud(on){
  hudEl.hidden = on === undefined ? !hudEl.hidden : !on;
  $("bHud").setAttribute("aria-pressed", String(!hudEl.hidden));
  try { hud && hud.setEnabled(!hudEl.hidden); } catch (e) {}
  refit();
}
if (cfg.hud === false) toggleHud(false);

/* ── missions ──────────────────────────────────────────────── */
// ponytail: mission keys hard-coded from the spec's list; hud.js owns the
// scripts. A key it does not know is a no-op there, not a crash here.
const MISSION_KEYS = ["kremlin", "icbm", "delworld", "gibson", "satellite"];
function randomMission(){
  try {
    hud && hud.runMission(MISSION_KEYS[Math.floor(Math.random() * MISSION_KEYS.length)]);
  } catch (e) {}
}

/* ── clipboard ─────────────────────────────────────────────── */

function copySelection(){
  const sel = term.getSelection();
  if (sel) navigator.clipboard.writeText(sel).catch(() => {});
}
function pasteClipboard(){
  navigator.clipboard.readText()
    .then(t => { if (t) term.paste(t); })   // term.paste honours bracketed-paste mode
    .catch(() => {});
}

/* ── hotkeys ───────────────────────────────────────────────── */
/* Resolved in one place and consulted twice: xterm asks "is this mine?"
   and refuses to forward it, the document listener runs the action. Every
   other key — including a bare Ctrl-C — falls straight through to the PTY. */

function hotkey(e){
  if (e.key === "F9")  return () => setPreset(order[(presetIdx + 1) % order.length]);
  if (e.key === "F10") return () => toggleHud();
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey){
    switch (String(e.key).toLowerCase()){
      case "c": return copySelection;
      case "v": return pasteClipboard;
      case "m": return randomMission;
    }
  }
  return null;
}

term.attachCustomKeyEventHandler(e => e.type !== "keydown" || !hotkey(e));

document.addEventListener("keydown", e => {
  const act = hotkey(e);
  if (!act) return;
  e.preventDefault();
  act();
});

/* ── window gadgets ────────────────────────────────────────── */

$("gShrink").addEventListener("click", () => amiga.minimize && amiga.minimize());
$("gZoom").addEventListener("click",   () => amiga.maximize && amiga.maximize());
$("gClose").addEventListener("click",  () => amiga.close && amiga.close());
// ponytail: no Electron equivalent of Workbench depth-arrange in the
// contract; blur is the honest near-miss. Wire amiga.depth() if it appears.
$("gDepth").addEventListener("click",  () => amiga.depth ? amiga.depth() : window.blur());

$("bGlitch").addEventListener("click", () => { try { effects && effects.glitch(420); } catch (e) {} });
$("bGuru").addEventListener("click",   () => { try { effects && effects.guru(); } catch (e) {} });
$("bBoot").addEventListener("click",   () => runBoot());
$("bHud").addEventListener("click",    () => toggleHud());

/* ── boot sequence ─────────────────────────────────────────── */
/* Typed over the screen while the PTY spawns underneath, so it costs no
   real startup latency. Any key skips it — and the key is NOT swallowed,
   because by then the shell is already live and that keystroke is input. */

const BOOT = [
  "Kickstart 1.3 ROM ............ OK",
  "CHIP RAM   512K .............. OK",
  "FAST RAM  8192K .............. OK",
  "DF0: reading .................",
  "",
  "> ESTABLISHING UPLINK",
  "> ACCESS GRANTED",
  ""
];
const bootEl = $("boot");
let bootTimer = null;

function skipBoot(){
  if (!bootTimer) return;
  clearInterval(bootTimer);
  bootTimer = null;
  bootEl.hidden = true;
  try { effects && effects.glitch(140); } catch (e) {}
  term.focus();
}

function runBoot(){
  clearInterval(bootTimer);
  bootEl.hidden = false;
  bootEl.textContent = "";
  let li = 0, ci = 0;
  bootTimer = setInterval(() => {
    if (li >= BOOT.length) return skipBoot();
    const line = BOOT[li];
    if (ci <= line.length){
      bootEl.textContent = BOOT.slice(0, li).join("\n") + (li ? "\n" : "") + line.slice(0, ci);
      ci++;
    } else { li++; ci = 0; }
  }, 11);
}

bootEl.addEventListener("click", skipBoot);
document.addEventListener("keydown", skipBoot, true);   // no preventDefault: the key is still input

/* ── chrome odds and ends ──────────────────────────────────── */

const clockEl = $("clock");
const tickClock = () => { clockEl.textContent = new Date().toTimeString().slice(0, 8); };
tickClock();
setInterval(tickClock, 1000);

/* ── go ────────────────────────────────────────────────────── */
/* No setPreset() here on purpose — config.json's effect values are already
   live, and forcing "medium" at boot would silently overwrite them. */

term.focus();
if (cfg.bootSequence !== false) runBoot();
