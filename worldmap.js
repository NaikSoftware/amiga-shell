/* worldmap.js — the 64x32 world, and the painter that draws it.
   Ported verbatim from prototype.html: land mask, region table, city
   coordinates, and the situation-display painter with its ICBM arcs,
   impact rings and blinking target reticles.
   No DOM lookups here beyond the canvas it is handed — missions.js owns
   the mission bar, this file only knows how to paint into a 2D context. */

export const MAPW = 64, MAPH = 32;

/* 64x32 equirectangular land mask, stored as per-row column spans.
   Deliberately coarse — at CRT scale it reads as continents, and the
   whole grid fits in a dozen lines instead of a bundled dataset.
   ponytail: hand-sketched land mask, swap for real coastline data
   only if someone actually complains it's wrong. */
const LAND = {
  1:[[8,20],[22,27],[48,52]],
  2:[[6,21],[21,28],[33,34],[40,62]],
  3:[[3,8],[8,21],[22,27],[33,36],[37,64]],
  4:[[2,8],[8,22],[23,27],[30,31],[33,37],[37,64]],
  5:[[2,7],[7,22],[32,37],[37,64]],
  6:[[7,22],[30,31],[32,38],[38,64]],
  7:[[9,21],[31,39],[39,60],[59,60]],
  8:[[10,20],[30,36],[36,41],[41,50],[50,57]],
  9:[[10,20],[30,38],[40,45],[45,57]],
  10:[[11,19],[29,40],[40,43],[44,48],[48,57]],
  11:[[13,18],[28,40],[40,44],[44,49],[50,55]],
  12:[[14,17],[18,19],[28,40],[40,44],[44,49],[49,53],[55,56]],
  13:[[15,18],[28,42],[44,48],[49,54],[55,56]],
  14:[[17,22],[28,43],[47,48],[50,54],[55,56]],
  15:[[17,25],[28,42],[49,57]],
  16:[[17,26],[30,41],[50,58],[58,59]],
  17:[[18,27],[30,40],[50,58],[58,60]],
  18:[[18,27],[31,40],[40,41],[53,59]],
  19:[[18,27],[31,39],[40,41],[52,60]],
  20:[[19,26],[32,38],[40,41],[52,60]],
  21:[[19,24],[33,37],[52,60]],
  22:[[19,23],[34,36],[53,59],[62,63]],
  23:[[19,22],[62,63]],
  24:[[19,22],[62,63]],
  25:[[20,21]],
  28:[[0,64]],29:[[0,64]],30:[[0,64]],31:[[0,64]]
};

export const landGrid = Array.from({length:MAPH}, () => new Array(MAPW).fill(0));
for (const r in LAND) for (const [a,b] of LAND[r])
  for (let c = a; c < b && c < MAPW; c++) landGrid[r][c] = 1;

export const REGIONS = [
  {n:"ANTARCTICA",    r:[27,32], c:[0,64]},
  {n:"NORTH-AMERICA", r:[0,15],  c:[0,28]},
  {n:"SOUTH-AMERICA", r:[13,27], c:[14,29]},
  {n:"EUROPE",        r:[1,11],  c:[29,41]},
  {n:"AFRICA",        r:[9,24],  c:[26,44]},
  {n:"ASIA",          r:[0,17],  c:[40,64]},
  {n:"OCEANIA",       r:[14,27], c:[46,64]}
];

export function regionOf(r,c){
  for (const g of REGIONS)
    if (r >= g.r[0] && r < g.r[1] && c >= g.c[0] && c < g.c[1]) return g.n;
  return "OCEANIA";
}

export const CITY = {
  MOSCOW:[55.7,37.6], KYIV:[50.4,30.5], LONDON:[51.5,-0.1],
  WASHINGTON:[38.9,-77.0], BEIJING:[39.9,116.4], PYONGYANG:[39.0,125.7],
  TEHRAN:[35.7,51.4], "CHEYENNE MTN":[38.7,-104.8], VANDENBERG:[34.7,-120.6],
  BERLIN:[52.5,13.4], TOKYO:[35.7,139.7], CANBERRA:[-35.3,149.1],
  "DIEGO GARCIA":[-7.3,72.4], BRASILIA:[-15.8,-47.9]
};

function mapGeom(w,h){
  const cs = Math.min(w/MAPW, h/MAPH);
  return {cs, ox:(w - cs*MAPW)/2, oy:(h - cs*MAPH)/2};
}
function ll2xy(lat,lon,g){
  return [g.ox + ((lon+180)/5.625)*g.cs, g.oy + ((90-lat)/5.625)*g.cs];
}
const blank = () => ({targets:[], links:[], strikes:[], rings:[], sub:"NORAD / DEFCON 5"});

/* createMap(canvas) -> the situation display.
   `deleted` is a live Set of region names; missions add to it to make a
   continent vanish and clear it to restore from the floppy backup. */
export function createMap(canvas){
  const ctx = canvas.getContext("2d");
  const deleted = new Set();
  let state = blank();

  function resize(){
    const box = canvas.parentElement;
    if (!box) return;
    const r = box.getBoundingClientRect();
    canvas.width  = Math.max(80, Math.floor(r.width));
    canvas.height = Math.max(60, Math.floor(r.height));
  }

  /* paint(t, onImpact) — t is seconds since the HUD started.
     onImpact(name) fires once per warhead arrival so the caller can
     punctuate it with effects.glitch(). */
  function paint(t, onImpact){
    const w = canvas.width, h = canvas.height;
    if (!w) return;
    const g = mapGeom(w,h);
    ctx.clearRect(0,0,w,h);

    // ocean dot grid + land cells
    for (let r = 0; r < MAPH; r++){
      for (let c = 0; c < MAPW; c++){
        const x = g.ox + c*g.cs, y = g.oy + r*g.cs;
        if (landGrid[r][c]){
          if (deleted.has(regionOf(r,c))){
            ctx.fillStyle = "rgba(255,60,60,.16)";
            ctx.fillRect(x + g.cs*.35, y + g.cs*.35, Math.max(1,g.cs*.3), Math.max(1,g.cs*.3));
          } else {
            ctx.fillStyle = "rgba(255,182,39,.62)";
            ctx.fillRect(x, y, Math.max(1,g.cs-.6), Math.max(1,g.cs-.6));
          }
        } else if ((r+c) % 2 === 0){
          ctx.fillStyle = "rgba(255,182,39,.10)";
          ctx.fillRect(x + g.cs*.4, y + g.cs*.4, 1, 1);
        }
      }
    }

    // static links (breach routes)
    ctx.lineWidth = 1;
    state.links.forEach(l => {
      if (!CITY[l.from] || !CITY[l.to]) return;
      const a = ll2xy(...CITY[l.from], g), b = ll2xy(...CITY[l.to], g);
      const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2 - Math.hypot(b[0]-a[0], b[1]-a[1])*.28;
      ctx.strokeStyle = "rgba(255,233,176,.75)";
      ctx.setLineDash([4,3]);
      ctx.lineDashOffset = -t*22;
      ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.quadraticCurveTo(mx,my,b[0],b[1]); ctx.stroke();
      ctx.setLineDash([]);
    });

    // ICBM arcs — a quadratic bezier drawn out to the flight progress
    state.strikes.forEach(s => {
      if (!CITY[s.from] || !CITY[s.to]) return;
      const p = Math.max(0, Math.min(1, (t - s.t0) / s.dur));
      if (p <= 0) return;
      const a = ll2xy(...CITY[s.from], g), b = ll2xy(...CITY[s.to], g);
      const d = Math.hypot(b[0]-a[0], b[1]-a[1]);
      const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2 - d*.45;
      const qx = (u) => (1-u)*(1-u)*a[0] + 2*(1-u)*u*mx + u*u*b[0];
      const qy = (u) => (1-u)*(1-u)*a[1] + 2*(1-u)*u*my + u*u*b[1];

      ctx.strokeStyle = "rgba(255,68,68,.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(a[0],a[1]);
      for (let u = 0; u <= p; u += .02) ctx.lineTo(qx(u), qy(u));
      ctx.stroke();
      ctx.lineWidth = 1;

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(qx(p)-2, qy(p)-2, 4, 4);

      if (p >= 1 && !s.hit){
        s.hit = true;
        state.rings.push({x:b[0], y:b[1], t0:t});
        if (onImpact) onImpact(s.to);
      }
    });

    // impact rings
    state.rings = state.rings.filter(r => t - r.t0 < 1.6);
    state.rings.forEach(r => {
      const p = (t - r.t0) / 1.6;
      ctx.strokeStyle = `rgba(255,68,68,${(1-p).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, p*38, 0, Math.PI*2); ctx.stroke();
      ctx.lineWidth = 1;
    });

    // targets
    const blinkOn = Math.sin(t*7) > 0;
    ctx.font = "10px monospace";
    state.targets.forEach(name => {
      if (!CITY[name]) return;
      const [x,y] = ll2xy(...CITY[name], g);
      ctx.strokeStyle = blinkOn ? "#FF4444" : "rgba(255,68,68,.35)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x-6,y); ctx.lineTo(x+6,y);
      ctx.moveTo(x,y-6); ctx.lineTo(x,y+6); ctx.stroke();
      ctx.strokeRect(x-4.5, y-4.5, 9, 9);
      ctx.lineWidth = 1;
      ctx.fillStyle = "#FFE9B0";
      ctx.fillText(name, x + 9, y + 3);
    });
  }

  return {
    deleted,
    get state(){ return state; },
    reset(s){ state = Object.assign(blank(), s || {}); deleted.clear(); },
    addStrike(st, t0){ state.strikes.push({...st, t0, hit:false}); },
    clearStrikes(){ state.strikes = []; state.rings = []; },
    resize, paint
  };
}
