/**
 * bridge/adapters/love2d.js
 *
 * Adapter for LÖVE2D games.
 *
 * Two ways to use this:
 *
 * 1. TEST MODE (no game running): runs Lua 5.1 via fengari-web, the same
 *    engine Rover uses in the browser. Lets you test the bridge protocol
 *    and the sandbox without a real LÖVE game.
 *
 * 2. PRODUCTION: the LÖVE game itself runs the bridge (see
 *    examples/love2d/game-bridge.lua). The game exposes its own Lua API as
 *    globals and Rover's editor calls them over WebSocket. This file is
 *    then a thin Node wrapper that simply forwards to the running game.
 *
 * Set LOVE2D_HOST to a game's WebSocket URL to use production mode.
 */

import fengari from "fengari-web";

const GAME_URL = process.env.LOVE2D_HOST || null;

export async function run(code, settings, globals) {
  if (GAME_URL) {
    return runRemote(code, settings, globals);
  }
  return runLocal(code, settings, globals);
}

async function runRemote(code, settings, globals) {
  // Forward to a running LÖVE game's WebSocket bridge.
  const ws = new WebSocket(GAME_URL);
  await new Promise((res, rej) => {
    ws.onopen = res; ws.onerror = rej; ws.onclose = rej;
  });
  const payload = JSON.stringify({ type: "run", id: "1", payload: { code, settings, globals } });
  ws.send(payload);
  const result = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("game timed out")), 5000);
    ws.onmessage = (ev) => { clearTimeout(t); res(JSON.parse(ev.data).payload); };
    ws.onerror = rej;
  });
  ws.close();
  return result;
}

function runLocal(code, settings, globals) {
  const s = settings || {};
  const L = fengari.lauxlib.luaL_newstate();
  fengari.lualib.luaL_openlibs(L);

  let output = "";
  let isError = false;

  const sandbox = s.sandbox || {};
  const runtime = s.runtime || {};
  const errors  = s.errors  || {};

  // ── blocked keywords ──────────────────────────────────────────────────────
  const blocked = sandbox.blockedKeywords || [];
  if (blocked.length) {
    const scan = String(code || "");
    for (const kw of blocked) {
      const pattern = typeof kw === "string" ? kw : kw.pattern;
      const message = typeof kw === "string"
        ? `Keyword "${kw}" is not allowed.`
        : (kw.message || `Keyword "${pattern}" is not allowed.`);
      const re = new RegExp("\\b" + escapeRe(pattern) + "\\b");
      if (re.test(scan)) return { output: message, isError: true };
    }
  }

  // ── instruction budget / wall-clock timeout ───────────────────────────────
  const maxInstr = sandbox.maxInstructions || 0;
  const maxSeconds = sandbox.maxSeconds || 0;
  let deadline = maxSeconds > 0 ? Date.now() + maxSeconds * 1000 : 0;
  let instrCount = 0;

  if ((maxInstr > 0 || maxSeconds > 0) && typeof fengari.lua.lua_sethook === "function") {
    fengari.lua.lua_sethook(L, hook, fengari.lua.LUA_MASKCOUNT, 1);
  }

  function hook(L) {
    if (maxInstr > 0) {
      instrCount++;
      if (instrCount > maxInstr) {
        fengari.lua.lua_sethook(L, null, 0, 0);
        fengari.lauxlib.luaL_error(L, fengari.to_luastring("instruction limit exceeded"));
      }
    }
    if (maxSeconds > 0 && Date.now() > deadline) {
      fengari.lua.lua_sethook(L, null, 0, 0);
      fengari.lauxlib.luaL_error(L, fengari.to_luastring("time limit exceeded"));
    }
  }

  // ── print override ────────────────────────────────────────────────────────
  fengari.lua.lua_getglobal(L, "print");
  fengari.lua.lua_pushjsfunction(L, function (L) {
    const n = fengari.lua.lua_gettop(L);
    const parts = [];
    for (let i = 1; i <= n; i++) {
      fengari.lua.lua_getglobal(L, "tostring");
      fengari.lua.lua_pushvalue(L, i);
      fengari.lua.lua_call(L, 1, 1);
      parts.push(fengari.lua.lua_tojsstring(L, -1));
      fengari.lua.lua_pop(L, 1);
    }
    output += parts.join("\t") + "\n";
    return 0;
  });
  fengari.lua.lua_setglobal(L, "print");

  // ── host globals ──────────────────────────────────────────────────────────
  if (globals && typeof globals === "object") {
    for (const [name, fn] of Object.entries(globals)) {
      fengari.lua.lua_pushjsfunction(L, function (L) {
        try {
          return fn(L);
        } catch (err) {
          fengari.lauxlib.luaL_error(L, fengari.to_luastring(String(err?.message || err)));
          return 0;
        }
      });
      fengari.lua.lua_setglobal(L, name);
    }
  }

  // ── remove unwanted globals ───────────────────────────────────────────────
  const remove = runtime.removeGlobals || [];
  for (const name of remove) {
    fengari.lua.lua_pushnil(L);
    fengari.lua.lua_setglobal(L, name);
  }

  // ── execute ───────────────────────────────────────────────────────────────
  const status = fengari.lauxlib.luaL_dostring(L, fengari.to_luastring(code || ""));
  if (status !== 0) {
    isError = true;
    let raw = fengari.lua.lua_tojsstring(L, -1) || "";
    for (const p of (errors.patterns || [])) {
      const re = new RegExp(p.re);
      if (re.test(raw)) raw = p.msg;
    }
    output = raw;
  }

  return { output, isError };
}

function escapeRe(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}