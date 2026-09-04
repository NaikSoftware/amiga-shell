#!/usr/bin/env node
// Fetch the Topaz TTF into fonts/.
//
// Topaz-8 is the Amiga system font and ships with no machine on earth any more.
// This is the ONLY outbound network call in the build and it is a convenience:
// the CSS stack falls back to "Ubuntu Mono, monospace" and the app is fully
// functional without it. So this script never fails the install — it prints
// where to get the font by hand and exits 0.
//
// Dependency-free on purpose: node's built-in fetch, nothing else.

"use strict";

const fs = require("fs");
const path = require("path");

// dMG / Trueschool's TrueType reconstruction of Topaz, the mirror everybody
// uses. Pinned to a commit-independent path on the default branch — if this
// ever 404s the manual instructions below still stand.
const URL =
  "https://raw.githubusercontent.com/rewtnull/amigafonts/master/ttf/TopazPlus_a1200_v1.0.ttf";

const DIR = path.join(__dirname, "..", "fonts");
const FILE = path.join(DIR, "TopazPlus_a1200.ttf");  // the name style.css asks for

// A 404 page is 200 OK with HTML in it. Only the sfnt magic proves it's a font:
// 0x00010000 (TrueType), "OTTO" (CFF), "true"/"ttcf" (Mac / collection).
function isFont(buf) {
  if (buf.length < 4) return false;
  const m = buf.readUInt32BE(0);
  return m === 0x00010000 || m === 0x4f54544f || m === 0x74727565 || m === 0x74746366;
}

function manual(reason) {
  console.error(`\n[amiga] Topaz font not installed: ${reason}`);
  console.error("[amiga] The app works fine without it (falls back to Ubuntu Mono).");
  console.error("[amiga] To install it by hand, drop any Topaz TTF here:");
  console.error(`[amiga]   ${FILE}`);
  console.error("[amiga] Sources: https://github.com/rewtnull/amigafonts (ttf/)");
  console.error("[amiga]          https://www.trueschool.se/  (dMG's originals)\n");
}

async function main() {
  if (fs.existsSync(FILE)) {
    console.log(`[amiga] font already present: ${FILE}`);
    return;
  }

  let buf;
  try {
    const res = await fetch(URL, { redirect: "follow" });
    if (!res.ok) return manual(`HTTP ${res.status} from ${URL}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return manual(`${err.message} (offline?)`);
  }

  if (!isFont(buf)) {
    return manual(`downloaded ${buf.length} bytes but they are not a TTF`);
  }

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, buf);
  console.log(`[amiga] Topaz installed: ${FILE} (${buf.length} bytes)`);
}

main().catch((err) => manual(err.message)); // never non-zero: this is optional
