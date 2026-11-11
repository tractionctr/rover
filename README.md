# Rover

A code editor that runs Lua. You can use it standalone, or plug it into your
game so players type code that controls your game.

## What it does

- **Write and run Lua 5.1 code** in your browser. No install, no account.
- **Plug it into your game** — players type code that calls your game's real
  functions. You decide what they can call and what they can't.

## Standalone use

```bash
npm install
npm run dev
```

Open http://localhost:5173. Type Lua, hit **▶ Run**, see output. Done.

Build a production bundle:

```bash
npm run build
```

## Plug it into your game

### Step 1 — Give your game a code port

Add a file in your game that listens for code and runs it. Example
(`game.lua`):

```lua
-- game.lua
function startCodeConsole()
  -- listens on port 37373
  -- when code arrives, runs it in your game
end
```

### Step 2 — Tell Rover to talk to your game

In your game's page, run:

```javascript
window.Rover.useRuntime("remote", "ws://localhost:37373");
```

### Step 3 — Done

Players type code in Rover, it runs in your game.

## What players can call

You decide. In your game's code console file, expose only the functions you
want:

```lua
startCodeConsole({
    move = function(x, y) ... end,   -- player can call this
    rotate = function(d) ... end,    -- player can call this
    -- anything not listed here is blocked
})
```

Standard Lua functions (`print`, `math`, `string`, `table`) are always
available.

## Limits

Set these in your game's code console file:

| Setting | What it does |
|---|---|
| `maxInstructions` | Max Lua bytecode ops before abort |
| `maxSeconds` | Max seconds before abort |
| `blockedKeywords` | Regex patterns to block (e.g. `"while"`, `"io."`) |

## Shortcuts

| Action | Shortcut |
|---|---|
| Run | `Ctrl`+`Enter` |
| Clear output | `Ctrl`+`L` |
| Reset to example | `Ctrl`+`R` |
| Font size | `A−` / `A+` |
| Theme | button in top-right |

## Project layout

```
src/          # the editor and Lua runtime
  main.js
  runtime.js   # how code is run (browser or remote)
  worker.js
bridge/       # the server that connects Rover to your game
  index.js
  adapters/    # runtime adapters (add your own)
examples/     # integration stubs for any engine
```

## Testing

```bash
node test-worker.mjs   # unit tests
node test-bridge.mjs   # integration tests
```

## License

See [LICENSE](LICENSE).