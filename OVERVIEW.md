# Rover — Work Overview

A self-contained web-based Lua 5.1 console (CodeMirror 6 editor + fengari-web
VM in a Web Worker). Source under `src/`, built bundle under `dist/`.

## What has been done

- **Core console (committed earlier):** editor with syntax highlighting,
  autocomplete, block-aware Enter (auto-closes `if`/`for`/`function`/…),
  `+=`/`-=`/`*=`/`/=` preprocessor, smart error translation with line
  highlighting, dark/light VS Code–style themes, draggable splitter, font
  size control, run history, and localStorage persistence.
- **Host integration API (this session, commit `9ba1bd2`):**
  - `src/settings.js` — validated `mergeSettings()` with defaults for
    `sandbox` (`blockedKeywords`, `maxInstructions`, `maxSeconds`),
    `runtime` (`globals`, `removeGlobals`), `algebra`
    (`tableArithmetic`), and `errors` (`patterns`).
  - `src/worker.js` — applies settings per run: keyword regex scan,
    `lua_sethook` instruction budget + wall-clock timeout, error-pattern
    rewriting, and host globals registered as Lua globals.
  - `src/main.js` — `window.Rover.configure() / getSettings() / run() / clear()`.
  - `examples/love-graphics/host.html` — demo embedding Rover in a host
    page with a `setPixel()` global and sandbox config.
  - Rebuilt `dist/` bundle.

## What still needs to be done

1. **Fix two bugs in `src/worker.js`** (described below) — host globals never
   actually reach Lua, and the error-message rewrite key is wrong.
2. **Wire up the unused settings** declared in `settings.js` but not consumed
   by the worker: `runtime.removeGlobals` and `algebra.tableArithmetic`.
3. **Decide on the LÖVE example** — `examples/love-graphics/host.html`
   references `host.js` and `/src/main.js`, which don't exist in the repo.
4. **Push to remote** (`origin/main`) once the above are resolved.

## Known issues

- `examples/love-graphics/host.html` is a stub — it needs a `host.js` and
  a production build path to be runnable.

## How to test in `C:\Users\Admin\OneDrive\Documents\love2d\3d_game\graphics_renderer`

See the **Testing** section below.