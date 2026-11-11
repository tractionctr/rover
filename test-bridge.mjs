// test-bridge.mjs — end-to-end test of the bridge server + RemoteRuntime.
// Spawns the bridge with a globals module, connects a RemoteRuntime, and
// checks the sandbox and host-globals wiring.

import { startBridge } from "./bridge/index.js";
import { RemoteRuntime } from "./src/runtime.js";
import { WebSocket } from "ws";

// In Node, RemoteRuntime uses the global WebSocket. For testing we swap it
// to the node package so the client and bridge talk over the same transport.
import { WebSocket as BROWSER_W } from "ws";
globalThis.WebSocket = BROWSER_W;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra ?? ""); }
}

// A globals module: the game's API, exposed as Lua globals.
const globalsPath = new URL("./test-globals.mjs", import.meta.url).href;

const wss = await startBridge({ port: 37376, lua: "fengari", globalsFile: globalsPath });

function runViaBridge(code, settings) {
  return new Promise((resolve) => {
    const rt = new RemoteRuntime("ws://localhost:37376");
    rt.onmessage = (data) => { rt.terminate(); resolve(data); };
    rt.onerror = () => { rt.terminate(); resolve({ output: "bridge error", isError: true }); };
    rt.run(code, settings);
  });
}

// 1. Basic print
let r = await runViaBridge('print("hello", 42)');
check("bridge print", r.output === "hello\t42\n" && r.isError === false, JSON.stringify(r));

// 2. Sandbox: blocked keyword
r = await runViaBridge('while true do end', { sandbox: { blockedKeywords: ["while"] } });
check("bridge blocked keyword", r.isError === true && /not allowed/.test(r.output), JSON.stringify(r));

// 3. Sandbox: instruction budget
r = await runViaBridge('while true do end', { sandbox: { maxInstructions: 500 } });
check("bridge instruction budget", r.isError === true && /instruction limit/.test(r.output), JSON.stringify(r));

// 4. Error pattern rewrite
r = await runViaBridge('bad_pixel_thing()', { errors: { patterns: [{ re: "bad_pixel_thing", msg: "Use setPixel() instead." }] } });
check("bridge error rewrite", r.output === "Use setPixel() instead." && r.isError === true, JSON.stringify(r));

// 5. Host globals (provided by the bridge CLI, not the wire)
r = await runViaBridge('print(setPixel(10, 20))');
check("bridge host globals", r.output === "30.0\n" && r.isError === false, JSON.stringify(r));

// 6. Host global error surfaces
r = await runViaBridge('explode()');
check("bridge host global error", r.isError === true && /KABOOM/.test(r.output), JSON.stringify(r));

wss.close();
console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);