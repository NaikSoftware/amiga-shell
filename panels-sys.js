// AmigaTerm — panels that render ONLY real machine telemetry.
//
// Fed by sysprobe over IPC; hud.js calls setSys() as payloads arrive. Every
// field can be null, and null is drawn as "----", never as a plausible
// number. If the whole payload is missing these panels say NO TELEMETRY and
// stop, rather than degrading into the fake generators the rest of the HUD
// uses — a panel labelled CPU CORES must never show invented load.
//
// Palette is the HUD's amber; layout is sized for a ~290px column.

const AMBER = "#FFB627";
const HI = "#FFE9B0";
const DIM = "#8A6212";
const DEEP = "#3A2A08";
const WARN = "#FF6B6B";

let sys = null;
export function setSys(payload) { sys = payload || null; }

const pad2 = (n) => (n < 10 ? "0" + n : String(n));
const gb = (bytes) => (bytes / 1073741824).toFixed(1);

function noData(ctx, w, h, label) {
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px monospace";
  ctx.fillStyle = DIM;
  ctx.textBaseline = "top";
  ctx.fillText(label, 8, 8);
  return true;
}

/* ── per-core CPU ─────────────────────────────────────────────────
   One bar per core. sysprobe reports cores individually and only the
   aggregate was being drawn; on a 12-thread box the difference between
   "40% busy" and "one core pinned" is the whole story. */

// smoothed per-core values, reused across frames so nothing allocates
let coreSmooth = null;

export function paintCores(ctx, w, h) {
  const cores = sys && sys.cpu && Array.isArray(sys.cpu.cores) ? sys.cpu.cores : null;
  if (!cores || !cores.length) return void noData(ctx, w, h, "CPU: NO TELEMETRY");

  if (!coreSmooth || coreSmooth.length !== cores.length)
    coreSmooth = new Float32Array(cores.length);
  for (let i = 0; i < cores.length; i++) {
    const v = Number.isFinite(cores[i]) ? cores[i] : 0;
    coreSmooth[i] += (v - coreSmooth[i]) * 0.4;
  }

  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = "top";
  ctx.font = "10px monospace";
  ctx.fillStyle = DIM;
  const agg = sys.cpu.agg;
  ctx.fillText(`CPU ${agg == null ? "----" : Math.round(agg) + "%"}  ${cores.length} THREADS`, 8, 4);

  const colour = (v) => (v > 85 ? WARN : v > 55 ? HI : AMBER);

  /* Two layouts. The column is tall and narrow, so cores stack as rows; the
     bottom deck is wide and short, where 12 stacked rows collapse into an
     unreadable smear — there, cores stand as vertical bars side by side.
     Threshold is on aspect, not a magic width, so it holds on any window. */
  if (w > h * 2.2) {
    const padL = 8, padR = 8, top = 18, base = h - 12;
    const n = cores.length;
    const slot = (w - padL - padR) / n;
    const bw = Math.max(2, Math.floor(slot) - 2);
    const height = base - top;
    for (let i = 0; i < n; i++) {
      const x = padL + i * slot;
      const v = coreSmooth[i];
      ctx.fillStyle = DEEP;
      ctx.fillRect(x, top, bw, height);
      const bh = Math.max(1, height * v / 100);
      ctx.fillStyle = colour(v);
      ctx.fillRect(x, top + height - bh, bw, bh);
      if (slot >= 14) {                       // only label when it fits
        ctx.fillStyle = DIM;
        ctx.fillText(pad2(i), x, base + 1);
      }
    }
    return;
  }

  const padL = 8, padR = 8, top = 18, bottom = 6;
  const n = cores.length;
  const barH = Math.max(3, Math.floor((h - top - bottom) / n) - 2);
  const barW = w - padL - padR - 40;
  for (let i = 0; i < n; i++) {
    const y = top + i * (barH + 2);
    if (y + barH > h - 2) break;
    const v = coreSmooth[i];
    ctx.fillStyle = DEEP;
    ctx.fillRect(padL + 18, y, barW, barH);
    ctx.fillStyle = colour(v);
    ctx.fillRect(padL + 18, y, Math.max(1, barW * v / 100), barH);
    ctx.fillStyle = DIM;
    ctx.fillText(pad2(i), padL, y - 1);
    ctx.fillStyle = AMBER;
    ctx.fillText(String(Math.round(v)).padStart(3), w - padR - 22, y - 1);
  }
}

/* ── system vitals ────────────────────────────────────────────────
   Load average, real system uptime, memory in absolute terms, GPU memory,
   package temperature and battery — everything sysprobe already reads and
   nothing else was displaying. */

export function paintVitalsReal(ctx, w, h) {
  if (!sys) return void noData(ctx, w, h, "SYSTEM: NO TELEMETRY");

  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = "top";
  ctx.font = "12px monospace";

  const rows = [];

  if (Array.isArray(sys.load))
    rows.push(["LOAD", sys.load.map((n) => n.toFixed(2)).join(" ")]);
  else rows.push(["LOAD", "----"]);

  if (Number.isFinite(sys.uptime)) {
    const s = Math.floor(sys.uptime);
    const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600);
    rows.push(["UPTIME", d > 0 ? `${d}d ${hh}h` : `${hh}h ${Math.floor((s % 3600) / 60)}m`]);
  } else rows.push(["UPTIME", "----"]);

  if (sys.mem && Number.isFinite(sys.mem.used))
    rows.push(["MEM", `${gb(sys.mem.used)}/${gb(sys.mem.total)}G`]);
  else rows.push(["MEM", "----"]);

  if (sys.gpu && Number.isFinite(sys.gpu.memUsedMB))
    rows.push(["GPU MEM", `${sys.gpu.memUsedMB}/${sys.gpu.memTotalMB}M`]);
  else rows.push(["GPU MEM", "----"]);

  // null here is the honest answer on macOS, where there is no unprivileged
  // temperature source at all — not a reading of zero
  rows.push(["TEMP", Number.isFinite(sys.tempC) ? `${sys.tempC}C` : "----"]);

  if (sys.battery && Number.isFinite(sys.battery.pct))
    rows.push(["BATTERY", `${sys.battery.pct}% ${sys.battery.ac ? "AC" : "BATT"}`]);
  else rows.push(["BATTERY", "----"]);

  const rowH = 14;
  for (let i = 0; i < rows.length; i++) {
    const y = 6 + i * rowH;
    if (y + rowH > h) break;
    ctx.font = "10px monospace";
    ctx.fillStyle = DIM;
    ctx.fillText(rows[i][0], 8, y + 1);
    ctx.font = "12px monospace";
    ctx.fillStyle = rows[i][1] === "----" ? DEEP : AMBER;
    ctx.fillText(rows[i][1], 78, y);
  }
}

/* ── storage ──────────────────────────────────────────────────────
   Real filesystem capacity for / and $HOME, in absolute GB as well as
   percent. Same device on most boxes; drawn separately anyway because on a
   machine where they differ, that is exactly what you want to see. */

export function paintStorage(ctx, w, h) {
  const fs = sys && sys.fs;
  if (!fs || (!fs.root && !fs.home)) return void noData(ctx, w, h, "DISK: NO TELEMETRY");

  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = "top";

  const entries = [];
  if (fs.root) entries.push(["/", fs.root]);
  if (fs.home && fs.home.path !== "/") entries.push(["~", fs.home]);

  let y = 8;
  for (const [label, e] of entries) {
    if (y + 26 > h) break;
    ctx.font = "10px monospace";
    ctx.fillStyle = DIM;
    ctx.fillText(label, 8, y);
    ctx.fillStyle = AMBER;
    const txt = Number.isFinite(e.used)
      ? `${gb(e.used)}G / ${gb(e.size)}G` : "----";
    ctx.fillText(txt, 24, y);
    ctx.fillStyle = e.usedPct > 90 ? WARN : DIM;
    ctx.fillText(`${Math.round(e.usedPct)}%`, w - 34, y);

    const bw = w - 16;
    ctx.fillStyle = DEEP;
    ctx.fillRect(8, y + 12, bw, 7);
    ctx.fillStyle = e.usedPct > 90 ? WARN : e.usedPct > 75 ? HI : AMBER;
    ctx.fillRect(8, y + 12, Math.max(1, bw * Math.min(100, e.usedPct) / 100), 7);
    y += 30;
  }
}

export const SYS_PANELS = {
  cpucores: { title: "CPU CORES  LIVE", kind: "canvas", paint: paintCores,      grow: 0, h: 150 },
  sysinfo:  { title: "SYSTEM  LIVE",    kind: "canvas", paint: paintVitalsReal, grow: 0, h: 104 },
  storage:  { title: "STORAGE  LIVE",   kind: "canvas", paint: paintStorage,    grow: 0, h: 78 }
};

/* Spread across scenarios so real readouts are always somewhere in rotation
   rather than clustered into one layout you rarely see. */
export const SYS_LAYOUTS = {
  idle:  [["cpucores", "sysinfo"], ["sysinfo", "storage", "nettrace"], ["cpucores", "storage"]],
  think: [["cpucores", "neurallink"], ["sysinfo", "codegen"]],
  read:  [["storage", "sectordump"], ["sysinfo", "diskio"]],
  edit:  [["cpucores", "sectordump"], ["storage", "codegen"]],
  bash:  [["cpucores", "nettrace"], ["sysinfo", "daemons"]],
  net:   [["sysinfo", "packets"], ["cpucores", "globe"]],
  task:  [["cpucores", "daemons"], ["sysinfo", "radar"]]
};
