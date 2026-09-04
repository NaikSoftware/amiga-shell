/* panels-extra.js — more instruments for the theater column.

   Same two panel shapes hud.js already builds:
     {title, kind:"lines",  gen:"<key in GENERATORS>", rate:<ms>}
     {title, kind:"canvas", paint:fn, grow:0, h:<px>}

   The `lines` panels here feed on EXTRA_GENERATORS from missions-extra.js,
   so hud.js must merge that in before mounting them.

   Painters are called as paint(ctx, w, h, t, load, mic) from the rAF loop.
   `mic` is hud.js's microphone singleton — getFreq()/getWave() give back a
   reused Uint8Array when a real stream is running and null otherwise, which
   is the default. A painter that ignores it just stays fiction. Next
   to a live terminal, so the house rules are: no allocation inside the
   loop, no shadowBlur, no filter, no per-frame arrays. Anything that needs
   state keeps it in a module-level typed array, the way BLIPS does in
   hud.js. Palette is the HUD's: #FFB627 amber, #FFE9B0 highlight. */

function paintIntercept(ctx, w, h, t) {
  /* SIGINT waterfall: frequency across, time scrolling down, brightness =
     signal strength. Unambiguous — it reads as "something is intercepting
     traffic" at a glance, which a bouncing ball did not.

     Scrolls by copying the canvas onto itself one row down and drawing only
     the new top row, so cost is one drawImage plus ~60 fillRects per step
     regardless of panel size. Steps every 3rd frame; at 60fps a per-frame
     scroll is faster than the eye wants and burns fill rate.
     ponytail: module-level state assumes one mounted instance, which the
     layout tables guarantee. Key it per-panel if that ever stops holding. */
  const COLS = 64;
  if (!paintIntercept.last) paintIntercept.last = 0;
  const step = (t * 20) | 0;
  const scroll = step !== paintIntercept.last;
  paintIntercept.last = step;

  if (!scroll) return;

  // shift everything down one row, then paint the newest scan line on top
  ctx.drawImage(ctx.canvas, 0, 1);
  const cw = w / COLS;
  for (let i = 0; i < COLS; i++) {
    const f = i / COLS;
    // three drifting carriers plus a noise floor
    let v = 0.10
      + 0.55 * Math.exp(-((f - 0.22 - 0.05 * Math.sin(t * 0.7)) ** 2) * 400)
      + 0.40 * Math.exp(-((f - 0.55 + 0.04 * Math.sin(t * 1.1)) ** 2) * 900)
      + 0.30 * Math.exp(-((f - 0.80) ** 2) * 250) * (0.5 + 0.5 * Math.sin(t * 3))
      + Math.random() * 0.16;
    if (v > 1) v = 1;
    ctx.fillStyle = v > 0.72 ? "#FFE9B0"
                  : v > 0.45 ? "#FFB627"
                  : v > 0.26 ? "#8A6212"
                  : v > 0.15 ? "#3A2A08" : "#0A0A06";
    ctx.fillRect(i * cw, 0, cw + 0.6, 1);
  }
  // frequency ruler pinned to the bottom edge
  ctx.fillStyle = "rgba(255,182,39,.30)";
  for (let i = 0; i <= 8; i++) ctx.fillRect((w / 8) * i, h - 3, 1, 3);
}

/* Three-step amber ramp. paintPlasma referenced this and it did not exist,
   so the panel threw on its first frame and took the whole rAF loop with it. */
const PLASMA_RAMP = ["#3A2A08", "#8A6212", "#FFB627"];

function paintPlasma(ctx,w,h,t){
  const cell = 12;                       // coarse on purpose: 1985 called
  const cols = Math.ceil(w/cell), rows = Math.ceil(h/cell);
  for (let r = 0; r < rows; r++){
    const y = r*cell;
    for (let c = 0; c < cols; c++){
      const v = Math.sin(c*.42 + t*1.7) + Math.sin(r*.55 - t*1.1) + Math.sin((c+r)*.31 + t*.7);
      ctx.fillStyle = PLASMA_RAMP[v > 1 ? 2 : v > -.6 ? 1 : 0];
      ctx.fillRect(c*cell, y, cell, cell);
    }
  }
}

/* ── DNA double helix, rungs every third step ───────────────────────── */

function paintHelix(ctx,w,h,t){
  ctx.clearRect(0,0,w,h);
  const n = Math.max(12, Math.min(48, Math.floor(w/7)));
  const cy = h/2, amp = h*.34, k = 6.0/n;

  ctx.strokeStyle = "rgba(255,182,39,.30)";
  ctx.beginPath();
  for (let i = 0; i <= n; i += 3){
    const p = i*k*Math.PI - t*2.2, x = w*i/n;
    ctx.moveTo(x, cy + Math.sin(p)*amp);
    ctx.lineTo(x, cy - Math.sin(p)*amp);
  }
  ctx.stroke();

  ctx.strokeStyle = "#FFB627";
  ctx.beginPath();
  for (let i = 0; i <= n; i++){
    const x = w*i/n, y = cy + Math.sin(i*k*Math.PI - t*2.2)*amp;
    i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,233,176,.85)";
  ctx.beginPath();
  for (let i = 0; i <= n; i++){
    const x = w*i/n, y = cy - Math.sin(i*k*Math.PI - t*2.2)*amp;
    i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
  }
  ctx.stroke();
}

/* ── spectrum analyser — 24 bars with falling peak caps ──────────────

   Real microphone when hud.js hands us a live analyser (`mic.getFreq()`
   returns its reused Uint8Array), the original fake maths when it hands us
   null — which is the default, and every failure case besides. Nothing here
   knows how the audio was obtained; it is passed in, so the whole panel is
   testable against a stub.

   FFT bins are linear in frequency, so a straight bin-per-bar mapping puts
   everything a human can hear in the first two bars and spends the other 22
   on inaudible hiss. The bars are log-spaced instead — same reason every
   real equaliser is drawn in octaves. */

const SPEC = new Float32Array(24);   // bar heights, 0..1, smoothed
const PEAK = new Float32Array(24);   // peak-hold caps, fall slowly

/* Room noise sits well above zero in a byte-frequency bin, so anything under
   this reads as silence and the display flattens instead of shimmering.
   Calibration knob: lower it for a quiet mic, raise it in a noisy room. */
const FREQ_FLOOR = .30;

/* Log-spaced bin edges, built once per (binCount, barCount) pair and then
   reused — this is per-frame code, it allocates nothing after the first call. */
let EDGES = null, EDGES_KEY = 0;
function logEdges(bins, n){
  const key = bins*100 + n;
  if (EDGES_KEY === key) return EDGES;
  const e = new Uint16Array(n + 1);
  // stop at ~72% of Nyquist: the top of the range is inaudible content that
  // would otherwise eat a third of the panel
  const lo = 1, hi = Math.max(lo + n, Math.min(bins, Math.round(bins*.72)));
  for (let i = 0; i <= n; i++){
    const v = Math.round(lo * Math.pow(hi/lo, i/n));
    e[i] = i && v <= e[i-1] ? e[i-1] + 1 : v;      // keep the edges increasing
  }
  EDGES = e; EDGES_KEY = key;
  return e;
}

function paintSpectrum(ctx,w,h,t,load,mic){
  ctx.clearRect(0,0,w,h);
  const n = SPEC.length, bw = w/n, k = load === undefined ? 1 : .25 + load*.75;
  const freq = mic && mic.getFreq();
  const e = freq ? logEdges(freq.length, n) : null;
  for (let i = 0; i < n; i++){
    let target;
    if (freq){
      let mx = 0;                                  // loudest bin in the octave
      for (let j = e[i]; j < e[i+1] && j < freq.length; j++)
        if (freq[j] > mx) mx = freq[j];
      target = (mx/255 - FREQ_FLOOR) / (1 - FREQ_FLOOR);
      if (target < 0) target = 0; else if (target > 1) target = 1;
    } else {
      target = Math.abs(Math.sin(t*(1.1 + i*.13) + i*1.7)) * (1 - i/n*.55) * k;
    }
    SPEC[i] += (target - SPEC[i]) * (freq ? .40 : .25);
    PEAK[i] = SPEC[i] > PEAK[i] ? SPEC[i] : Math.max(0, PEAK[i] - .006);

    const bh = Math.max(1, SPEC[i]*(h-6));
    ctx.fillStyle = i & 1 ? "#FFB627" : "rgba(255,182,39,.62)";
    ctx.fillRect(i*bw + 1, h - bh - 2, bw - 2, bh);
    ctx.fillStyle = "#FFE9B0";                     // the cap, falling on its own
    ctx.fillRect(i*bw + 1, h - Math.max(1, PEAK[i]*(h-6)) - 4, bw - 2, 2);
  }
}

/* ── EKG — PQRST built once into a 256-entry table, then just indexed.
   No transcendentals in the paint loop; the trace scrolls by phase. ─── */

const EKG = new Float32Array(256);
{
  const g = (u,c,s) => { const d = (u-c)/s; return Math.exp(-d*d); };
  for (let i = 0; i < 256; i++){
    const u = i/256;
    EKG[i] = .12*g(u,.18,.045) - .16*g(u,.30,.012) + 1.0*g(u,.34,.014)
           - .24*g(u,.38,.020) + .26*g(u,.60,.070);
  }
}

function paintEkg(ctx,w,h,t,load){
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = "rgba(255,182,39,.16)";
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();

  const bpm  = 62 + (load === undefined ? 0 : load)*78;
  const per  = 60/bpm, span = 3.0, amp = h*.38, mid = h*.55;
  ctx.strokeStyle = "#FFB627";
  ctx.beginPath();
  for (let x = 0; x < w; x += 2){
    const s = t - span + x/w*span;
    let u = (s/per) % 1; if (u < 0) u += 1;
    const y = mid - EKG[(u*256)|0]*amp;
    x ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
  }
  ctx.stroke();
  // the leading dot, where the trace is "now"
  ctx.fillStyle = "#FFE9B0";
  ctx.fillRect(w-3, mid - EKG[((t/per % 1 + 1) % 1 * 256)|0]*amp - 1.5, 3, 3);
}

/* ── rotating wireframe cube, two-axis, cheap perspective ───────────── */

const CUBE_V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const CUBE_E = [0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7];
const CX = new Float32Array(8), CY = new Float32Array(8);

function paintCube(ctx,w,h,t){
  ctx.clearRect(0,0,w,h);
  const s = Math.min(w,h)*.30, ox = w/2, oy = h/2;
  const ca = Math.cos(t*.8), sa = Math.sin(t*.8);
  const cb = Math.cos(t*.55), sb = Math.sin(t*.55);
  for (let i = 0; i < 8; i++){
    const v = CUBE_V[i];
    const x = v[0]*ca - v[2]*sa;
    let   z = v[0]*sa + v[2]*ca;
    const y = v[1]*cb - z*sb;
    z = v[1]*sb + z*cb;
    const p = 2.8/(2.8 + z);
    CX[i] = ox + x*s*p; CY[i] = oy + y*s*p;
  }
  ctx.strokeStyle = "#FFB627";
  ctx.beginPath();
  for (let e = 0; e < CUBE_E.length; e += 2){
    ctx.moveTo(CX[CUBE_E[e]],   CY[CUBE_E[e]]);
    ctx.lineTo(CX[CUBE_E[e+1]], CY[CUBE_E[e+1]]);
  }
  ctx.stroke();
  ctx.fillStyle = "#FFE9B0";
  for (let i = 0; i < 8; i++) ctx.fillRect(CX[i]-1.5, CY[i]-1.5, 3, 3);
}

/* ── registry ──────────────────────────────────────────────────────── */

export { paintSpectrum };

export const EXTRA_PANELS = {
  deepspace: {title:"DEEP SPACE NET", kind:"lines", gen:"deepSpace", rate:260},
  codegen: {title:"SOURCE codegen.c", kind:"lines", gen:"codeGen", rate:150},
  stacktrace: {title:"STACK TRACE",  kind:"lines",  gen:"stackTrace",  rate:180},
  elements:   {title:"ELEMENT SET",  kind:"lines",  gen:"tle",         rate:200},
  reagents:   {title:"REAGENTS",     kind:"lines",  gen:"chemFormula", rate:170},
  genome:     {title:"GENOME",       kind:"lines",  gen:"dnaPairs",    rate:100},
  telegram:   {title:"TELEGRAM",     kind:"lines",  gen:"telegram",    rate:260},
  ledger:     {title:"BLOCKCHAIN",   kind:"lines",  gen:"blockHash",   rate:140},
  lift:       {title:"LIFT BANK",    kind:"lines",  gen:"elevator",    rate:210},
  rods:       {title:"ROD ARRAY",    kind:"lines",  gen:"reactorRods", rate:160},
  doserr:     {title:"AmigaDOS",     kind:"lines",  gen:"amigaError",  rate:320},
  intercept:  {title:"SIGINT WATERFALL", kind:"canvas", paint:paintIntercept, grow:0, h:128},
  plasma:     {title:"PLASMA",       kind:"canvas", paint:paintPlasma,   grow:0, h:104},
  helix:      {title:"HELIX",        kind:"canvas", paint:paintHelix,    grow:0, h:112},
  spectrum:   {title:"SPECTRUM",     kind:"canvas", paint:paintSpectrum, grow:0, h:96, mic:1},
  vitals:     {title:"VITALS",       kind:"canvas", paint:paintEkg,      grow:0, h:92},
  vectors:    {title:"VECTOR CUBE",  kind:"canvas", paint:paintCube,     grow:0, h:128}
};

/* Additional rotations, keyed by the same scenario names hud.js uses.
   Concatenate onto LAYOUTS[key] rather than replacing it — these mix new
   panels with D's existing ones on purpose, so the column never reads as
   two disconnected halves. */
export const EXTRA_LAYOUTS = {
  idle:  [["deepspace","intercept"], ["codegen","intercept"], ["intercept","doserr"], ["plasma","telegram","subsystems"], ["vitals","lift","nettrace"]],
  think: [["codegen","subsystems"], ["helix","genome"], ["plasma","neurallink","subsystems"], ["vectors","stacktrace"]],
  read:  [["genome","sectordump","subsystems"], ["elements","fswalk"], ["ledger","diskio"]],
  edit:  [["codegen","diskio"], ["stacktrace","sectordump"], ["reagents","doserr","scope"], ["vectors","fswalk"]],
  bash:  [["rods","daemons","subsystems"], ["stacktrace","spectrum"], ["doserr","nettrace","intercept"]],
  net:   [["deepspace","globe"], ["elements","packets","spectrum"], ["ledger","globe"], ["telegram","radar"]],
  task:  [["deepspace","radar","subsystems"], ["rods","vitals","daemons"], ["spectrum","subsystems","plasma"], ["helix","radar"]]
};
