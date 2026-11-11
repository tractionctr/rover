# Rover

A self-contained web-based Lua console — write, edit, and run Lua 5.1 code in
your browser with no backend, no install, and no account.

Rover is an **IDE, not a specific engine**. It ships with a built-in browser
Lua VM, but it can also drive any external Lua runtime (LÖVE2D, LuaJIT,
Unity, Godot, …) over a WebSocket bridge. That's how you build an in-game
code console — like the game *The Farmer Was Replaced* — where the player
types code that calls your game's real functions, with the sandbox
controlled by you.

Built on [CodeMirror 6](https://codemirror.net/) for the editor and
[fengari-web](https://github.com/fengari/fengari-web) for the Lua VM, so syntax
highlighting, autocomplete, and execution all run client-side.

## Features

- **Lua 5.1 runtime** — real `print`, `tostring`, `error`, and the standard
  library, running in a background Web Worker so the UI never blocks.
- **Syntax highlighting** with keyword/string/comment coloring, matching the
  VS Code dark palette by default.
- **Smart error reporting** — Lua runtime errors are translated into friendly
  messages with the offending line number, and the error line is highlighted
  in the editor.
- **Block-aware completion** — `if`/`for`/`function`/`while`/`repeat` blocks
  auto-close with matching indentation and a closing keyword snippet.
- **Preprocessor** — `+=`, `-=`, `*=`, `/=` are rewritten to plain operators
  before execution, since Lua 5.1 doesn't support compound assignment.
- **Two themes** — VS Code–style dark and a light variant, switchable from the
  title bar (saved to `localStorage`).
- **Draggable divider** between the editor and the output panel, with the
  position saved.
- **Adjustable font size** — `A−` / `A+` buttons, saved to `localStorage`.
- **Run history** — past runs are kept as collapsible entries below the live
  output (collapsed by default; click **▸ History** to expand).
- **Persistence** — your code, theme, font size, splitter position, and history
  are all saved in `localStorage` across reloads.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Build a production bundle:

```bash
npm run build
npm run preview  # serve ./dist on http://localhost:4173
```

## Usage

| Action | Shortcut |
|---|---|
| Run | `Ctrl`+`Enter` (or ▶ Run) |
| Clear output | `Ctrl`+`L` (or ✕ Clear) |
| Reset to example | `Ctrl`+`R` (or ↺ Reset) |
| Font size | `A−` / `A+` buttons |
| Theme | button in the top-right title bar |
| Resize output | drag the blue divider |

## Embedding

The whole app is a single `index.html` plus ES modules under `src/`. Drop the
`dist/` contents onto any static host (GitHub Pages, Netlify, Vercel, a game
server, …) and you're done:

```
rover/
├── index.html
├── dist/
│   ├── index.html
│   └── assets/
└── src/           # source for development
```

If you want to embed Rover inside another page, the build output is just two
files — `dist/index.html` and `dist/assets/*` — so you can iframe it or inline
the bundle as needed.

## In-game code console (any Lua engine)

Rover can drive an external Lua runtime over WebSocket. The player types code
in the editor; Rover sends it to your engine; your engine runs it with access
to your game's real functions. You control what the code can do via the
sandbox settings.

### Architecture

```
Rover editor (browser) ── WebSocket ──▶ bridge server ──▶ your Lua engine
```

- **`bridge/`** — a Node.js WebSocket bridge server with built-in adapters.
- **`src/runtime.js`** — `LocalRuntime` (browser VM, default) and
  `RemoteRuntime` (WebSocket to an external engine).
- **`examples/love2d/game-bridge.lua`** — drop-in for LÖVE2D games.

### LÖVE2D game setup

1. Copy `examples/love2d/game-bridge.lua` into your project.
2. In `love.load()`, start it with the functions you want the player to call:

```lua
local bridge = require("game-bridge")

function love.load()
    bridge.start({
        port = 37373,
        globals = {
            move  = function(dx, dy) myObject.x = myObject.x + dx end,
            rotate = function(rx, ry) myObject.rx = myObject.rx + rx end,
            setColor = function(r, g, b) myObject.color = {r, g, b, 1} end,
        }
    })
end
```

3. In Rover, switch to remote mode:

```javascript
window.Rover.useRuntime("remote", "ws://localhost:37373");
```

Now the player's code runs inside your running game, calling your real
functions. Only the globals you expose are callable — everything else
(`os.execute`, `io.*`, file access, …) can be blocked via the sandbox.

### Bridge server

```bash
node bridge/index.js --port 37373 --lua fengari --globals ./my-globals.js
```

`--globals` points to a JS module exporting the game's API:

```javascript
// my-globals.js
export default {
    setPixel(L) {
        const x = fengari.lauxlib.luaL_checknumber(L, 1);
        const y = fengari.lauxlib.luaL_checknumber(L, 2);
        // ... write to your framebuffer ...
        return 0;
    }
};
```

### Sandbox settings

Passed via `window.Rover.configure({ sandbox, runtime, errors })`:

| Setting | Purpose |
|---|---|
| `sandbox.blockedKeywords` | Regex-blocked statements (`"while"`, `"os.execute"`, `"io.*"`) |
| `sandbox.maxInstructions` | Lua bytecode instruction budget (0 = unlimited) |
| `sandbox.maxSeconds` | Wall-clock timeout before abort |
| `runtime.globals` | Functions exposed to Lua (browser mode only) |
| `runtime.removeGlobals` | Standard globals to hide (`"os"`, `"io"`) |
| `errors.patterns` | Regex rewrites for Lua error messages |

## Project layout

```
src/
  main.js        # orchestrator: editor setup, buttons, host API
  runtime.js     # pluggable runtime (LocalRuntime / RemoteRuntime)
  worker.js      # fengari-web worker (isolated from the main thread)
  settings.js    # configuration schema and validation
  engine.js      # pure execution helper (no DOM / CodeMirror knowledge)
  luaBlocks.js   # block-aware completion logic
  themes/        # VS Code dark / light themes
bridge/
  index.js       # WebSocket bridge server
  adapters/      # engine adapters (fengari, love2d)
examples/
  love2d/        # in-game IDE example for LÖVE2D
```

## Testing

```bash
node test-worker.mjs   # 9 tests: sandbox, limits, error rewrites, globals
node test-bridge.mjs   # 6 tests: WebSocket round-trip, engine adapters
```

## License

See [LICENSE](LICENSE).