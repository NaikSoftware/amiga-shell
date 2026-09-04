/* generators.js — the extra line generators the HUD panels feed on.

   Nothing here is wired up by itself: hud.js merges EXTRA_GENERATORS into
   its own GENERATORS table before the first panel mounts. One plain object
   literal, no side effects at import time. */

/* ── extra line generators — pure () => string, one line, no DOM ──────
   Same contract as GENERATORS in hud.js: called on an interval, the return
   value is dropped straight into a panel body. Keep them under ~44 columns
   so a narrow HUD does not wrap them. */

const rnd  = (a,b) => a + Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];
const hex  = n => Array.from({length:n},()=>"0123456789ABCDEF"[Math.floor(Math.random()*16)]).join("");
const num  = (a,b) => Math.floor(rnd(a,b));

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

  /* An AmigaShell session rather than a wall of identical error lines: real
     1.x commands against real volumes, with results, and a genuine AmigaDOS
     error only now and then. A log reads as a machine doing something; a
     column of "ERROR 2xx" reads as a broken generator. */
  amigaError: (() => {
    const VOL = ["SYS:", "DF0:", "DF1:", "WORK:", "RAM:"];
    const SCRIPT = [
      () => `${cwd()}> list ${pick(["c", "s", "libs", "devs", "fonts"])}`,
      () => `  ${pick(["Shell", "Execute", "Assign", "Mount", "SetPatch", "IPrefs"])}` +
            `${String(Math.floor(rnd(900, 98000))).padStart(9)} rwed`,
      () => `${cwd()}> info`,
      () => `  ${pick(VOL).padEnd(6)}${Math.floor(rnd(400, 880))}K  ${Math.floor(rnd(20, 99))}% full`,
      () => `${cwd()}> copy ${pick(["s/startup-sequence", "c/Dir", "libs/mathtrans.library"])}`,
      () => `  copied ${Math.floor(rnd(1, 40))} file${Math.random() < .5 ? "s" : ""}`,
      () => `${cwd()}> assign ${pick(["T:", "ENV:", "CLIPS:"])} ${pick(VOL)}t`,
      () => `${cwd()}> avail`,
      () => `  chip ${Math.floor(rnd(180, 512))}K   fast ${Math.floor(rnd(1024, 8192))}K`,
      () => { const e = pick(DOSERR); return `${pick(VOL)} ERROR ${e[0]}  ${e[1]}`; }
    ];
    const cwd = () => `1.${pick(VOL)}`;
    let i = 0;
    return () => SCRIPT[i++ % SCRIPT.length]();
  })()
};
