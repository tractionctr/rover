/**
 * bridge/index.js — Rover bridge server.
 *
 * Lets the in-browser Rover IDE drive an *external* Lua engine
 * (LÖVE2D, LuaJIT, luajit, …) over WebSocket. The host project runs this
 * server, exposes its Lua API as globals, and Rover's editor calls them.
 *
 * Protocol (JSON frames over WS):
 *   client -> server:  { type: "run", id, payload: { code, settings, globals } }
 *   server -> client:  { type: "result", id, payload: { output, isError } }
 *
 * Usage:
 *   node bridge/index.js --port 37373 --lua love2d
 *
 * The --lua flag selects a built-in adapter. Each adapter is a plain JS
 * module that exports { run(code, settings, globals) => { output, isError } }.
 */

import { createServer } from "node:net";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = argv.slice(2);
  const out = { port: 37373, lua: "fengari", globalsFile: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" && args[i + 1]) out.port = Number(args[++i]);
    else if (a === "--lua"  && args[i + 1]) out.lua   = args[++i];
    else if (a === "--globals" && args[i + 1]) out.globalsFile = args[++i];
    else if (a.startsWith("--port=")) out.port = Number(a.slice(7));
    else if (a.startsWith("--lua="))  out.lua   = a.slice(6);
    else if (a.startsWith("--globals=")) out.globalsFile = a.slice(10);
  }
  return out;
}

// ─── Adapter loader ──────────────────────────────────────────────────────────

async function loadAdapter(name) {
  // Built-in adapters live next to this file. Use file:// so the ESM loader
  // is happy on every platform (Windows needs a scheme, not a bare path).
  const path = new URL(`adapters/${name}.js`, `file://${__dirname}/`).href;
  try {
    const mod = await import(path);
    if (typeof mod.run !== "function") throw new Error("adapter has no run()");
    return mod;
  } catch (e) {
    console.error(`[bridge] adapter "${name}": ${e.message}`);
    exit(1);
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────

export async function startBridge(opts) {
  const adapter = await loadAdapter(opts.lua);

  // Load host globals from a JS module if provided. The module exports a
  // default object of { name: (L, ...args) => pushesN } functions.
  let globals = null;
  if (opts.globalsFile) {
    const url = new URL(opts.globalsFile, `file://${process.cwd()}/`).href;
    const mod = await import(url);
    globals = mod.default || mod;
  }

  const wss = new WebSocketServer({ port: opts.port });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello", lua: opts.lua }));

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== "run") return;

      console.error("[bridge] calling adapter.run...");
      try {
        // Globals are owned by the host game/adapter, not sent over the wire
        // (they are JS functions and can't be JSON-serialized). The adapter
        // exposes its own API; the browser only sends code + settings.
        const result = await adapter.run(msg.payload.code, msg.payload.settings, globals);
        console.error("[bridge] adapter.run returned:", JSON.stringify(result));
        ws.send(JSON.stringify({ type: "result", id: msg.id, payload: result }));
      } catch (err) {
        console.error("[bridge] handler error:", err);
        ws.send(JSON.stringify({
          type: "result", id: msg.id,
          payload: { output: "Bridge error: " + String(err?.message || err), isError: true },
        }));
      }
    });
  });

  wss.on("error", (e) => { console.error("[bridge]", e.message); exit(1); });

  console.log(`[bridge] listening on ws://localhost:${opts.port} (lua=${opts.lua})`);
  return wss;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startBridge(parseArgs());
}