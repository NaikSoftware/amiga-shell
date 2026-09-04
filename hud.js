/* hud.js — the theater column: panels, line generators, canvas instruments,
   Workbench requesters, and the Claude activity sniffer.

   There is exactly one concept here: panels. A registry of specs, per-scenario
   layout tables, and two regions — the side column and the bottom bar — that
   mount from it under identical rules. Rotation, the hold timer, the pin
   gadget and F8 work the same in both, because there is nothing else in
   either region to work around.

   Everything here is decoration. The PTY stream is never touched: feed()
   is a read-only tap wrapped in try/catch, and setEnabled(false) tears
   down every interval and rAF so an idle HUD costs nothing. */

import { setNewsMarkers } from "./worldmap.js";
import { EXTRA_GENERATORS } from "./generators.js";
import { EXTRA_PANELS, EXTRA_LAYOUTS } from "./panels-extra.js";
import { CLOCK_PANELS, CLOCK_LAYOUTS } from "./panels-clock.js";
import { SYS_PANELS, SYS_LAYOUTS, setSys } from "./panels-sys.js";
import { WIDE_PANELS, BOTTOM_LAYOUTS } from "./panels-wide.js";

const $ = id => document.getElementById(id);
const rnd = (a,b) => a + Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];
const hex = n => Array.from({length:n},()=>"0123456789ABCDEF"[Math.floor(Math.random()*16)]).join("");

/* ── line generators — pure, no side effects, individually testable ── */

export const GENERATORS = {
  hexDump: () => {
    const off = Math.floor(rnd(0, 0xFFFFF));
    return `${off.toString(16).toUpperCase().padStart(6,"0")} ${Array.from({length:6},()=>hex(2)).join(" ")} ` +
      Array.from({length:8},()=>pick("abcdefghijklmnopqrstuvwxyz.$#@%*-_/".split(""))).join("");
  },
  portScan: () => {
    const p = pick([21,22,23,25,80,110,443,1337,4444,8080,9001]);
    return `10.0.${Math.floor(rnd(0,4))}.${String(Math.floor(rnd(2,254))).padStart(3)}:${String(p).padStart(5)} ` +
      `${pick(["SYN","ACK","RST","OPEN","FILTERED"]).padEnd(9)}${Math.floor(rnd(1,99))}ms`;
  },
  packetTrace: () => `${pick(["TCP","UDP","ICMP","TLS"]).padEnd(5)}${hex(4)}>${hex(4)} ` +
    `${String(Math.floor(rnd(40,1500))).padStart(4)}B ${pick(["OK ","ERR","RTX"])}`,
  cryptoKey: () => `${hex(5)} ${hex(5)} ${hex(5)} ${hex(5)}`,
  procList: () => `${String(Math.floor(rnd(100,9999))).padStart(4)} ` +
    `${pick(["kickstart","exec.lib","dos.lib","narrator","copperd","blitd","trackdisk","guru"]).padEnd(10)}` +
    `${pick(["RUN","WAIT","SLP"])} ${String(Math.floor(rnd(0,99))).padStart(2)}%`,
  // ponytail: prototype's padEnd bound to the filename alone, so long paths
  // ran to 49 columns and clipped. Pad the whole path instead.
  fsWalk: () => (`SYS:${pick(["src","lib","node_modules",".git","dist","fonts"])}/` +
    pick(["main.js","effects.js","hud.js","style.css","config.json"])).padEnd(28).slice(0,28) +
    `${String(Math.floor(rnd(1,400))).padStart(4)}K`
};

/* ── microphone ───────────────────────────────────────────────── */

/* Real input for WAVEFORM and SPECTRUM. OFF unless `config.micEqualizer`
   is exactly `true` — a terminal emulator does not open the microphone on
   its own, ever. Every failure lands in the same place: getFreq()/getWave()
   return null and the panels keep drawing the fake maths they always drew.
   Failure means all of: the key absent or false, permission denied, no
   input device, no `navigator.mediaDevices` (opened as a plain file:// page
   in a browser without it), the AudioContext refusing to construct, or the
   analyser throwing later. There is deliberately NO retry — one refusal is
   the answer, not a reason to poke the device 60 times a second.

   Started lazily by the first paint that asks for data, and released
   MIC.IDLE_MS after the last one, so a rotated-out panel or a HUD switched
   off with F10 does not sit there holding the mic open. Same discipline as
   PACKET LOG: real when it is real, silently fake when it is not, and the
   header only says LIVE when bytes are genuinely arriving. */

const MIC = {
  FFT: 1024,        // 512 bins, ~43 Hz each at 44.1 kHz
  IDLE_MS: 5000,    // release the device this long after the last paint
  // Calibration knob. Real mics differ by 20 dB and no room is silent, so
  // samples under this read as silence and the trace goes flat instead of
  // jittering. Raise it if a quiet room still wobbles.
  WAVE_FLOOR: .02
};

export const micsource = (() => {
  let phase = "off";                 // off | starting | live | dead
  let actx = null, stream = null, analyser = null;
  let freq = null, wave = null;      // allocated once, refilled every frame
  let lastUse = 0, lastResume = 0, watchdog = 0;

  // No bridge (plain browser) or no key => stays off. Read defensively:
  // main.js may not whitelist micEqualizer at all, and that must read false.
  const enabled = () => {
    try { return window.amiga?.config?.micEqualizer === true; }
    catch (_) { return false; }
  };

  function release(){
    try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { actx?.close(); } catch (_) {}
    if (watchdog){ clearInterval(watchdog); watchdog = 0; }
    stream = actx = analyser = freq = wave = null;
  }

  function start(){
    phase = "starting";
    let p;
    try {
      // the processing chain is off: we want what the room sounds like,
      // not what a voice-call filter thinks the room should sound like
      p = navigator.mediaDevices.getUserMedia({audio:{
        echoCancellation:false, noiseSuppression:false, autoGainControl:false
      }});
    } catch (_) { phase = "dead"; return; }
    Promise.resolve(p).then(s => {
      stream = s;
      if (phase !== "starting"){ release(); return; }   // stopped mid-flight
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      analyser = actx.createAnalyser();
      analyser.fftSize = MIC.FFT;
      analyser.smoothingTimeConstant = .72;
      actx.createMediaStreamSource(s).connect(analyser);
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
      try { actx.resume?.().catch(() => {}); } catch (_) {}
      watchdog = setInterval(() => {
        if (Date.now() - lastUse > MIC.IDLE_MS) stop();
      }, 2000);
      phase = "live";
    }).catch(() => { phase = "dead"; release(); });     // denied, or no device
  }

  function stop(){
    if (phase === "off") return;
    release();
    if (phase !== "dead") phase = "off";               // dead stays dead
  }

  // true only when the analyser is actually running; also the lazy start
  // point and the liveness timestamp the watchdog reads.
  function ready(){
    lastUse = Date.now();
    if (phase === "live"){
      if (actx.state === "running") return true;
      // autoplay policy can park a fresh context; nudge it at most once a
      // second and report not-live until it really runs
      if (lastUse - lastResume > 1000){
        lastResume = lastUse;
        try { actx.resume().catch(() => {}); } catch (_) {}
      }
      return false;
    }
    if (phase === "off" && enabled()) start();
    return false;
  }

  // no closures, no arguments object, nothing allocated: this runs twice a
  // frame next to a live terminal
  function grab(wantFreq){
    if (!ready()) return null;
    const buf = wantFreq ? freq : wave;
    try {
      if (wantFreq) analyser.getByteFrequencyData(buf);
      else analyser.getByteTimeDomainData(buf);
      return buf;
    } catch (_) { phase = "dead"; release(); return null; }
  }

  return {
    getFreq(){ return grab(true); },
    getWave(){ return grab(false); },
    live(){ return phase === "live" && !!actx && actx.state === "running"; },
    stop
  };
})();

/* ── canvas instruments ────────────────────────────────────────────── */

const BLIPS = Array.from({length:7}, () => ({a: rnd(0,Math.PI*2), d: rnd(.25,.95)}));

/* Slow peak follower, so a quiet mic still fills the panel and a loud one
   does not clip off the top. One frame of lag (we gain this frame by last
   frame's peak) is invisible and saves buffering the samples. */
let scopePeak = .2;

export function paintScope(ctx,w,h,t,load,mic){
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = "rgba(255,182,39,.18)";
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  ctx.strokeStyle = "#FFB627";
  ctx.beginPath();

  const s = mic && mic.getWave();       // null unless a real stream is up
  if (s){
    const step = s.length / w, amp = h*.44, g = .92/scopePeak;
    let mx = 0;
    for (let x = 0; x < w; x++){
      const raw = (s[(x*step)|0] - 128)/128;
      const a = raw < 0 ? -raw : raw;
      if (a > mx) mx = a;
      let d = a < MIC.WAVE_FLOOR ? 0 : raw*g;    // silence => flat line
      if (d > 1.1) d = 1.1; else if (d < -1.1) d = -1.1;
      const y = h/2 - d*amp;
      x ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
    }
    // decay towards the current peak, never below a floor that would turn
    // the gain into a divide-by-nothing
    scopePeak = Math.max(mx, scopePeak*.97, .05);
  } else {
    for (let x = 0; x < w; x++){
      const p = x/w * Math.PI*6;
      const y = h/2 + Math.sin(p + t*3)*h*.24*load
        + Math.sin(p*2.7 - t*4.4)*h*.11*load + (Math.random()-.5)*h*.05*load;
      x ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
    }
  }
  ctx.stroke();
}

function paintRadar(ctx,w,h,t){
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 4;
  ctx.strokeStyle = "rgba(255,182,39,.28)";
  for (let i = 1; i <= 3; i++){ ctx.beginPath(); ctx.arc(cx,cy,r*i/3,0,Math.PI*2); ctx.stroke(); }
  ctx.beginPath();
  ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy); ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r);
  ctx.stroke();
  const a = t*1.7;
  const grad = ctx.createLinearGradient(cx,cy,cx+Math.cos(a)*r,cy+Math.sin(a)*r);
  grad.addColorStop(0,"rgba(255,182,39,.55)"); grad.addColorStop(1,"rgba(255,182,39,0)");
  ctx.strokeStyle = grad; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r); ctx.stroke();
  ctx.lineWidth = 1; ctx.fillStyle = "#FFE9B0";
  BLIPS.forEach(b => {
    const da = ((a - b.a) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
    const fade = Math.max(0, 1 - da/1.8);
    if (fade <= 0) return;
    ctx.globalAlpha = fade;
    ctx.fillRect(cx + Math.cos(b.a)*r*b.d - 2, cy + Math.sin(b.a)*r*b.d - 2, 4, 4);
  });
  ctx.globalAlpha = 1;
}

function paintGlobe(ctx,w,h,t){
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 5;
  ctx.strokeStyle = "rgba(255,182,39,.5)";
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle = "rgba(255,182,39,.26)";
  for (let i = 1; i <= 3; i++){
    const k = r*Math.cos(Math.asin(i/4));
    ctx.beginPath(); ctx.ellipse(cx, cy - r*i/4, k, k*.22, 0, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy + r*i/4, k, k*.22, 0, 0, Math.PI*2); ctx.stroke();
  }
  for (let i = 0; i < 5; i++){
    const ph = t*.7 + i*Math.PI/5;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(Math.cos(ph))*r, r, 0, 0, Math.PI*2); ctx.stroke();
  }
  ctx.fillStyle = "#FFE9B0";
  BLIPS.slice(0,4).forEach(b => {
    const ph = t*.7 + b.a;
    ctx.globalAlpha = Math.cos(ph) > 0 ? 1 : .2;
    ctx.fillRect(cx + Math.cos(ph)*r*b.d - 2, cy + Math.sin(b.a*3)*r*.55 - 2, 4, 4);
  });
  ctx.globalAlpha = 1;
}

/* ── panel registry ────────────────────────────────────────────────── */

/* Live headlines pushed from main (`claude -p`). Module-level so the panel
   can mount and unmount freely without losing the last fetch. */
/* Real /proc/net telemetry, pushed from main. Empty until the first sample
   (and forever on non-Linux), which is exactly when the panel falls back to
   the fake generator — so PACKET LOG is real where it can be and fiction
   where it cannot, never a fake claiming to be real. */
let netLines = [];

/* Real system telemetry pushed from main (sysprobe). Every field may be null
   and nothing is ever fabricated — a gauge with no real number behind it
   shows its simulated label instead of inventing a figure. */
let sys = null;
try {
  window.amiga?.onSys?.((payload) => { sys = payload || null; setSys(sys); });
} catch (e) { /* no bridge: gauges stay simulated */ }
try {
  window.amiga?.onNet?.((lines) => { if (Array.isArray(lines)) netLines = lines; });
} catch (e) { /* no bridge: stays empty, generator takes over */ }

let newsLines = ["", "  AWAITING UPLINK...", ""];
try {
  window.amiga?.onNews?.((lines) => {
    if (Array.isArray(lines) && lines.length) newsLines = lines;
  });
} catch (e) { /* no bridge (opened in a plain browser): panel just idles */ }

/* Geolocated headlines for the world map, same bridge, its own channel.
   Handed straight to worldmap.js, which owns the marker set — nothing in
   this file ever mixes them with the generated panel content. */
try {
  window.amiga?.onNewsMap?.((markers) => setNewsMarkers(markers));
} catch (e) { /* no bridge: the map panel is then just a world map */ }

/* ── sniffed Claude Code activity ─────────────────────────────────────
   What the sniffer saw, newest last, with a wall-clock stamp. This is the
   one log in the HUD that is not fiction: every line is a tool call that
   really came down the PTY. Module-level so the CLAUDE ACTIVITY panel can
   rotate out and back without losing the history. */
/* .panel-bd is 15px/1.18 => a ~17.7px line box. The old code divided by 18,
   which rounds the wrong way and renders one row more than fits. */
const LINE_PX = 17.7;

const ACTIVITY_CAP = 40;
const activity = [];
function logActivity(text){
  const d = new Date();
  activity.push(d.toTimeString().slice(0,8) + " " + text);
  while (activity.length > ACTIVITY_CAP) activity.shift();
}

/* Headlines come from outside the app, so they are escaped before they
   ever reach innerHTML. Everything else in this file is generated locally. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* Panels that threw while painting. Never mounted again this session. */
const BROKEN = new Set();

/* Panels the user pinned. A pinned panel survives every layout change, the
   ambient rotation and a manual shuffle — it is unmounted only by unpinning
   it or turning the HUD off. Capped so a wall of pins cannot squeeze the
   rotating panels out of the region entirely.

   The cap is PER REGION, not global: the bottom bar shows three panels at a
   time, so a global cap of 3 spent down there would freeze the whole bar
   while still leaving the side column free — and the reverse, three side
   pins, would lock the bottom bar out of pinning anything at all. Two of
   the bottom bar's three slots is the most that can be nailed down; the
   side column keeps the 3 it always had. */
const PINNED = new Set();
const MAX_PINNED = {side: 3, bottom: 2};

/* One key, one region. A spec marked `wide` belongs to the bottom bar and
   nothing else; everything else is side-column only. Keeping them exclusive
   is what stops a pin dragging a 290px-column panel into a 500px slot. */
const regionOf = key => (PANELS[key] && PANELS[key].wide) ? "bottom" : "side";
const pinsIn = region => {
  let n = 0;
  PINNED.forEach(k => { if (regionOf(k) === region) n++; });
  return n;
};

/* Gauge sources, in priority order. Each returns {label,value,text} when a
   genuinely real number exists, or null to fall back to the simulated bar.
   Nothing here invents a figure: sysprobe reports null when it cannot read a
   source, and that null propagates all the way out to the label, so a bar is
   never a fake number wearing a real-looking name. */
const SIM_LABEL = ["BLITTER", "COPPER", "UPLINK", "ENTROPY"];
const REAL_GAUGE = [
  (s) => s && s.cpu && s.cpu.agg != null
    ? { label: "CPU", value: s.cpu.agg, text: Math.round(s.cpu.agg) } : null,
  (s) => s && s.mem && s.mem.usedPct != null
    ? { label: "MEM", value: s.mem.usedPct, text: Math.round(s.mem.usedPct) } : null,
  (s) => s && s.gpu && s.gpu.util != null
    ? { label: "GPU", value: s.gpu.util, text: Math.round(s.gpu.util) }
    : (s && s.tempC != null
       ? { label: "TEMP", value: Math.min(100, s.tempC), text: s.tempC + "C" } : null),
  (s) => s && s.fs && s.fs.root && s.fs.root.usedPct != null
    ? { label: "DISK", value: s.fs.root.usedPct, text: Math.round(s.fs.root.usedPct) } : null
];

const PANELS = {
  news: {title:"WIRE / UKRAINE", kind:"news", rate:15000},
  nettrace:   {title:"PACKET LOG",  kind:"net",    gen:"portScan",    rate:900},
  sectordump: {title:"SECTOR DUMP", kind:"lines",  gen:"hexDump",     rate:70},
  neurallink: {title:"NEURAL LINK", kind:"lines",  gen:"cryptoKey",   rate:90},
  daemons:    {title:"DAEMONS",     kind:"lines",  gen:"procList",    rate:220},
  packets:    {title:"PACKET LOG",  kind:"lines",  gen:"packetTrace", rate:130},
  fswalk:     {title:"FILE TABLE",  kind:"lines",  gen:"fsWalk",      rate:150},
  scope:      {title:"WAVEFORM",    kind:"canvas", paint:paintScope,  grow:0, h:92, mic:1},
  radar:      {title:"PROXIMITY",   kind:"canvas", paint:paintRadar,  grow:0, h:128},
  globe:      {title:"ORBIT TRACK", kind:"canvas", paint:paintGlobe,  grow:0, h:128},
  subsystems: {title:"SUBSYSTEMS",  kind:"gauges", grow:0},
  diskio:     {title:"DF0: TRACK",  kind:"disk",   grow:0}
};

const LAYOUTS = {
  idle:  [["news","subsystems"], ["nettrace","subsystems"], ["packets","scope","subsystems"], ["nettrace","radar"]],
  think: [["neurallink","scope","subsystems"], ["neurallink","globe"]],
  read:  [["sectordump","diskio"], ["sectordump","fswalk","subsystems"]],
  edit:  [["sectordump","subsystems","scope"], ["fswalk","diskio"]],
  bash:  [["nettrace","daemons"], ["daemons","subsystems","scope"]],
  net:   [["news","globe"], ["globe","packets"], ["packets","radar","subsystems"]],
  task:  [["daemons","subsystems"], ["daemons","radar"]]
};

/* Agent F's extra generators, panels and layout rotations. Merged at module
   scope so they are in place before the first panel mounts. */
Object.assign(GENERATORS, EXTRA_GENERATORS);
Object.assign(PANELS, EXTRA_PANELS);
Object.assign(PANELS, CLOCK_PANELS);
Object.assign(PANELS, SYS_PANELS);
for (const k in EXTRA_LAYOUTS)
  if (LAYOUTS[k]) LAYOUTS[k] = LAYOUTS[k].concat(EXTRA_LAYOUTS[k]);
for (const k in CLOCK_LAYOUTS)
  if (LAYOUTS[k]) LAYOUTS[k] = LAYOUTS[k].concat(CLOCK_LAYOUTS[k]);
for (const k in SYS_LAYOUTS)
  if (LAYOUTS[k]) LAYOUTS[k] = LAYOUTS[k].concat(SYS_LAYOUTS[k]);


/* The bottom bar's own panel set and its rotation table, merged the same way
   as every other panels-*.js. The `wide` flag on each spec is what binds them
   to the bottom region — see regionOf(). */
Object.assign(PANELS, WIDE_PANELS);

/* ── operation strip ──────────────────────────────────────────────────
   It used to ramp 0->100 forever and mean absolutely nothing, which is
   exactly the kind of invented motion the rest of this file goes out of its
   way to avoid. It now reads a real number off sysprobe and rotates slowly
   through whichever ones exist, and nothing else ever writes to it. No
   telemetry means no motion at all — parked at zero, labelled STANDBY. */
export const OP_METRICS = [
  (s) => s && s.cpu && s.cpu.agg != null ? {label:"CPU LOAD", pct:s.cpu.agg} : null,
  (s) => s && s.mem && s.mem.usedPct != null ? {label:"MEMORY", pct:s.mem.usedPct} : null,
  (s) => s && s.fs && s.fs.root && s.fs.root.usedPct != null
    ? {label:"DISK " + (s.fs.root.path || "/"), pct:s.fs.root.usedPct} : null,
  (s) => s && s.gpu && s.gpu.util != null ? {label:"GPU", pct:s.gpu.util} : null
];
const OP_SWAP_MS = 8000;      // slow enough to read, fast enough to be alive

/* ── requesters ────────────────────────────────────────────────────── */

const REQUESTERS = [
  {t:"System Request", l:["Please insert volume","Workbench1.3: in any drive"], b:["Retry","Cancel"]},
  {t:"DF0:",           l:["Disk is unreadable","Track 42 checksum error"],      b:["Retry","Cancel"]},
  {t:"exec.library",   l:["Not enough memory to","complete operation"],         b:["Continue"]},
  {t:"UPLINK",         l:["Remote key exchange","%HEX%"],                       b:["Accept","Deny"]},
  {t:"trackdisk.device", l:["Write protected volume","SYS: is read only"],      b:["Retry","Cancel"]}
];
const ALERTS = [
  {t:"INTRUSION",   l:["Unauthorized trace detected","Source: 10.0.4.77"],       b:["Trace","Ignore"], alert:1},
  {t:"NORAD",       l:["Launch detected. This is","not a drill."],               b:["Acknowledge"],    alert:1},
  {t:"FATAL",       l:["/world is being deleted","This cannot be undone"],       b:["Undo","Proceed"], alert:1},
  {t:"COUNTERMEASURE", l:["Trace originated at","your own address"],             b:["Abort"],          alert:1}
];

/* ── Claude activity sniffer ───────────────────────────────────────── */

/* Escape sequences Claude Code sprays everywhere: CSI, OSC, two-char ESC
   sequences, and stray control bytes. Stripped before matching, because a
   marker wrapped in colour codes is the normal case, not the exception. */
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

const SNIFF_RULES = [
  ["\\b(?:Read|Glob|Grep)\\(",                              "read"],
  ["\\b(?:Edit|Write|MultiEdit|NotebookEdit)\\(",           "edit"],
  ["\\bBash\\(",                                            "bash"],
  ["\\b(?:WebFetch|WebSearch)\\(",                          "net"],
  ["\\bTask\\(",                                            "task"],
  ["(?:\\besc to interrupt|[✻✽✳✢✶∗*]\\s*\\w+…)",            "think"]
];
const SNIFF_RX = new RegExp(SNIFF_RULES.map(r => "(" + r[0] + ")").join("|"), "g");
const TAIL_CAP = 4096;

/* createSniffer(onScenario) -> feed(chunk)
   onScenario(key, marker, call) — `key` is the scenario, `marker` the text
   that matched, `call` that marker plus whatever of the line has arrived so
   far, so the CLAUDE ACTIVITY panel can show `Bash(npm test)` and not just
   `Bash(`. A chunk boundary mid-argument means `call` is short; that is a
   cosmetic truncation in a log, never a missed match.

   PTY chunks split at arbitrary byte boundaries, so `⏺ Bash(` routinely
   arrives as two chunks. We keep a rolling tail of the stripped stream and
   a cursor marking how far we have already matched, so a marker fires its
   scenario exactly once no matter how it was chopped up.

   DEGRADE PATH (intended, not a bug): Claude Code's output format is not a
   stable API. If nothing matches we do nothing at all and the HUD keeps
   running its ambient rotation. A missed match costs theater, never the
   terminal — so there is deliberately no fallback heuristic here.

   Returned as a callable; `.feed` is an alias so either calling style works. */
export function createSniffer(onScenario){
  let buf = "", cursor = 0;

  function feed(chunk){
    if (typeof chunk !== "string" || !chunk) return;
    buf += chunk.replace(ANSI, "");
    SNIFF_RX.lastIndex = cursor;
    let m;
    while ((m = SNIFF_RX.exec(buf)) !== null){
      cursor = m.index + m[0].length;
      SNIFF_RX.lastIndex = cursor;
      for (let i = 1; i < m.length; i++){
        if (m[i] !== undefined){
          const call = buf.slice(m.index, m.index + 72).split("\n")[0];
          onScenario(SNIFF_RULES[i-1][1], m[0], call);
          break;
        }
      }
    }
    if (buf.length > TAIL_CAP){
      const drop = buf.length - TAIL_CAP;
      buf = buf.slice(drop);
      cursor = Math.max(0, cursor - drop);
    }
  }

  feed.feed = feed;
  feed.reset = () => { buf = ""; cursor = 0; };
  return feed;
}

/* ── the HUD itself ────────────────────────────────────────────────── */

export function initHud({ hudEl, barEl, config, effects }){
  const fx = effects || {glitch(){}, guru(){}};
  let cfg = normCfg(config);
  let running = false, raf = 0, t0 = performance.now(), clock = 0;
  let typingBoost = 0, lastType = 0;
  let scenarioKey = "idle", load = .35, opPct = 0, lastSniff = 0;
  const timers = [];
  const openReqs = new Set();

  /* ── regions ────────────────────────────────────────────────────────
     Panels live in two places: the side column and the bottom bar. Same
     registry, same builder, same rotation, same pin gadget, same shuffle —
     only the host element, the layout table and the hold timer differ, so
     everything below takes a region object instead of reaching for hudEl
     directly. Nothing else can own either region, which is what makes F8
     unconditional.

     The bar element IS the bottom region — there is no deck wrapper any
     more, because there is no longer a second thing sharing the bar. */
  const REGIONS = {
    side:   {name:"side",   el:hudEl, layouts:LAYOUTS,        mounted:new Map(), lastLayout:0},
    bottom: {name:"bottom", el:barEl, layouts:BOTTOM_LAYOUTS, mounted:new Map(), lastLayout:0}
  };
  const eachRegion = (fn) => { fn(REGIONS.side); fn(REGIONS.bottom); };

  // the operation strip is index.html's, not ours — write it if it exists,
  // shrug if it does not. The window title belongs to renderer.js (real cwd),
  // so the HUD deliberately never touches it.
  const op = {label:$("opLabel"), fill:$("opFill"), hex:$("opHex")};
  const desktop = $("desktop") || document.body;

  function normCfg(c){
    const e = (c && c.effects) || c || {};
    const n = (k,d) => { const v = Number(e[k]); return isFinite(v) ? Math.max(0, Math.min(100, v)) : d; };
    return {glitchRate: n("glitchRate", 8)};
  }

  /* ── panels ── */

  function buildPanel(key){
    const spec = PANELS[key];
    const el = document.createElement("div");
    el.className = "panel";
    el.dataset.panel = key;            // which panel this is, for the eye and for tests
    if (spec.grow === 0) el.dataset.grow = "0";
    if (spec.h) el.style.flexBasis = spec.h + "px";

    const hd = document.createElement("div");
    hd.className = "panel-hd";
    hd.innerHTML = `<span>${spec.title}</span>` +
      `<span class="pin" role="button" tabindex="0" title="Pin this panel">` +
      `${PINNED.has(key) ? "\u25C6" : "\u25C7"}</span>`;
    const pinEl = hd.querySelector(".pin");
    const region = regionOf(key);
    const togglePin = () => {
      if (PINNED.has(key)) PINNED.delete(key);
      else if (pinsIn(region) < MAX_PINNED[region]) PINNED.add(key);
      else return;                       // at this region's cap: unpin first
      pinEl.textContent = PINNED.has(key) ? "\u25C6" : "\u25C7";
      el.classList.toggle("pinned", PINNED.has(key));
      pinEl.title = PINNED.has(key) ? "Unpin this panel" : "Pin this panel";
    };
    pinEl.addEventListener("click", togglePin);
    pinEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); togglePin(); }
    });
    if (PINNED.has(key)) el.classList.add("pinned");
    const bd = document.createElement("div");
    bd.className = "panel-bd";
    el.append(hd, bd);

    const p = {key, el, body:bd, spec, lines:[]};

    if (spec.kind === "canvas"){
      bd.classList.add("pad0");
      const cv = document.createElement("canvas");
      // a fresh canvas defaults to 300x150; CSS then stretches that bitmap
      // into whatever box the panel really has, which is the distortion.
      // Zero means "not measured yet" and paintPanel's guard skips it.
      cv.width = 0; cv.height = 0;
      bd.appendChild(cv);
      p.canvas = cv; p.ctx = cv.getContext("2d");
      // panels with a live header — the mic state, the map's now-showing
      // story — own the title span so paintPanel can rewrite it in place
      if (spec.mic || spec.head) p.hdText = hd.firstChild;
      if (spec.mic) p.titleLive = spec.title + "  MIC LIVE";
    }
    if (spec.kind === "gauges"){
      // labels are rewritten per-tick to match whichever source is real
      bd.innerHTML = [0,1,2,3].map((i) =>
        `<div class="gauge"><span class="lbl" data-l="${i}">----</span><span class="bar">
         <span class="fill" data-g="${i}"></span></span><span class="val" data-v="${i}">0</span></div>`).join("");
      p.gauge = [30,45,20,12];
    }
    if (spec.kind === "disk"){ p.head = 0; p.heat = new Array(80).fill(0); }
    if (spec.kind === "net"){
    const paint = () => {
      const cap = Math.max(3, Math.floor(bd.clientHeight / 18));
      let rows, live;
      if (netLines.length){
        rows = netLines.slice(0, cap); live = true;
      } else {
        // no /proc/net (macOS, or disabled): keep the panel alive with fiction
        p.lines.push(GENERATORS[spec.gen]());
        while (p.lines.length > cap) p.lines.shift();
        rows = p.lines; live = false;
      }
      hd.firstChild.textContent = live ? "PACKET LOG  LIVE" : "PACKET LOG";
      bd.innerHTML = rows.map((l, i) =>
        i === rows.length - 1 ? `<span class="hot">${esc(l)}</span>` : esc(l)).join("\n");
    };
    paint();
    p.timer = setInterval(paint, spec.rate);
  }

  if (spec.kind === "news"){
    const paint = () => {
      const cap = Math.max(2, Math.floor(bd.clientHeight / 18));
      bd.innerHTML = newsLines.slice(0, cap)
        .map((l, i) => i === 0 ? `<span class="hot">${esc(l)}</span>` : esc(l))
        .join("\n");
    };
    paint();
    p.timer = setInterval(paint, spec.rate);
  }

  /* The one honest log in the HUD: sniffed Claude Code tool calls, newest
     at the bottom, wall-clock stamped. Nothing is generated here — an empty
     history says so rather than inventing traffic to fill the panel. */
  if (spec.kind === "activity"){
    /* Newest FIRST. The rows are clipped by `overflow:hidden`, and the row
       count can only ever be an estimate of how many fit — so whichever end
       is at the bottom is the end that gets cut. For a log of what just
       happened, the newest line is the one that must never be the casualty,
       so it sits at the top and older entries fall off the bottom.
       The row estimate is also deliberately conservative (a spare row) for
       the same reason: overshooting hides a line, undershooting shows one
       fewer. */
    const paint = () => {
      const cap = Math.max(3, Math.floor(bd.clientHeight / LINE_PX) - 1);
      if (!activity.length){
        bd.innerHTML = `<span class="fade">  AWAITING CLAUDE CODE...</span>`;
        return;
      }
      const rows = activity.slice(-cap).reverse();
      bd.innerHTML = rows.map((l, i) =>
        i === 0 ? `<span class="hot">${esc(l)}</span>` : esc(l)).join("\n");
    };
    paint();
    p.timer = setInterval(paint, spec.rate || 1000);
  }

  if (spec.kind === "lines"){
      for (let i = 0; i < 5; i++) p.lines.push(GENERATORS[spec.gen]());
      p.timer = setInterval(() => {
        p.lines.push(GENERATORS[spec.gen]());
        const cap = Math.max(3, Math.floor(bd.clientHeight / 18));
        while (p.lines.length > cap) p.lines.shift();
        bd.innerHTML = p.lines.map((l,i) =>
          i === p.lines.length-1 ? `<span class="hot">${l}</span>`
          : (i < 2 ? `<span class="fade">${l}</span>` : l)).join("\n");
      }, spec.rate);
    }
    return p;
  }

  function sizeCanvas(p){
    if (!p.canvas) return;
    const r = p.body.getBoundingClientRect();
    const w = Math.floor(r.width), h = Math.floor(r.height);
    // 0x0 happens legitimately mid-transition. Sizing to a placeholder there
    // is what leaves a bitmap of the wrong aspect ratio to be stretched into
    // the real box — so leave it and wait for the observer to say otherwise.
    if (w < 8 || h < 8) return;
    // assigning width/height clears the canvas, so only do it on a real change
    if (p.canvas.width !== w) p.canvas.width = w;
    if (p.canvas.height !== h) p.canvas.height = h;
  }

  /* One rAF-coalesced sizing pass for both regions — the same discipline
     renderer.js's refit() uses, and for the same reason. Measuring a canvas
     in the same tick it was appended reads the pre-layout box: flex has not
     run yet, so every bottom-deck canvas came up the wrong size and stayed
     that way until a window resize forced a re-measure. One frame later the
     layout is settled and getBoundingClientRect is telling the truth.

     A ResizeObserver per region covers everything that changes the boxes
     without a window resize: the bar opening, F10, and F7 hiding the gadget
     bar and handing the bar more height. No per-panel timers. */
  let sizeRaf = 0;
  function sizeAll(){
    if (sizeRaf) return;
    sizeRaf = requestAnimationFrame(() => {
      sizeRaf = 0;
      eachRegion(rg => rg.mounted.forEach(sizeCanvas));
    });
  }
  /* Observing only the REGION is not enough. A region's own box does not
     change when panels swap inside it, so a panel whose canvas was measured
     before flex laid it out (`sizeCanvas` bails under 8px) never got a second
     chance — it stayed 0x0, `frame()` skipped it on the width guard, and it
     sat there as a black rectangle until the window was resized. That is the
     "some panels go black after F8" bug. Observing each panel body means the
     panel itself reports the moment it has a real box. */
  const sizeObserver = new ResizeObserver((entries) => {
    for (const e of entries){
      const p = bodyOwner.get(e.target);
      if (p) sizeCanvas(p);
    }
    sizeAll();
  });
  const bodyOwner = new WeakMap();

  function watchBody(p){
    if (!p.canvas) return;
    bodyOwner.set(p.body, p);
    try { sizeObserver.observe(p.body); } catch (e) {}
  }
  function unwatchBody(p){
    if (!p.canvas) return;
    try { sizeObserver.unobserve(p.body); } catch (e) {}
  }

  /* Animated removal. Also the only place a panel timer is cleared, so a
     panel can never leave the DOM with its interval still running. */
  function unmount(rg, key){
    const p = rg.mounted.get(key);
    if (!p) return;
    unwatchBody(p);
    clearInterval(p.timer);
    rg.mounted.delete(key);
    p.el.classList.add("closing");
    setTimeout(() => p.el.remove(), 160);
  }

  /* Immediate, unanimated, and it ignores pins — F10 off means gone. */
  function teardown(rg){
    for (const k of [...rg.mounted.keys()]){
      clearInterval(rg.mounted.get(k).timer);
      rg.mounted.get(k).el.remove();
      rg.mounted.delete(k);
    }
  }

  function setLayout(rg, keys){
    // This region's pinned panels are always part of its layout, and lead it
    // so their position does not jump around as the rotating panels change.
    // A layout table typo, a retired panel or a key belonging to the other
    // region is dropped here rather than throwing on mount.
    keys = [...new Set([...PINNED, ...keys])]
      .filter(k => PANELS[k] && !BROKEN.has(k) && regionOf(k) === rg.name);
    for (const k of [...rg.mounted.keys()]) if (!keys.includes(k)) unmount(rg, k);
    keys.forEach(k => {
      if (!rg.mounted.has(k)){
        const p = buildPanel(k);
        rg.mounted.set(k, p);
        rg.el.appendChild(p.el);
        watchBody(p);          // the panel itself reports when it has a box
      }
    });
    keys.forEach(k => rg.el.appendChild(rg.mounted.get(k).el));
    sizeAll();          // next frame, once flex has actually laid the slots out
  }

  /* Minimum time a set of panels stays on screen, no matter what the stream
     is doing. Claude Code emits tool calls every few seconds, and each one
     changes the scenario — gating only on "same scenario" left every
     Read->Edit->Bash sequence swapping the whole column, which reads as a
     slideshow. The scenario (and the op strip, and load) still tracks the
     stream immediately; only the PANELS are held. */
  const LAYOUT_HOLD_MS = 45000;

  /* Re-pick one region's layout, gated by that region's own hold timer.
     `force` is the explicit shuffle, which must never be swallowed by the
     hold. Returns true if the layout actually changed.

     There is deliberately no other veto here. The bottom region used to
     decline while the mission runner owned the bar, which is why F8 shuffled
     the column and left the bar alone — the reported bug. Both regions are
     now plain panel regions and both always answer. */
  /* Layout choice is a uniform sample over the panels themselves, not a pick
     from a curated list of combinations.

     The curated tables had a structural flaw: a panel's chance of appearing
     depended on how many hand-written layouts happened to mention it, and a
     panel absent from the dominant scenario's list could never appear at all.
     `spectrum` was in no `idle` layout, and a plain shell sits in `idle`
     almost permanently — so it was unreachable in practice, while `scope` sat
     at roughly 1 chance in 12. Sampling the panel pool directly gives every
     panel in a region the same odds, every time.

     Scenario still matters, but as a nudge rather than a gate: the panels a
     scenario's old layouts favoured are simply added to the pool a second
     time, so they come up more often without ever locking anything out. */
  function poolFor(rg){
    const pool = [];
    for (const key of Object.keys(PANELS)){
      if (BROKEN.has(key)) continue;
      if (regionOf(key) !== rg.name) continue;
      if (PINNED.has(key)) continue;          // already guaranteed a slot
      pool.push(key);
    }
    // scenario bias: one extra ticket for panels the scenario used to prefer
    for (const combo of (rg.layouts[scenarioKey] || [])){
      for (const key of combo){
        if (PANELS[key] && regionOf(key) === rg.name && !PINNED.has(key)
            && !BROKEN.has(key)) pool.push(key);
      }
    }
    return pool;
  }

  function sampleLayout(rg){
    const pool = poolFor(rg);
    const want = rg.name === "bottom" ? 3 : 2 + (Math.random() < .5 ? 1 : 0);
    const slots = Math.max(1, want - pinsIn(rg.name));
    const out = [];
    // sample without replacement so a layout never shows the same panel twice
    const bag = pool.slice();
    while (out.length < slots && bag.length){
      const i = Math.floor(Math.random() * bag.length);
      const key = bag[i];
      bag.splice(i, 1);
      if (!out.includes(key)) out.push(key);
    }
    return out;
  }

  function relayout(rg, now, force){
    if (!force && now - rg.lastLayout < LAYOUT_HOLD_MS && rg.mounted.size) return false;
    rg.lastLayout = now;
    setLayout(rg, sampleLayout(rg));
    return true;
  }

  function setScenario(key){
    const next = key in LAYOUTS ? key : "idle";
    const now = Date.now();
    scenarioKey = next;
    load = scenarioKey === "idle" ? .35 : 1;

    // hold the panels even across a scenario change — both regions, each on
    // its own timer, so the column and the bar do not turn over in lockstep
    let changed = false;
    eachRegion(rg => { if (relayout(rg, now)) changed = true; });
    // rare on purpose, and behind the shared cooldown in spawnRequester
    if (changed && scenarioKey !== "idle" && Math.random() < .06)
      setTimeout(spawnRequester, rnd(300,1400));
  }

  /* ── requesters ──────────────────────────────────────────────────────
     Two unrelated sources fire these — an ambient timer and the occasional
     non-idle scenario change — and neither knows about the other, so they
     used to stack into bursts. One shared leash: a popup needs
     REQ_COOLDOWN_MS of quiet behind it, whatever produced the last one. */
  const REQ_COOLDOWN_MS = 90000;
  let lastReq = 0;

  function spawnRequester(){
    if (!running || openReqs.size >= 2) return;
    const now = Date.now();
    if (now - lastReq < REQ_COOLDOWN_MS) return;
    lastReq = now;
    const r = Math.random() < .3 ? pick(ALERTS) : pick(REQUESTERS);
    const el = document.createElement("div");
    el.className = "requester" + (r.alert ? " alert" : "");
    el.innerHTML =
      `<div class="req-hd"><span>${r.t}</span><span>${hex(4)}</span></div>` +
      `<div class="req-bd">${r.l.map(x => x.replace("%HEX%", hex(8)+" "+hex(8))).join("<br>")}</div>` +
      `<div class="req-ft">${r.b.map(b => `<button class="btn">${b.toUpperCase()}</button>`).join("")}</div>`;
    const box = desktop.getBoundingClientRect();
    el.style.left = rnd(30, Math.max(40, box.width - 300)).toFixed(0)+"px";
    el.style.top  = rnd(40, Math.max(60, box.height - 210)).toFixed(0)+"px";
    desktop.appendChild(el);
    openReqs.add(el);
    const close = () => {
      if (!openReqs.delete(el)) return;
      el.classList.add("closing");
      setTimeout(() => el.remove(), 150);
    };
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", close));
    setTimeout(close, rnd(3800, 7000));
  }

  /* ── sniffer wiring ──────────────────────────────────────────────────
     A tool call does two things and no more: it picks the scenario whose
     layout group is in rotation, and it goes in the activity log. */

  const sniff = createSniffer((key, marker, call) => {
    lastSniff = Date.now();
    logActivity(call || marker);
    setScenario(key);
  });

  /* ── loops ── */

  /* One painter must never be able to kill the render loop. A panel that
     throws is unmounted, unpinned and never mounted again this session — in
     either region — rather than taking the whole HUD, and the terminal, down
     with it. This is not hypothetical: a painter referencing an undefined
     constant threw on its first frame and froze the entire HUD until it was
     found. */
  function paintPanel(rg, p){
    if (p.spec.kind !== "canvas" || !p.canvas.width) return;
    try {
      p.spec.paint(p.ctx, p.canvas.width, p.canvas.height, clock, load, micsource);
    } catch (e) {
      console.warn("[amigaterm] panel", p.key, "threw; retiring it:", e);
      BROKEN.add(p.key);
      PINNED.delete(p.key);          // a retired panel must not be pinned back in
      try { unmount(rg, p.key); } catch (_) {}
      return;
    }
    if (p.hdText){
      // the map's now-showing story, or MIC LIVE only while bytes are
      // genuinely arriving. Written only when it actually changes — this runs
      // once a frame and the terminal next door does not need the reflow.
      let s;
      try { s = p.spec.head ? p.spec.head(clock) : (micsource.live() ? p.titleLive : p.spec.title); }
      catch (_) { s = p.spec.title; }
      if (p.hdText.textContent !== s) p.hdText.textContent = s;
    }
  }

  function frame(now){
    clock = (now - t0)/1000;
    eachRegion(rg => rg.mounted.forEach(p => paintPanel(rg, p)));
    raf = requestAnimationFrame(frame);
  }

  /* ── operation strip ── */

  let opIdx = 0, lastOpSwap = 0;

  function opTick(){
    const avail = [];
    for (const f of OP_METRICS){ const m = f(sys); if (m) avail.push(m); }
    if (!avail.length){
      // no readable telemetry: park it. The old fallback here was a bar
      // ramping for no reason, which is worse than an empty one.
      opPct = 0;
      if (op.label) op.label.textContent = "STANDBY";
    } else {
      const now = Date.now();
      if (now - lastOpSwap > OP_SWAP_MS){ lastOpSwap = now; opIdx++; }
      const m = avail[opIdx % avail.length];
      opPct = Math.max(0, Math.min(100, m.pct));
      if (op.label) op.label.textContent = m.label;
    }
    if (op.fill) op.fill.style.width = opPct.toFixed(0)+"%";
    // was random hex every 180ms; now it is the number the bar is showing,
    // and blank when there is no number to show
    if (op.hex) op.hex.textContent = opPct > 0 ? Math.round(opPct)+"%" : "";
  }

  const every = (ms, fn) => timers.push(setInterval(fn, ms));

  function start(){
    if (running) return;
    running = true;
    hudEl.hidden = false;
    // the bar is permanent furniture: it holds the bottom panel region, so it
    // opens with the HUD and closes with it
    barEl.dataset.open = "1";
    t0 = performance.now();
    eachRegion(rg => { rg.lastLayout = 0; });
    setScenario("idle");
    eachRegion(rg => sizeObserver.observe(rg.el));
    sizeAll();
    raf = requestAnimationFrame(frame);

    every(180, opTick);                                  // operation strip

    every(130, () => {
      if (typingBoost > 0) typingBoost = Date.now() - lastType > 400
        ? Math.max(0, typingBoost - .08) : typingBoost;                                   // gauges + DF0 head
      eachRegion(rg => rg.mounted.forEach(p => {
        if (p.spec.kind === "gauges"){
          p.gauge.forEach((v,i) => {
            // Real reading if sysprobe has one, otherwise the simulated bar.
        // The label says which — a fake number under a real-looking label
        // is exactly what this whole exercise is meant to remove.
        const real = REAL_GAUGE[i] && REAL_GAUGE[i](sys);
        if (real){
          p.body.querySelector(`[data-l="${i}"]`).textContent = real.label;
          const v = Math.max(0, Math.min(100, real.value));
          p.gauge[i] = p.gauge[i] + (v - p.gauge[i]) * .35;
          p.body.querySelector(`[data-g="${i}"]`).style.width = p.gauge[i].toFixed(0)+"%";
          p.body.querySelector(`[data-v="${i}"]`).textContent = real.text;
          return;
        }
        p.body.querySelector(`[data-l="${i}"]`).textContent = SIM_LABEL[i];
        const t = load > .5 ? rnd(45,98) : rnd(8,42);
        const target = Math.min(99, t + typingBoost * 45);
            p.gauge[i] = v + (target - v)*.22;
            p.body.querySelector(`[data-g="${i}"]`).style.width = p.gauge[i].toFixed(0)+"%";
            p.body.querySelector(`[data-v="${i}"]`).textContent = Math.round(p.gauge[i]);
          });
        }
        if (p.spec.kind === "disk"){
          p.head = (p.head + Math.floor(rnd(1,6))) % 80;
          p.heat[p.head] = 1;
          p.heat = p.heat.map(v => v*.93);
          const ch = v => v > .75 ? "█" : v > .45 ? "▓" : v > .2 ? "▒" : v > .06 ? "░" : "·";
          let out = "";
          for (let r = 0; r < 8; r++) out += p.heat.slice(r*10,(r+1)*10).map(ch).join(" ") + "\n";
          p.body.innerHTML = out + `<span class="hot">HEAD ${String(p.head).padStart(2,"0")}  ${hex(4)}</span>`;
        }
      }));
    });

    /* Ambient rotation. Deliberately slow and probabilistic: a panel should
       feel like equipment someone left running, not a slideshow. Checking
       every 26s at 30% odds puts the mean dwell near 90s, and the geometric
       distribution means some layouts stick around for many minutes — which
       is the point. Do not speed this up to make it look busier.

       Both regions roll their own dice against their own hold timer, so the
       column and the bar drift apart instead of turning over together. */
    every(30000, () => {
      const now = Date.now();
      if (scenarioKey !== "idle" && now - lastSniff > 45000){
        scenarioKey = "idle"; load = .35;
      }
      eachRegion(rg => { if (Math.random() < .30) relayout(rg, now); });
    });

    /* Ambient requesters. p=0.12 every 30s puts the mean near four minutes,
       and the cooldown in spawnRequester keeps that from clustering. Kept
       probabilistic rather than scheduled: a fault that arrives on the dot
       reads as a cron job, not a fault. Tuned for the one fixed effects
       level — there is no intensity slider to scale off any more. */
    every(30000, () => { if (Math.random() < .12) spawnRequester(); });
    every(20000, () => { if (Math.random() < cfg.glitchRate/100*.12) fx.guru(); });
  }

  function stop(){
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf); raf = 0;
    if (sizeRaf){ cancelAnimationFrame(sizeRaf); sizeRaf = 0; }
    timers.splice(0).forEach(clearInterval);
    sizeObserver.disconnect();
    micsource.stop();          // F10 off must not leave the mic open
    eachRegion(teardown);      // both regions, pins included: no orphan intervals
    openReqs.forEach(el => el.remove());
    openReqs.clear();
    hudEl.hidden = true;
    barEl.dataset.open = "0";
    if (op.label) op.label.textContent = "STANDBY";
    if (op.fill) op.fill.style.width = "0%";
    if (op.hex) op.hex.textContent = "";
  }

  if (!config || config.hud !== false) start();
  else hudEl.hidden = true;

  return {
    /* read-only tap on the PTY stream — after xterm.write, never before.
       A HUD bug must not take down someone's shell, hence the blanket catch. */
    feed(chunk){
      if (!running) return;
      try { sniff(chunk); } catch (_) { /* theater only; never rethrow */ }
    },
    /* Keystrokes drive the gauges: typing spikes ENTROPY and the subsystem
       bars, and they settle when you stop. Purely a decay on an existing
       value — no timer of its own. */
    typed(){
      if (!running) return;
      typingBoost = Math.min(1, typingBoost + .34);
      lastType = Date.now();
    },
    setEnabled(on){ on ? start() : stop(); },
    setConfig(c){ cfg = normCfg(c); },
    /* Manual shuffle (F8). Re-picks BOTH regions' layouts and resets both
       hold timers, so an explicit shuffle is never swallowed by the 45s
       minimum that stops automatic switching looking like a slideshow, and
       neither region can decline. Pinned panels stay where they are — that
       is what the pin is for. */
    shuffle(){
      if (!running) return;
      const now = Date.now();
      eachRegion(rg => relayout(rg, now, true));
    }
  };
}
