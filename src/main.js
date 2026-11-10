/**
 * main.js — Rover Lua Console
 *
 * Thin orchestrator: reads active theme, sets CSS root attribute,
 * configures CodeMirror, wires buttons. Nothing visual lives here.
 */

import { getTheme } from "./themes/index.js";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import { Decoration }                from "@codemirror/view";
import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { keymap }                    from "@codemirror/view";
import { StreamLanguage }            from "@codemirror/language";
import { lua }                       from "@codemirror/legacy-modes/mode/lua";
import { syntaxHighlighting }        from "@codemirror/language";
import { getCloserInfo, countUnclosedBlocks, stripLuaNoise } from "./luaBlocks.js";
import { mergeSettings } from "./settings.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SAVE_KEY       = "rover-code";
const HISTORY_KEY    = "rover-history";
const THEME_KEY      = "rover-theme";
const MAX_HISTORY    = 30;
const TIMEOUT_MS     = 2000;
const DEBOUNCE_SAVE  = 400;

// ─── Default example code ─────────────────────────────────────────────────────

const DEFAULT_CODE = `-- ╔══════════════════════════════════════╗
-- ║           ROVER LUA CONSOLE          ║
-- ║   Write Lua · Ctrl+Enter to run      ║
-- ╚══════════════════════════════════════╝

local limit = 6

local function meetsLimit(n)
  if n > limit then
    return tostring(n) .. " > " .. tostring(limit)
  else
    return tostring(n) .. " <= " .. tostring(limit)
  end
end

print("─── Range check ───")
for i = 1, 10 do
  print("  " .. i .. ": " .. meetsLimit(i))
end

print()
print("─── Types ───")
print("nil:      ", type(nil))
print("number:   ", type(42))
print("string:   ", type("hello"))
print("boolean:  ", type(true))
print("table:    ", type({}))
print("function: ", type(function() end))
`;

// ─── HTML shell ───────────────────────────────────────────────────────────────

document.querySelector("#app").innerHTML = `
<div class="app-shell">

  <!-- Title bar -->
  <div class="title-bar">
    <div class="title-left">
      <span class="logo">R</span>
      <span class="title-name">Rover — Lua Console</span>
      <span class="kbd-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> Run</span>
      <span style="color:var(--fg-muted)">·</span>
      <span class="kbd-hint"><kbd>Ctrl</kbd>+<kbd>L</kbd> Clear</span>
      <span style="color:var(--fg-muted)">·</span>
      <span class="kbd-hint"><kbd>Ctrl</kbd>+<kbd>R</kbd> Reset</span>
    </div>
    <button class="theme-toggle" id="btn-theme" title="Toggle light/dark mode">🌙 Dark</button>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <button class="btn primary" id="btn-run">▶ Run</button>
    <button class="btn" id="btn-clear">✕ Clear</button>
    <button class="btn" id="btn-reset">↺ Reset</button>
    <div class="tool-sep"></div>
    <button class="btn font-btn" id="btn-font-down">A−</button>
    <span class="font-label" id="font-size-label">14px</span>
    <button class="btn font-btn" id="btn-font-up">A+</button>
    <div class="toolbar-spacer"></div>
  </div>

  <!-- Main area: editor on top, output below -->
  <div class="main-area">
    <div class="editor-pane" id="editor-pane">
      <div id="editor"></div>
    </div>

    <div class="output-section" id="output-section">
      <!-- Draggable divider between editor and output -->
      <div class="splitter" id="splitter" title="Drag to resize"></div>
      <div class="output-tabbar">
      <span class="tab active" id="tab-output">Output</span>
      <span class="history-count" id="history-label" style="display:none;">
        Last <strong id="run-count">0</strong> run(s)
      </span>
      <span class="history-toggle" id="history-toggle" title="Toggle run history">▸ History</span>
    </div>
    <div class="output-body" id="output-body">
      <div id="history"></div>
      <pre id="output" class="output-current">(Press ▶ Run or Ctrl+Enter)</pre>
    </div>
  </div>
  </div>

  <!-- Status bar -->
  <div class="status-bar">
    <span class="status-item" id="status">Ready</span>
    <span class="toolbar-spacer"></span>
    <span class="status-item" id="status-info">Lua 5.1 · fengari</span>
  </div>

</div>
`;

// ─── State ────────────────────────────────────────────────────────────────────

let runHistory    = [];
let worker        = null;
let fontSize      = 14;
let saveTimer     = null;
let timeoutId     = null;
let runStart      = 0;
let currentTheme  = "dark";

// ── Host integration ────────────────────────────────────────────────────────
// Set by window.Rover.configure(). These are passed to the worker on every
// run so a host page can sandbox code and inject native functions.
let activeSettings = null;   // validated settings object (or null = defaults)
let activeGlobals  = null;   // { name: fn(L) => number } host globals

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, editor.state.doc.toString()); } catch {}
  }, DEBOUNCE_SAVE);
}

function persistHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(runHistory)); } catch {}
}

function restoreHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) runHistory = JSON.parse(raw);
  } catch {}
}

function clearHistory() {
  runHistory = [];
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  const histEl  = document.getElementById("history");
  const labelEl = document.getElementById("history-label");
  const countEl = document.getElementById("run-count");
  if (histEl)   histEl.innerHTML    = "";
  if (labelEl)  labelEl.style.display = "none";
  if (countEl)  countEl.textContent = "0";
}

// ─── Theme system ─────────────────────────────────────────────────────────────

function applyTheme(name) {
  const theme = getTheme(name);
  currentTheme = name;
  document.documentElement.setAttribute("data-theme", name);
  // Update theme toggle label
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = theme.isDark ? "☀️ Light" : "🌙 Dark";
  // Persist
  try { localStorage.setItem(THEME_KEY, name); } catch {}
  // Re-apply highlight style by reconfiguring the syntaxHighlighting compartment
  // (we use a dedicated compartment for theme changes)
  editor.dispatch({ effects: themeComp.reconfigure(syntaxHighlighting(theme.highlight)) });
}

const themeComp = new Compartment();

// ─── Status bar ───────────────────────────────────────────────────────────────

function updateStatus(view) {
  const state     = view.state;
  const pos       = state.selection.main.from;
  const line      = state.doc.lineAt(pos);
  const col       = pos - line.from + 1;
  const unclosed  = countUnclosedBlocks(state.doc.toString());
  const el        = document.getElementById("status");
  if (!el) return;
  const blockMsg  = unclosed === 0 ? "All blocks closed" : `${unclosed} unclosed block${unclosed !== 1 ? "s" : ""}`;
  el.textContent  = `Ln ${line.number}, Col ${col}   •   ${blockMsg}`;
  el.className    = `status-item${unclosed ? " status-warn" : ""}`;
}

// ─── Error highlighting ───────────────────────────────────────────────────────

const setErrorEffect = StateEffect.define();

const errorLineField = StateField.define({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setErrorEffect)) continue;
      if (e.value === null) { deco = Decoration.none; }
      else {
        try {
          const line = tr.state.doc.line(e.value);
          deco = Decoration.set([Decoration.line({ class: "cm-error-line" }).range(line.from)]);
        } catch { deco = Decoration.none; }
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

function highlightErrorLine(n) { editor.dispatch({ effects: setErrorEffect.of(n) }); }
function clearErrorHighlight()  { editor.dispatch({ effects: setErrorEffect.of(null) }); }

// ─── Smart error translation ──────────────────────────────────────────────────

function friendlyError(raw, code) {
  const lineMatch = raw.match(/:(\d+):/);
  const callLine  = lineMatch ? parseInt(lineMatch[1]) : null;
  const srcLines  = code.split("\n");
  let msg = raw.replace(/^\[string "[^"]*"\]:\d+:\s*/, "").trim();

  function findFunctionDef(name) {
    for (let i = 0; i < srcLines.length; i++) {
      if (new RegExp(`\\bfunction\\s+${name}\\s*\\(|\\blocal\\s+function\\s+${name}\\s*\\(|\\b${name}\\s*=\\s*function`).test(srcLines[i]))
        return i + 1;
    }
    return null;
  }

  function findVarDef(name) {
    for (let i = 0; i < srcLines.length; i++) {
      const t = srcLines[i];
      if (/\blocal\b.*\b/.test(t) && t.includes(name)) return i + 1;
      if (/^\s*${name}\s*=/.test(t)) return i + 1;
    }
    return null;
  }

  const patterns = [
    [/attempt to call a nil value \(global '(\w+)'\)/, (_, name) => {
      const d = findFunctionDef(name);
      if (d && callLine && d > callLine) return `'${name}' called on line ${callLine} but defined on line ${d}`;
      if (d) return `'${name}' defined on line ${d} — check that line`;
      const stdlib = ["print","pairs","ipairs","type","tostring","tonumber","error","assert","pcall","math","string","table"];
      const close  = stdlib.find(f => f !== name && Math.abs(f.length-name.length)<=2 && [...name].filter((c,i)=>f[i]!==c).length<=2);
      return close ? `'${name}' doesn't exist — did you mean '${close}'?`
                   : `'${name}' doesn't exist — check spelling or define it first`;
    }],
    [/attempt to call a nil value \(local '(\w+)'\)/,  (_, n) => `'${n}' is not a function`],
    [/attempt to call a nil value$/,                    () => "Tried to call something with no value"],

    [/attempt to perform arithmetic on a nil value \(global '(\w+)'\)/, (_, name) => {
      const d = findVarDef(name);
      if (!d) return `'${name}' was never defined — try: local ${name} = 0`;
      if (callLine && d > callLine) return `'${name}' used before it's defined`;
      return `'${name}' is nil — assign a number to it`;
    }],
    [/attempt to perform arithmetic on a nil value/,                 () => "Can't do math on a nil value"],
    [/attempt to concatenate a nil value/,                           (_, n) => `Try tostring(${n}) — it might be nil`],
    [/attempt to concatenate a ([\w ]+) value$/, (_, t) => `Can't join a ${t} directly — use tostring()`],
    [/attempt to index a nil value/,                                  () => "Can't access properties on nil"],

    [/'end' expected \(to close '(\w+)' at line (\d+)\) near '<eof>'/, (_, kw, l) =>
      `Missing 'end' — '${kw}' block starting line ${l} was never closed`],
    [/'end' expected near '(.+)'/,     (_, near) => `Expected 'end' but found '${near}'`],
    [/'then' expected near '(.+)'/,    (_, near) => `Missing 'then' after if condition`],
    [/'do' expected near '(.+)'/,      (_, near) => `Missing 'do' — write: for ... do or while ... do`],
    [/'=' expected near '(.+)'/,       (_, near) => `Expected '=' but found '${near}'`],
    [/unexpected symbol near '(.+)'/,  (_, sym) => sym === "<eof>" ? "Unexpected end of file — probably missing an 'end'" : `Unexpected '${sym}'`],

    [/bad argument #(\d+) to '(\w+)' \((\w+) expected, got (\w+)\)/,
     (_, n, fn, exp, got) => `'${fn}' arg #${n}: expected ${exp}, got ${got}`],
    [/attempt to compare two (\w+) values$/,  () => "Can't compare two same-type values with < or >"],
    [/attempt to compare (\w+) with (\w+)/,   () => "Can't compare different types with < or >"],

    [/stack overflow/, () => "Infinite recursion — add an exit condition"],
  ];

  for (const [pattern, handler] of patterns) {
    const m = msg.match(pattern);
    if (m) { msg = handler(...m); break; }
  }
  return { lineNum: callLine, msg };
}

// ─── Block helpers ────────────────────────────────────────────────────────────

function isElseBranch(lineText) {
  const [t] = stripLuaNoise(lineText);
  return t === "else" || (/\belseif\b/.test(t) && /\bthen\b/.test(t));
}

function preprocessLua(code) {
  return code
    .replace(/(\w+)\s*\+=\s*(.+)/g, "$1 = $1 + $2")
    .replace(/(\w+)\s*-=\s*(.+)/g,  "$1 = $1 - $2")
    .replace(/(\w+)\s*\*=\s*(.+)/g, "$1 = $1 * $2")
    .replace(/(\w+)\s*\/=\s*(.+)/g, "$1 = $1 / $2");
}

// ─── History rendering ────────────────────────────────────────────────────────

function appendHistory(output, isError) {
  runHistory.push({ timestamp: nowLabel(), output, isError });
  if (runHistory.length > MAX_HISTORY) runHistory.shift();
  renderHistory();
}

function renderHistory() {
  const histEl  = document.getElementById("history");
  const labelEl = document.getElementById("history-label");
  const countEl = document.getElementById("run-count");
  if (!histEl) return;

  if (runHistory.length === 0) {
    histEl.innerHTML = ""; labelEl.style.display = "none"; return;
  }
  labelEl.style.display = "flex";
  countEl.textContent = runHistory.length;

  histEl.innerHTML = runHistory.map((entry, i) => `
    <details class="history-entry${entry.isError ? " is-error" : ""}">
      <summary>
        <span class="time">${escapeHtml(entry.timestamp)}</span>
        <span class="badge">${entry.isError ? "✕" : "✓"}</span>
        <span class="excerpt">${escapeHtml(
          entry.output.slice(0, 100).replace(/\n/g, " ")
        )}${entry.output.length > 100 ? "…" : ""}</span>
      </summary>
      <pre class="body">${escapeHtml(entry.output)}</pre>
    </details>
  `).join("");
}

// ─── Run logic ────────────────────────────────────────────────────────────────

function runCode() {
  const code     = preprocessLua(editor.state.doc.toString());
  const outputEl = document.getElementById("output");
  if (!outputEl) return;

  if (!worker) {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = handleWorkerMessage;
    worker.onerror   = () => showResult("Worker crashed — see console", true, 0);
  }

  clearErrorHighlight();
  outputEl.textContent = "Running…";
  outputEl.className   = "output-running";

  runStart   = performance.now();
  timeoutId  = setTimeout(() => {
    worker.terminate(); worker = null;
    const elapsed = ((performance.now() - runStart)).toFixed(0);
    showResult(`❌ Timed out (${elapsed} ms)`, true, 0);
  }, TIMEOUT_MS);

  // Pass the active host settings + globals so the run is sandboxed.
  const msg = { code };
  if (activeSettings) msg.settings = activeSettings;
  if (activeGlobals)  msg.globals  = activeGlobals;
  worker.postMessage(msg);
}

function handleWorkerMessage(e) {
  clearTimeout(timeoutId);
  const raw     = e.data.output || "";
  const elapsed = ((performance.now() - runStart)).toFixed(0);
  const isError = e.data.isError || /^\[string ".+"\]:\d+:/.test(raw) || /stack overflow/.test(raw);
  showResult(raw, isError, elapsed);
}

function showResult(raw, isError, elapsed) {
  const outputEl = document.getElementById("output");
  if (!outputEl) return;

  if (isError) {
    const { lineNum, msg } = friendlyError(raw, editor.state.doc.toString());
    const displayMsg = `❌ Error${lineNum ? ` (line ${lineNum})` : ""}: ${msg}`;
    outputEl.textContent = displayMsg;
    outputEl.className   = "output-error";
    if (lineNum) highlightErrorLine(lineNum);
    appendHistory(`${displayMsg}\n— ${elapsed} ms`, true);
  } else {
    outputEl.textContent = raw || `(no output)  ✓ ran in ${elapsed} ms`;
    outputEl.className   = "output-ok";
    appendHistory(`${raw.trim()}  [${elapsed} ms]`, false);
  }
  persistHistory();
}

function clearOutput() {
  const outputEl = document.getElementById("output");
  if (outputEl) { outputEl.textContent = "(Press ▶ Run or Ctrl+Enter)"; outputEl.className = ""; }
  clearHistory();
}

function resetEditor() {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: DEFAULT_CODE } });
  clearOutput();
}

function changeFontSize(delta) {
  fontSize = Math.min(26, Math.max(10, fontSize + delta));
  document.getElementById("font-size-label").textContent = `${fontSize}px`;
  editor.dispatch({ effects: fontSizeComp.reconfigure(fontTheme(fontSize)) });
}

// ─── Font size compartment ────────────────────────────────────────────────────

const fontSizeComp = new Compartment();
function fontTheme(size) {
  return EditorView.theme({
    ".cm-content": { fontSize: size + "px", lineHeight: "1.6" },
    ".cm-gutters": { fontSize: size + "px", lineHeight: "1.6" },
  });
}

// ─── Autocomplete options ─────────────────────────────────────────────────────

const mathOpts = [
  snippetCompletion("math.random(${1})",         { label: "math.random",    type: "function" }),
  snippetCompletion("math.floor(${1:x})",        { label: "math.floor",     type: "function" }),
  snippetCompletion("math.ceil(${1:x})",         { label: "math.ceil",      type: "function" }),
  snippetCompletion("math.abs(${1:x})",          { label: "math.abs",       type: "function" }),
  snippetCompletion("math.sqrt(${1:x})",         { label: "math.sqrt",      type: "function" }),
  snippetCompletion("math.max(${1:a}, ${2:b})",  { label: "math.max",       type: "function" }),
  snippetCompletion("math.min(${1:a}, ${2:b})",  { label: "math.min",       type: "function" }),
  { label: "math.huge", type: "constant", detail: "∞" },
  { label: "math.pi",   type: "constant", detail: "3.14159…" },
];

const stringOpts = [
  snippetCompletion("string.len(${1:s})",                           { label: "string.len",    type: "function" }),
  snippetCompletion("string.sub(${1:s}, ${2:i})",                   { label: "string.sub",    type: "function" }),
  snippetCompletion("string.upper(${1:s})",                         { label: "string.upper",  type: "function" }),
  snippetCompletion("string.lower(${1:s})",                         { label: "string.lower",  type: "function" }),
  snippetCompletion("string.rep(${1:s}, ${2:n})",                   { label: "string.rep",    type: "function" }),
  snippetCompletion("string.reverse(${1:s})",                       { label: "string.reverse",type: "function" }),
  snippetCompletion("string.format(${1:fmt})",                      { label: "string.format", type: "function" }),
  snippetCompletion("string.gsub(${1:s}, ${2:p}, ${3:r})",          { label: "string.gsub",   type: "function" }),
  snippetCompletion("string.byte(${1:s})",                          { label: "string.byte",   type: "function" }),
  snippetCompletion("string.char(${1:n})",                          { label: "string.char",   type: "function" }),
];

const tableOpts = [
  snippetCompletion("table.insert(${1:t}, ${2:v})",  { label: "table.insert",  type: "function" }),
  snippetCompletion("table.remove(${1:t})",           { label: "table.remove",  type: "function" }),
  snippetCompletion("table.sort(${1:t})",             { label: "table.sort",    type: "function" }),
  snippetCompletion("table.concat(${1:t}, ${2:s})",   { label: "table.concat",  type: "function" }),
];

const globalOpts = [
  ...["while","for","if","else","elseif","then","do","end","return","break",
      "local","function","repeat","until","not","and","or","nil","in"].map(kw => ({ label: kw, type: "keyword" })),
  { label: "true",  type: "constant" },
  { label: "false", type: "constant" },
  snippetCompletion("print(${1})",            { label: "print",        type: "function" }),
  snippetCompletion("pairs(${1:t})",          { label: "pairs",        type: "function" }),
  snippetCompletion("ipairs(${1:t})",         { label: "ipairs",       type: "function" }),
  snippetCompletion("type(${1})",             { label: "type",         type: "function" }),
  snippetCompletion("tostring(${1})",         { label: "tostring",     type: "function" }),
  snippetCompletion("tonumber(${1})",         { label: "tonumber",     type: "function" }),
  snippetCompletion("error(${1})",            { label: "error",        type: "function" }),
  snippetCompletion("assert(${1})",           { label: "assert",       type: "function" }),
  snippetCompletion("pcall(${1})",            { label: "pcall",        type: "function" }),
  snippetCompletion("unpack(${1:t})",         { label: "unpack",       type: "function" }),
  snippetCompletion("select(${1})",           { label: "select",       type: "function" }),
  snippetCompletion("rawget(${1:t}, ${2:k})", { label: "rawget",       type: "function" }),
  snippetCompletion("setmetatable(${1:t})",   { label: "setmetatable", type: "function" }),
  { label: "math",   type: "namespace", detail: "math library"  },
  { label: "string", type: "namespace", detail: "string library"},
  { label: "table",  type: "namespace", detail: "table library" },
  { label: "os",     type: "namespace", detail: "os library"    },
  { label: "io",     type: "namespace", detail: "io library"    },
];

// ─── Editor setup ─────────────────────────────────────────────────────────────

const editor = new EditorView({
  state: EditorState.create({
    doc: DEFAULT_CODE,
    extensions: [
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) updateStatus(update.view);
        if (update.docChanged) clearErrorHighlight();
        if (update.docChanged) scheduleSave();
      }),

      keymap.of([
        { key: "Mod-Enter", run: () => { runCode(); return true; } },
        { key: "Mod-l",     run: () => { clearOutput(); return true; } },
        { key: "Mod-r",     run: () => { resetEditor(); return true; } },
        { key: "Mod-=",     run: () => { changeFontSize(+1); return true; } },
        { key: "Mod--",     run: () => { changeFontSize(-1); return true; } },
        {
          key: "Enter",
          run: (view) => {
            const { state }  = view;
            const pos        = state.selection.main.from;
            const line       = state.doc.lineAt(pos);
            const text       = line.text;
            const indent     = text.match(/^\s*/)[0];
            const cursorPos  = pos - line.from;
            const atEnd      = cursorPos >= text.trimEnd().length;
            const inner      = indent + "  ";

            if (isElseBranch(text) && atEnd) {
              view.dispatch({
                changes:   { from: pos, to: pos, insert: "\n" + inner },
                selection: { anchor: pos + 1 + inner.length },
              });
              return true;
            }

            if (atEnd) {
              const closer = getCloserInfo(state.doc.toString(), text);
              if (closer) {
                const insert = "\n" + inner + (closer.needsCloser ? "\n" + indent + closer.closerText : "");
                view.dispatch({
                  changes:   { from: pos, to: pos, insert },
                  selection: { anchor: pos + 1 + inner.length },
                });
                return true;
              }
            }

            view.dispatch({
              changes:   { from: pos, to: pos, insert: "\n" + indent },
              selection: { anchor: pos + 1 + indent.length },
            });
            return true;
          },
        },
      ]),

      basicSetup,
      themeComp.of(syntaxHighlighting(getTheme("dark").highlight)),
      closeBrackets(),
      keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap]),
      StreamLanguage.define(lua),
      errorLineField,
      fontSizeComp.of(fontTheme(fontSize)),

      autocompletion({ activateOnTyping: true, override: [(ctx) => {
        const word = ctx.matchBefore(/[\w.]*/);
        if (!word || (word.from === word.to && !ctx.explicit)) return null;
        const p = word.text;
        if (p.startsWith("math."))   return { from: word.from, options: mathOpts };
        if (p.startsWith("string.")) return { from: word.from, options: stringOpts };
        if (p.startsWith("table."))  return { from: word.from, options: tableOpts };
        return { from: word.from, options: globalOpts };
      }]}),
    ],
  }),
  parent: document.getElementById("editor"),
});

// ─── Draggable splitter ───────────────────────────────────────────────────────

function setupSplitter() {
  const splitter = document.getElementById("splitter");
  const editorPane = document.getElementById("editor-pane");
  const outputSection = document.getElementById("output-section");
  if (!splitter || !editorPane || !outputSection) return;

  let dragging = false;

  splitter.addEventListener("mousedown", (e) => {
    dragging = true;
    splitter.classList.add("dragging");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const mainArea = document.querySelector(".main-area");
    if (!mainArea) return;
    const rect = mainArea.getBoundingClientRect();
    const editorHeight = e.clientY - rect.top;
    const minEditor = 80;
    const minOutput = 40;
    const maxEditor = rect.height - minOutput;
    const h = Math.max(minEditor, Math.min(maxEditor, editorHeight));
    const pct = (h / rect.height) * 100;
    editorPane.style.flexBasis = pct + "%";
    editorPane.style.flexShrink = 0;
    outputSection.style.flexBasis = (100 - pct) + "%";
    outputSection.style.flexShrink = 0;
    // Persist
    try { localStorage.setItem("rover-splitter", pct); } catch {}
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Restore saved theme
let savedTheme = "dark";
try {
  const t = localStorage.getItem(THEME_KEY);
  if (t && getTheme(t)) savedTheme = t;
} catch {}

// Apply theme: inject CSS into <head>, set data-theme attribute, configure editor
const theme = getTheme(savedTheme);
document.documentElement.setAttribute("data-theme", savedTheme);
const styleEl = document.createElement("style");
styleEl.id = "theme-css";
styleEl.textContent = theme.css;
document.head.appendChild(styleEl);

const themeBtn = document.getElementById("btn-theme");
if (themeBtn) themeBtn.textContent = theme.isDark ? "☀️ Light" : "🌙 Dark";

// Restore code
restoreHistory();
if (runHistory.length > 0) renderHistory();

try {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved !== null && saved.length > 0) {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: saved } });
  }
} catch {}

updateStatus(editor);

// Restore splitter position
try {
  const savedSplit = localStorage.getItem("rover-splitter");
  if (savedSplit !== null) {
    const pct = parseFloat(savedSplit);
    if (!isNaN(pct) && pct > 10 && pct < 90) {
      const ep = document.getElementById("editor-pane");
      const os = document.getElementById("output-section");
      if (ep && os) {
        ep.style.flexBasis = pct + "%"; ep.style.flexShrink = 0;
        os.style.flexBasis = (100 - pct) + "%"; os.style.flexShrink = 0;
      }
    }
  }
} catch {}

setupSplitter();

// ─── Run-history toggle ──────────────────────────────────────────────────────
// Collapsed by default so the live output always has room. Click the
// "▸ History" button in the tabbar to expand it.
const historyToggle = document.getElementById("history-toggle");
const outputBody    = document.getElementById("output-body");
if (historyToggle && outputBody) {
  // Restore saved state
  let historyVisible = true;
  try { historyVisible = localStorage.getItem("rover-history-visible") !== "false"; } catch {}
  if (!historyVisible) {
    outputBody.classList.add("collapsed");
    historyToggle.classList.remove("active");
    historyToggle.textContent = "▸ History";
  }
  historyToggle.addEventListener("click", () => {
    const collapsed = outputBody.classList.toggle("collapsed");
    historyToggle.classList.toggle("active", !collapsed);
    historyToggle.textContent = collapsed ? "▸ History" : "▾ History";
    try { localStorage.setItem("rover-history-visible", String(!collapsed)); } catch {}
  });
}

// ─── Button bindings ──────────────────────────────────────────────────────────

document.getElementById("btn-run").onclick    = runCode;
document.getElementById("btn-clear").onclick = clearOutput;
document.getElementById("btn-reset").onclick = resetEditor;
document.getElementById("btn-font-up").onclick   = () => changeFontSize(1);
document.getElementById("btn-font-down").onclick = () => changeFontSize(-1);

themeBtn?.addEventListener("click", () => {
  const next = currentTheme === "dark" ? "light" : "dark";
  applyTheme(next);
  // Refresh the editor extension with the new theme
  editor.dispatch({ effects: themeComp.reconfigure(syntaxHighlighting(getTheme(next).highlight)) });
});

console.log(`[rover] ${currentTheme} theme loaded`);

// ─── Public host API ─────────────────────────────────────────────────────────
//
// A host page calls window.Rover.configure({ ... }) before the user runs
// code. Settings are validated and passed to the worker on every run.
//
//   window.Rover.configure({
//     sandbox: { blockedKeywords: ["while", "os.execute"], maxInstructions: 50000 },
//     runtime: { globals: { setPixel: (L, x, y, r, g, b) => { ... } } },
//     errors:  { patterns: [{ re: "bad pixel", msg: "Use setPixel() instead." }] }
//   });
//
// Globals are JS functions (L, ...args) => number of Lua stack values pushed.
// See worker.js for the argument-reading helpers.

window.Rover = {
  configure(userSettings, userGlobals) {
    activeSettings = mergeSettings(userSettings);
    activeGlobals = userGlobals || null;
    return window.Rover;
  },
  getSettings() {
    return activeSettings;
  },
  run(code) {
    if (code != null) editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: code }
    });
    runCode();
  },
  clear() { clearOutput(); },
};