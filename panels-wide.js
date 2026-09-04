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
 *     `.deck.panels .panel` in style.css) and a fixed flex-basis fights that;
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

export const WIDE_PANELS = {
  wcores:   {title:"CPU CORES  LIVE", kind:"canvas", paint:paintCores,      wide:1},
  wstorage: {title:"STORAGE  LIVE",   kind:"canvas", paint:paintStorage,    wide:1},
  wsysinfo: {title:"SYSTEM  LIVE",    kind:"canvas", paint:paintVitalsReal, wide:1},
  wchrono:  {title:"CHRONO",          kind:"canvas", paint:paintChrono,     wide:1},
  wnet:     {title:"PACKET LOG",      kind:"net",    gen:"portScan",    rate:900, wide:1},
  wdaemons: {title:"DAEMONS",         kind:"lines",  gen:"procList",    rate:220, wide:1},
  wfswalk:  {title:"FILE TABLE",      kind:"lines",  gen:"fsWalk",      rate:150, wide:1}
};

/* Same scenario keys as hud.js's LAYOUTS, three slots at a time — the bar has
   three. Four of the seven panels are real machine telemetry and one is the
   real /proc/net feed, which is the point of the bar when no operation is
   running: the machine you are actually sitting at, not more fiction. */
export const BOTTOM_LAYOUTS = {
  idle:  [["wcores","wnet","wchrono"], ["wsysinfo","wstorage","wnet"], ["wchrono","wcores","wstorage"]],
  think: [["wcores","wsysinfo","wchrono"], ["wcores","wnet","wdaemons"]],
  read:  [["wstorage","wfswalk","wsysinfo"], ["wcores","wfswalk","wchrono"]],
  edit:  [["wstorage","wfswalk","wcores"], ["wsysinfo","wfswalk","wnet"]],
  bash:  [["wcores","wdaemons","wnet"], ["wsysinfo","wdaemons","wstorage"]],
  net:   [["wnet","wcores","wchrono"], ["wnet","wsysinfo","wdaemons"]],
  task:  [["wdaemons","wcores","wsysinfo"], ["wdaemons","wchrono","wstorage"]]
};
