/**
 * engine.js — pure execution layer.
 *
 * No DOM knowledge.  No CodeMirror knowledge.  Only takes Lua source
 * and returns { output, isError }.
 *
 * Consumers wrap this in a Worker or call it directly; the caller
 * decides how errors are presented.
 */

import * as fengari from "fengari-web";

export function executeLua(code) {
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
  if (status !== 0) {
    output = fengari.lua.lua_tojsstring(L, -1);
  }

  return { output, isError: status !== 0 };
}