# AmigaTerm — module contract (binding, do not renegotiate)

Every agent builds against this. If you think an interface is wrong, implement
it as written and note the objection in your report. Do not change it
unilaterally — other agents are writing to it right now, in parallel.

Full design: `docs/superpowers/specs/2026-09-04-amiga-terminal-design.md`.
Visual reference: `prototype.html` (complete, working, animated — port its CSS
and its logic; do not reinvent the look).

## Prime directive

**This is a real terminal.** It runs `vim`, `htop`, `less`, `ssh`, `git`,
`python`, anything. Claude Code is one program you can run in it, not a
dependency. Nothing in the effects or HUD may interfere with the byte stream,
input handling, or resize behavior. If an effect would break `Ctrl-C`, the
effect loses.

## File ownership — touch ONLY your own files

| Agent | Owns |
|---|---|
| A — main | `package.json`, `main.js`, `preload.js`, `config.json`, `.gitignore` |
| B — renderer | `index.html`, `style.css`, `renderer.js` |
| C — effects | `effects.js` |
| D — hud | `hud.js`, `worldmap.js` |
| E — test/docs | `test.js`, `README.md`, `scripts/fetch-font.js` |

Never edit another agent's file. Never create a file outside your column.

## Interfaces

### preload → renderer (Agent A provides, B consumes)

```js
window.pty = {
  onData(cb),          // cb(string) — raw PTY output
  onExit(cb),          // cb({exitCode})
  write(data),         // string -> PTY
  resize(cols, rows)   // number, number
};
window.amiga = {
  config,              // the parsed config.json object, defaults already applied
  minimize(), maximize(), close(),   // window gadgets
  shellError            // null, or a string describing a failed shell spawn
};
```

`contextIsolation: true`, `nodeIntegration: false`. Nothing else crosses.

### effects.js (Agent C provides, B consumes)

```js
export function initEffects({ screenEl, getSourceCanvas, config }) {
  return {
    glitch(ms),            // one burst now; ms optional
    guru(),                // Guru Meditation banner, self-healing
    setConfig(effectsCfg), // {scanlines,bloom,curvature,glitchRate,flicker} 0-100
    start(), stop()
  };
}
```

- `screenEl` is the `.screenwrap` element. `getSourceCanvas()` returns the live
  xterm canvas (or null before xterm mounts — handle that).
- Applies intensity by setting CSS custom properties on `document.documentElement`,
  exactly the names `prototype.html` already uses.
- The glitch overlay is your own `<canvas>` appended into `screenEl`.
- **Idle cost must be zero**: no `drawImage`, no rAF work between bursts.

### hud.js (Agent D provides, B consumes)

```js
export function initHud({ hudEl, barEl, config, effects }) {
  return {
    feed(chunk),      // called with every PTY chunk, AFTER xterm.write
    setEnabled(bool), // F10 toggle
    setConfig(cfg),
  };
}
```

- `feed` is a **read-only tap**. It must never throw, block, or mutate the
  chunk. Wrap the whole body in try/catch — a HUD bug must not kill the
  terminal.
- Buffer across chunks: PTY data splits at arbitrary byte boundaries, so a
  marker like `⏺ Bash(` can arrive in two pieces. Keep a rolling tail buffer
  (cap it, e.g. 4 KB) and match against it.
- If nothing matches, do nothing — ambient mode continues. A missed match is
  the documented degrade path, not an error.

## config.json

```json
{
  "shell": null,
  "shellArgs": [],
  "fontSize": 16,
  "bootSequence": true,
  "hud": true,
  "effects": { "scanlines": 45, "bloom": 30, "curvature": 15, "glitchRate": 8, "flicker": 5 }
}
```

`shell: null` means "use `$SHELL`, else `/bin/bash`". All effect values 0–100;
clamp out-of-range and missing values to the defaults above rather than
producing `NaN` in a CSS value.

## Hotkeys (Agent B owns the bindings)

`F10` toggle HUD · `Ctrl+Shift+C/V` copy/paste ·
`F7` toggle gadget bar &middot; `F8` shuffle panels. Everything else goes to the PTY untouched.

## House style

- Plain ES modules in the renderer, CommonJS in main. No bundler, no TypeScript,
  no framework, no new dependencies beyond `electron`, `node-pty`, `@xterm/xterm`,
  `@xterm/addon-webgl`, `@xterm/addon-fit`.
- Match `prototype.html`'s naming and comment density.
- Mark a deliberate shortcut with a `ponytail:` comment naming its ceiling.
- Keep each file under ~400 lines.

## Reporting

Return: files written, how you verified them, anything you could not do, and
any place you had to guess at another agent's behavior.
