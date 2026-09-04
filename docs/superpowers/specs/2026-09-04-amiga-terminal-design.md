# AmigaTerm — Design Spec

Date: 2026-09-04
Status: Approved (design), pending implementation plan

## 1. Purpose

A terminal emulator for daily use with the Claude Code CLI, styled as an Amiga
Workbench 1.3 window wrapped around a green-phosphor CRT screen, with a
"hacking theater" HUD that reacts to what Claude Code is actually doing.

Two hard requirements pull against each other and both must hold:

- **Maximum retro feeling.** Scanlines, bloom, flicker, glitch bursts, boot
  sequence, ambient corruption, Guru Meditations.
- **Actually usable for real work.** The user reads real code and real stack
  traces in this window all day. Effects are tunable and the HUD is
  dismissable; legibility is never a one-way door.

Where the two conflict, tunability resolves it: ship at a readable medium,
let the user crank it.

## 2. Non-goals

- Not a general-purpose terminal replacement. One window, one PTY, no tabs,
  no splits, no session management. If the user wants tabs, that is a
  separate project.
- No configuration UI. `config.json` is edited by hand.
- No shell integration, no prompt rewriting, no command history features.
- Not cross-platform-verified. Target is this machine: Linux, Wayland, KDE
  Plasma. It will likely work elsewhere; that is not tested or promised.

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | Effects are the whole point, and CSS/canvas is the cheapest place to build them. |
| Terminal | xterm.js + `@xterm/addon-webgl` + `@xterm/addon-fit` | Battle-tested VT emulation. Not writing our own. |
| PTY | `node-pty` | Spawned in the main process; bytes cross to the renderer over IPC. |
| Build | none | Plain CommonJS in main, plain ES modules in renderer. No bundler, no transpiler. |

Rejected: Tauri (no Rust toolchain on this machine, slower iteration),
forking cool-retro-term (QML is a poor host for the HUD logic, needs a Qt
build environment).

## 4. Process and security model

`nodeIntegration: false`, `contextIsolation: true`. `preload.js` exposes
exactly one object:

```js
window.pty = {
  onData(cb),        // main -> renderer, raw PTY bytes
  write(data),       // renderer -> main, keystrokes
  resize(cols, rows) // renderer -> main
}
```

Nothing else crosses the bridge. The renderer never touches `fs`, `child_process`
or `require`.

`main.js` spawns the child process. Default command is `claude`; overridable
in `config.json` via `shell` and `shellArgs`. If the configured command is not
found on `PATH`, fall back to `$SHELL` and surface the failure as a Guru
Meditation rather than a silent blank window.

## 5. File layout

```
amiga-terminal/
  package.json
  main.js         Electron main: BrowserWindow, node-pty spawn, IPC
  preload.js      contextBridge (the three methods above)
  index.html      Workbench chrome markup + HUD skeleton
  style.css       Amiga frame, CRT overlay layers, HUD styling
  renderer.js     xterm wiring, boot sequence, config load, hotkeys
  effects.js      glitch / chroma-split / flicker engine (canvas)
  hud.js          fake-op generators + Claude-activity sniffer
  config.json     tunables
  fonts/          Topaz TTF (see §11)
  test.js         assert-based checks (see §12)
  prototype.html  standalone animated visual prototype (phase 1)
```

Nine source files. If any one of them passes ~400 lines, that is a signal it
is doing too much and should be split — not a rule to enforce preemptively.

## 6. Visual design — Workbench 1.3 chrome

The Electron window is frameless (`frame: false`); the Amiga window
decoration is drawn in HTML and is the real title bar.

- Title bar: `#FF8800` orange ground, `#000` Topaz text, reading
  `AmigaShell — <cwd>`. Left: depth-arrange gadget. Right: shrink and
  zoom gadgets, then close.
- Window border: 2px, `#FFFFFF` outer / `#0055AA` inner, the classic
  double-line Workbench edge.
- Body ground behind the CRT screen: `#0055AA`.
- The title bar is the window drag handle (`-webkit-app-region: drag`);
  gadgets are `no-drag` so they stay clickable.
- Gadgets are functional: close quits, shrink minimizes, zoom maximizes.
  Cosmetic-only gadgets would be a lie the user clicks on.

## 7. Visual design — the CRT screen

The screen is a stack of layers over the xterm canvas, bottom to top:

1. **xterm WebGL canvas** — the real text. Phosphor green `#33FF66` on
   `#0A140A`, ANSI palette remapped to phosphor-tinted variants so colored
   output still differentiates but stays in-family.
2. **Bloom layer** — a CSS-blurred, additively-composited duplicate of the
   text canvas. Gives phosphor glow.
3. **Scanlines** — `repeating-linear-gradient`, 2px pitch, opacity driven
   by config.
4. **Glitch overlay canvas** — transparent and idle by default. See §8.
5. **Vignette + screen mask** — radial darkening plus `border-radius` on the
   screen container, faking tube edges.
6. **Flicker** — a whole-screen opacity animation at low amplitude.

### Deliberate limitation: no true barrel distortion

CSS cannot warp a raster. Real curvature means owning the entire render pass
in WebGL — resampling xterm's output through a distortion shader every frame.
That is a large amount of code for one effect, and it fights xterm's own
renderer.

The fake is a rounded screen mask, a strong vignette, and a slight
`perspective()` transform. This is marked in `style.css` with:

```css
/* ponytail: faked curvature via mask+vignette; upgrade to a WebGL barrel
   pass over the xterm canvas if this reads flat on a real monitor */
```

This is the one simplification with a known ceiling. If the prototype reads
flat, escalating to the WebGL pass is a scoped follow-up, not a redesign.

## 8. The glitch engine (`effects.js`)

Idle cost must be zero. No per-frame canvas copying when nothing is glitching.

A burst is scheduled by a Poisson-ish timer driven by `config.glitchRate`.
When one fires, for its duration (80–400ms) each frame:

1. `drawImage` the xterm canvas into the overlay canvas.
2. Redraw as horizontal slices at random Y offsets with random X displacement.
3. Draw the same source twice more, offset a few pixels, composited through
   red and cyan channel filters — chroma separation.
4. Optionally corrupt a region with random glyph bytes that heal on the next
   burst boundary.

Between bursts the overlay canvas is cleared and no work happens. This is what
makes constant glitching affordable.

Burst flavors: `slice` (row displacement), `chroma` (channel split),
`roll` (vertical scanline roll), `corrupt` (character garbage),
`guru` (full-screen Guru Meditation banner, rare, self-healing).

## 9. The HUD (`hud.js`)

### Placement

A right-hand column and a bottom strip, both **outside** the terminal's
bounding box. The terminal is never overlapped. `F10` collapses the HUD
entirely and the terminal reflows to full width.

### Generators

Pure functions producing fake output lines, no side effects, individually
testable:

- `portScan()` — host:port, SYN/ACK states, progress
- `hexDump()` — offset + hex + ASCII gutter
- `packetTrace()` — src/dst, protocol, byte counts
- `cryptoKey()` — base64-ish key material scrolling
- `progressBar(label, pct)` — block-character bars

### Claude activity sniffer

A read-only tap on the PTY stream. It never modifies, delays or reorders
bytes going to xterm — it receives a copy after xterm has been written to.

It matches Claude Code's tool-call markers and maps them to scenarios:

| Stream pattern | HUD scenario |
|---|---|
| `Read(`, `Glob(`, `Grep(` | `SECTOR DUMP` — hex dump scrolling |
| `Edit(`, `Write(` | `PATCHING BINARY` — progress bar |
| `Bash(` | `INJECTING PAYLOAD` — port scan |
| `WebFetch(`, `WebSearch(` | `UPLINK ACTIVE` — packet trace |
| `Task(` | `SPAWNING DAEMON` — process list |
| thinking spinner / `esc to interrupt` | `NEURAL LINK` — crypto key stream |

**Failure mode is explicit**: Claude Code's output format is not a stable
API. If none of these patterns match, the sniffer contributes nothing and the
HUD runs its ambient rotation. A missed match degrades the theater; it never
breaks the terminal. This is the intended behavior, not a bug to guard
against.

### Ambient mode

With no Claude activity detected, generators rotate on a slow timer so the
HUD is always alive.

## 10. Boot sequence

Plays in the renderer on launch, over the CRT screen, while the PTY spawns in
parallel — so it costs no real startup latency.

```
Kickstart 1.3 ROM ............ OK
CHIP RAM   512K .............. OK
FAST RAM  8192K .............. OK
DF0: reading .................
> ESTABLISHING UPLINK
> ACCESS GRANTED
```

Typed out with per-character delay and a cursor. Skippable with any keypress —
a boot animation you cannot skip becomes hostile by the fifth launch.
Disable permanently with `config.bootSequence: false`.

## 11. Font

Topaz-8 is not installed on this machine. Setup fetches a free TopazPlus /
Topaz_a1200 TTF into `fonts/`.

This is the only outbound network call in the build, and it is explicit rather
than silent. If the fetch fails, the CSS font stack falls back to
`Ubuntu Mono, monospace` and the app logs a visible one-line notice. The app
must be fully functional without the font.

Rendering: `image-rendering: pixelated`, integer font sizes only, to keep
bitmap glyph edges sharp.

## 12. Configuration

`config.json`, hand-edited, read at startup:

```json
{
  "shell": "claude",
  "shellArgs": [],
  "bootSequence": true,
  "effects": {
    "scanlines": 45,
    "bloom": 30,
    "curvature": 15,
    "glitchRate": 8,
    "flicker": 5
  },
  "hud": true
}
```

All effect values are 0–100. `F9` cycles three presets — calm (all near 0),
medium (the values above), max (all near 100) — without editing the file.
`F10` toggles the HUD.

## 13. Testing

`test.js`, run with `node test.js`. Assert-based, no framework, no fixtures.
It covers the logic that can actually be wrong:

- Sniffer: each pattern in the §9 table maps to its scenario.
- Sniffer: unmatched input produces no scenario (the documented degrade path).
- Sniffer: patterns split across two chunk boundaries are still detected —
  PTY data arrives in arbitrary chunks, so the sniffer must buffer.
- Generators: each returns non-empty strings and stays within the HUD's
  column width.
- Config: out-of-range and missing values clamp to defaults rather than
  producing `NaN` in a CSS value.

Everything visual is verified by running the app and looking at it. Snapshot
testing a CRT glitch is not worth the machinery.

## 14. Delivery phases

**Phase 1 — visual prototype.** A single self-contained `prototype.html`,
published as an Artifact. Full CRT stack, chrome, HUD and glitch engine, fed
by faked terminal text instead of a real PTY. The user judges the motion —
flicker cadence, glitch frequency, bloom falloff, boot timing — in a browser.
A static mockup would misrepresent an app that is mostly animation.

**Phase 2 — Electron shell.** Port the approved CSS and canvas layers
unchanged into the Electron app, wire the real PTY, wire the sniffer to real
Claude Code output.

Phase 2 does not begin until the prototype's look is approved.
