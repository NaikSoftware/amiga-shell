// AmigaTerm — context bridge. Exactly two objects cross, nothing else.
// The renderer never sees ipcRenderer, require, fs or child_process.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Synchronous handshake so window.amiga.config is a value, not a promise.
const boot = ipcRenderer.sendSync("amiga:bootstrap");

contextBridge.exposeInMainWorld("pty", {
  onData: (cb) => ipcRenderer.on("pty:data", (_e, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on("pty:exit", (_e, info) => cb(info)),
  write: (data) => ipcRenderer.send("pty:write", String(data)),
  resize: (cols, rows) => ipcRenderer.send("pty:resize", cols, rows)
});

contextBridge.exposeInMainWorld("amiga", {
  config: boot.config,
  shellError: boot.shellError,
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close"),
  // headlines pushed from main; renderer never spawns anything itself
  onNews: (cb) => ipcRenderer.on("news:data", (_e, lines) => cb(lines)),
  // geolocated headlines for the world map, already parsed and clamped
  onNewsMap: (cb) => ipcRenderer.on("newsmap:data", (_e, markers) => cb(markers))
});
