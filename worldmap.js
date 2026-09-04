/* worldmap.js — the 64x32 world, and the painter that draws it.
   Land mask ported verbatim from prototype.html; the display on top of it is
   NEWS WATCH: real geolocated headlines pushed from main.js, amber diamonds
   with one label on screen at a time and a trace arc between consecutive
   stories.

   No DOM here at all — not even a canvas. paintWorldMap() has exactly the
   signature every other HUD canvas painter has, so the map is an ordinary
   `kind:"canvas"` panel: hud.js owns the element, builds it on mount and
   drops it on unmount, and the map has no lifecycle of its own to leak. */

const MAPW = 64, MAPH = 32;

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

const landGrid = Array.from({length:MAPH}, () => new Array(MAPW).fill(0));
for (const r in LAND) for (const [a,b] of LAND[r])
  for (let c = a; c < b && c < MAPW; c++) landGrid[r][c] = 1;

/* ── live news markers ──────────────────────────────────────────────────
   Real geolocated headlines, pushed from main.js via hud.js. Module-level
   rather than per-panel state: the feed arrives in hud.js, the map panel can
   mount and unmount underneath it, and neither needs a handle on the other.
   ponytail: single-map assumption; key it per panel if two ever mount. */
let newsMarkers = [];
const NEWS_DWELL = 20;
/* Trace arcs. When the "now showing" story rotates, a trajectory flies from
   the previous story's location to the new one. Purely visual; holds at most
   a handful of entries and drops them once they land. */
const NEWS_ARC_DUR = 2.6;
let newsArcs = [], newsLastCur = -1;                        // seconds per story on the label

/* Replaces the marker set. Coordinates arrive already clamped from main.js's
   parser; what is left is map-specific — drop a story that would land on top
   of one we already kept, because at 64x32 two overlapping reticles read as
   one broken one. One grid cell is 5.625 deg on both axes, so 6 keeps every
   surviving marker at least a cell from its neighbour. Labels cannot collide
   by construction — only one is on screen at a time. */
export function setNewsMarkers(list){
  const out = [];
  if (Array.isArray(list)) for (const m of list){
    if (out.length >= 7) break;
    const lat = Number(m && m.lat), lon = Number(m && m.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const la = Math.max(-90, Math.min(90, lat));
    const lo = Math.max(-180, Math.min(180, lon));
    if (out.some(p => Math.abs(p.lat - la) < 6 && Math.abs(p.lon - lo) < 6)) continue;
    const place = String((m && m.place) || "").slice(0,12);
    const summary = String((m && m.summary) || "").slice(0,44);
    if (!place) continue;
    // label built once, here, so the painter never allocates a string
    out.push({lat:la, lon:lo, place, label: summary ? place + ": " + summary : place});
  }
  newsMarkers = out;
  newsArcs = []; newsLastCur = -1;
}

export const newsMarkerCount = () => newsMarkers.length;
export function currentNewsMarker(t){
  if (!newsMarkers.length) return null;
  return newsMarkers[Math.floor(Math.max(0,t) / NEWS_DWELL) % newsMarkers.length];
}

/* NEWS WATCH markers: amber diamonds with a slow breath, and exactly one
   label on screen at a time, stepping through the stories every NEWS_DWELL
   seconds. Nothing in here allocates — colours are literals, alpha rides
   globalAlpha, and the label string was built when the markers arrived. */
/* Amber trajectory between two news markers: a quadratic bezier drawn out to
   flight progress, a bright head at the tip, and an expanding ring on
   arrival. */
function paintNewsArcs(ctx, g, t){
  if (!newsArcs.length) return;
  const xy = (m) => [ g.ox + ((m.lon+180)/5.625)*g.cs,
                      g.oy + ((90-m.lat)/5.625)*g.cs ];
  for (let i = newsArcs.length - 1; i >= 0; i--){
    const s = newsArcs[i];
    const p = Math.min(1, (t - s.t0) / NEWS_ARC_DUR);
    if (p <= 0) continue;
    const a = xy(s.a), b = xy(s.b);
    const d = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2 - d*.45;
    const qx = (u) => (1-u)*(1-u)*a[0] + 2*(1-u)*u*mx + u*u*b[0];
    const qy = (u) => (1-u)*(1-u)*a[1] + 2*(1-u)*u*my + u*u*b[1];

    // the trail fades once it has landed, so old arcs retire on their own
    const age = (t - s.t0) - NEWS_ARC_DUR;
    const fade = age <= 0 ? 1 : Math.max(0, 1 - age / 2.2);
    if (fade <= 0){ newsArcs.splice(i, 1); continue; }

    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#FFB627";
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]);
    for (let u = 0; u <= p; u += .02) ctx.lineTo(qx(u), qy(u));
    ctx.stroke();

    if (p < 1){
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(qx(p)-2, qy(p)-2, 4, 4);
    } else if (!s.hit){
      s.hit = true; s.ringAt = t;
    }
    if (s.hit){
      const rp = (t - s.ringAt) / 1.4;
      if (rp < 1){
        ctx.globalAlpha = fade * (1 - rp);
        ctx.strokeStyle = "#FFE9B0";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b[0], b[1], rp*30, 0, Math.PI*2); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }
}

function paintNews(ctx, g, t, w, h){
  if (!newsMarkers.length) return;
  const pulse = .55 + .45*Math.sin(t*1.8);
  const cur = Math.floor(Math.max(0,t) / NEWS_DWELL) % newsMarkers.length;

  // rotation fires a trace from the story we were on to the one we move to
  if (cur !== newsLastCur){
    if (newsLastCur >= 0 && newsMarkers[newsLastCur])
      newsArcs.push({ a: newsMarkers[newsLastCur], b: newsMarkers[cur], t0: t, hit: false });
    newsLastCur = cur;
    if (newsArcs.length > 4) newsArcs.shift();
  }
  paintNewsArcs(ctx, g, t);

  ctx.font = "10px monospace";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < newsMarkers.length; i++){
    const m = newsMarkers[i];
    const x = g.ox + ((m.lon+180)/5.625)*g.cs;
    const y = g.oy + ((90-m.lat)/5.625)*g.cs;
    const on = i === cur;

    ctx.globalAlpha = on ? pulse : .45;
    ctx.strokeStyle = "#FFB627";
    ctx.beginPath();
    ctx.moveTo(x, y-4.5); ctx.lineTo(x+4.5, y);
    ctx.lineTo(x, y+4.5); ctx.lineTo(x-4.5, y);
    ctx.closePath(); ctx.stroke();
    if (!on) continue;

    ctx.beginPath(); ctx.arc(x, y, 6 + pulse*3, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#FFE9B0";
    ctx.fillRect(x-1.5, y-1.5, 3, 3);

    /* Label placement: to the right of the marker, flipped to the left when
       it would run off the edge, then clamped into the canvas either way.
       ponytail: width estimated at 6px/char rather than measured — exact
       enough for 10px monospace, and it keeps measureText (and the
       TextMetrics object it allocates) out of the render path. */
    const tw = m.label.length * 6;
    let lx = x + 9;
    if (lx + tw > w - 2) lx = x - 9 - tw;
    if (lx < 2) lx = 2;
    const ly = Math.max(11, Math.min(h - 3, y + 3));
    ctx.globalAlpha = .62;
    ctx.fillStyle = "#000000";
    ctx.fillRect(lx - 2, ly - 9, tw + 4, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#FFE9B0";
    ctx.fillText(m.label, lx, ly);
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

function mapGeom(w,h){
  const cs = Math.min(w/MAPW, h/MAPH);
  return {cs, ox:(w - cs*MAPW)/2, oy:(h - cs*MAPH)/2};
}
/* paintWorldMap(ctx, w, h, t) — the HUD's standard canvas painter signature,
   so this drops into the panel registry like any other instrument. Draws the
   ocean dot grid and the land cells, then whatever NEWS WATCH has. With no
   headlines yet it is simply a world map, which reads fine on its own. */
export function paintWorldMap(ctx, w, h, t){
  if (!w || !h) return;
  const g = mapGeom(w, h);
  ctx.clearRect(0, 0, w, h);

  for (let r = 0; r < MAPH; r++){
    for (let c = 0; c < MAPW; c++){
      const x = g.ox + c*g.cs, y = g.oy + r*g.cs;
      if (landGrid[r][c]){
        ctx.fillStyle = "rgba(255,182,39,.62)";
        ctx.fillRect(x, y, Math.max(1,g.cs-.6), Math.max(1,g.cs-.6));
      } else if ((r+c) % 2 === 0){
        ctx.fillStyle = "rgba(255,182,39,.10)";
        ctx.fillRect(x + g.cs*.4, y + g.cs*.4, 1, 1);
      }
    }
  }

  paintNews(ctx, g, t, w, h);
}
