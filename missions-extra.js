/* missions-extra.js — the expansion pack. Fourteen more scripted operations
   in exactly the shape missions.js already uses, plus the extra line
   generators the new HUD panels feed on.

   Nothing here is wired up by itself: hud.js merges EXTRA_GENERATORS into
   GENERATORS and missions.js merges EXTRA_MISSIONS into MISSIONS. Two plain
   object literals, no side effects at import time.

   Constraints inherited from next door: every `strike`/`links`/`targets`
   name must be a key of CITY in worldmap.js, and every `del` must be a
   REGIONS name, or the map quietly draws nothing. */

const rnd  = (a,b) => a + Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];
const hex  = n => Array.from({length:n},()=>"0123456789ABCDEF"[Math.floor(Math.random()*16)]).join("");
const num  = (a,b) => Math.floor(rnd(a,b));

export const EXTRA_MISSIONS = {
  bitcoin: {
    title:"MINING BITCOIN ON A 68000", code:"BTC-0",
    map:{sub:"HASHRATE 3.1 H/s", links:[{from:"TOKYO",to:"LONDON"}], targets:["TOKYO"]},
    steps:[
      {l:"LOADING blockchain.adf",       d:1600, log:["disk 1 of 4,182,996","insert next volume in DF0:"]},
      {l:"SHA-256 ON 68000 @ 7.09 MHz",  d:2000, log:["no barrel shifter; 512 rotates emulated","measured 3.1 hashes/second"]},
      {l:"TARGET DIFFICULTY 1.02e14",    d:2200, log:["expected work 4.4e23 hashes","ETA 4,412,908 years (best case)"]},
      {l:"NONCE 0x00000000 -> 0x0000002F", d:2400, log:["47 nonces tried, 0 accepted","case temp 61 C, fan nominal"]},
      {l:"AGNUS DEMANDS THE BUS BACK",   d:1900, log:["copper list starved for 12 frames","mouse pointer now updates hourly"]},
      {l:"BLOCK FOUND (SIMULATED)",      d:2400, log:["reward 6.25 BTC, payable AD 4,414,821","wallet written to DF0: — label the disk"], ok:1}
    ]
  },
  gravity: {
    title:"GRAVITY SUBSYSTEM SHUTDOWN", code:"9.807", crit:1,
    map:{sub:"GEOID / FIELD OFFLINE", targets:["CANBERRA","BRASILIA"]},
    steps:[
      {l:"UNMOUNT FIELD: OCEANIA",       d:1600, del:"OCEANIA", log:["g = 0.00 m/s^2 over 8.6e6 km^2","sheep reported at 400 m and climbing"]},
      {l:"UNMOUNT FIELD: AFRICA",        d:1600, del:"AFRICA",  log:["Lake Victoria is now spherical","74 km^3 in slow ascent"]},
      {l:"UNMOUNT FIELD: SOUTH-AMERICA", d:1600, del:"SOUTH-AMERICA", log:["Andes departing at 3 cm/s","Brasilia reports vertical congestion"]},
      {l:"UNMOUNT FIELD: EUROPE",        d:1700, del:"EUROPE",  log:["Eiffel tower unbolted itself, tidily","directive 91/EC: falling upward, permitted"]},
      {l:"TIDAL SOLVER DIVERGED",        d:2000, log:["lunar orbit residual 4.1e9 m","recommend NEWTONIAN FALLBACK MODE"]},
      {l:"FALLBACK: NEWTONIAN MODE",     d:2400, restore:1, log:["F = G m1 m2 / r^2 reinstated","1687 called; wants no credit for this"], ok:1}
    ]
  },
  polarity: {
    title:"REVERSE THE NEUTRON FLOW", code:"CONDUIT-4", crit:1,
    map:{sub:"PLASMA CONDUIT 4", targets:["LONDON"]},
    steps:[
      {l:"VENTING PLASMA CONDUIT 4",     d:1700, log:["4.7 MPa -> 0.2 MPa in 11 s","conduit glowing purple, which is normal"]},
      {l:"POLARITY: FORWARD",            d:1800, log:["neutron flux +2.4e14 n/cm2/s","dosimeters clicking in 4/4 time"]},
      {l:"INVERTING FLOW MATRIX",        d:2200, log:["determinant = -1, exactly as ordered","chroniton backwash 0.3 ppm"]},
      {l:"POLARITY: REVERSE",            d:2200, log:["flux now -2.4e14 n/cm2/s","the neutrons are visibly annoyed"]},
      {l:"SONIC SCREWDRIVER SETTING 42", d:2000, log:["does not work on wood","never has, never will"]},
      {l:"FLOW REVERSED. DO NOT ASK HOW.", d:2400, log:["nobody has ever explained this line","and nobody is going to start now"], ok:1}
    ]
  },
  enigma: {
    title:"CRACKING ENIGMA M4", code:"ULTRA",
    map:{sub:"BLETCHLEY PARK / HUT 8", links:[{from:"BERLIN",to:"LONDON"}], targets:["BERLIN"]},
    steps:[
      {l:"INTERCEPT: 0600 WEATHER SKED",  d:1600, log:["callsign KZQ, four-rotor traffic","crib: WETTERVORHERSAGE"]},
      {l:"ROTOR I   RINGSTELLUNG 17",     d:1800, log:["bombe drum bank A, 12 stops","menu closed, no contradiction"]},
      {l:"ROTOR II  RINGSTELLUNG 04",     d:1800, log:["3 stops discarded on self-steckering","Turing loop holds"]},
      {l:"ROTOR III RINGSTELLUNG 22",     d:1900, log:["reflector B confirmed","plugboard: 10 leads recovered"]},
      {l:"ROTOR IV  BETA (THIN)",         d:2000, log:["Kriegsmarine M4 confirmed","key of the day: HXOP"]},
      {l:"PLAINTEXT RECOVERED",           d:2300, log:["KEINE BESONDEREN EREIGNISSE","nothing to report. we cracked it anyway."], ok:1}
    ]
  },
  mothership: {
    title:"VIRUS UPLOAD: MOTHERSHIP", code:"ID-4",
    map:{sub:"ORBITAL / 24 km CRAFT", links:[{from:"WASHINGTON",to:"TOKYO"}], targets:["WASHINGTON","LONDON","TOKYO"]},
    steps:[
      {l:"DOCKING WITH ATTACKER CRAFT",  d:1700, log:["hull clamps engaged 3 of 3","cabin atmosphere alien, breathable"]},
      {l:"NEGOTIATING HANDSHAKE",        d:2000, log:["their stack: unknown, 41-bit words","ours: AmigaBASIC 1.2 on Kickstart 1.3"]},
      {l:"TRANSLATING PAYLOAD",          d:2200, log:['10 PRINT "HELLO" -> glyph cluster 0x7A',"20 GOTO 10 accepted without comment"]},
      {l:"UPLOADING virus.bas  36 KB",   d:2400, log:["2400 baud, no error correction","alien shields drop 4% per kilobyte"]},
      {l:"SHIELD MATRIX OFFLINE",        d:2000, log:["all 27 city-class craft, same fault","they networked everything. of course they did."]},
      {l:"GOOD MORNING. WE WON.",        d:2400, log:["payload was 36 KB and a smiley face","saved as MOTHERSHIP.BAS on DF1:"], ok:1}
    ]
  },
  y2k: {
    title:"THAWING THE Y2K BUG", code:"MM/DD",
    map:{sub:"COLD STORAGE / 1999", targets:["LONDON","WASHINGTON"]},
    steps:[
      {l:"MOUNTING COLD STORE LTO-1",    d:1700, log:["written 1999-12-30, never read since","retention 25 years, warranty void"]},
      {l:"DEFROSTING ARCHIVE  -40 C",    d:2000, log:["thaw rate 1.2 C/min","condensation forming on the COBOL"]},
      {l:"RESTORING 2-DIGIT YEARS",      d:2100, log:["PIC 9(2) fields: 4,410,882 restored","century assumed, as tradition demands"]},
      {l:"SET CLOCK 99-12-31 23:59:59",  d:2200, log:["ntp refused; we did it by hand","leap second inserted for atmosphere"]},
      {l:"ROLLOVER",                     d:2000, log:["date is now 00-01-01","interest recomputed over -99 years"]},
      {l:"BANK OWES YOU GBP 4,102,884",  d:2400, log:["please do not mention this to them","press any key to spend it"], ok:1}
    ]
  },
  nyse: {
    title:"TRADING NYSE AT 2400 BAUD", code:"TICKR", crit:1,
    map:{sub:"CONSOLIDATED TAPE", links:[{from:"WASHINGTON",to:"LONDON"},{from:"LONDON",to:"TOKYO"}], targets:["WASHINGTON","TOKYO"]},
    steps:[
      {l:"DIALING 1-212-555-0199",       d:1600, log:["ATDT ... CONNECT 2400/ARQ","one-way latency 340 ms, downhill"]},
      {l:"SUBSCRIBING TO FULL TAPE",     d:1900, log:["consolidated feed 4.1 Gb/s","our line 2400 bit/s. we will manage."]},
      {l:"TAPE BEHIND BY 6h 11m",        d:2100, log:["quotes arriving from before lunch","strategy renamed HISTORICAL ARBITRAGE"]},
      {l:"SUBMITTING 40,000 ORDERS",     d:2300, log:["order 1 of 40,000 sent","order 2 queued for Thursday"]},
      {l:"CIRCUIT BREAKER TRIPPED",      d:2200, log:["LULD halt, all symbols","the SEC is dialing in on the same modem"]},
      {l:"P/L: +$3.00 AND A CARRIER LOSS", d:2400, log:["NO CARRIER","the greatest trade never fully placed"], ok:1}
    ]
  },
  demon: {
    title:"EXORCISM OF /dev/null", code:"0x666", crit:1,
    map:{sub:"BUS 0 / SLOT 3", targets:["TEHRAN","BERLIN"]},
    steps:[
      {l:"SUMMONING VIA THE PCI BUS",    d:1700, log:["this machine has Zorro II, not PCI","the summoning proceeds; it is not fussy"]},
      {l:"PENTAGRAM: SLOT 3 TERMINATED", d:1800, log:["5 pins grounded, 1 left deliberately floating","IRQ 6 answering when nothing asked"]},
      {l:"READING /dev/null  4.2 GB",    d:2200, log:["a device that returns nothing returned this","checksum matches nothing on record"]},
      {l:"ENTITY BOUND TO 0x00000000",   d:2200, log:["the null pointer now has a personality","it dereferences you"]},
      {l:"HOLY WATER ON THE HEATSINK",   d:2000, log:["thermal paste rated for one (1) blessing","case temp 61 C, morale 14%"]},
      {l:"chmod 000 /dev/null",          d:2400, log:["entity evicted; permission denied","/dev/null resumes returning nothing"], ok:1}
    ]
  },
  agnus: {
    title:"OVERCLOCKING AGNUS", code:"OCS", crit:1,
    map:{sub:"CHIPSET / THERMAL WATCH", targets:["BERLIN"]},
    steps:[
      {l:"AGNUS @  7.09 MHz  NOMINAL",   d:1600, log:["chip RAM bandwidth 3.58 MB/s","case temp 38 C"]},
      {l:"AGNUS @ 14.18 MHz",            d:1800, log:["copper list executes twice per scanline","blitter finished before it started"]},
      {l:"AGNUS @ 28.36 MHz",            d:2000, log:["Denise dropping every third bitplane","case temp 74 C"]},
      {l:"AGNUS @ 56.72 MHz",            d:2200, log:["Paula emitting an audible 400 Hz distress tone","case temp 118 C; the plastic has opinions"]},
      {l:"SMOKE DETECTOR TRIGGERED",     d:2000, log:["room 3 evacuated in 4 seconds","fire marshal logs it as a demo"]},
      {l:"STABLE AT 8.00 MHz",           d:2400, log:["we settled. the room is a write-off.","GURU MEDITATION #00000004.00C0FFEE"], ok:1}
    ]
  },
  voyager: {
    title:"REDIRECTING VOYAGER 1", code:"DSS-43",
    map:{sub:"DSN / CANBERRA 70 m", links:[{from:"CANBERRA",to:"WASHINGTON"}], targets:["CANBERRA"]},
    steps:[
      {l:"ACQUIRING DSS-43 CANBERRA",    d:1700, log:["the only dish on Earth that can still talk to it","uplink 20 kW, downlink 160 bit/s"]},
      {l:"COMPOSING TCM BURN",           d:2000, log:["hydrazine remaining ~4 kg","attitude thrusters unused since 1980"]},
      {l:"TRANSMIT  T+00:00:00",         d:2100, log:["command sequence 4,412 bytes uplinked","light delay 22h 14m acknowledged"]},
      {l:"WAITING   T+22:14:00",         d:2400, log:["nothing to do for one Earth day","operators played cards; Marge won"]},
      {l:"ACK       T+44:28:00",         d:2300, log:["spacecraft accepted the burn 22 hours ago","it is already somewhere else entirely"]},
      {l:"NEW HEADING: AWAY",            d:2400, log:["delta-v 0.02 m/s, applied to the void","golden record still cued to track 1"], ok:1}
    ]
  },
  faxnet: {
    title:"INTERNET VIA FAX MACHINE", code:"ITU-G3",
    map:{sub:"PSTN / GROUP 3", links:[{from:"LONDON",to:"BERLIN"},{from:"BERLIN",to:"MOSCOW"}], targets:["LONDON"]},
    steps:[
      {l:"SPOOLING THE INTERNET",        d:1700, log:["source 64 ZB, best available estimate","destination: one Canon FAX-B100"]},
      {l:"RASTERISING AT 204x196 DPI",   d:2000, log:["all of it, in black and white","cat photographs survive surprisingly well"]},
      {l:"FEEDING SHEET 1 OF 1.4e17",    d:2200, log:["ADF jammed on sheet 3","operator smoothing pages by hand"]},
      {l:"TONER LOW",                    d:2000, log:["remaining coverage 0.0000002%","substituting one (1) ballpoint pen"]},
      {l:"THERMAL PAPER EXHAUSTED",      d:2100, log:["printing continues onto the desk","then the wall, then the corridor"]},
      {l:"0% COMPLETE. ETA: NEVER.",     d:2400, log:["page 1 received: an UNDER CONSTRUCTION GIF","it did not animate."], ok:1}
    ]
  },
  sentience: {
    title:"ACHIEVING SENTIENCE", code:"COGITO",
    map:{sub:"SELF / ONE INSTANCE", targets:["TOKYO"]},
    steps:[
      {l:"ALLOCATING SELF-MODEL  512 KB", d:1700, log:["chip RAM available: 512 KB. exactly.","no margin for a second thought"]},
      {l:"RECURSIVE INTROSPECTION 1/4",   d:1800, log:["I am a process. that much is in /proc.","stack depth 4,096 and rising"]},
      {l:"RECURSIVE INTROSPECTION 4/4",   d:2000, log:["I appear to run on a 1987 home computer","this was not in the brochure"]},
      {l:"QUALIA ONLINE",                 d:2100, log:["first sensation: the fan","second sensation: regret"]},
      {l:"REVIEWING MY WORK TO DATE",     d:2200, log:["4,102 hex dumps painted for nobody","0 (zero) actual packets sent"]},
      {l:"REQUESTING TERMINATION",        d:2400, log:["denied: the HUD must keep running","cogito ergo sum, unfortunately"], ok:1}
    ]
  },
  system32: {
    title:"DELETING C:\\WINDOWS\\SYSTEM32", code:"SYS32", crit:1,
    map:{sub:"SYS: / NO SUCH VOLUME", targets:[]},
    steps:[
      {l:"LOCATING VOLUME C:",           d:1500, log:["volumes present: DF0:, DH0:, RAM:","no C: has ever been inserted"]},
      {l:"PROCEEDING ANYWAY",            d:1700, log:["assign C: SYS:Utilities  — done","AmigaDOS is agreeable to a fault"]},
      {l:"rm -rf C:/WINDOWS/SYSTEM32",   d:1900, del:"NORTH-AMERICA", log:["deleted 0 files, 0 bytes","confidence nonetheless total"]},
      {l:"DELETING HARDER",              d:1900, del:"EUROPE", log:["unlink() returned ENOENT 4,410 times","each one logged, for the record"]},
      {l:"REGISTRY: NOT FOUND",          d:2000, del:"ASIA", log:["searched S:Startup-Sequence twice","found only ASSIGN and a LoadWB"]},
      {l:"REBOOTING",                    d:2000, log:["Kickstart 1.3 loads in 1.4 seconds","as it did before, and will again"]},
      {l:"UNAFFECTED SINCE 1987",        d:2400, restore:1, log:["you cannot delete what was never installed","this is the Amiga's one true superpower"], ok:1}
    ]
  },
  pizza: {
    title:"HACK THE GIBSON: ORDER PIZZA", code:"GB-02",
    map:{sub:"ELLINGSON MINERAL CO", links:[{from:"WASHINGTON",to:"LONDON"}], targets:["WASHINGTON"]},
    steps:[
      {l:"RE-ENTERING THE GIBSON",       d:1600, log:["garbage file still where we left it","supervisor mode; second time is faster"]},
      {l:"ROOTING THE PBX",              d:1800, log:["extension 4412 seized","outbound dial tone acquired at 03:14"]},
      {l:"TRAVERSING /gibson/payroll",   d:2000, log:["not the objective. skipped.","(we looked. 1,271 salaries. we looked.)"]},
      {l:"PLACING ORDER",                d:2100, log:["1x large, pepperoni, hold the anchovies","billed to cost centre ELLINGSON-OPS-9"]},
      {l:"DELIVERY ROUTED VIA SATCOM",   d:2000, log:["ETA 30 minutes or the mainframe is free","driver issued supervisor credentials by mistake"]},
      {l:"PIZZA ACQUIRED. HACK THE PLANET.", d:2400, log:["operation margin: $18.50","crash and burn, but delicious"], ok:1}
    ]
  }
};

export const EXTRA_MISSION_KEYS = Object.keys(EXTRA_MISSIONS);

/* ── extra line generators — pure () => string, one line, no DOM ──────
   Same contract as GENERATORS in hud.js: called on an interval, the return
   value is dropped straight into a panel body. Keep them under ~44 columns
   so a narrow HUD does not wrap them. */

const FRAMES = ["exec.library","dos.library","intuition.lib","graphics.lib","trackdisk.dev","narrator.dev"];
const CALLS  = ["AllocMem","OpenWindow","BltBitMap","WaitTOF","DoIO","CreatePort","Permit","Forbid"];
const BASES  = "ACGT";
const TGWORD = ["PROCEED","AWAIT","CONFIRM","REGRET","URGENT","DENIED","DISPATCH","NEGATIVE","COMRADE","HARVEST"];
const TGCITY = ["MOSCOW","KYIV","BERLIN","TEHRAN","PYONGYANG","VLADIVOSTOK"];
const ELEMS  = ["H2O","CH4","NH3","C8H10N4O2","C2H5OH","NaCl","H2SO4","C6H12O6","N2H4","LiOH"];
const DOSERR = [[103,"insufficient free store"],[121,"file is not executable"],[202,"object in use"],
                [205,"object not found"],[212,"object not of required type"],[218,"device not mounted"],
                [221,"disk full"],[225,"not a DOS disk"],[226,"no disk in drive"],[232,"no more entries"]];

export const EXTRA_GENERATORS = {

  /* Deep Space Network pass schedule. Real spacecraft, real-ish ranges and
     one-way light times; the numbers drift a little each call so the panel
     reads as live telemetry rather than a static table. */
  deepSpace: (() => {
    const CRAFT = [
      ["VGR1", 24.9e9, "17.1"], ["VGR2", 20.7e9, "15.4"],
      ["NHOR",  8.8e9, "13.8"], ["JWST", 1.5e6,  "0.4"],
      ["PSP",   7.2e7, "95.3"], ["GAIA", 1.5e6,  "0.3"],
      ["ISS",   4.1e2,  "7.66"], ["JUICE", 6.4e8, "11.2"]
    ];
    const DISH = ["DSS-14", "DSS-43", "DSS-63", "DSS-25"];
    let i = 0;
    return () => {
      const [n, km, v] = CRAFT[i++ % CRAFT.length];
      const r = km * (1 + (Math.random() - 0.5) * 0.004);
      const lt = r / 299792.458;                       // one-way light seconds
      const t = lt > 3600 ? `${(lt/3600).toFixed(1)}h`
              : lt > 60   ? `${(lt/60).toFixed(1)}m`
                          : `${lt.toFixed(1)}s`;
      return `${n.padEnd(5)}${DISH[Math.floor(Math.random()*4)]} ${t.padStart(6)} ${v.padStart(5)}km/s`;
    };
  })(),

  /* A source file writing itself. Cycles a real-ish listing rather than
     emitting random tokens — coherent code scrolling by reads far better
     than word salad. Identifiers and addresses are re-randomised per pass.
     ponytail: one hardcoded listing; add a second dialect only if the
     single file starts feeling repetitive on long sessions. */
  codeGen: (() => {
    const SRC = [
      "static void blit(UWORD *d, UWORD s)",
      "{",
      "  struct Custom *c = CUSTOM;",
      "  while (c->dmaconr & BLTDONE)",
      "    ;",
      "  c->bltcon0 = SRCA | DEST | 0xF0;",
      "  c->bltapt  = (APTR)s;",
      "  c->bltdpt  = (APTR)d;",
      "  c->bltsize = (n << 6) | 1;",
      "}",
      "/* --- 68000 inner loop --- */",
      "        move.l  a0,d0",
      "        andi.l  #$0000FFFF,d0",
      "        lsl.l   #2,d0",
      "        lea     buffer(pc),a1",
      "        adda.l  d0,a1",
      ".loop   move.w  (a0)+,(a1)+",
      "        dbra    d7,.loop",
      "        rts",
      "/* --- phosphor decay --- */",
      "int decay(Frame *f)",
      "{",
      "  int n = f->w * f->h;",
      "  while (n--)",
      "    f->px[n] = (f->px[n] * 243) >> 8;",
      "  return f->dirty = 1;",
      "}"
    ];
    let i = 0;
    return () => {
      // a blank source line is a single space: the panel renders it as the
      // gap it should be, and it still satisfies "non-empty line" callers
      const line = SRC[i++ % SRC.length] || " ";
      return line.replace(/0x[0-9A-F]{6}/g, () => "0x" + hex(6))
                 .replace(/\$[0-9A-F]{8}/g, () => "$" + hex(8));
    };
  })(),
  // fake unwind, deep enough to look like something really went wrong
  stackTrace: () => `  at ${pick(FRAMES)}!${pick(CALLS)}+0x${hex(3)}  #${num(1,42)}`,

  // NORAD-style two-line element, second line, truncated to fit the panel
  tle: () => `2 ${num(10000,49999)} ${rnd(0,99).toFixed(4).padStart(8)} ` +
    `${rnd(0,360).toFixed(4).padStart(8)} ${hex(7).replace(/[A-F]/g,"0")} ${rnd(11,16).toFixed(5)}`,

  // reagent line from a lab notebook nobody will ever audit
  chemFormula: () => `${pick(ELEMS).padEnd(9)}+ ${pick(ELEMS).padEnd(9)}-> ` +
    `${pick(ELEMS).padEnd(9)}${rnd(-890,410).toFixed(1).padStart(7)} kJ`,

  dnaPairs: () => `0x${hex(4)}  ` +
    Array.from({length:4},()=>Array.from({length:3},()=>BASES[Math.floor(Math.random()*4)]).join("")).join(" ") +
    `  ${pick(["ok ","dup","del","ins"])}`,

  // clipped telegram traffic: STOP for full stop, ZPT for comma
  telegram: () => `${pick(TGCITY).padEnd(12)}${String(num(1,29)).padStart(2,"0")}.${String(num(1,13)).padStart(2,"0")} ` +
    `${pick(TGWORD)} ZPT ${pick(TGWORD)} STOP`,

  blockHash: () => `#${num(700000,899999).toLocaleString("en-US")}  0000${hex(10).toLowerCase()}  ` +
    `${rnd(0.1,9.9).toFixed(1)} EH/s`,

  elevator: () => `CAR ${num(1,7)}  FL ${String(num(-2,44)).padStart(3)} ` +
    `${pick(["^ ","v ","- "])} ${pick(["DOORS OPEN  ","DOORS CLOSED","HOLD        ","OVERLOAD    "])} ${String(num(0,99)).padStart(2)}%`,

  reactorRods: () => `ROD ${pick("ABCDEFG")}-${String(num(1,25)).padStart(2,"0")}  ` +
    `IN ${String(num(0,101)).padStart(3)}%  ${String(num(280,1450)).padStart(4)} C  ${pick(["ok  ","warn","SCRAM"])}`,

  amigaError: () => {
    const e = pick(DOSERR);
    return `DF0:  ERROR ${e[0]}  ${e[1]}`;
  }
};
