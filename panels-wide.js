/* panels-wide.js — the bottom bar's panel set.
 *
 * The side column is 290px wide and stacks vertically; the bottom bar is the
 * full window width, ~190px tall, and lays out horizontally, so its slots run
 * around 500x175. A panel drawn for the column sits in one of those looking
 * lost, and a panel drawn for the bar is unreadable in the column — so a spec
 * marked `wide` belongs to the bottom region and nothing else. hud.js reads
 * that flag (`regionOf`) and refuses to mount a panel in the wrong region,
 * pins included.
 *
 * Same spec shape hud.js already builds — {title, kind, paint|gen, rate} —
 * so these get a header, a pin gadget and a place in the rotation like any
 * other panel. Two deliberate differences from the column specs:
 *
 *   - no `grow`/`h`: the bottom slots share the bar's width evenly (see
 *     `.panelbar .panel` in style.css) and a fixed flex-basis fights that;
 *   - the painters are reused verbatim from panels-sys.js and panels-clock.js.
 *     They all size off (w,h), so nothing had to be rewritten to go wide.
 *
 * ponytail: painters carrying module-level state (panels-extra's waterfall
 * scroll row, its spectrum bar arrays) are deliberately NOT duplicated here.
 * Two mounted instances would share that state and smear into each other. The
 * ones below are stateless or keyed by their input, so a column copy and a bar
 * copy can coexist. Key the state per panel if a waterfall is ever wanted down
 * here too.
 */

import { paintCores, paintVitalsReal, paintStorage } from "./panels-sys.js";
import { paintChrono } from "./panels-clock.js";
import { paintWorldMap, currentNewsMarker, newsMarkerCount } from "./worldmap.js";

/* The map's header doubles as the "now showing" label. `head(t)` is the only
   extra hook in the spec shape: hud.js calls it once a frame for a canvas
   panel that has one and writes the result into the title span, exactly the
   way it already swaps in MIC LIVE. LIVE is asserted only when real
   headlines have actually arrived. */
function mapHead(t){
  if (!newsMarkerCount()) return "WORLD MAP";
  const m = currentNewsMarker(t);
  return m ? "NEWS WATCH \u25CF LIVE  " + m.place : "NEWS WATCH \u25CF LIVE";
}

export const WIDE_PANELS = {
  wmap:     {title:"WORLD MAP",        kind:"canvas", paint:paintWorldMap,
             head:mapHead, wide:1},
  wactivity:{title:"CLAUDE ACTIVITY",  kind:"activity", rate:1000, wide:1},
  wcores:   {title:"CPU CORES  LIVE", kind:"canvas", paint:paintCores,      wide:1},
  wstorage: {title:"STORAGE  LIVE",   kind:"canvas", paint:paintStorage,    wide:1},
  wsysinfo: {title:"SYSTEM  LIVE",    kind:"canvas", paint:paintVitalsReal, wide:1},
  wchrono:  {title:"CHRONO",          kind:"canvas", paint:paintChrono,     wide:1},
  wnet:     {title:"PACKET LOG",      kind:"net",    gen:"portScan",    rate:900, wide:1},
  wdaemons: {title:"DAEMONS",         kind:"lines",  gen:"procList",    rate:220, wide:1},
  wfswalk:  {title:"FILE TABLE",      kind:"lines",  gen:"fsWalk",      rate:150, wide:1}
};

/* Same scenario keys as hud.js's LAYOUTS, three slots at a time — the bar has
   three. Six of the nine panels are real: four machine telemetry, the real
   /proc/net feed, the map's real headlines and the real sniffed tool calls.
   That is the point of the bar: the machine you are actually sitting at.

   WORLD MAP is in most rotations of every scenario, because it is the one
   panel worth looking at, and CLAUDE ACTIVITY leads the scenarios the sniffer
   itself produced — if the stream said "Bash", the log of what it said
   belongs on screen. Neither is privileged beyond that: every scenario also
   has a rotation without them, so both come and go like any other panel, and
   both pin like any other panel. */
export const BOTTOM_LAYOUTS = {
  idle:  [["wmap","wnet","wchrono"], ["wsysinfo","wstorage","wnet"], ["wchrono","wcores","wmap"]],
  think: [["wmap","wsysinfo","wactivity"], ["wcores","wnet","wdaemons"]],
  read:  [["wactivity","wfswalk","wmap"], ["wcores","wfswalk","wchrono"]],
  edit:  [["wactivity","wfswalk","wcores"], ["wmap","wfswalk","wstorage"]],
  bash:  [["wactivity","wdaemons","wmap"], ["wsysinfo","wdaemons","wstorage"]],
  net:   [["wnet","wmap","wchrono"], ["wnet","wsysinfo","wdaemons"]],
  task:  [["wactivity","wcores","wmap"], ["wdaemons","wchrono","wstorage"]]
};
