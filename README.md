# Rover

A self-contained web-based Lua console — write, edit, and run Lua 5.1 code in
your browser with no backend, no install, and no account.

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

## Project layout

```
src/
  main.js        # orchestrator: editor setup, buttons, run loop
  worker.js      # fengari-web worker (isolated from the main thread)
  engine.js      # pure execution helper (no DOM / CodeMirror knowledge)
  luaBlocks.js   # block-aware completion logic
  themes/
    index.js     # theme registry
    retro-dark.js
    retro-light.js
```

## License

See [LICENSE](LICENSE).