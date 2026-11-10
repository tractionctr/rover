// Test suite for worker.js — stubs Web Worker globals to test Lua runtime,
// sandbox limits, error rewriting, and host globals without a browser.

import fengari from "fengari-web";

let last = null;
globalThis.onmessage = null;
globalThis.postMessage = (msg) => { last = msg; };

await import("./src/worker.js");

function run(code, settings, globals) {
  last = null;
  globalThis.onmessage({ data: { code, settings, globals } });
  return last;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra ?? ""); }
}

// 1. Basic print
let r = run('print("hello", 42)');
check("basic print", r.output === "hello\t42\n" && r.isError === false, JSON.stringify(r));

// 2. Host global reachable
r = run('print(setPixel(10, 20, 30))', null,
  { setPixel: (L) => {
      const x = fengari.lauxlib.luaL_checknumber(L, 1);
      const y = fengari.lauxlib.luaL_checknumber(L, 2);
      fengari.lua.lua_pushnumber(L, x + y);
      return 1;
  } });
check("host global reachable", r.output === "30.0\n" && r.isError === false, JSON.stringify(r));

// 3. Host global error
r = run('boom()', null,
  { boom: () => { throw new Error("nope"); } });
check("host global error", r.isError === true && /nope/.test(r.output), JSON.stringify(r));

// 4. blockedKeywords string
r = run('while true do end', { sandbox: { blockedKeywords: ["while"] } });
check("blocked keyword string", r.isError === true && /not allowed/.test(r.output), JSON.stringify(r));

// 5. blockedKeywords object
r = run('goto x', { sandbox: { blockedKeywords: [{ pattern: "goto", message: "no goto allowed" }] } });
check("blocked keyword object", r.output === "no goto allowed" && r.isError === true, JSON.stringify(r));

// 6. Error pattern rewrite
r = run('bad_pixel_thing()', { errors: { patterns: [{ re: "bad_pixel_thing", msg: "Use setPixel() instead." }] } });
check("error pattern rewrite", r.output === "Use setPixel() instead." && r.isError === true, JSON.stringify(r));

// 7. removeGlobals
r = run('os.time()', { runtime: { removeGlobals: ["os"] } });
check("removeGlobals", r.isError === true && /os/.test(r.output), JSON.stringify(r));

// 8. Instruction budget — a loop that would otherwise run forever.
//    (LUA_MASKCOUNT counts Lua bytecode ops; a `while true` loop is the
//    reliable way to trip it since a bounded for-loop finishes first.)
r = run('while true do end', { sandbox: { maxInstructions: 500 } });
check("instruction budget", r.isError === true && /instruction limit/.test(r.output), JSON.stringify(r));

// 9. Lua syntax error
r = run('if then end');
check("syntax error flagged", r.isError === true, JSON.stringify(r));

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);