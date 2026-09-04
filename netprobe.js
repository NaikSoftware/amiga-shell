// AmigaTerm — real network telemetry for the PACKET LOG panel.
//
// Everything here comes from /proc/net, which is world-readable, so this needs
// no root and no CAP_NET_RAW. That rules out real per-packet capture (pcap
// needs privileges we are not going to ask for), so "packets" here means:
// real interface packet counters, and real open connections. Both are genuine
// facts about the machine, which is the point — the rest of the HUD is fiction.
//
// Linux only. /proc/net does not exist on macOS or Windows; every reader
// returns empty there and the caller falls back to the fake generator.
//
// ponytail: /proc/net/tcp is O(connections) per sample and we re-read it every
// second. On a box with tens of thousands of sockets that is real work — cap
// the parse and move on rather than getting clever.

"use strict";

const fs = require("fs");

const AVAILABLE = process.platform === "linux" && fs.existsSync("/proc/net/dev");
const MAX_LINES = 4000;   // parse cap; see ponytail note above

// TCP states as /proc reports them, hex-keyed.
const STATE = {
  "01": "ESTAB", "02": "SYNSNT", "03": "SYNRCV", "04": "FINWT1",
  "05": "FINWT2", "06": "TIMEWT", "07": "CLOSE", "08": "CLSWT",
  "09": "LASTAK", "0A": "LISTEN", "0B": "CLOSNG"
};

/* /proc encodes IPv4 as little-endian hex: "0100007F" is 127.0.0.1. */
function hexToIPv4(hex) {
  return [
    parseInt(hex.slice(6, 8), 16),
    parseInt(hex.slice(4, 6), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(0, 2), 16)
  ].join(".");
}

/* IPv6 is four little-endian 32-bit words. Only the tail is shown — a full
   v6 address does not fit the HUD column and the interesting part is the end. */
function hexToIPv6Short(hex) {
  if (hex.length !== 32) return "::";
  const w = [];
  for (let i = 0; i < 32; i += 8) {
    const g = hex.slice(i, i + 8);
    w.push(g.slice(6, 8) + g.slice(4, 6), g.slice(2, 4) + g.slice(0, 2));
  }
  const tail = w.slice(-2).join(":").replace(/^0+/, "") || "0";
  return "::" + tail;
}

function parseProcNet(text, v6) {
  const out = [];
  const lines = String(text).split("\n");
  for (let i = 1; i < lines.length && out.length < MAX_LINES; i++) {
    const f = lines[i].trim().split(/\s+/);
    if (f.length < 4) continue;
    const rem = f[2];
    const st = f[3];
    const cut = rem.lastIndexOf(":");
    if (cut < 1) continue;
    const addrHex = rem.slice(0, cut);
    const port = parseInt(rem.slice(cut + 1), 16);
    if (!Number.isFinite(port)) continue;
    const addr = v6 ? hexToIPv6Short(addrHex) : hexToIPv4(addrHex);
    // port 0 with a zero address is a listener, not a conversation
    if (port === 0) continue;
    out.push({ addr, port, state: STATE[st] || st });
  }
  return out;
}

function readConnections() {
  if (!AVAILABLE) return [];
  const out = [];
  for (const [path, v6] of [["/proc/net/tcp", false], ["/proc/net/tcp6", true]]) {
    try { out.push(...parseProcNet(fs.readFileSync(path, "utf8"), v6)); }
    catch (e) { /* interface vanished or perms changed: skip this source */ }
  }
  return out;
}

function parseNetDev(text) {
  const out = {};
  for (const line of String(text).split("\n").slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 10 || f.some((n) => !Number.isFinite(n))) continue;
    out[m[1].trim()] = { rxBytes: f[0], rxPkts: f[1], txBytes: f[8], txPkts: f[9] };
  }
  return out;
}

function readInterfaces() {
  if (!AVAILABLE) return {};
  try { return parseNetDev(fs.readFileSync("/proc/net/dev", "utf8")); }
  catch (e) { return {}; }
}

/* Turn two interface samples into per-second rates. Counters are unsigned and
   wrap; a negative delta means a wrap or an interface reset, so it is dropped
   rather than rendered as a huge negative spike. */
function rates(prev, now, dtMs) {
  const dt = Math.max(0.001, dtMs / 1000);
  const out = [];
  for (const name of Object.keys(now)) {
    if (name === "lo" || !prev[name]) continue;
    const dRx = now[name].rxPkts - prev[name].rxPkts;
    const dTx = now[name].txPkts - prev[name].txPkts;
    const dB = (now[name].rxBytes - prev[name].rxBytes) +
               (now[name].txBytes - prev[name].txBytes);
    if (dRx < 0 || dTx < 0 || dB < 0) continue;
    out.push({ name, rx: dRx / dt, tx: dTx / dt, bps: dB / dt });
  }
  return out;
}

/* Display lines for the PACKET LOG panel, sized for its ~34 column width. */
function format(ifaceRates, conns) {
  const lines = [];
  for (const r of ifaceRates) {
    if (r.rx < 0.5 && r.tx < 0.5) continue;
    const kb = r.bps / 1024;
    lines.push(
      `${r.name.slice(0, 6).padEnd(7)}` +
      `R${String(Math.round(r.rx)).padStart(5)} ` +
      `T${String(Math.round(r.tx)).padStart(5)} ` +
      `${kb > 999 ? (kb / 1024).toFixed(1) + "M" : Math.round(kb) + "K"}`
    );
  }
  // A browser opens eight sockets to the same host; eight identical rows are
  // noise. Collapse to one row per endpoint with a count.
  const seen = new Map();
  for (const c of conns) {
    const key = c.addr + ":" + c.port + ":" + c.state;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, n] of seen) {
    const i = key.lastIndexOf(":", key.lastIndexOf(":") - 1);
    const addr = key.slice(0, i);
    const [port, state] = key.slice(i + 1).split(":");
    const host = addr.length > 15 ? addr.slice(0, 15) : addr;
    lines.push(`${host.padEnd(16)}${String(port).padStart(5)} ${state}` +
               (n > 1 ? ` x${n}` : ""));
  }
  return lines;
}

module.exports = {
  AVAILABLE,
  hexToIPv4,
  hexToIPv6Short,
  parseProcNet,
  parseNetDev,
  readConnections,
  readInterfaces,
  rates,
  format
};
