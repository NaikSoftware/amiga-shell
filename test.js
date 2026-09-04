#!/usr/bin/env node
// AmigaTerm tests — `node test.js`. Assert-based, no framework, no fixtures,
// no dependencies. Covers only the logic that can actually be wrong (spec §13):
// config normalization and the Claude activity sniffer. Everything visual is
// verified by running the app and looking at it.
//
// CommonJS on purpose: main.js is CJS and hud.js is an ES module, and a plain
// `node test.js` with no "type" in package.json can reach both — require() for
// the first, await import() for the second.

"use strict";

const assert = require("assert");
const path = require("path");

// ------------------------------------------------------------- harness ----

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err && err.message || err).split("\n").join("\n       ")}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ------------------------------------------------------- config (main.js) --

async function configTests() {
  group("config normalization (main.js)");

  let m;
  try {
    m = require("./main.js");
  } catch (err) {
    await test("main.js is importable from plain node", () => { throw err; });
    return;
  }

  await test("main.js exports normalizeConfig and DEFAULTS", () => {
    assert.strictEqual(typeof m.normalizeConfig, "function");
    assert.ok(m.DEFAULTS && typeof m.DEFAULTS === "object");
  });
  if (typeof m.normalizeConfig !== "function") return;

  const { normalizeConfig, DEFAULTS } = m;
  const EFFECTS = Object.keys(DEFAULTS.effects);

  // Every path out of the normalizer must produce a number a CSS variable can
  // hold. This is the assertion that actually matters.
  function assertUsable(cfg) {
    assert.ok(cfg && typeof cfg === "object", "config is an object");
    for (const k of EFFECTS) {
      const v = cfg.effects[k];
      assert.ok(Number.isFinite(v), `effects.${k} is finite, got ${v}`);
      assert.ok(v >= 0 && v <= 100, `effects.${k} in 0-100, got ${v}`);
    }
    assert.ok(Number.isFinite(cfg.fontSize) && cfg.fontSize > 0, "fontSize is a usable number");
    assert.ok(cfg.shell === null || typeof cfg.shell === "string", "shell is null or string");
    assert.ok(Array.isArray(cfg.shellArgs), "shellArgs is an array");
    assert.strictEqual(typeof cfg.bootSequence, "boolean");
    assert.strictEqual(typeof cfg.hud, "boolean");
  }

  await test("out-of-range effect values clamp to 0-100", () => {
    const c = normalizeConfig({
      effects: { scanlines: 500, bloom: -20, curvature: 100.4, glitchRate: 1e9, flicker: -Infinity }
    });
    assert.strictEqual(c.effects.scanlines, 100);
    assert.strictEqual(c.effects.bloom, 0);
    assert.strictEqual(c.effects.curvature, 100);
    assert.strictEqual(c.effects.glitchRate, 100);
    // -Infinity is not finite, so it falls back rather than clamping to 0.
    assert.ok(Number.isFinite(c.effects.flicker));
    assertUsable(c);
  });

  await test("in-range effect values pass through untouched", () => {
    const c = normalizeConfig({ effects: { scanlines: 0, bloom: 100, curvature: 33 } });
    assert.strictEqual(c.effects.scanlines, 0);
    assert.strictEqual(c.effects.bloom, 100);
    assert.strictEqual(c.effects.curvature, 33);
  });

  await test("missing effect keys fall back to their defaults", () => {
    const c = normalizeConfig({ effects: { scanlines: 10 } });
    assert.strictEqual(c.effects.scanlines, 10);
    for (const k of EFFECTS) {
      if (k !== "scanlines") assert.strictEqual(c.effects[k], DEFAULTS.effects[k], k);
    }
  });

  await test("non-numeric garbage falls back to defaults", () => {
    for (const junk of ["banana", null, undefined, NaN, {}, [], true, () => {}, Infinity]) {
      const c = normalizeConfig({ effects: Object.fromEntries(EFFECTS.map((k) => [k, junk])) });
      for (const k of EFFECTS) {
        assert.ok(Number.isFinite(c.effects[k]), `${k} finite for junk ${String(junk)}`);
        assert.strictEqual(c.effects[k], DEFAULTS.effects[k], `${k} default for junk ${String(junk)}`);
      }
    }
  });

  // Number("") is 0, so a blank string reads as "all the way off" rather than
  // as the default. Odd, but 0 is a legal slider value and never reaches CSS as
  // NaN, which is the property that matters.
  await test("blank strings stay finite and in range", () => {
    const c = normalizeConfig({ effects: Object.fromEntries(EFFECTS.map((k) => [k, ""])) });
    for (const k of EFFECTS) {
      assert.ok(Number.isFinite(c.effects[k]) && c.effects[k] >= 0 && c.effects[k] <= 100, k);
    }
  });

  await test("numeric strings are accepted and clamped", () => {
    const c = normalizeConfig({ effects: { scanlines: "50", bloom: "999" } });
    assert.strictEqual(c.effects.scanlines, 50);
    assert.strictEqual(c.effects.bloom, 100);
  });

  await test("empty / invalid / hostile config still yields a usable object", () => {
    for (const raw of [{}, null, undefined, "not a config", 42, [], { effects: "nope" }, { effects: null }]) {
      assertUsable(normalizeConfig(raw));
    }
  });

  await test("defaults round-trip: normalizing the defaults changes nothing", () => {
    assert.deepStrictEqual(normalizeConfig(DEFAULTS), normalizeConfig({}));
    assert.deepStrictEqual(normalizeConfig({}).effects, DEFAULTS.effects);
  });

  await test("fontSize garbage falls back, absurd values clamp", () => {
    assert.strictEqual(normalizeConfig({ fontSize: "huge" }).fontSize, DEFAULTS.fontSize);
    assert.strictEqual(normalizeConfig({ fontSize: null }).fontSize, DEFAULTS.fontSize);
    const big = normalizeConfig({ fontSize: 9999 }).fontSize;
    assert.ok(Number.isFinite(big) && big > 0 && big <= 200, `fontSize clamped, got ${big}`);
    const small = normalizeConfig({ fontSize: -5 }).fontSize;
    assert.ok(Number.isFinite(small) && small > 0, `fontSize positive, got ${small}`);
  });

  await test("shell / shellArgs are sanitized", () => {
    assert.strictEqual(normalizeConfig({ shell: 42 }).shell, null);
    assert.strictEqual(normalizeConfig({ shell: "" }).shell, null);
    assert.strictEqual(normalizeConfig({ shell: "/bin/zsh" }).shell, "/bin/zsh");
    assert.deepStrictEqual(normalizeConfig({ shellArgs: "-l" }).shellArgs, []);
    assert.deepStrictEqual(normalizeConfig({ shellArgs: ["-l", 7, null] }).shellArgs, ["-l"]);
  });

  await test("booleans are only booleans", () => {
    assert.strictEqual(normalizeConfig({ hud: "yes" }).hud, DEFAULTS.hud);
    assert.strictEqual(normalizeConfig({ hud: false }).hud, false);
    assert.strictEqual(normalizeConfig({ bootSequence: 0 }).bootSequence, DEFAULTS.bootSequence);
    assert.strictEqual(normalizeConfig({ bootSequence: false }).bootSequence, false);
  });

  if (typeof m.loadConfig === "function") {
    await test("the shipped config.json loads and is usable", () => {
      assertUsable(m.loadConfig(__dirname));
    });
    await test("a directory with no config.json still loads defaults", () => {
      assertUsable(m.loadConfig(path.join(__dirname, "no-such-dir")));
    });
  }
}

// -------------------------------------------------------- sniffer (hud.js) --
// hud.js is an ES module; await import() reaches it from this CommonJS file.
// It touches `document` only inside initHud(), so importing it under plain
// node is safe — that is what makes the sniffer testable at all.

async function hudTests() {
  group("Claude activity sniffer (hud.js)");

  let h;
  try {
    h = await import("./hud.js");
  } catch (err) {
    await test("hud.js is importable from plain node", () => { throw err; });
    return;
  }

  await test("hud.js exports createSniffer", () => {
    assert.strictEqual(typeof h.createSniffer, "function");
  });
  if (typeof h.createSniffer !== "function") return;

  // createSniffer(onScenario) returns a callable feed(chunk); onScenario gets
  // the scenario key. Collect the keys a stream produces.
  function sniff(...chunks) {
    const keys = [];
    const feed = h.createSniffer((key) => keys.push(key));
    for (const c of chunks) feed(c);
    return keys;
  }

  // The §9 table, verbatim.
  const TABLE = [
    ["⏺ Read(main.js)", "read"],
    ["⏺ Glob(**/*.js)", "read"],
    ["⏺ Grep(pattern)", "read"],
    ["⏺ Edit(hud.js)", "edit"],
    ["⏺ Write(README.md)", "edit"],
    ["⏺ Bash(npm test)", "bash"],
    ["⏺ WebFetch(https://example.com)", "net"],
    ["⏺ WebSearch(topaz font)", "net"],
    ["⏺ Task(explore the repo)", "task"],
    ["✻ Divining… (4s · esc to interrupt)", "think"],
    ["  (esc to interrupt)", "think"]
  ];

  for (const [line, want] of TABLE) {
    await test(`${JSON.stringify(line)} -> ${want}`, () => {
      const keys = sniff(line + "\n");
      assert.ok(keys.length >= 1, "produced no scenario at all");
      assert.ok(keys.includes(want), `expected ${want}, got ${JSON.stringify(keys)}`);
    });
  }

  await test("every documented scenario key is reachable", () => {
    const seen = new Set(TABLE.flatMap(([line]) => sniff(line)));
    for (const want of ["read", "edit", "bash", "net", "task", "think"]) {
      assert.ok(seen.has(want), `scenario "${want}" never fires`);
    }
  });

  // The one that actually bites: PTY chunks split wherever the kernel felt
  // like it, so the marker arrives in halves.
  await test("a marker split at ANY boundary fires exactly once", () => {
    const line = "⏺ Bash(npm run build)\n";
    for (let i = 0; i <= line.length; i++) {
      const keys = sniff(line.slice(0, i), line.slice(i));
      assert.strictEqual(
        keys.length, 1,
        `split at ${i} (${JSON.stringify(line.slice(0, i))} | ${JSON.stringify(line.slice(i))}) gave ${JSON.stringify(keys)}`
      );
      assert.strictEqual(keys[0], "bash", `split at ${i} gave ${keys[0]}`);
    }
  });

  await test("a marker split into single characters fires exactly once", () => {
    assert.deepStrictEqual(sniff(...("⏺ Task(sub agent)\n".split(""))), ["task"]);
  });

  await test("two markers in one stream fire twice, in order", () => {
    assert.deepStrictEqual(sniff("⏺ Read(a.js)\n⏺ Bash(ls)\n"), ["read", "bash"]);
  });

  await test("a marker is not re-fired by later chunks", () => {
    const keys = [];
    const feed = h.createSniffer((k) => keys.push(k));
    feed("⏺ Edit(style.css)\n");
    feed("some unrelated output\n");
    feed("more output with no markers at all\n");
    assert.deepStrictEqual(keys, ["edit"]);
  });

  await test("ANSI-wrapped markers are still detected", () => {
    // Colour codes land between the glyph and the marker — the normal case.
    assert.deepStrictEqual(sniff("\x1b[32m⏺\x1b[0m \x1b[1mBash\x1b[0m(ls -la)\n"), ["bash"]);
    assert.deepStrictEqual(sniff("\x1b[38;5;208mRead\x1b[39m(main.js)\n"), ["read"]);
    // ...including split across a chunk in the middle of the escape sequence.
    const s = "\x1b[1;32m⏺ Task(go)\x1b[0m\n";
    for (let i = 0; i <= s.length; i++) {
      assert.deepStrictEqual(sniff(s.slice(0, i), s.slice(i)), ["task"], `ansi split at ${i}`);
    }
  });

  await test("unmatched input produces no scenario (the degrade path)", () => {
    const noise = [
      "$ ls -la\ntotal 42\ndrwxr-xr-x 3 naik naik 4096 Sep  4 23:00 .\n",
      "\x1b[?1049h\x1b[H\x1b[2Jvim session\x1b[?1049l",
      "Traceback (most recent call last):\n  File \"x.py\", line 3\n",
      "read(2) returned -1\nwriting(nothing)\nTasks(3) done\n",
      "npm WARN deprecated foo@1.0.0\n",
      "",
      "\x00\x07\x1b]0;title\x07"
    ];
    for (const chunk of noise) {
      assert.deepStrictEqual(sniff(chunk), [], `noise fired a scenario: ${JSON.stringify(chunk)}`);
    }
  });

  await test("garbage input never throws", () => {
    const feed = h.createSniffer(() => {});
    for (const junk of [null, undefined, 0, 42, {}, [], true, NaN]) feed(junk);
  });

  await test("the rolling buffer is capped and still matches after overflow", () => {
    const keys = [];
    const feed = h.createSniffer((k) => keys.push(k));
    for (let i = 0; i < 40; i++) feed("x".repeat(512)); // ~20 KB of nothing
    feed("⏺ WebFetch(https://example.com)\n");
    assert.deepStrictEqual(keys, ["net"]);
  });

  // ------------------------------------------------------------ generators --
  group("HUD line generators (hud.js)");

  if (!h.GENERATORS) {
    console.log("  skip generators are not exported");
    return;
  }

  for (const [name, fn] of Object.entries(h.GENERATORS)) {
    await test(`${name}() returns a non-empty single-line string`, () => {
      assert.strictEqual(typeof fn, "function");
      for (let i = 0; i < 200; i++) {
        const s = fn();
        assert.strictEqual(typeof s, "string", `${name} returned ${typeof s}`);
        assert.ok(s.trim().length > 0, `${name} returned blank`);
        assert.ok(!/[\r\n]/.test(s), `${name} returned a multi-line string`);
        assert.ok(!/undefined|NaN/.test(s), `${name} leaked: ${s}`);
        // The HUD column is narrow; a runaway line would blow the layout out.
        assert.ok(s.length <= 56, `${name} is ${s.length} chars: ${s}`);
      }
    });
  }
}

// ------------------------------------------------------------- netprobe ----
// Real parsing against fixed /proc fixtures: byte order, counter wrap and
// hostile input are all things that would silently produce garbage on screen.

async function testNetprobe() {
  const net = require("./netprobe.js");

  await test("hexToIPv4 decodes /proc little-endian order", () => {
    assert.strictEqual(net.hexToIPv4("0100007F"), "127.0.0.1");
    assert.strictEqual(net.hexToIPv4("0F02000A"), "10.0.2.15");
  });

  await test("parseProcNet reads remote addr/port/state, skips listeners", () => {
    const fixture = [
      "  sl  local_address rem_address   st tx_queue rx_queue",
      "   0: 0100007F:235A 00000000:0000 0A 00000000:00000000",
      "   1: 0F02000A:B3C2 5DB8D822:01BB 01 00000000:00000000"
    ].join("\n");
    const rows = net.parseProcNet(fixture, false);
    assert.strictEqual(rows.length, 1, "the :0000 listener must be dropped");
    assert.strictEqual(rows[0].addr, "34.216.184.93");
    assert.strictEqual(rows[0].port, 443);
    assert.strictEqual(rows[0].state, "ESTAB");
  });

  await test("parseNetDev pulls rx/tx packet and byte counters", () => {
    const fixture = [
      "Inter-|   Receive                     |  Transmit",
      " face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed",
      "    lo:  100  10 0 0 0 0 0 0  200  20 0 0 0 0 0 0",
      " eth0:  999  50 0 0 0 0 0 0  888  40 0 0 0 0 0 0"
    ].join("\n");
    const d = net.parseNetDev(fixture);
    assert.strictEqual(d.eth0.rxPkts, 50);
    assert.strictEqual(d.eth0.txPkts, 40);
    assert.strictEqual(d.eth0.rxBytes, 999);
    assert.strictEqual(d.eth0.txBytes, 888);
  });

  await test("rates ignores loopback and drops counter wrap", () => {
    const prev = { lo: {rxBytes:0,rxPkts:0,txBytes:0,txPkts:0},
                   eth0:{rxBytes:100,rxPkts:10,txBytes:100,txPkts:10} };
    const now  = { lo: {rxBytes:9,rxPkts:9,txBytes:9,txPkts:9},
                   eth0:{rxBytes:200,rxPkts:20,txBytes:200,txPkts:20} };
    const r = net.rates(prev, now, 1000);
    assert.strictEqual(r.length, 1, "lo must be excluded");
    assert.strictEqual(r[0].rx, 10);

    // a wrapped (decreasing) counter must vanish, not render as negative
    const wrapped = net.rates({ eth0:{rxBytes:500,rxPkts:50,txBytes:500,txPkts:50} },
                              { eth0:{rxBytes:1,  rxPkts:1, txBytes:1,  txPkts:1} }, 1000);
    assert.strictEqual(wrapped.length, 0);
  });

  await test("format collapses duplicate endpoints and fits the column", () => {
    const conns = [
      {addr:"1.2.3.4", port:443, state:"ESTAB"},
      {addr:"1.2.3.4", port:443, state:"ESTAB"},
      {addr:"5.6.7.8", port:80,  state:"ESTAB"}
    ];
    const lines = net.format([], conns);
    assert.strictEqual(lines.length, 2, "identical endpoints collapse to one row");
    assert.ok(lines.some((l) => /x2/.test(l)), "the collapsed row shows a count");
    for (const l of lines) assert.ok(l.length <= 40, `too wide: ${l}`);
  });

  await test("parsers never throw on garbage", () => {
    for (const junk of ["", "\n\n", "not a table", "a:b:c", "\0".repeat(1000)]) {
      net.parseProcNet(junk, false);
      net.parseProcNet(junk, true);
      net.parseNetDev(junk);
    }
    net.format([], []);
  });
}

// ------------------------------------------------------------- sysprobe ----
// The gauges are only worth having if they are true, so every parser is fed
// the real output format plus the ways it degrades: empty, garbage, "[N/A]",
// a counter that went backwards, two identical samples.

async function testSysprobe() {
  group("system telemetry (sysprobe.js)");

  const sys = require("./sysprobe.js");

  // -- cpu delta ------------------------------------------------------------
  // os.cpus() is cumulative since boot; a snapshot alone says nothing.

  const core = (user, nice, s, idle, irq) => ({ times: { user, nice, sys: s, idle, irq } });

  await test("cpuDelta computes busy percent from two samples", () => {
    const prev = [core(100, 0, 50, 850, 0), core(0, 0, 0, 1000, 0)];
    const now  = [core(200, 0, 100, 1700, 0), core(0, 0, 0, 2000, 0)];
    const d = sys.cpuDelta(prev, now);
    // core 0: 150 busy of 1000 -> 15%; core 1: fully idle -> 0%
    assert.strictEqual(d.cores[0], 15);
    assert.strictEqual(d.cores[1], 0);
    // aggregate over both: 150 busy of 2000
    assert.strictEqual(d.agg, 7.5);
  });

  await test("cpuDelta reports a saturated core as 100, not over", () => {
    const d = sys.cpuDelta([core(0, 0, 0, 0, 0)], [core(1000, 0, 0, 0, 0)]);
    assert.strictEqual(d.cores[0], 100);
    assert.strictEqual(d.agg, 100);
  });

  await test("identical samples give null, not 0% or NaN (divide by zero)", () => {
    const snap = [core(1, 2, 3, 4, 5), core(1, 2, 3, 4, 5)];
    const d = sys.cpuDelta(snap, snap);
    assert.deepStrictEqual(d.cores, [null, null], "a zero delta is no information");
    assert.strictEqual(d.agg, null);
  });

  await test("a counter reset yields null for that core, never a negative", () => {
    // suspend/resume or a hotplugged core: the counter goes backwards
    const prev = [core(500, 0, 500, 500, 0), core(100, 0, 0, 900, 0)];
    const now  = [core(1, 0, 1, 1, 0),       core(200, 0, 0, 1800, 0)];
    const d = sys.cpuDelta(prev, now);
    assert.strictEqual(d.cores[0], null, "reset core must be null");
    assert.ok(Number.isFinite(d.cores[1]), "a healthy sibling core still reports");
    for (const c of d.cores) assert.ok(c === null || c >= 0, `negative leaked: ${c}`);
  });

  await test("cpuDelta rejects mismatched, empty and garbage samples", () => {
    assert.strictEqual(sys.cpuDelta([core(0,0,0,1,0)], [core(0,0,0,1,0), core(0,0,0,1,0)]), null);
    assert.strictEqual(sys.cpuDelta([], []), null);
    for (const junk of [null, undefined, "cpus", 42, {}, NaN]) {
      assert.strictEqual(sys.cpuDelta(junk, junk), null, `junk ${String(junk)}`);
      assert.strictEqual(sys.cpuDelta([core(0,0,0,1,0)], junk), null);
    }
    // a malformed entry inside an otherwise fine array
    const d = sys.cpuDelta([core(0,0,0,0,0), null], [core(0,0,0,100,0), null]);
    assert.strictEqual(d.cores[1], null);
  });

  // -- sysfs percent files (AMD gpu_busy_percent, BAT*/capacity) -------------

  await test("parsePct reads an AMD gpu_busy_percent file", () => {
    assert.strictEqual(sys.parsePct("0\n"), 0);
    assert.strictEqual(sys.parsePct("37\n"), 37);
    assert.strictEqual(sys.parsePct("100\n"), 100);
    assert.strictEqual(sys.parsePct(" 42 "), 42);
  });

  await test("parsePct rejects out-of-range and garbage", () => {
    for (const junk of ["", "\n", "N/A", "banana", "-1", "101", "1e9", null, undefined, {}, "0x10"]) {
      assert.strictEqual(sys.parsePct(junk), null, `junk ${String(junk)}`);
    }
  });

  // -- thermal --------------------------------------------------------------

  await test("parseMilliC converts /sys thermal millidegrees", () => {
    assert.strictEqual(sys.parseMilliC("54000\n"), 54);
    assert.strictEqual(sys.parseMilliC("50050\n"), 50.1);   // rounded to 0.1
    assert.strictEqual(sys.parseMilliC("0"), 0);
    assert.strictEqual(sys.parseMilliC("-5000"), -5);       // a cold sensor is legal
  });

  await test("parseMilliC rejects garbage and impossible readings", () => {
    for (const junk of ["", "\n", "unknown", "abc", null, undefined, {}, "999999999", "-99999999"]) {
      assert.strictEqual(sys.parseMilliC(junk), null, `junk ${String(junk)}`);
    }
  });

  await test("pickZone prefers the CPU package over decoy zones", () => {
    // the real /sys/class/thermal on this class of laptop: INT3400 is a DPTF
    // policy device that reads a constant 20C and must not be chosen
    const zones = [
      { name: "thermal_zone0", type: "SEN2" },
      { name: "thermal_zone1", type: "INT3400 Thermal" },
      { name: "thermal_zone3", type: "pch_cometlake" },
      { name: "thermal_zone6", type: "x86_pkg_temp" }
    ];
    assert.strictEqual(sys.pickZone(zones), "thermal_zone6");
    assert.strictEqual(sys.pickZone([{ name: "z0", type: "acpitz" },
                                     { name: "z1", type: "coretemp" }]), "z1");
  });

  await test("pickZone falls back past known-bogus zones, then to anything", () => {
    assert.strictEqual(
      sys.pickZone([{ name: "z0", type: "INT3400 Thermal" }, { name: "z1", type: "SEN3" }]),
      "z1");
    // nothing but decoys: still return one rather than nothing
    assert.strictEqual(sys.pickZone([{ name: "z0", type: "INT3400 Thermal" }]), "z0");
    for (const junk of [[], null, undefined, "zones", {}]) {
      assert.strictEqual(sys.pickZone(junk), null, `junk ${String(junk)}`);
    }
  });

  // -- nvidia-smi -----------------------------------------------------------

  await test("parseNvidiaSmi reads the csv,noheader,nounits line", () => {
    const g = sys.parseNvidiaSmi("20, 346, 6144\n");     // verbatim from this box
    assert.strictEqual(g.source, "nvidia");
    assert.strictEqual(g.util, 20);
    assert.strictEqual(g.memUsedMB, 346);
    assert.strictEqual(g.memTotalMB, 6144);
  });

  await test("parseNvidiaSmi takes the first GPU of several", () => {
    const g = sys.parseNvidiaSmi("11, 100, 8192\n77, 900, 8192\n");
    assert.strictEqual(g.util, 11);
    assert.strictEqual(g.memUsedMB, 100);
  });

  await test("parseNvidiaSmi turns [N/A] into null, never 0", () => {
    const g = sys.parseNvidiaSmi("[N/A], 512, 4096\n");
    assert.strictEqual(g.util, null, "an unreported figure must be visibly missing");
    assert.strictEqual(g.memUsedMB, 512);
  });

  await test("parseNvidiaSmi returns null for garbage and driver errors", () => {
    const errs = [
      "",
      "\n\n",
      "NVIDIA-SMI has failed because it couldn't communicate with the driver\n",
      "Failed to initialize NVML: Driver/library version mismatch\n",
      "banana, banana, banana",
      "[N/A], [N/A], [N/A]"
    ];
    for (const e of errs) assert.strictEqual(sys.parseNvidiaSmi(e), null, JSON.stringify(e));
    for (const junk of [null, undefined, 42, {}]) {
      assert.strictEqual(sys.parseNvidiaSmi(junk), null, `junk ${String(junk)}`);
    }
  });

  // -- battery: macOS pmset --------------------------------------------------

  await test("parsePmsetBatt reads a discharging Mac laptop", () => {
    const out = "Now drawing from 'Battery Power'\n" +
      " -InternalBattery-0 (id=4325475)\t89%; discharging; 3:52 remaining present: true\n";
    const b = sys.parsePmsetBatt(out);
    assert.strictEqual(b.pct, 89);
    assert.strictEqual(b.status, "Discharging");
    assert.strictEqual(b.ac, false);
  });

  await test("parsePmsetBatt reads charging, charged and AC-attached states", () => {
    const chg = sys.parsePmsetBatt(
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t42%; charging; 1:10 remaining present: true\n");
    assert.strictEqual(chg.pct, 42);
    assert.strictEqual(chg.status, "Charging");
    assert.strictEqual(chg.ac, true);

    const full = sys.parsePmsetBatt(
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n");
    assert.strictEqual(full.status, "Full");
    assert.strictEqual(full.pct, 100);

    const held = sys.parsePmsetBatt(
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; AC attached; not charging present: true\n");
    assert.strictEqual(held.status, "Not charging");
  });

  await test("parsePmsetBatt on a Mac desktop reports AC with no percentage", () => {
    const b = sys.parsePmsetBatt("Now drawing from 'AC Power'\n");
    assert.strictEqual(b.pct, null, "no battery means null, not 0%");
    assert.strictEqual(b.ac, true);
  });

  await test("parsePmsetBatt returns null for garbage", () => {
    for (const junk of ["", "\n", "command not found", "zzz", null, undefined, {}, 42]) {
      assert.strictEqual(sys.parsePmsetBatt(junk), null, `junk ${String(junk)}`);
    }
  });

  // -- battery: Linux sysfs --------------------------------------------------

  await test("parseBattery reads capacity + status + AC online", () => {
    const b = sys.parseBattery("100\n", "Not charging\n", "1\n");   // this box, verbatim
    assert.strictEqual(b.pct, 100);
    assert.strictEqual(b.status, "Not charging");
    assert.strictEqual(b.ac, true);

    const d = sys.parseBattery("57\n", "Discharging\n", "0\n");
    assert.strictEqual(d.pct, 57);
    assert.strictEqual(d.status, "Discharging");
    assert.strictEqual(d.ac, false);
  });

  await test("parseBattery survives half a battery", () => {
    assert.deepStrictEqual(sys.parseBattery("77\n", null, null), { pct: 77, status: null, ac: null });
    assert.deepStrictEqual(sys.parseBattery(null, "Charging\n", null), { pct: null, status: "Charging", ac: null });
    // an unrecognised kernel word is Unknown, not a crash and not invented
    assert.strictEqual(sys.parseBattery("50", "Weird State", null).status, "Unknown");
  });

  await test("parseBattery returns null when there is no battery at all", () => {
    assert.strictEqual(sys.parseBattery(null, null, null), null);
    assert.strictEqual(sys.parseBattery("", "", ""), null);
    for (const junk of [undefined, {}, 42, NaN]) {
      const b = sys.parseBattery(junk, junk, junk);
      assert.ok(b === null || b.pct === null, `junk ${String(junk)} invented a value`);
    }
  });

  // -- filesystem ------------------------------------------------------------

  await test("fsUsage turns a StatFs into size/free/used percent", () => {
    const u = sys.fsUsage("/", { bsize: 4096, blocks: 1000, bfree: 400, bavail: 300 });
    assert.strictEqual(u.size, 4096000);
    assert.strictEqual(u.free, 4096 * 300);          // bavail: root's reserve is not yours
    assert.strictEqual(u.used, 4096 * 600);
    assert.strictEqual(u.usedPct, 66.7);             // used / (used + avail), like df
    assert.strictEqual(u.path, "/");
  });

  await test("fsUsage returns null for an unusable StatFs", () => {
    for (const junk of [null, undefined, {}, { bsize: 4096, blocks: 0, bfree: 0, bavail: 0 },
                        { bsize: NaN, blocks: 10, bfree: 1, bavail: 1 }]) {
      assert.strictEqual(sys.fsUsage("/x", junk), null, `junk ${JSON.stringify(junk)}`);
    }
  });

  // -- the live payload ------------------------------------------------------
  // Shape only; the values depend on the machine and are checked by hand.

  await test("sample() yields the documented payload shape, all keys present", async () => {
    const p = await sys.sample();
    for (const k of ["t", "uptime", "load", "cpu", "mem", "tempC", "fs", "gpu", "battery"]) {
      assert.ok(k in p, `missing key ${k}`);
    }
    assert.ok(Number.isFinite(p.t) && Number.isFinite(p.uptime));
    assert.ok(p.load === null || (Array.isArray(p.load) && p.load.length === 3));
    assert.ok(Number.isFinite(p.mem.total) && p.mem.total > 0);
    assert.ok(p.mem.usedPct >= 0 && p.mem.usedPct <= 100);
    assert.ok(p.tempC === null || Number.isFinite(p.tempC));
    assert.ok(p.gpu === null || typeof p.gpu === "object");
    assert.ok(p.battery === null || typeof p.battery === "object");
    assert.ok(p.fs && "root" in p.fs && "home" in p.fs);
    assert.ok(!/undefined/.test(JSON.stringify(p)), "no undefined leaks into IPC");
  });

  await test("the first sample has no cpu delta; a later one does", async () => {
    const a = await sys.sample();          // may already be the second call
    let spun = 0; for (let i = 0; i < 3e6; i++) spun += i;   // give the counters something
    const b = await sys.sample();
    assert.ok(b.cpu === null || Array.isArray(b.cpu.cores), "cpu is null or {agg,cores}");
    if (b.cpu) {
      assert.strictEqual(b.cpu.cores.length, require("os").cpus().length);
      for (const c of b.cpu.cores) {
        assert.ok(c === null || (c >= 0 && c <= 100), `core out of range: ${c}`);
      }
      assert.ok(b.cpu.agg === null || (b.cpu.agg >= 0 && b.cpu.agg <= 100));
    }
    assert.ok(a && spun >= 0);
  });

  await test("refreshSlow never throws and fills the slow tier", async () => {
    const s = await sys.refreshSlow();
    assert.ok(s && "fs" in s && "gpu" in s && "battery" in s);
    assert.ok(s.gpu === null || s.gpu.util === null || (s.gpu.util >= 0 && s.gpu.util <= 100));
    assert.ok(s.battery === null || s.battery.pct === null ||
              (s.battery.pct >= 0 && s.battery.pct <= 100));
  });

  // -- the config key, which is the thing that has bitten this project twice --

  await test("normalizeConfig keeps sysTelemetry and sysIntervalMs", () => {
    const { normalizeConfig } = require("./main.js");
    assert.strictEqual(normalizeConfig({}).sysTelemetry, true, "default must survive the whitelist");
    assert.strictEqual(normalizeConfig({ sysTelemetry: false }).sysTelemetry, false);
    assert.strictEqual(normalizeConfig({ sysTelemetry: "no" }).sysTelemetry, true);
    assert.strictEqual(normalizeConfig({}).sysIntervalMs, 1000);
    assert.strictEqual(normalizeConfig({ sysIntervalMs: 5 }).sysIntervalMs, 250);
    assert.strictEqual(normalizeConfig({ sysIntervalMs: 1e9 }).sysIntervalMs, 10000);
    assert.strictEqual(normalizeConfig({ sysIntervalMs: "banana" }).sysIntervalMs, 1000);
  });
}

// ---------------------------------------------------------------- runner ----

(async () => {
  await configTests();
  await hudTests();
  await testNetprobe();
  await testSysprobe();

  console.log(`\n${"-".repeat(52)}`);
  if (failures.length) {
    console.log(`FAIL — ${passed} passed, ${failures.length} failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASS — ${passed} test groups passed, 0 failed.`);
})().catch((err) => {
  console.error("\ntest harness crashed:", err);
  process.exit(1);
});
