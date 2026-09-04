/* missions.js — the scripted operations and the mission bar they play in.
   Ported from prototype.html. Five missions, each a list of steps with a
   duration, a log burst, and optional map side effects (missile strikes,
   continent deletion, restore-from-floppy).

   This module owns the contents of the mission bar element it is handed:
   the situation display, the mission log and the countdown panel. It
   rebuilds them on init so it does not depend on markup in index.html. */

import { createMap } from "./worldmap.js";
import { EXTRA_MISSIONS } from "./missions-extra.js";

const hex = n => Array.from({length:n},()=>"0123456789ABCDEF"[Math.floor(Math.random()*16)]).join("");

export const MISSIONS = {
  kremlin: {
    title:"BREACH: KREMLIN MAINFRAME", code:"KR-77",
    map:{sub:"INTRUSION ROUTE", links:[{from:"KYIV",to:"MOSCOW"}], targets:["MOSCOW"]},
    steps:[
      {l:"RESOLVING kremlin.ru",        d:1500, log:["dns kremlin.ru -> 95.173.136.70","AS-CENTRALTELECOM  ttl 3600"]},
      {l:"PROBING 95.173.136.70",       d:1700, log:["22/tcp  open  ssh OpenSSH 4.3","443/tcp open  https","1337/tcp FILTERED"]},
      {l:"BYPASSING FIREWALL 3/7",      d:2000, log:["fragmenting packets...","ttl shim accepted","layer 3 traversed"]},
      {l:"CRACKING RSA-4096",           d:2600, log:["pollard rho, 4 threads","p = 0x"+hex(12),"q = 0x"+hex(12)]},
      {l:"DUMPING /etc/shadow",         d:1700, log:["root:$6$"+hex(16),"1194 accounts exfiltrated"]},
      {l:"ACCESS GRANTED",              d:2000, log:["session established","covering tracks: wtmp cleared"], ok:1}
    ]
  },
  icbm: {
    title:"ICBM TRAJECTORY PLOT", code:"DEFCON1", crit:1, countdown:22,
    map:{sub:"NORAD / DEFCON 1", targets:["MOSCOW","PYONGYANG","TEHRAN","BEIJING"]},
    steps:[
      {l:"SILO KEYS TURNED",            d:1800, log:["VANDENBERG  key A  CONFIRMED","CHEYENNE MTN key B CONFIRMED"]},
      {l:"PLOTTING GREAT CIRCLE",       d:2200, log:["apogee 1287 km","flight time 31m04s"],
       strike:[{from:"VANDENBERG",to:"PYONGYANG",dur:3.2}]},
      {l:"WARHEADS ASSIGNED 4/4",       d:2400, log:["W88 x4 armed","CEP 90m"],
       strike:[{from:"CHEYENNE MTN",to:"MOSCOW",dur:4.0},{from:"VANDENBERG",to:"BEIJING",dur:3.6}]},
      {l:"TERMINAL GUIDANCE LOCK",      d:2200, log:["star tracker nominal","reentry vehicles separated"],
       strike:[{from:"DIEGO GARCIA",to:"TEHRAN",dur:2.8}]},
      {l:"ABORT CODE ACCEPTED",         d:2600, log:["WOPR: a strange game.","the only winning move is not to play."], ok:1}
    ]
  },
  delworld: {
    title:"rm -rf /world", code:"FATAL", crit:1,
    map:{sub:"DELETION IN PROGRESS", targets:[]},
    steps:[
      {l:"rm -rf /world/OCEANIA",       d:1500, del:"OCEANIA",       log:["unlink 14,203,997 entries"]},
      {l:"rm -rf /world/AFRICA",        d:1600, del:"AFRICA",        log:["unlink 30,370,000 entries"]},
      {l:"rm -rf /world/SOUTH-AMERICA", d:1600, del:"SOUTH-AMERICA", log:["unlink 17,840,000 entries"]},
      {l:"rm -rf /world/EUROPE",        d:1600, del:"EUROPE",        log:["unlink 10,180,000 entries"]},
      {l:"rm -rf /world/ASIA",          d:1700, del:"ASIA",          log:["unlink 44,579,000 entries"]},
      {l:"rm -rf /world/NORTH-AMERICA", d:1700, del:"NORTH-AMERICA", log:["unlink 24,709,000 entries"]},
      {l:"rm -rf /world/ANTARCTICA",    d:1500, del:"ANTARCTICA",    log:["unlink 14,200,000 entries"]},
      {l:"fsck: RESTORING FROM DF0:",   d:2400, restore:1, log:["backup found: world.adf","148,082,997 entries restored"], ok:1}
    ]
  },
  gibson: {
    title:"HACKING THE GIBSON", code:"GB-01",
    map:{sub:"ELLINGSON MINERAL CO", links:[{from:"LONDON",to:"WASHINGTON"}], targets:["WASHINGTON"]},
    steps:[
      {l:"DIALING 212-555-0142",        d:1500, log:["carrier detected 2400 baud","CONNECT"]},
      {l:"GARBAGE FILE INJECTED",       d:1900, log:["rc file appended","supervisor mode acquired"]},
      {l:"WALKING THE FILE TREE",       d:2100, log:["/gibson/payroll  4.2 GB","/gibson/da_vinci  17 KB"]},
      {l:"WORM LOCATED",                d:2000, log:["da_vinci.exe  slicing 0.4c/tick","1,271 accounts skimmed"]},
      {l:"MESS WITH THE BEST",          d:2200, log:["die like the rest.","crash and burn averted"], ok:1}
    ]
  },
  satellite: {
    title:"SATCOM UPLINK", code:"KH-11",
    map:{sub:"ORBITAL DOWNLINK", targets:["CANBERRA","BRASILIA","TOKYO"]},
    steps:[
      {l:"ACQUIRING KH-11 BIRD",        d:1700, log:["az 214.7  el 38.2","doppler -3.1 kHz"]},
      {l:"DISH SLEW 214.7 DEG",         d:1800, log:["slew complete","lock: 0.998"]},
      {l:"DOWNLINK 1.2 GB/s",           d:2200, log:["frames 44,102 rx","ber 1e-9"]},
      {l:"IMAGERY DECODED",             d:2000, log:["4 frames, 0.31 m/px","targets tagged"], ok:1}
    ]
  }
};

// Agent F's 14 extra operations, merged before MISSION_KEYS is derived.
Object.assign(MISSIONS, EXTRA_MISSIONS);

export const MISSION_KEYS = Object.keys(MISSIONS);

const BAR_HTML = `
  <div class="panel map" data-m="mapPanel">
    <div class="panel-hd"><span data-m="mapTitle">GLOBAL SITUATION DISPLAY</span><span data-m="mapSub">NORAD / DEFCON 5</span></div>
    <div class="panel-bd pad0"><canvas data-m="mapCanvas"></canvas></div>
  </div>
  <div class="panel log">
    <div class="panel-hd"><span>MISSION LOG</span><span class="dot"></span></div>
    <div class="panel-bd" data-m="logBody"></div>
  </div>
  <div class="panel cd" data-m="cdPanel">
    <div class="panel-hd"><span data-m="cdTitle">STATUS</span><span data-m="cdCode">0000</span></div>
    <div class="panel-bd cdbody">
      <div class="cdbig" data-m="cdBig">--:--</div>
      <div class="cdsub" data-m="cdSub">STANDBY</div>
      <div class="cdbar" data-m="cdBar"><i></i></div>
    </div>
  </div>`;

/* initMissions({missionBarEl, effects, spawnRequester, setOp, onResize})
   setOp(label, crit)  — writes the operation strip label (hud owns it)
   spawnRequester(mode) — 2 forces an alert requester, 0 suppresses one
   onResize()          — called when the bar opens/closes and geometry moves */
export function initMissions({ missionBarEl, effects, spawnRequester, setOp, onResize }){
  /* index.html already ships this markup; take it if it is there and only
     inject our own copy if it is not, so the bar works either way. */
  const PARTS = ["mapPanel","mapTitle","mapSub","mapCanvas","logBody",
                 "cdPanel","cdTitle","cdCode","cdBig","cdSub","cdBar"];
  const el = {};
  const find = () => PARTS.every(k =>
    (el[k] = missionBarEl.querySelector("#" + k) || missionBarEl.querySelector(`[data-m="${k}"]`)));
  if (!find()){ missionBarEl.innerHTML = BAR_HTML; find(); }
  missionBarEl.dataset.open = "0";

  const map = createMap(el.mapCanvas);
  let mission = null, timers = [], logLines = [], clock = 0, cdLeft = 0, pct = 0, tick = null;

  function log(line, cls){
    logLines.push(cls ? `<span class="${cls}">${line}</span>` : line);
    const cap = Math.max(4, Math.floor(el.logBody.clientHeight / 18));
    while (logLines.length > cap) logLines.shift();
    el.logBody.innerHTML = logLines.join("\n");
  }

  function clearTimers(){ timers.forEach(clearTimeout); timers = []; }
  const after = (ms, fn) => timers.push(setTimeout(fn, ms));

  function run(key){
    const m = MISSIONS[key];
    if (!m) return;
    clearTimers();
    mission = m;
    logLines = [];
    pct = 0;
    cdLeft = m.countdown ? m.countdown * 60 : 0;
    map.reset(m.map);

    missionBarEl.dataset.open = "1";
    el.mapTitle.textContent = m.title;
    el.mapSub.textContent = m.map.sub || "";
    el.cdTitle.textContent = m.code;
    el.cdCode.textContent = hex(4);
    el.cdPanel.classList.toggle("crit", !!m.crit);
    el.mapPanel.classList.toggle("crit", !!m.crit);
    el.cdBar.classList.toggle("bad", !!m.crit);
    el.cdBig.classList.toggle("bad", !!m.crit);
    after(240, () => { map.resize(); onResize && onResize(); });
    log(`>>> ${m.title}`, "hot");
    effects.glitch(220);

    let at = 0;
    m.steps.forEach((s, i) => {
      after(at, () => {
        setOp(s.l, !!m.crit);
        el.cdSub.textContent = `STEP ${i+1}/${m.steps.length}`;
        log(`[${String(i+1).padStart(2,"0")}] ${s.l}`, s.ok ? "hot" : null);
        (s.log||[]).forEach((line, j) =>
          after(260*(j+1), () => log("     " + line, m.crit && !s.ok ? "bad" : null)));
        if (s.del){ map.deleted.add(s.del); effects.glitch(300); }
        if (s.restore){ map.deleted.clear(); effects.glitch(400); }
        if (s.strike) s.strike.forEach(st => map.addStrike(st, clock));
        if (s.ok) after(700, () => spawnRequester(m.crit ? 2 : 0));
      });
      at += s.d;
    });

    after(at + 600, () => {
      log("<<< OPERATION COMPLETE", "hot");
      mission = null;
      map.clearStrikes();
      map.deleted.clear();
      setOp(null, false);
      after(1800, () => {
        if (mission) return;
        missionBarEl.dataset.open = "0";
        onResize && onResize();
      });
    });
  }

  /* one-second housekeeping: countdown when a mission wants one, wall
     clock when it does not. Only runs while the HUD is enabled. */
  function beat(){
    if (mission && mission.countdown){
      cdLeft = Math.max(0, cdLeft - 1);
      el.cdBig.textContent = `T-${String(Math.floor(cdLeft/60)).padStart(2,"0")}:${String(cdLeft%60).padStart(2,"0")}`;
    } else if (mission){
      el.cdBig.textContent = `${String(Math.floor(pct)).padStart(2,"0")}%`;
    } else {
      el.cdBig.textContent = new Date().toTimeString().slice(3,8);
      el.cdSub.textContent = "STANDBY";
    }
    el.cdBar.firstElementChild.style.width = pct.toFixed(0)+"%";
    el.cdCode.textContent = hex(4);
  }

  return {
    run,
    keys: MISSION_KEYS,
    active: () => mission !== null,
    total: () => mission ? mission.steps.reduce((a,s) => a+s.d, 0) : 0,
    progress(p){ pct = p; },
    paint(t){
      clock = t;
      if (missionBarEl.dataset.open === "1") map.paint(t, () => effects.glitch(180));
    },
    resize: map.resize,
    start(){ if (!tick) tick = setInterval(beat, 1000); },
    stop(){
      clearTimers();
      clearInterval(tick); tick = null;
      mission = null;
      map.clearStrikes(); map.deleted.clear();
      missionBarEl.dataset.open = "0";
    }
  };
}
