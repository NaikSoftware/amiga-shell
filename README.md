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

All effect sliders are 0–100 and clamped.

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

## Note on `--no-sandbox`

`npm start` passes `--no-sandbox`. On Linux, Electron's `chrome-sandbox` helper
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
npm run start:sandboxed
```

You must redo this after every `npm install` that replaces Electron.
