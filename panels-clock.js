// AmigaTerm — CHRONO panel. Real wall-clock time, real date, real session
// uptime, and real world clocks for the cities the news map plots.
//
// Everything here is genuine — no simulated drift, no fake sync status. It
// pairs with the world map: when NEWS WATCH puts a story on Kyiv, the panel
// is already telling you what time it is there.
//
// Wall-clock formatting is recomputed only when the second actually ticks,
// not every frame. Intl.DateTimeFormat is expensive enough that building one
// per frame would show up in a profile, so the formatters are module-scope
// singletons and the rendered strings are cached between ticks.

const AMBER = "#FFB627";
const HI = "#FFE9B0";
const DIM = "#8A6212";

/* Cities match the world map's CITY table so the two panels agree. */
const ZONES = [
  ["KYIV", "Europe/Kyiv"],
  ["MOSCOW", "Europe/Moscow"],
  ["LONDON", "Europe/London"],
  ["WASHNGTN", "America/New_York"],
  ["TOKYO", "Asia/Tokyo"]
];

const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY",
              "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/* Built once. A bad IANA zone name throws here rather than mid-render, and
   the entry is dropped — a missing world clock beats a broken panel. */
const FMT = [];
for (const [label, tz] of ZONES) {
  try {
    FMT.push({
      label,
      fmt: new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false
      })
    });
  } catch (e) { /* zone unknown on this platform: skip it */ }
}

const pad = (n) => (n < 10 ? "0" + n : String(n));

/* Cache: only rebuilt when the wall-clock second changes. */
let lastSec = -1;
let cache = { time: "--:--:--", date: "", day: "", zones: [] };

function refresh(now) {
  const s = Math.floor(now.getTime() / 1000);
  if (s === lastSec) return;
  lastSec = s;
  cache.time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  // Workbench-style date, e.g. 05-SEP-26
  cache.date = `${pad(now.getDate())}-${MONTHS[now.getMonth()]}-${String(now.getFullYear()).slice(2)}`;
  cache.day = DAYS[now.getDay()];
  cache.zones = FMT.map((z) => {
    try { return [z.label, z.fmt.format(now)]; }
    catch (e) { return [z.label, "--:--"]; }
  });
}

/* Session uptime. System uptime lives in the main process (sysprobe pushes
   it over IPC); this is honestly labelled SESSION so the two are never
   confused. performance.now() is monotonic, so it survives a clock change. */
const T0 = typeof performance !== "undefined" ? performance.now() : 0;

function uptimeString() {
  const ms = (typeof performance !== "undefined" ? performance.now() : 0) - T0;
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

export function paintChrono(ctx, w, h) {
  const now = new Date();
  refresh(now);

  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = "top";

  // big local time, scaled to the panel so it fits at either size
  const big = Math.max(14, Math.min(34, Math.floor(w / 8.6)));
  ctx.font = `${big}px monospace`;
  ctx.fillStyle = HI;
  ctx.fillText(cache.time, 8, 6);

  ctx.font = "11px monospace";
  ctx.fillStyle = AMBER;
  ctx.fillText(cache.date, 8, big + 10);
  ctx.fillStyle = DIM;
  ctx.fillText(cache.day, 8, big + 24);

  // session uptime, right-aligned against the date row
  ctx.fillStyle = DIM;
  const up = "UP " + uptimeString();
  ctx.fillText(up, Math.max(8, w - 8 - up.length * 6.2), big + 10);

  // world clocks, two columns, only as many rows as actually fit
  const rowY = big + 42;
  const rowH = 13;
  const fit = Math.max(0, Math.floor((h - rowY - 2) / rowH));
  ctx.font = "11px monospace";
  for (let i = 0; i < cache.zones.length && i < fit * 2; i++) {
    const [label, val] = cache.zones[i];
    const col = i % 2, row = (i / 2) | 0;
    const x = 8 + col * (w / 2 - 4);
    const y = rowY + row * rowH;
    if (y + rowH > h) break;
    ctx.fillStyle = DIM;
    ctx.fillText(label, x, y);
    ctx.fillStyle = AMBER;
    ctx.fillText(val, x + 62, y);
  }
}

export const CLOCK_PANELS = {
  chrono: { title: "CHRONO", kind: "canvas", paint: paintChrono, grow: 0, h: 128 }
};

/* Slotted into the calmer scenarios — a clock is reference, not spectacle. */
export const CLOCK_LAYOUTS = {
  idle: [["chrono", "nettrace"], ["chrono", "deepspace"]],
  net:  [["chrono", "globe"]],
  think:[["chrono", "neurallink"]]
};
