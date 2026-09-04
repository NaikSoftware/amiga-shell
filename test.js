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

// ---------------------------------------------------------------- runner ----

(async () => {
  await configTests();
  await hudTests();

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
