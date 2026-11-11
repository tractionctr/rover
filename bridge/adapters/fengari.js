/**
 * bridge/adapters/fengari.js
 *
 * Runs Lua 5.1 in Node via fengari-web — the same engine Rover uses in the
 * browser. Useful for local testing of the bridge without a real engine.
 */

import fengari from "fengari-web";

export async function run(code, settings, globals) {
  return runLua(code, settings, globals);
}

function runLua(code, settings, globals) {
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
          // fengari-web's jsfunction wrapper intercepts exceptions from the JS
          // function and re-throws them as Lua errors. Just let it propagate.
          throw err;
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
