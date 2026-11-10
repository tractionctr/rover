/**
 * worker.js — Web Worker entry point.
 *
 * Receives a message { code, settings, globals } and runs the Lua source
 * inside fengari-web, returning { output, ... }.
 *
 * Settings are applied *per run* (sandbox, speed, errors). Host globals are
 * injected into the state so a host page can expose native functions to Lua.
 *
 * All fengari logic is inlined here to avoid module-sharing issues between
 * the worker and the main thread.
 */

import fengari from "fengari-web";

onmessage = (e) => {
  const { code, settings, globals } = e.data || {};
  try {
    const result = runLua(code, settings, globals);
    postMessage({ output: result.output, isError: result.isError });
  } catch (err) {
    postMessage({ output: "Worker crash: " + String(err?.message || err), isError: true });
  }
};

function runLua(code, settings, globals) {
  const s = settings || {};
  const L = fengari.lauxlib.luaL_newstate();
  fengari.lualib.luaL_openlibs(L);

  let output = "";
  let isError = false;

  // settings is the nested object from settings.js: settings.sandbox.*,
  // settings.runtime.*, settings.algebra.*, settings.errors.*.
  const sandbox = s.sandbox || {};
  const runtime = s.runtime || {};
  const errors  = s.errors  || {};

  // ── Sandbox: block forbidden statements/keywords ──────────────────────────
  const blocked = sandbox.blockedKeywords || [];
  if (blocked.length) {
    const scan = String(code || "");
    for (const kw of blocked) {
      // Accept both "while" and { pattern: "while", message: "..." }
      const pattern = typeof kw === "string" ? kw : kw.pattern;
      const message = typeof kw === "string"
        ? `Keyword "${kw}" is not allowed.`
        : (kw.message || `Keyword "${pattern}" is not allowed.`);
      const re = new RegExp("\\b" + escapeRe(pattern) + "\\b");
      if (re.test(scan)) {
        return { output: message, isError: true };
      }
    }
  }

  // ── Sandbox: instruction budget via lua_sethook ────────────────────────────
  const maxInstr = sandbox.maxInstructions || 0;
  let instrCount = 0;
  if (maxInstr > 0 && typeof fengari.lua.lua_sethook === "function") {
    fengari.lua.lua_sethook(L, hook, fengari.lua.LUA_MASKCOUNT, maxInstr);
  }

  // ── Sandbox: wall-clock timeout via lua_sethook (count-based fallback) ────
  const maxSeconds = sandbox.maxSeconds || 0;
  let deadline = 0;
  if (maxSeconds > 0) deadline = Date.now() + maxSeconds * 1000;

  function hook(L, arg1, arg2) {
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

  // ── Host globals ──────────────────────────────────────────────────────────
  if (globals && typeof globals === "object") {
    for (const [name, fn] of Object.entries(globals)) {
      fengari.lua.lua_pushjsfunction(L, function (L) {
        try {
          return fn(L);
        } catch (err) {
          fengari.lauxlib.luaL_error(L, fengari.to_luastring(String(err?.message || err)));
          return 0; // unreachable; luaL_error longjmps but TypeScript/JS needs it
        }
      });
      fengari.lua.lua_setglobal(L, name);
    }
  }

  // ── Remove unwanted standard globals ───────────────────────────────────────
  const remove = s.runtime && Array.isArray(s.runtime.removeGlobals)
    ? s.runtime.removeGlobals
    : [];
  for (const name of remove) {
    fengari.lua.lua_pushnil(L);
    fengari.lua.lua_setglobal(L, name);
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  const status = fengari.lauxlib.luaL_dostring(L, fengari.to_luastring(code || ""));
  if (status !== 0) {
    isError = true;
    let raw = fengari.lua.lua_tojsstring(L, -1) || "";
    // Rewrite known error patterns (settings.errors.patterns)
    const patterns = (s.errors && s.errors.patterns) || [];
    for (const p of patterns) {
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