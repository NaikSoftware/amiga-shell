/* panels-extra.js — more instruments for the theater column.

   Same two panel shapes hud.js already builds:
     {title, kind:"lines",  gen:"<key in GENERATORS>", rate:<ms>}
     {title, kind:"canvas", paint:fn, grow:0, h:<px>}

   The `lines` panels here feed on EXTRA_GENERATORS from missions-extra.js,
   so hud.js must merge that in before mounting them.

   Painters are called as paint(ctx, w, h, t, load) from the rAF loop, next
   to a live terminal, so the house rules are: no allocation inside the
   loop, no shadowBlur, no filter, no per-frame arrays. Anything that needs
   state keeps it in a module-level typed array, the way BLIPS does in
   hud.js. Palette is the HUD's: #FFB627 amber, #FFE9B0 highlight. */

/* ── Boing Ball — the 1984 Amiga demo, restyled into the HUD's amber ───

   Tessellation is 12 longitudes x 6 latitudes. At the real panel size
   (290x130) the ball is 78px across, so the visible hemisphere is six 30°
   columns: ~19px at the centre, ~14px next, ~5px at the limb, and the
   latitude bands measure the same. 16x8 — what the demo itself used, on a
   ball twice this size — puts the limb column at 2px and the checker starts
   to shimmer; 20x20 is a grey haze.

   Vertex and face-normal tables are built once. The paint loop costs two
   trig calls a frame (the spin) and multiplies after that: no allocation, no
   clip, no gradient, no shadowBlur. */

const TAU = Math.PI*2;
const B_LAT = 6, B_LON = 12, B_ROW = B_LON + 1;
// axis tilt: pole leaning right and a little toward the viewer, as in the demo
const B_CP = Math.cos(.26), B_SP = Math.sin(.26);
const B_CR = Math.cos(-.28), B_SR = Math.sin(-.28);

const B_SLAT = new Float32Array(B_LAT+1), B_CLAT = new Float32Array(B_LAT+1);
const B_SLON = new Float32Array(B_ROW),   B_CLON = new Float32Array(B_ROW);
const B_MS = new Float32Array(B_LON),     B_MC = new Float32Array(B_LON);
const B_ZC = new Float32Array(B_LAT),     B_ZS = new Float32Array(B_LAT);
const B_U  = new Float32Array(B_ROW),     B_V  = new Float32Array(B_ROW);
const B_MV = new Float32Array(B_LON);
const B_VX = new Float32Array((B_LAT+1)*B_ROW);
const B_VY = new Float32Array((B_LAT+1)*B_ROW);
{
  for (let i = 0; i <= B_LAT; i++){
    const a = Math.PI*i/B_LAT; B_SLAT[i] = Math.sin(a); B_CLAT[i] = Math.cos(a);
  }
  for (let j = 0; j < B_ROW; j++){
    const a = TAU*j/B_LON; B_SLON[j] = Math.sin(a); B_CLON[j] = Math.cos(a);
  }
  for (let j = 0; j < B_LON; j++){
    const a = TAU*(j+.5)/B_LON; B_MS[j] = Math.sin(a); B_MC[j] = Math.cos(a);
  }
  // depth of each cell's own centre normal, split into its i and j halves so
  // the cull inside the loop is one multiply-add
  for (let i = 0; i < B_LAT; i++){
    const a = Math.PI*(i+.5)/B_LAT;
    B_ZC[i] = Math.cos(a)*B_SP; B_ZS[i] = Math.sin(a)*B_CP;
  }
}

function paintBoing(ctx,w,h,t){
  ctx.clearRect(0,0,w,h);

  /* the room: the demo's flat grid wall, with the floor line it bounces on */
  const floorY = h - h*.06 - 2;
  const cell = floorY/5;
  const cols = Math.max(3, Math.min(24, Math.round(w/cell)));
  ctx.strokeStyle = "rgba(255,182,39,.13)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++){ const y = floorY*i/5 + .5; ctx.moveTo(0,y); ctx.lineTo(w,y); }
  for (let i = 0; i <= cols; i++){ const x = (w*i/cols|0) + .5; ctx.moveTo(x,0); ctx.lineTo(x,floorY); }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,182,39,.34)";
  ctx.beginPath(); ctx.moveTo(0,floorY+.5); ctx.lineTo(w,floorY+.5); ctx.stroke();

  /* motion: a long calm traverse, a bounce that lands on the floor line,
     and a squash that only exists in the last moment before contact */
  const r    = Math.min(h*.30, w*.16);
  const hop  = Math.abs(Math.sin(t*1.15));
  const q    = .13*Math.max(0, 1 - hop*7);
  const rx   = r*(1 + q*.8), ry = r*(1 - q);
  const span = Math.max(0, w - 2*r - 8);
  const cx   = r + 4 + span*(.5 + .5*Math.sin(t*.42));
  const cy   = floorY - ry - Math.max(0, floorY - 2*r - 5)*.55*hop;
  const spin = cx/r;            // spins with travel, so it reverses at the ends

  const sh = 1 - hop*.45;
  ctx.fillStyle = "rgba(255,182,39,.10)";
  ctx.beginPath(); ctx.ellipse(cx, floorY, rx*.92*sh, r*.20*sh, 0, 0, TAU); ctx.fill();

  /* sphere: rotate the longitude tables by `spin`, project every vertex once */
  const cs = Math.cos(spin), sn = Math.sin(spin);
  for (let j = 0; j < B_ROW; j++){
    B_U[j] = B_CLON[j]*cs - B_SLON[j]*sn;
    B_V[j] = B_SLON[j]*cs + B_CLON[j]*sn;
  }
  for (let j = 0; j < B_LON; j++) B_MV[j] = B_MS[j]*cs + B_MC[j]*sn;
  for (let i = 0; i <= B_LAT; i++){
    const sl = B_SLAT[i], cl = B_CLAT[i], o = i*B_ROW;
    for (let j = 0; j < B_ROW; j++){
      const x = sl*B_U[j], z = sl*B_V[j];
      const y1 = cl*B_CP - z*B_SP;
      B_VX[o+j] = cx + (x*B_CR - y1*B_SR)*rx;
      B_VY[o+j] = cy - (x*B_SR + y1*B_CR)*ry;
    }
  }

  ctx.fillStyle = "#8A6212";
  ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,TAU); ctx.fill();
  ctx.fillStyle = "#FFB627";
  for (let i = 0; i < B_LAT; i++){
    const o = i*B_ROW, p = o + B_ROW, zc = B_ZC[i], zs = B_ZS[i];
    for (let j = i & 1; j < B_LON; j += 2){
      if (zc + zs*B_MV[j] <= 0) continue;                 // back face
      ctx.beginPath();
      ctx.moveTo(B_VX[o+j],   B_VY[o+j]);
      ctx.lineTo(B_VX[o+j+1], B_VY[o+j+1]);
      ctx.lineTo(B_VX[p+j+1], B_VY[p+j+1]);
      ctx.lineTo(B_VX[p+j],   B_VY[p+j]);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(255,233,176,.45)";
  ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,TAU); ctx.stroke();
}

/* ── plasma — three summed sines, quantised to three amber ramps ────── */

const PLASMA_RAMP = ["rgba(255,182,39,.12)","rgba(255,182,39,.42)","rgba(255,233,176,.85)"];

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

/* ── spectrum analyser — 24 bars with peak caps, state in a typed array ─ */

const SPEC = new Float32Array(24);

function paintSpectrum(ctx,w,h,t,load){
  ctx.clearRect(0,0,w,h);
  const n = SPEC.length, bw = w/n, k = load === undefined ? 1 : .25 + load*.75;
  for (let i = 0; i < n; i++){
    const target = Math.abs(Math.sin(t*(1.1 + i*.13) + i*1.7)) * (1 - i/n*.55) * k;
    SPEC[i] += (target - SPEC[i]) * .25;
    const bh = Math.max(1, SPEC[i]*(h-6));
    ctx.fillStyle = i & 1 ? "#FFB627" : "rgba(255,182,39,.62)";
    ctx.fillRect(i*bw + 1, h - bh - 2, bw - 2, bh);
    ctx.fillStyle = "#FFE9B0";
    ctx.fillRect(i*bw + 1, h - bh - 4, bw - 2, 2);
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
  boing:      {title:"BOING",        kind:"canvas", paint:paintBoing,    grow:0, h:128},
  plasma:     {title:"PLASMA",       kind:"canvas", paint:paintPlasma,   grow:0, h:104},
  helix:      {title:"HELIX",        kind:"canvas", paint:paintHelix,    grow:0, h:112},
  spectrum:   {title:"SPECTRUM",     kind:"canvas", paint:paintSpectrum, grow:0, h:96},
  vitals:     {title:"VITALS",       kind:"canvas", paint:paintEkg,      grow:0, h:92},
  vectors:    {title:"VECTOR CUBE",  kind:"canvas", paint:paintCube,     grow:0, h:128}
};

/* Additional rotations, keyed by the same scenario names hud.js uses.
   Concatenate onto LAYOUTS[key] rather than replacing it — these mix new
   panels with D's existing ones on purpose, so the column never reads as
   two disconnected halves. */
export const EXTRA_LAYOUTS = {
  idle:  [["deepspace","boing"], ["codegen","boing"], ["boing","doserr"], ["plasma","telegram","subsystems"], ["vitals","lift","nettrace"]],
  think: [["codegen","subsystems"], ["helix","genome"], ["plasma","neurallink","subsystems"], ["vectors","stacktrace"]],
  read:  [["genome","sectordump","subsystems"], ["elements","fswalk"], ["ledger","diskio"]],
  edit:  [["codegen","diskio"], ["stacktrace","sectordump"], ["reagents","doserr","scope"], ["vectors","fswalk"]],
  bash:  [["rods","daemons","subsystems"], ["stacktrace","spectrum"], ["doserr","nettrace","boing"]],
  net:   [["deepspace","globe"], ["elements","packets","spectrum"], ["ledger","globe"], ["telegram","radar"]],
  task:  [["deepspace","radar","subsystems"], ["rods","vitals","daemons"], ["spectrum","subsystems","plasma"], ["helix","radar"]]
};
