import * as fengari from "fengari-web";

onmessage = (e) => {
  try {
    const code = e.data;

    const L = fengari.lauxlib.luaL_newstate();
    fengari.lualib.luaL_openlibs(L);

    let output = "";

    fengari.lua.lua_pushjsfunction(L, function(L) {
      const n = fengari.lua.lua_gettop(L);
      let msg = [];

      for (let i = 1; i <= n; i++) {
        msg.push(fengari.lua.lua_tojsstring(L, i));
      }

      output += msg.join(" ") + "\n";
      return 0;
    });

    fengari.lua.lua_setglobal(L, "print");

    const status = fengari.lauxlib.luaL_dostring(
      L,
      fengari.to_luastring(code)
    );

    if (status !== 0) {
      output = fengari.lua.lua_tojsstring(L, -1);
    }

    postMessage({ output });

  } catch (err) {
    postMessage({ output: "Worker crash: " + err.message });
  }
};