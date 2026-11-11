# Rover

A self-contained web-based Lua console — write, edit, and run Lua 5.1 code in
your browser with no backend, no install, and no account.

Rover is an **IDE, not a specific engine**. It ships with a built-in browser
Lua VM, but it can also drive any external Lua runtime over a WebSocket
bridge. That's how you build an in-game code console — the player types code
that calls your game's real functions, with the sandbox controlled by you.

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
- **`examples/<engine>/game-bridge.<ext>`** — engine-specific integration stubs.

To connect an external engine, implement two things:
1. A tiny bridge that accepts Rover messages on a WebSocket and forwards them
   to your Lua VM (or Node adapter). It passes the player's code + sandbox
   settings into `luaL_dostring()` or equivalent.
2. A globals map from your game to the bridge so Rover knows which
   functions the player is allowed to call.

### Bridge server

```bash
node bridge/index.js --port 37373 --lua <adapter> --globals ./my-globals.js
```

- `--lua` selects the runtime adapter (`fengari` by default). Write custom
  adapters in `bridge/adapters/<name>.js`.
- `--globals` points to a JS module exporting the game's API as Lua-callable
  functions.

### Engine integration steps

1. Start a WebSocket bridge on a known port, forwarding runs into your Lua
   state. Expose only the functions players should have access to.
2. In Rover, switch to remote mode:

```javascript
window.Rover.useRuntime("remote", "ws://localhost:37373");
```

That's it. Now the player's code executes inside your game with access to
your exposed globals — anything not explicitly exposed is unreachable.
You control the sandbox entirely via `window.Rover.configure({...})`.

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
  adapters/      # engine adapters (fengari + any custom ones you add)
examples/
  <engine>/      # engine-specific integration stubs (add your own)
```

## Testing

```bash
node test-worker.mjs   # 9 tests: sandbox, limits, error rewrites, globals
node test-bridge.mjs   # 6 tests: WebSocket round-trip, engine adapters
```

## License

See [LICENSE](LICENSE).
