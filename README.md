# AmigaTerm

A real, general-purpose terminal emulator styled as an Amiga Workbench 1.3
window wrapped around a green-phosphor CRT screen, with a fake-hacking HUD.

It runs `vim`, `htop`, `less`, `ssh`, `git`, `python` — anything, exactly like
any other terminal. Claude Code is the primary use case, not a dependency: the
HUD gains an extra layer of reactivity when it spots Claude Code's tool-call
markers in the output stream, and works fine when it doesn't.

Electron + xterm.js + node-pty. No bundler, no framework.

Want to see the look first? Open `prototype.html` in a browser — it is a
complete, animated, standalone preview. Nothing to install.

## Install

```sh
npm install
node scripts/fetch-font.js   # optional Amiga font, see below
npm start
npm test             # node test.js
```

## Configuration

`config.json`, hand-edited, read at startup. Missing or out-of-range values
fall back to the defaults below rather than reaching CSS as `NaN`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `shell` | string \| null | `null` | `null` = `$SHELL`, else `/bin/bash` |
| `shellArgs` | string[] | `[]` | Extra args for the shell |
| `fontSize` | number | `16` | Terminal font size, px (6–72) |
| `bootSequence` | bool | `true` | Play the Kickstart boot animation |
| `hud` | bool | `true` | Show the HUD column and bottom strip |
| `effects.scanlines` | 0–100 | `45` | CRT scanline density |
| `effects.bloom` | 0–100 | `30` | Phosphor glow |
| `effects.curvature` | 0–100 | `15` | Screen barrel curve |
| `effects.glitchRate` | 0–100 | `8` | How often glitch bursts fire |
| `effects.flicker` | 0–100 | `5` | Brightness flicker |
| `micEqualizer` | bool | `false` | Feed the real microphone into WAVEFORM / SPECTRUM |

All effect sliders are 0–100 and clamped.

## Microphone (off by default)

The `WAVEFORM` and `SPECTRUM` panels can show your actual microphone —
`getUserMedia` -> `AnalyserNode`, a live trace in the first and a
log-spaced equaliser with falling peak caps in the second. It is off
unless `config.json` contains `"micEqualizer": true`, and only then does
the app ever ask for the device. A terminal emulator has no business
opening the mic on its own.

When it is on, the panel headers read `WAVEFORM  MIC LIVE` /
`SPECTRUM  MIC LIVE` — and only while audio is genuinely arriving. If the
key is absent or false, permission is denied, there is no input device, or
anything else goes wrong, the panels keep drawing the same generated
animation they always did, with the plain header. No dialog, no console
noise, no retry loop: one refusal is the answer. Same rule as `PACKET LOG`,
which is real `/proc/net` data on Linux and fiction everywhere else.

The device is opened lazily by the first frame that needs it and released
five seconds after the last one — so rotating the panel off screen, or
switching the HUD off with `F10`, closes the stream and the `AudioContext`
rather than leaving the mic indicator burning.

## Hotkeys

| Key | Action |
|---|---|
| `F9` | Cycle effect intensity: calm / medium / max |
| `F10` | Toggle the HUD (terminal reflows to full width) |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste |
| `Ctrl+Shift+M` | Run a random HUD mission |

Everything else goes to the PTY untouched.

## Font

Topaz-8 is the Amiga system font and is installed nowhere.
`node scripts/fetch-font.js` downloads a free TrueType reconstruction into
`fonts/`. This is the only outbound network call in the build.

If it fails, the script says so and exits 0 — the CSS falls back to
`Ubuntu Mono, monospace` and the app is fully functional. To install by hand,
drop any Topaz TTF into `fonts/` as `TopazPlus_a1200.ttf`; the usual
source is <https://github.com/rewtnull/amigafonts> (`ttf/`).

## Design

`docs/superpowers/specs/2026-09-04-amiga-terminal-design.md`.

## Platforms

Developed and tested on **Linux (Wayland/KDE)**. It should run on macOS and
Windows — nothing in the code is Linux-specific — but neither has been tested,
so treat the notes below as "what to expect", not "known good".

### macOS

```sh
npm install     # MUST be run on the Mac: node-pty compiles a native binary,
                # so a node_modules copied from Linux will not load
npm start
```

Needs Xcode Command Line Tools (`xcode-select --install`) for that build.
`npm start` detects the platform and omits `--no-sandbox`, which is a Linux-only
workaround — on macOS the Chromium sandbox works and stays on.

Two things differ on a Mac:

- **Font.** The stack includes `Menlo`, `SF Mono` and `Monaco`, so it will pick
  Menlo. Fine coverage, slightly different look from the Linux build.
- **The `claude -p` news feeds** shell out to `claude` on `PATH`. That works when
  you launch from a terminal with `npm start`. If you ever bundle this as a
  double-clickable `.app`, GUI processes on macOS do not inherit your shell
  `PATH`, so `claude` will not be found and both feeds go quiet — harmless
  (they fail silently by design), but set an absolute path if you need them.

`$SHELL` will be `/bin/zsh` and is used as-is; the `/bin/bash` fallback only
applies if `$SHELL` is unset.

### Windows

Untested and least likely to work first try: `node-pty` uses ConPTY there, and
the shell default would need to be `powershell.exe` or `cmd.exe` via
`config.shell`. Expect to do some work.

## Note on `--no-sandbox` (Linux only)

On Linux, `npm start` passes `--no-sandbox`. On Linux, Electron's `chrome-sandbox` helper
must be owned by root with mode 4755, which a plain `npm install` cannot do, so
without the flag the app aborts at launch with:

```
The SUID sandbox helper binary was found, but is not configured correctly.
```

The Chromium sandbox is a boundary against untrusted web content. This app loads
only local files and renders your own shell's output, and it spawns that shell
with your full privileges by design — so the sandbox is not the security boundary
here that it is in a browser.

To run with it enabled anyway:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm start
```

You must redo this after every `npm install` that replaces Electron.
