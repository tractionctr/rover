/**
 * runtime.js — pluggable Lua runtime abstraction.
 *
 * Rover is an IDE, not a specific engine. This module defines the contract
 * between the editor (main.js) and whatever Lua runtime is attached:
 *
 *   LocalRuntime   — fengari-web, runs in the browser (current behaviour)
 *   RemoteRuntime  — talks to an external engine over WebSocket
 *
 * Both expose the same interface:
 *
 *   run(code, settings, globals) -> { output, isError }
 *   onmessage / onerror callbacks
 *
 * A host project can swap runtimes at construction time so the same editor
 * can drive a browser VM, a native LuaJIT, a LÖVE2D game, etc.
 */

import * as fengari from "fengari-web";

// ─── LocalRuntime (fengari-web) ──────────────────────────────────────────────

export class LocalRuntime {
  constructor() {
    this.onmessage = null;
    this.onerror   = null;
    this._worker   = null;
  }

  run(code, settings, globals) {
    if (!this._worker) {
      this._worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      this._worker.onmessage = (e) => {
        if (this.onmessage) this.onmessage(e.data);
      };
      this._worker.onerror = (e) => {
        if (this.onerror) this.onerror(e);
      };
    }
    const msg = { code };
    if (settings) msg.settings = settings;
    if (globals)  msg.globals  = globals;
    this._worker.postMessage(msg);
  }

  terminate() {
    if (this._worker) { this._worker.terminate(); this._worker = null; }
  }
}

// ─── RemoteRuntime (WebSocket bridge to an external engine) ──────────────────

export class RemoteRuntime {
  /**
   * @param {string} url  ws:// or wss:// URL of the Rover bridge server
   */
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror   = null;
    this._ws = null;
    this._pending = new Map();   // id -> { resolve, reject, timer }
    this._queue = [];            // messages queued before connection
    this._nextId = 1;
    this._connect();
  }

  _connect() {
    try {
      this._ws = new WebSocket(this.url);
    } catch (e) {
      if (this.onerror) this.onerror(e);
      return;
    }
    this._ws.onopen = () => {
      // Flush queued messages now that we're connected.
      this._flushQueue();
    };
    this._ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "result" && this._pending.has(msg.id)) {
        const p = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        clearTimeout(p.timer);
        if (this.onmessage) this.onmessage(msg.payload);
      }
    };
    this._ws.onerror = (e) => {
      if (this.onerror) this.onerror(e);
    };
    this._ws.onclose = () => {
      // Auto-reconnect so the IDE stays usable across engine restarts.
      setTimeout(() => this._connect(), 1500);
    };
  }

  run(code, settings, globals) {
    const id = this._nextId++;
    const payload = { code, settings, globals };
    const frame = JSON.stringify({ type: "run", id, payload });

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      // Not connected yet — queue it with its ID so we can match the response.
      this._queue.push({ id, frame });
      return;
    }
    this._ws.send(frame);

    // Hard client-side timeout — the bridge is expected to respond quickly.
    const timer = setTimeout(() => {
      if (this._pending.has(id)) {
        this._pending.delete(id);
        if (this.onmessage)
          this.onmessage({ output: "❌ Bridge timed out", isError: true });
      }
    }, 5000);
    this._pending.set(id, { resolve: () => {}, reject: () => {}, timer });
  }

  _flushQueue() {
    for (const { id, frame } of this._queue) {
      this._ws.send(frame);
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          if (this.onmessage)
            this.onmessage({ output: "❌ Bridge timed out", isError: true });
        }
      }, 5000);
      this._pending.set(id, { resolve: () => {}, reject: () => {}, timer });
    }
    this._queue = [];
  }

  terminate() {
    if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
  }
}

// ─── Default export: a factory matching the shape main.js expects ────────────

export function createRuntime(kind, url) {
  if (kind === "remote") return new RemoteRuntime(url);
  return new LocalRuntime();
}