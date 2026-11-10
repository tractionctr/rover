/**
 * worker.js — Web Worker entry point.
 *
 * Receives Lua source on 'message', returns { output }.
 * All fengari logic is inlined here to avoid module sharing issues.
 */

import * as fengari from "fengari-web";

onmessage = (e) => {
  try {
    const code = e.data;

    const L = fengari.lauxlib.luaL_newstate();
    fengari.lualib.luaL_openlibs(L);

    let output = "";

    // Override print to use Lua's tostring() so nil → "nil",
    // tables get a pointer instead of being silently dropped.
    fengari.lua.lua_getglobal(L, "print");
    fengari.lua.lua_pushjsfunction(L, function(L) {
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

    const status = fengari.lauxlib.luaL_dostring(L, fengari.to_luastring(code));
    if (status !== 0) output = fengari.lua.lua_tojsstring(L, -1);

    postMessage({ output });
  } catch (err) {
    postMessage({ output: "Worker crash: " + String(err?.message || err) });
  }
};