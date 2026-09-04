/* hud.js — the theater column: fake-op panels, line generators, canvas
   instruments, Workbench requesters, and the Claude activity sniffer.
   Ported from prototype.html; missions and the world map live next door.

   Everything here is decoration. The PTY stream is never touched: feed()
   is a read-only tap wrapped in try/catch, and setEnabled(false) tears
   down every interval and rAF so an idle HUD costs nothing. */

import { initMissions, MISSION_KEYS } from "./missions.js";
import { setNewsMarkers, setNewsMode, newsMarkerCount, currentNewsMarker } from "./worldmap.js";
import { EXTRA_GENERATORS } from "./missions-extra.js";
import { EXTRA_PANELS, EXTRA_LAYOUTS } from "./panels-extra.js";

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

/* ── canvas instruments ────────────────────────────────────────────── */

const BLIPS = Array.from({length:7}, () => ({a: rnd(0,Math.PI*2), d: rnd(.25,.95)}));

function paintScope(ctx,w,h,t,load){
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = "rgba(255,182,39,.18)";
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  ctx.strokeStyle = "#FFB627";
  ctx.beginPath();
  for (let x = 0; x < w; x++){
    const p = x/w * Math.PI*6;
    const y = h/2 + Math.sin(p + t*3)*h*.24*load
      + Math.sin(p*2.7 - t*4.4)*h*.11*load + (Math.random()-.5)*h*.05*load;
    x ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
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
} catch (e) { /* no bridge: the map simply never enters NEWS WATCH */ }

/* Headlines come from outside the app, so they are escaped before they
   ever reach innerHTML. Everything else in this file is generated locally. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const PANELS = {
  news: {title:"WIRE / UKRAINE", kind:"news", rate:15000},
  nettrace:   {title:"NETTRACE",    kind:"lines",  gen:"portScan",    rate:110},
  sectordump: {title:"SECTOR DUMP", kind:"lines",  gen:"hexDump",     rate:70},
  neurallink: {title:"NEURAL LINK", kind:"lines",  gen:"cryptoKey",   rate:90},
  daemons:    {title:"DAEMONS",     kind:"lines",  gen:"procList",    rate:220},
  packets:    {title:"PACKET LOG",  kind:"lines",  gen:"packetTrace", rate:130},
  fswalk:     {title:"FILE TABLE",  kind:"lines",  gen:"fsWalk",      rate:150},
  scope:      {title:"WAVEFORM",    kind:"canvas", paint:paintScope,  grow:0, h:92},
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
for (const k in EXTRA_LAYOUTS)
  if (LAYOUTS[k]) LAYOUTS[k] = LAYOUTS[k].concat(EXTRA_LAYOUTS[k]);


const OPNAME = {
  idle:"STANDBY", think:"NEURAL LINK", read:"SECTOR DUMP 0x4A2F",
  edit:"PATCHING BINARY", bash:"INJECTING PAYLOAD", net:"UPLINK ACTIVE", task:"SPAWNING DAEMON"
};

/* a tool call may kick off a matching mission — see the gate in initHud */
/* Each scenario draws from a pool so the same tool call doesn't always
   stage the same operation. Themed loosely: reading -> snooping, editing ->
   destructive, bash -> intrusion, net -> long-haul comms, task -> summoning
   something. All 19 are reachable from real work, not just Ctrl+Shift+M. */
const MISSION_FOR = {
  read: ["gibson", "enigma", "sentience", "y2k", "faxnet"],
  edit: ["delworld", "system32", "gravity", "polarity", "agnus"],
  bash: ["kremlin", "bitcoin", "demon", "pizza", "nyse"],
  net:  ["icbm", "mothership", "voyager", "satellite", "faxnet"],
  task: ["satellite", "sentience", "demon", "voyager", "bitcoin"]
};

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
        if (m[i] !== undefined){ onScenario(SNIFF_RULES[i-1][1], m[0]); break; }
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

export function initHud({ hudEl, missionBarEl, config, effects }){
  const fx = effects || {glitch(){}, guru(){}};
  let cfg = normCfg(config);
  let running = false, raf = 0, t0 = performance.now(), clock = 0;
  let typingBoost = 0, lastType = 0;
  let scenarioKey = "idle", load = .35, opPct = 0, lastLayout = 0, lastMission = 0, lastSniff = 0;
  const timers = [];
  const mounted = new Map();
  const openReqs = new Set();

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
    if (spec.grow === 0) el.dataset.grow = "0";
    if (spec.h) el.style.flexBasis = spec.h + "px";

    const hd = document.createElement("div");
    hd.className = "panel-hd";
    hd.innerHTML = `<span>${spec.title}</span><span class="dot"></span>`;
    const bd = document.createElement("div");
    bd.className = "panel-bd";
    el.append(hd, bd);

    const p = {key, el, body:bd, spec, lines:[]};

    if (spec.kind === "canvas"){
      bd.classList.add("pad0");
      const cv = document.createElement("canvas");
      bd.appendChild(cv);
      p.canvas = cv; p.ctx = cv.getContext("2d");
    }
    if (spec.kind === "gauges"){
      bd.innerHTML = ["BLITTER","COPPER","UPLINK","ENTROPY"].map((l,i) =>
        `<div class="gauge"><span class="lbl">${l}</span><span class="bar">
         <span class="fill" data-g="${i}"></span></span><span class="val" data-v="${i}">0</span></div>`).join("");
      p.gauge = [30,45,20,12];
    }
    if (spec.kind === "disk"){ p.head = 0; p.heat = new Array(80).fill(0); }
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
    p.canvas.width = Math.max(40, Math.floor(r.width));
    p.canvas.height = Math.max(40, Math.floor(r.height));
  }

  function setLayout(keys){
    for (const [k,p] of mounted){
      if (!keys.includes(k)){
        clearInterval(p.timer);
        p.el.classList.add("closing");
        setTimeout(() => p.el.remove(), 160);
        mounted.delete(k);
      }
    }
    keys.forEach(k => {
      if (!mounted.has(k)){
        const p = buildPanel(k);
        mounted.set(k, p);
        hudEl.appendChild(p.el);
        sizeCanvas(p);
      }
    });
    keys.forEach(k => hudEl.appendChild(mounted.get(k).el));
  }

  function sizeAll(){ mounted.forEach(sizeCanvas); missions.resize(); }

  function setOp(label, crit){
    if (!op.label) return;
    op.label.textContent = label || OPNAME[scenarioKey];
    op.label.classList.toggle("crit", !!crit);
  }

  /* Minimum time a set of panels stays on screen, no matter what the stream
     is doing. Claude Code emits tool calls every few seconds, and each one
     changes the scenario — gating only on "same scenario" left every
     Read->Edit->Bash sequence swapping the whole column, which reads as a
     slideshow. The scenario (and the op strip, and load) still tracks the
     stream immediately; only the PANELS are held. */
  const LAYOUT_HOLD_MS = 45000;

  function setScenario(key){
    const next = key in LAYOUTS ? key : "idle";
    const now = Date.now();
    const changed = next !== scenarioKey;
    scenarioKey = next;
    load = scenarioKey === "idle" ? .35 : 1;
    if (!missions.active()) setOp(null, false);

    // hold the panels even across a scenario change
    if (now - lastLayout < LAYOUT_HOLD_MS && mounted.size) return;
    lastLayout = now;
    setLayout(pick(LAYOUTS[scenarioKey]));
    if (scenarioKey !== "idle" && !missions.active() && Math.random() < .25)
      setTimeout(spawnRequester, rnd(300,1400));
  }

  /* ── requesters ── */

  function spawnRequester(forceAlert){
    if (!running || openReqs.size >= 2) return;
    const r = forceAlert === 2 || (forceAlert !== 0 && Math.random() < .3) ? pick(ALERTS) : pick(REQUESTERS);
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

  const missions = initMissions({
    missionBarEl, effects: fx, spawnRequester, setOp, onResize: sizeAll
  });

  /* ── NEWS WATCH ──────────────────────────────────────────────────────
     What the map shows when no scripted operation is running, so the bar
     is useful rather than only theatrical.

     The mission runner owns the bar — it sets data-open itself and closes
     it 1.8s after an operation finishes. We never fight it: while a
     mission is active we hand the map back untouched, and afterwards we
     re-open the bar on the next tick. The header says LIVE because this
     is the one real thing on the panel. */
  const bar = (id) => missionBarEl.querySelector("#" + id)
                   || missionBarEl.querySelector(`[data-m="${id}"]`);
  const mapEls = {panel: bar("mapPanel"), title: bar("mapTitle"), sub: bar("mapSub")};
  let newsOwned = false;
  const NEWS_TITLE = "NEWS WATCH \u25CF LIVE";     // LIVE: this one is not theater

  function newsWatch(){
    const busy = missions.active();
    if (busy || !newsMarkerCount()){
      if (!newsOwned) return;
      newsOwned = false;
      setNewsMode(false);
      // a running mission closes the bar itself when it is done with it
      if (!busy){ missionBarEl.dataset.open = "0"; sizeAll(); }
      return;
    }
    if (!newsOwned){
      newsOwned = true;
      setNewsMode(true);
      mapEls.panel?.classList.remove("crit");     // not an alert, it is news
      setTimeout(sizeAll, 240);                   // after the bar transition
    }
    // re-assert: the mission runner's delayed close can land after we opened
    if (missionBarEl.dataset.open !== "1"){
      missionBarEl.dataset.open = "1";
      setTimeout(sizeAll, 240);
    }
    // header is rewritten only when it actually changes — this ticks every
    // 600ms and the terminal next door does not need the extra reflow
    const m = currentNewsMarker(clock);
    const sub = m ? m.place : "LIVE FEED";
    if (mapEls.title && mapEls.title.textContent !== NEWS_TITLE)
      mapEls.title.textContent = NEWS_TITLE;
    if (mapEls.sub && mapEls.sub.textContent !== sub) mapEls.sub.textContent = sub;
  }

  /* ── sniffer wiring: scenario always, mission only on a long leash ── */

  const sniff = createSniffer(key => {
    lastSniff = Date.now();
    setScenario(key);
    const now = Date.now();
    // one mission at a time, and no more than one per 45s, or a busy session
    // turns the terminal into a disco
    const pool = MISSION_FOR[key];
    if (!pool || missions.active() || now - lastMission < 45000) return;
    if (Math.random() < .5){
      const pick = pool[Math.floor(Math.random() * pool.length)];
      // an unknown key is a no-op in missions.run, so a typo degrades quietly
      lastMission = now; missions.run(pick);
    }
  });

  /* ── loops ── */

  function frame(now){
    clock = (now - t0)/1000;
    mounted.forEach(p => {
      if (p.spec.kind === "canvas" && p.canvas.width)
        p.spec.paint(p.ctx, p.canvas.width, p.canvas.height, clock, load);
    });
    missions.paint(clock);
    raf = requestAnimationFrame(frame);
  }

  const every = (ms, fn) => timers.push(setInterval(fn, ms));

  function start(){
    if (running) return;
    running = true;
    hudEl.hidden = false;
    t0 = performance.now();
    setScenario("idle");
    lastLayout = 0;
    missions.start();
    sizeAll();
    raf = requestAnimationFrame(frame);

    every(180, () => {                                   // operation strip
      if (missions.active()){
        const total = missions.total();
        opPct = Math.min(100, opPct + 100/(total/180));
      } else {
        opPct = load > .5 ? Math.min(100, opPct + rnd(1.5,7)) : opPct + .4;
      }
      if (opPct >= 100) opPct = 0;
      missions.progress(opPct);
      if (op.fill) op.fill.style.width = opPct.toFixed(0)+"%";
      if (op.hex) op.hex.textContent = `${hex(4)} ${hex(4)} ${hex(4)}`;
    });

    every(130, () => {
      if (typingBoost > 0) typingBoost = Date.now() - lastType > 400
        ? Math.max(0, typingBoost - .08) : typingBoost;                                   // gauges + DF0 head
      mounted.forEach(p => {
        if (p.spec.kind === "gauges"){
          p.gauge.forEach((v,i) => {
            // typing pushes the bars up and they fall back on their own
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
      });
    });

    /* Ambient rotation. Deliberately slow and probabilistic: a panel should
       feel like equipment someone left running, not a slideshow. Checking
       every 26s at 30% odds puts the mean dwell near 90s, and the geometric
       distribution means some layouts stick around for many minutes — which
       is the point. Do not speed this up to make it look busier. */
    every(30000, () => {
      if (missions.active()) return;
      const now = Date.now();
      if (now - lastLayout < LAYOUT_HOLD_MS) return;      // respect the hold
      if (scenarioKey !== "idle" && now - lastSniff > 45000){
        scenarioKey = "idle"; load = .35;
      }
      if (Math.random() < .30){ lastLayout = now; setLayout(pick(LAYOUTS[scenarioKey])); }
    });

    /* Ambient operations. Without this the map and the missile arcs only
       ever appear when the sniffer sees a Claude Code tool call, so a plain
       shell session never sees them at all. Now the theater runs on its own
       and Claude activity merely biases which operation gets staged. */
    every(38000, () => {
      if (missions.active() || Date.now() - lastMission < 38000) return;
      if (Math.random() < .55){
        lastMission = Date.now();
        missions.run(MISSION_KEYS[Math.floor(Math.random() * MISSION_KEYS.length)]);
      }
    });

    every(600, newsWatch);                               // map's idle mode

    every(9000,  () => { if (Math.random() < .18 + cfg.glitchRate/100*.5) spawnRequester(); });
    every(20000, () => { if (Math.random() < cfg.glitchRate/100*.12) fx.guru(); });
    addEventListener("resize", sizeAll);
  }

  function stop(){
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf); raf = 0;
    timers.splice(0).forEach(clearInterval);
    removeEventListener("resize", sizeAll);
    missions.stop();
    newsOwned = false;
    setNewsMode(false);
    setLayout([]);                                       // clears panel timers
    mounted.forEach(p => p.el.remove());
    mounted.clear();
    openReqs.forEach(el => el.remove());
    openReqs.clear();
    hudEl.hidden = true;
    if (op.label) op.label.textContent = "STANDBY";
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
    runMission(key){ if (running && MISSION_KEYS.includes(key)) missions.run(key); },
    missionKeys: MISSION_KEYS
  };
}
