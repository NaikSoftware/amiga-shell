// AmigaTerm — real system telemetry for the HUD gauges.
//
// Same deal as netprobe.js: genuine facts about the machine, no root, no
// dependencies, pure parsers kept separate from the readers so they are
// testable without the box being in a particular state.
//
// Two tiers, because they cost very different amounts:
//   sample()       — os.*/statfs-free stuff plus one sysfs read. Cheap enough
//                    for 1 Hz next to a live terminal. Never spawns anything.
//   refreshSlow()  — statfs, nvidia-smi, pmset. Spawns processes, so it runs on
//                    a slower timer (5 s) and its results are cached into the
//                    payload sample() returns.
//
// EVERY field is optional and every unknown is `null` — never a plausible
// stand-in. The whole point of this module is that the panels stop being fake,
// so a figure we cannot obtain must be visibly missing.
//
// ---------------------------------------------------------------- payload ---
// sample() resolves to this shape. All keys always present; values may be null.
//
// {
//   t:      1757030400000,          // Date.now() of this sample
//   uptime: 123456.7,               // seconds, os.uptime()
//   load:   [0.71, 0.88, 0.94] | null,   // 1/5/15 min; null on Windows
//   cpu: {                          // null until the second sample (needs a delta)
//     agg:   23.4,                  // 0-100 across all cores, or null
//     cores: [12.5, 41.0, null, …]  // 0-100 per core; null where undeterminable
//   } | null,
//   mem: { total, free, used, usedPct },   // bytes + 0-100. See macOS note below.
//   tempC:  54 | null,              // CPU package °C. Linux only.
//   fs: {                           // from refreshSlow(); either may be null
//     root: { path:"/",       size, free, used, usedPct },
//     home: { path:"/home/x", size, free, used, usedPct }
//   },
//   gpu: {                          // null when there is no GPU we can read
//     source:      "nvidia" | "amd",
//     util:        20   | null,     // 0-100
//     memUsedMB:   346  | null,
//     memTotalMB:  6144 | null
//   } | null,
//   battery: { pct: 100|null, status: "Charging"|"Discharging"|"Full"|"Not charging"|"Unknown"|null,
//              ac: true|false|null } | null   // null on desktops
// }
//
// Platform reality, so consumers know what to expect rather than guessing:
//   cpu / mem / load / uptime / fs   — Linux and macOS both, always.
//   tempC                            — Linux only. macOS has no unprivileged
//                                      path (SMC needs a kext/helper), so null.
//   gpu                              — Linux only (AMD sysfs or nvidia-smi).
//                                      macOS: null, deliberately. `ioreg -l`
//                                      dumps the whole IO registry (megabytes)
//                                      and its PerformanceStatistics keys are
//                                      undocumented, differ per GPU family and
//                                      are absent entirely on Apple Silicon.
//                                      A number we cannot verify is worse than
//                                      no number. ponytail: revisit with
//                                      `ioreg -rd1 -c IOAccelerator` if someone
//                                      with a Mac can confirm the key.
//   battery                          — Linux /sys/class/power_supply/BAT*,
//                                      macOS `pmset -g batt`. null on desktops.

"use strict";

const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const { execFile } = require("child_process");

// os.cpus() is [] in some containers; without it there is no core loop at all.
const AVAILABLE = Array.isArray(os.cpus()) && os.cpus().length > 0;

const IS_LINUX = process.platform === "linux";
const IS_MAC = process.platform === "darwin";

// -------------------------------------------------------- pure: cpu delta ---

/* os.cpus() is cumulative since boot, so a single snapshot is useless as an
   instantaneous load. Diff two of them.

   Three ways this goes wrong, all handled here rather than at the call site:
   - the two samples are identical (dTotal === 0) → no information, not 0% busy
   - a counter went backwards (suspend/resume, hotplug) → drop, do not render
     a negative or a spike
   - the core count changed between samples → the whole delta is meaningless */
function cpuDelta(prev, now) {
  if (!Array.isArray(prev) || !Array.isArray(now)) return null;
  if (!now.length || prev.length !== now.length) return null;

  let sumTotal = 0, sumIdle = 0;
  const cores = [];

  for (let i = 0; i < now.length; i++) {
    const a = prev[i] && prev[i].times, b = now[i] && now[i].times;
    if (!a || !b) { cores.push(null); continue; }

    let total = 0, bad = false;
    for (const k of Object.keys(b)) {
      const d = Number(b[k]) - Number(a[k]);
      if (!Number.isFinite(d) || d < 0) { bad = true; break; }   // counter reset
      total += d;
    }
    const idle = Number(b.idle) - Number(a.idle);

    if (bad || total <= 0) { cores.push(null); continue; }       // divide-by-zero
    cores.push(clamp01to100(100 * (1 - idle / total)));
    sumTotal += total;
    sumIdle += idle;
  }

  const agg = sumTotal > 0 ? clamp01to100(100 * (1 - sumIdle / sumTotal)) : null;
  return { agg, cores };
}

function clamp01to100(n) {
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

// ------------------------------------------------- pure: small-file parsers --

/* A sysfs percent file: one integer, a trailing newline, nothing else.
   Serves both AMD's gpu_busy_percent and a battery's capacity — same shape, one
   parser is one thing to get right. Anything outside 0-100 is not a percent. */
function parsePct(text) {
  const n = numeric(text);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

/* Number("") and Number(null) are both 0, so a truncated or missing sysfs read
   would otherwise render as a confident 0 % — exactly the invented figure this
   module exists to avoid. Demand a plain decimal and nothing else. */
function numeric(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* /sys/class/thermal/thermal_zoneN/temp is millidegrees Celsius. Sanity range
   is deliberately wide (a cold boot reads low, a thermal-throttling laptop
   reads 100+) but excludes the nonsense a missing sensor returns. */
function parseMilliC(text) {
  const n = numeric(text);
  if (n === null) return null;
  const c = n / 1000;
  return c > -50 && c < 200 ? Math.round(c * 10) / 10 : null;
}

/* Pick which thermal zone is "the CPU". Zone ordering is not stable across
   machines and several zones are not temperatures at all — INT3400 is a DPTF
   policy device that reads a constant 20 °C and would be picked by a naive
   "zone 0" or "average of all zones". Choose by type, not by index.
   `zones` is [{ name, type }]; returns a name or null. */
const TEMP_PREF = ["x86_pkg_temp", "coretemp", "cpu-thermal", "cpu_thermal",
                   "k10temp", "soc_thermal", "acpitz"];
const TEMP_BOGUS = /^(INT3400|iwlwifi)/i;

function pickZone(zones) {
  if (!Array.isArray(zones) || !zones.length) return null;
  for (const want of TEMP_PREF) {
    const hit = zones.find((z) => z && String(z.type).trim().toLowerCase() === want);
    if (hit) return hit.name;
  }
  const ok = zones.find((z) => z && !TEMP_BOGUS.test(String(z.type).trim()));
  return (ok || zones[0]).name || null;
}

/* nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total
     --format=csv,noheader,nounits
   emits one line per GPU: "20, 346, 6144". Multi-GPU boxes get the first line;
   the HUD has one gauge. "[N/A]" appears for fields a given card cannot report
   and must come back as null, not as 0. */
function parseNvidiaSmi(text) {
  if (typeof text !== "string") return null;
  const line = text.split("\n").map((s) => s.trim()).filter(Boolean)[0];
  if (!line) return null;
  const f = line.split(",").map((s) => s.trim());
  const num = (s) => {
    const n = numeric(s);
    return n !== null && n >= 0 ? n : null;    // "[N/A]" lands here as null
  };
  const util = f[0] === undefined ? null : num(f[0]);
  const memUsedMB = num(f[1]);
  const memTotalMB = num(f[2]);
  if (util === null && memUsedMB === null && memTotalMB === null) return null;
  return {
    source: "nvidia",
    util: util !== null && util <= 100 ? util : null,
    memUsedMB,
    memTotalMB
  };
}

/* `pmset -g batt` on macOS:
     Now drawing from 'Battery Power'
      -InternalBattery-0 (id=4325475)\t89%; discharging; 3:52 remaining present: true
   Desktops print "Now drawing from 'AC Power'" and no battery line at all, so
   a missing percentage means no battery, not 0 %. */
function parsePmsetBatt(text) {
  const s = String(text);
  const pctMatch = s.match(/(\d{1,3})%/);
  const pct = pctMatch ? parsePct(pctMatch[1]) : null;

  // AC state comes from the header line, independently of the battery line.
  const ac = /drawing from ['"]?AC Power/i.test(s) ? true
           : /drawing from ['"]?Battery Power/i.test(s) ? false
           : null;

  let status = null;
  if (/;\s*charging/i.test(s) || /finishing charge/i.test(s)) status = "Charging";
  else if (/;\s*discharging/i.test(s)) status = "Discharging";
  else if (/;\s*charged/i.test(s)) status = "Full";
  else if (/AC attached/i.test(s)) status = "Not charging";

  if (pct === null && ac === null) return null;
  return { pct, status, ac };
}

/* Linux battery: capacity is a percent file, status is one of the kernel's
   fixed words. Both are read independently — a battery that reports one and
   not the other still yields a usable half. */
const BATT_STATUS = ["Charging", "Discharging", "Full", "Not charging", "Unknown"];

function parseBattery(capacityText, statusText, acText) {
  const pct = parsePct(capacityText);
  const raw = String(statusText == null ? "" : statusText).trim();
  const status = BATT_STATUS.find((s) => s.toLowerCase() === raw.toLowerCase()) ||
                 (raw ? "Unknown" : null);
  const acRaw = String(acText == null ? "" : acText).trim();
  const ac = acRaw === "1" ? true : acRaw === "0" ? false : null;
  if (pct === null && status === null && ac === null) return null;
  return { pct, status, ac };
}

/* fs.statfs() gives blocks in `bsize` units. `bavail` (free to an unprivileged
   user) is what df reports as available and is what a capacity bar should use;
   the gap between bfree and bavail is root's reserve, which is not yours. */
function fsUsage(path, st) {
  if (!st || !Number.isFinite(st.bsize) || !Number.isFinite(st.blocks) || st.blocks <= 0) return null;
  const size = st.bsize * st.blocks;
  const free = st.bsize * st.bavail;
  const used = size - st.bsize * st.bfree;
  return {
    path,
    size,
    free,
    used,
    usedPct: clamp01to100((used / (used + free || 1)) * 100)
  };
}

// ---------------------------------------------------------------- readers ---

async function readText(path) {
  try { return await fsp.readFile(path, "utf8"); } catch (e) { return null; }
}

/* Zone list is fixed for the life of the machine, so it is resolved once at
   load and each sample then reads exactly one small file. */
const TEMP_PATH = (() => {
  if (!IS_LINUX) return null;
  try {
    const zones = fs.readdirSync("/sys/class/thermal")
      .filter((n) => /^thermal_zone\d+$/.test(n))
      .map((name) => {
        let type = "";
        try { type = fs.readFileSync(`/sys/class/thermal/${name}/type`, "utf8").trim(); } catch (e) {}
        return { name, type };
      });
    const pick = pickZone(zones);
    return pick ? `/sys/class/thermal/${pick}/temp` : null;
  } catch (e) { return null; }
})();

// AMD exposes utilisation directly in sysfs; resolved once, same reasoning.
const AMD_PATH = (() => {
  if (!IS_LINUX) return null;
  try {
    for (const card of fs.readdirSync("/sys/class/drm").filter((n) => /^card\d+$/.test(n))) {
      const p = `/sys/class/drm/${card}/device/gpu_busy_percent`;
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return null;
})();

// /sys/class/power_supply also lists mice and keyboards; BAT* is the machine's.
const BATT_DIR = (() => {
  if (!IS_LINUX) return null;
  try {
    const d = fs.readdirSync("/sys/class/power_supply");
    const bat = d.find((n) => /^BAT/i.test(n));
    const ac = d.find((n) => /^(AC|ADP|ACAD)/i.test(n));
    return bat ? { bat: `/sys/class/power_supply/${bat}`, ac: ac ? `/sys/class/power_supply/${ac}` : null } : null;
  } catch (e) { return null; }
})();

/* execFile, never exec: no shell, so nothing here can be turned into a command
   string. Short timeout and a small buffer — a hung nvidia-smi must not pile up
   behind the 5 s timer. Any failure is `null`, never a throw. */
function run(cmd, args, timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    try {
      const child = execFile(cmd, args, { timeout, maxBuffer: 1 << 16 },
        (err, stdout) => { if (!done) { done = true; resolve(err ? null : String(stdout)); } });
      child.on("error", () => { if (!done) { done = true; resolve(null); } });
    } catch (e) { resolve(null); }
  });
}

// One ENOENT is enough — stop spawning a process every 5 s to be told the same.
let nvidiaMissing = false;

async function readGpu() {
  if (AMD_PATH) {
    const util = parsePct(await readText(AMD_PATH));
    if (util !== null) return { source: "amd", util, memUsedMB: null, memTotalMB: null };
  }
  if (IS_LINUX && !nvidiaMissing) {
    const out = await run("nvidia-smi",
      ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"]);
    if (out === null) { nvidiaMissing = true; return null; }
    return parseNvidiaSmi(out);
  }
  return null;   // macOS included — see the platform notes at the top
}

async function readBattery() {
  if (BATT_DIR) {
    return parseBattery(
      await readText(`${BATT_DIR.bat}/capacity`),
      await readText(`${BATT_DIR.bat}/status`),
      BATT_DIR.ac ? await readText(`${BATT_DIR.ac}/online`) : null
    );
  }
  if (IS_MAC) {
    const out = await run("pmset", ["-g", "batt"]);
    return out === null ? null : parsePmsetBatt(out);
  }
  return null;
}

async function readFs() {
  const out = { root: null, home: null };
  const home = os.homedir();
  for (const [key, path] of [["root", "/"], ["home", home]]) {
    if (!path) continue;
    try { out[key] = fsUsage(path, await fsp.statfs(path)); } catch (e) { /* gone or unsupported */ }
  }
  return out;
}

// ---------------------------------------------------------------- sampling --

let prevCpu = AVAILABLE ? os.cpus() : null;
let slow = { fs: { root: null, home: null }, gpu: null, battery: null };

/* The expensive tier. Call it on its own slower timer; whatever it last
   produced is folded into every sample() until it runs again. Never rejects. */
async function refreshSlow() {
  const next = { fs: slow.fs, gpu: slow.gpu, battery: slow.battery };
  try { next.fs = await readFs(); } catch (e) {}
  try { next.gpu = await readGpu(); } catch (e) {}
  try { next.battery = await readBattery(); } catch (e) {}
  slow = next;
  return slow;
}

/* The cheap tier — call this once a second. The first call returns cpu:null
   because there is nothing to diff against yet; that is the contract, not a
   bug, and a consumer that renders null as "—" gets it right for free. */
async function sample() {
  const now = AVAILABLE ? os.cpus() : null;
  const cpu = cpuDelta(prevCpu, now);
  if (now) prevCpu = now;

  // macOS freemem() under-reports badly: cached and compressed pages count as
  // used there, so this reads as 80-90 % on a healthy Mac. It is the honest
  // value the kernel gives us through a portable API — not wrong, just not the
  // "available memory" a Linux user reads it as. Do not "fix" it by inventing
  // a correction factor.
  const total = os.totalmem(), free = os.freemem();
  const used = total - free;

  return {
    t: Date.now(),
    uptime: os.uptime(),
    // os.loadavg() is [0,0,0] on Windows — a real zero-load box is
    // indistinguishable from that, so report the platform's lie as null.
    load: process.platform === "win32" ? null : os.loadavg(),
    cpu,
    mem: { total, free, used, usedPct: total > 0 ? clamp01to100((used / total) * 100) : null },
    tempC: TEMP_PATH ? parseMilliC(await readText(TEMP_PATH)) : null,
    fs: slow.fs,
    gpu: slow.gpu,
    battery: slow.battery
  };
}

module.exports = {
  AVAILABLE,
  // pure, testable without the machine being in any particular state
  cpuDelta,
  parsePct,
  parseMilliC,
  pickZone,
  parseNvidiaSmi,
  parsePmsetBatt,
  parseBattery,
  fsUsage,
  // I/O
  sample,
  refreshSlow
};
