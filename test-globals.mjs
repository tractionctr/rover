// test-globals.mjs — a mock game API for the bridge test.
// In a real game this would be your game's functions: spawn, move, setPixel, etc.

import fengari from "fengari-web";

export default {
  // setPixel(x, y, r, g, b) -> writes a pixel. Here it just sums x+y.
  setPixel(L) {
    const x = fengari.lauxlib.luaL_checknumber(L, 1);
    const y = fengari.lauxlib.luaL_checknumber(L, 2);
    fengari.lua.lua_pushnumber(L, x + y);
    return 1;
  },
  // explode() -> deliberately throws, to test error propagation.
  explode(L) {
    fengari.lauxlib.luaL_error(L, fengari.to_luastring("KABOOM: nope"));
    return 0;
  },
};