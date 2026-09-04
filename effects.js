/* effects.js — CRT intensity mapping, the glitch engine, and the Guru.
   The intensity mapping is a straight port of prototype.html's applyCfg
   (same custom-property names, same formulas). The glitch engine is not:
   the prototype clones DOM text nodes, here the source is xterm's canvas,
   so bursts are drawn onto our own transparent overlay canvas.

   Idle cost is zero — between bursts there is one setTimeout and nothing
   else: no rAF, no drawImage, overlay cleared. */

const DEFAULTS = { scanlines:45, bloom:30, curvature:15, glitchRate:8, flicker:5 };
const FLAVORS  = ["slice", "chroma", "roll", "corrupt"];
const GLYPHS   = "!@#$%^&*()_+-=[]{}|;:,.<>/?~ABCDEF0123456789█▓▒░◆◇▪▫";
const PHOSPHOR = "#3BFF6E";
const RED = "#FF2828", CYAN = "#28DCFF";

const rnd   = (a, b) => a + Math.random() * (b - a);
const rndi  = (a, b) => Math.floor(rnd(a, b + 1));
const pick  = a => a[Math.floor(Math.random() * a.length)];
const hex   = n => Array.from({length:n}, () => "0123456789ABCDEF"[rndi(0,15)]).join("");
const clamp = (v, k) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : DEFAULTS[k];
};

export function initEffects({ screenEl, getSourceCanvas, config } = {}) {
  const root   = document.documentElement;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => motion.matches;

  let cfg = { ...DEFAULTS, ...(config && config.effects ? config.effects : config) };

  /* ── intensity → CSS custom properties (port of applyCfg) ──── */

  function applyCfg(c) {
    const n = k => clamp(c[k], k);
    root.style.setProperty("--scan-op",  (n("scanlines") / 100 * .62).toFixed(3));
    root.style.setProperty("--bloom-r",  (1 + n("bloom") / 100 * 13).toFixed(1) + "px");
    root.style.setProperty("--bloom-op", (.25 + n("bloom") / 100 * .6).toFixed(3));
    root.style.setProperty("--curve",    (4 + n("curvature") / 100 * 46).toFixed(0) + "px");
    root.style.setProperty("--vig-op",   (.35 + n("curvature") / 100 * .62).toFixed(3));
    // reduced motion kills the flicker amplitude outright; the CSS media
    // query also stops the animation, this is the belt to that's braces.
    root.style.setProperty("--flick-amp",
      reduced() ? "0" : (n("flicker") / 100 * .17).toFixed(3));
    root.style.setProperty("--flick-dur", (7.5 - n("flicker") / 100 * 6).toFixed(2) + "s");
  }
  applyCfg(cfg);

  /* ── overlay canvas ────────────────────────────────────────── */

  const cv  = document.createElement("canvas");
  cv.className = "glitchcanvas";
  cv.setAttribute("aria-hidden", "true");
  cv.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;background:transparent";
  const ctx = cv.getContext("2d");
  // Slot in ahead of the scanline/vignette layers so the burst reads through
  // them, exactly like the prototype's .glitchlayer. insertBefore(x, null)
  // is append, so this is safe before Agent B's layers exist.
  screenEl.insertBefore(cv, screenEl.querySelector(".layer"));

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = screenEl.clientWidth || 1;
    H = screenEl.clientHeight || 1;
    cv.width  = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS pixels
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(screenEl);

  function source() {
    try {
      const c = getSourceCanvas && getSourceCanvas();
      return (c && c.width > 0 && c.height > 0) ? c : null;
    } catch { return null; }         // xterm not mounted, or DOM renderer
  }

  /* ── burst painters ────────────────────────────────────────── */

  // Tinted copy for the chroma split. The destination-in pass restores the
  // source's alpha so a source that reads back blank (WebGL buffer already
  // composited away) paints nothing instead of a full-screen colour wash.
  let scratch = null, sctx = null;
  function tintPass(src, color, dx, dy) {
    if (!scratch) { scratch = document.createElement("canvas"); sctx = scratch.getContext("2d"); }
    if (scratch.width !== cv.width || scratch.height !== cv.height) {
      scratch.width = cv.width; scratch.height = cv.height;
    }
    sctx.globalCompositeOperation = "source-over";
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(src, 0, 0, scratch.width, scratch.height);
    sctx.globalCompositeOperation = "multiply";
    sctx.fillStyle = color;
    sctx.fillRect(0, 0, scratch.width, scratch.height);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(src, 0, 0, scratch.width, scratch.height);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = .55;
    ctx.drawImage(scratch, dx, dy, W, H);
    ctx.restore();
  }

  function paintSlices(src, amp) {
    const n = rndi(3, 9);
    for (let i = 0; i < n; i++) {
      const y  = rnd(0, H);
      const h  = rnd(4, Math.max(6, H * .12));
      const dx = rnd(-amp, amp);
      if (src) {
        const sy = y / H * src.height, sh = h / H * src.height;
        ctx.drawImage(src, 0, sy, src.width, sh, dx, y, W, h);
      } else {
        // ponytail: no source canvas → coloured bars instead of displaced
        // pixels. Reads as a glitch, upgrade only if the DOM-renderer
        // fallback stops being a rare path.
        ctx.fillStyle = `rgba(59,255,110,${rnd(.05, .18).toFixed(3)})`;
        ctx.fillRect(dx, y, W, h);
      }
    }
  }

  function paintChroma(src, amp) {
    if (!src) {
      ctx.globalAlpha = .12;
      ctx.fillStyle = RED;  ctx.fillRect(-amp, rnd(-3, 3), W, H);
      ctx.fillStyle = CYAN; ctx.fillRect( amp, rnd(-3, 3), W, H);
      ctx.globalAlpha = 1;
      return;
    }
    tintPass(src, RED,  -amp, rnd(-2, 2));
    tintPass(src, CYAN,  amp, rnd(-2, 2));
  }

  function paintRoll(src, t) {
    const off = (t * 2 % 1) * H;
    if (src) {
      ctx.globalAlpha = .85;
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, off,     W, H);
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, off - H, W, H);
      ctx.globalAlpha = 1;
    }
    const g = ctx.createLinearGradient(0, off - 26, 0, off + 26);
    g.addColorStop(0,  "rgba(120,255,160,0)");
    g.addColorStop(.5, "rgba(120,255,160,.16)");
    g.addColorStop(1,  "rgba(120,255,160,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, off - 26, W, 52);
  }

  // Region + glyph grid are fixed for the whole burst so the garbage sits
  // still and "heals" when the overlay clears at the burst boundary.
  let corruptBox = null, corruptRows = null;
  function planCorrupt() {
    const fs = 15, cw = fs * .6, lh = fs * 1.25;
    const w = rnd(W * .25, W * .7), h = rnd(H * .1, H * .35);
    corruptBox = { x: rnd(0, Math.max(0, W - w)), y: rnd(0, Math.max(0, H - h)), w, h, fs, lh, cw };
    corruptRows = Array.from({ length: Math.ceil(h / lh) }, () =>
      Array.from({ length: Math.ceil(w / cw) }, () => pick(GLYPHS)).join(""));
  }
  function paintCorrupt(src) {
    const b = corruptBox;
    if (src) {
      const sx = b.x / W * src.width, sy = b.y / H * src.height;
      ctx.drawImage(src, sx, sy, b.w / W * src.width, b.h / H * src.height,
                    b.x + rnd(-3, 3), b.y, b.w, b.h);
    }
    ctx.fillStyle = "rgba(10,20,10,.85)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.font = `${b.fs}px ui-monospace,monospace`;
    ctx.textBaseline = "top";
    ctx.fillStyle = Math.random() < .2 ? "#FFB627" : PHOSPHOR;
    corruptRows.forEach((row, i) => ctx.fillText(row, b.x + 2, b.y + i * b.lh));
  }

  /* ── burst loop ────────────────────────────────────────────── */

  let raf = null, timer = null, running = false, endAt = 0, flavor = "slice";

  function frame() {
    const now = performance.now();
    if (now >= endAt) { endBurst(); return; }
    const t = 1 - (endAt - now) / 400;
    const src = source();
    const amp = rnd(4, 12);
    ctx.clearRect(0, 0, W, H);
    if (flavor === "roll")         paintRoll(src, t);
    else if (flavor === "corrupt") paintCorrupt(src);
    else if (flavor === "chroma")  { paintChroma(src, amp); paintSlices(src, amp * .4); }
    else                           { paintSlices(src, amp); paintChroma(src, amp * .5); }
    raf = requestAnimationFrame(frame);
  }

  function endBurst() {
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    ctx.clearRect(0, 0, W, H);
    endAt = 0;
    screenEl.classList.remove("glitching");
  }

  function glitch(ms) {
    if (reduced()) return;
    const dur = Math.max(40, Number(ms) || rnd(80, 400));
    endAt = performance.now() + dur;
    flavor = source() ? pick(FLAVORS) : pick(["slice", "chroma"]);
    if (flavor === "corrupt") planCorrupt();
    screenEl.classList.add("glitching");
    if (raf === null) raf = requestAnimationFrame(frame);   // no double loop
  }

  /* ── Poisson-ish scheduler (port of scheduleGlitch) ─────────── */

  function scheduleGlitch() {
    const wait = rnd(1400, 14000) * (12 / Math.max(1, clamp(cfg.glitchRate, "glitchRate")));
    timer = setTimeout(() => { timer = null; glitch(); scheduleGlitch(); }, wait);
  }

  function start() {
    if (running || reduced()) return;
    running = true;
    scheduleGlitch();
  }

  function stop() {
    running = false;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    endBurst();
    hideGuru();     // stop() leaves nothing pending, banner included
  }

  /* ── Guru Meditation ───────────────────────────────────────── */

  const guruEl = document.createElement("div");
  guruEl.className = "guru";
  guruEl.hidden = true;
  // Inline styles duplicate prototype .guru so the banner is correct even if
  // Agent B's stylesheet names the class differently. Not pointer-events:none
  // — the Guru is dismissable by click. It never takes focus.
  guruEl.style.cssText =
    "position:absolute;top:0;left:0;right:0;z-index:9;background:#000;" +
    "border:4px solid #FF2A2A;padding:12px;text-align:center;cursor:pointer;" +
    "font-family:var(--term,monospace);font-size:20px;color:#FF2A2A;user-select:none";
  guruEl.addEventListener("click", () => hideGuru());
  screenEl.appendChild(guruEl);

  let guruTimer = null, guruFlash = null;
  function hideGuru() {
    guruEl.hidden = true;
    if (guruTimer !== null) { clearTimeout(guruTimer); guruTimer = null; }
    if (guruFlash !== null) { clearInterval(guruFlash); guruFlash = null; }
  }
  function guru() {
    hideGuru();
    guruEl.innerHTML =
      "Software Failure. &nbsp;Press left mouse button to continue.<br>" +
      `Guru Meditation #0000000${rndi(1, 8)}.0000${hex(4)}`;
    guruEl.hidden = false;
    glitch(260);
    if (!reduced()) {
      // A CSS @keyframes would beat this inline write, so whichever of the
      // two Agent B ships, the border still flashes.
      let on = true;
      guruFlash = setInterval(() => {
        on = !on;
        guruEl.style.borderColor = on ? "#FF2A2A" : "#000";
      }, 410);
    }
    guruTimer = setTimeout(hideGuru, 2600);
  }

  function setConfig(effectsCfg) {
    cfg = { ...cfg, ...(effectsCfg || {}) };
    applyCfg(cfg);
  }

  return { glitch, guru, setConfig, start, stop };
}
