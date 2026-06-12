import './style.css';

import * as fengari from "fengari-web";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { getCloserInfo, countUnclosedBlocks, stripLuaNoise } from "./luaBlocks.js";

// ─── HTML ─────────────────────────────────────────────────────────────────────

document.querySelector('#app').innerHTML = `
  <div class="container">
    <h1>Rover Console</h1>
    <div id="editor"></div>
    <div id="status"></div>
    <div class="controls">
      <button id="run">▶ Run <kbd>Ctrl+Enter</kbd></button>
      <button id="clear">✕ Clear</button>
    </div>
    <pre id="output"></pre>
  </div>
`;

// ─── Status bar ───────────────────────────────────────────────────────────────

function updateStatus(view) {
  const state    = view.state;
  const pos      = state.selection.main.from;
  const line     = state.doc.lineAt(pos);
  const col      = pos - line.from + 1;
  const unclosed = countUnclosedBlocks(state.doc.toString());
  const el       = document.getElementById("status");
  if (!el) return;
  const blockMsg = unclosed === 0
    ? "✓ All blocks closed"
    : `⚠ ${unclosed} block${unclosed !== 1 ? "s" : ""} not closed`;
  el.textContent = `Ln ${line.number}, Col ${col}   •   ${blockMsg}`;
  el.className   = unclosed === 0 ? "status-ok" : "status-warn";
}

// ─── Error highlighting ───────────────────────────────────────────────────────

const setErrorEffect = StateEffect.define();

const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorEffect)) {
        if (e.value === null) {
          deco = Decoration.none;
        } else {
          try {
            const line = tr.state.doc.line(e.value);
            deco = Decoration.set([
              Decoration.line({ class: "cm-error-line" }).range(line.from)
            ]);
          } catch { deco = Decoration.none; }
        }
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

function highlightErrorLine(n) { editor.dispatch({ effects: setErrorEffect.of(n) }); }
function clearErrorHighlight() { editor.dispatch({ effects: setErrorEffect.of(null) }); }

// ─── Smart error translator ───────────────────────────────────────────────────

/**
 * Takes the raw fengari error string AND the full source code so it can give
 * context-aware messages — e.g. detecting whether a function is defined later
 * than where it's called, whether a variable was never defined, etc.
 */
function friendlyError(raw, code) {
  const lineMatch = raw.match(/:(\d+):/);
  const callLine  = lineMatch ? parseInt(lineMatch[1]) : null;
  const srcLines  = code.split("\n");

  // Strip fengari's "[string ...]:N: " prefix so we're working with just the message
  let msg = raw.replace(/\[string "[^"]*"\]:\d+:\s*/, "").trim();

  // ── Code-searching helpers ──────────────────────────────────────────────────

  // Returns the 1-based line number where `name` is defined as a function,
  // or null if not found.
  function findFunctionDef(name) {
    for (let i = 0; i < srcLines.length; i++) {
      const t = srcLines[i];
      if (new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(t)       ||
          new RegExp(`\\blocal\\s+function\\s+${name}\\s*\\(`).test(t) ||
          new RegExp(`\\b${name}\\s*=\\s*function`).test(t)) {
        return i + 1;
      }
    }
    return null;
  }

  // Returns the 1-based line where `name` is first assigned / declared, or null.
  function findVarDef(name) {
    for (let i = 0; i < srcLines.length; i++) {
      const t = srcLines[i];
      if (new RegExp(`\\blocal\\s+.*\\b${name}\\b`).test(t) ||
          new RegExp(`^\\s*${name}\\s*=`).test(t)) {
        return i + 1;
      }
    }
    return null;
  }

  // ── Pattern table ───────────────────────────────────────────────────────────
  // Each entry: [regex, handler(fullMatch, ...groups) → string]

  const patterns = [

    // ── Calling something that isn't a function ─────────────────────────────
    [/attempt to call a nil value \(global '(\w+)'\)/, (_, name) => {
      const defLine = findFunctionDef(name);
      if (defLine && callLine && defLine > callLine) {
        return `'${name}' is called on line ${callLine} but isn't defined until line ${defLine} — move the function definition above line ${callLine}`;
      }
      if (defLine) {
        return `'${name}' is defined on line ${defLine} but something is wrong with it — check that line for mistakes`;
      }
      // Check if it's a typo of a known stdlib function
      const stdlib = ["print","pairs","ipairs","type","tostring","tonumber",
                      "error","assert","pcall","math","string","table"];
      const close  = stdlib.find(f => f !== name &&
        Math.abs(f.length - name.length) <= 2 &&
        [...name].filter((c,i) => f[i] !== c).length <= 2);
      if (close) return `'${name}' doesn't exist — did you mean '${close}'?`;
      return `'${name}' doesn't exist — check the spelling or make sure you defined it`;
    }],

    [/attempt to call a nil value \(local '(\w+)'\)/, (_, name) => {
      return `'${name}' is not a function — check what value you assigned to it`;
    }],

    [/attempt to call a nil value/, () =>
      `Tried to call something as a function but it has no value — check for typos`
    ],

    // ── Arithmetic on nil ───────────────────────────────────────────────────
    [/attempt to perform arithmetic on a nil value \(global '(\w+)'\)/, (_, name) => {
      const defLine = findVarDef(name);
      if (!defLine) {
        return `'${name}' has never been defined — did you forget to write: local ${name} = 0?`;
      }
      if (callLine && defLine > callLine) {
        return `'${name}' is used on line ${callLine} but only defined on line ${defLine} — move the definition above line ${callLine}`;
      }
      return `'${name}' is nil — it was defined but has no number value here. Check if a function returned nil or if it was set correctly`;
    }],

    [/attempt to perform arithmetic on a nil value \(local '(\w+)'\)/, (_, name) => {
      const defLine = findVarDef(name);
      if (callLine && defLine && defLine > callLine) {
        return `'${name}' is used before it's defined — move its definition above line ${callLine}`;
      }
      return `'${name}' is nil — make sure you assigned a number to it before doing math`;
    }],

    [/attempt to perform arithmetic on a nil value/, () =>
      `Can't do math on a nil value — one of your variables has no value`
    ],

    // ── Concatenation on nil ────────────────────────────────────────────────
    [/attempt to concatenate a nil value \(global '(\w+)'\)/, (_, name) => {
      const defLine = findVarDef(name) || findFunctionDef(name);
      if (!defLine) return `'${name}' has never been defined — can't join it into a string`;
      if (callLine && defLine > callLine) return `'${name}' is used on line ${callLine} but only defined on line ${defLine}`;
      return `'${name}' is nil — it has no value to turn into text. Try: tostring(${name})`;
    }],

    [/attempt to concatenate a nil value \(local '(\w+)'\)/, (_, name) => {
      return `'${name}' is nil — can't join it into a string. Try tostring(${name}) to be safe`;
    }],

    [/attempt to concatenate a ([\w ]+) value/, (_, t) =>
      `Can't join a ${t} directly into a string — wrap it in tostring() first`
    ],

    // ── Indexing nil ────────────────────────────────────────────────────────
    [/attempt to index a nil value \(global '(\w+)'\)/, (_, name) => {
      const defLine = findVarDef(name);
      if (!defLine) return `'${name}' doesn't exist — you can't use . or [] on something that was never defined`;
      return `'${name}' is nil — you can't use . or [] on it. Make sure it's a table or object first`;
    }],

    [/attempt to index a nil value \(local '(\w+)'\)/, (_, name) => {
      return `'${name}' is nil — you can't use . or [] on it. Make sure it's a table first`;
    }],

    // ── Missing structural keywords ─────────────────────────────────────────
    [/'end' expected \(to close '(\w+)' at line (\d+)\) near '<eof>'/, (_, kw, l) =>
      `Missing 'end' — the '${kw}' block that starts on line ${l} was never closed`
    ],

    [/'end' expected near '(.+)'/, (_, near) =>
      `Expected 'end' to close a block but found '${near}' instead — you might be missing an 'end' earlier`
    ],

    [/'then' expected near '(.+)'/, (_, near) =>
      `Missing 'then' after the if condition — write: if ... then`
    ],

    [/'do' expected near '(.+)'/, (_, near) =>
      `Missing 'do' after the loop condition — write: for ... do or while ... do`
    ],

    [/'=' expected near '(.+)'/, (_, near) =>
      `Expected '=' in an assignment but found '${near}' — check for typos`
    ],

    [/unexpected symbol near '(.+)'/, (_, sym) => {
      if (sym === "<eof>") return `Unexpected end of file — you're probably missing an 'end' somewhere`;
      return `Unexpected '${sym}' — check for typos or a missing operator near that character`;
    }],

    // ── Type mismatches ─────────────────────────────────────────────────────
    [/bad argument #(\d+) to '(\w+)' \((\w+) expected, got (\w+)\)/, (_, n, fn, exp, got) =>
      `'${fn}' needs a ${exp} as its ${ordinal(n)} argument, but got a ${got} instead`
    ],

    [/attempt to compare two (\w+) values/, (_, t) =>
      `Can't compare two ${t} values with < or > — these only work on numbers and strings`
    ],

    [/attempt to compare (\w+) with (\w+)/, (_, a, b) =>
      `Can't compare a ${a} with a ${b} — make sure both sides are the same type`
    ],

    // ── Stack overflow ──────────────────────────────────────────────────────
    [/stack overflow/, () => {
      // Try to identify the function that might be infinitely recursive
      const fnMatch = raw.match(/in function '(\w+)'/);
      if (fnMatch) {
        return `Infinite loop — '${fnMatch[1]}' keeps calling itself forever. Make sure it has a condition that stops the recursion`;
      }
      return `Infinite loop or recursion — a function is calling itself (or another function) forever with no way to stop`;
    }],
  ];

  for (const [pattern, handler] of patterns) {
    const match = msg.match(pattern);
    if (match) { msg = handler(...match); break; }
  }

  return { lineNum: callLine, msg };
}

function ordinal(n) {
  return n === "1" ? "1st" : n === "2" ? "2nd" : n === "3" ? "3rd" : `${n}th`;
}

// ─── Block helpers ────────────────────────────────────────────────────────────

/**
 * True when the line is `else` or `elseif … then`. These indent the next
 * line but don't open a new block of their own (the enclosing `if` already
 * owns the `end`), so the Enter handler treats them separately from
 * getBlockOpenedOn().
 */
function isElseBranch(lineText) {
  const t = stripLuaNoise(lineText)[0];
  return t === "else" || (/\belseif\b/.test(t) && /\bthen\b/.test(t));
}

// ─── Lua preprocessing ───────────────────────────────────────────────────────

function preprocessLua(code) {
  return code
    .replace(/(\w+)\s*\+=\s*(.+)/g, "$1 = $1 + $2")
    .replace(/(\w+)\s*-=\s*(.+)/g,  "$1 = $1 - $2")
    .replace(/(\w+)\s*\*=\s*(.+)/g, "$1 = $1 * $2")
    .replace(/(\w+)\s*\/=\s*(.+)/g, "$1 = $1 / $2");
}

// ─── Syntax theme ────────────────────────────────────────────────────────────

const luaTheme = HighlightStyle.define([
  { tag: tags.keyword,                        color: "#fd94a5" },
  { tag: tags.string,                         color: "#b8ffa8" },
  { tag: tags.number,                         color: "#ffd166" },
  { tag: tags.comment,                        color: "#666"    },
  { tag: tags.definition(tags.variableName),  color: "#73c7ff" },
  { tag: tags.variableName,                   color: "#e6e6e6" },
  { tag: tags.operator,                       color: "#f8a4d0" },
  { tag: tags.punctuation,                    color: "#aaa"    },
]);

// ─── Font size (Ctrl+= / Ctrl+-) ─────────────────────────────────────────────

const fontSizeComp = new Compartment();
let fontSize = 14;

function fontTheme(size) {
  return EditorView.theme({
    ".cm-content": { fontSize: size + "px", lineHeight: "1.6" },
    ".cm-gutters": { fontSize: size + "px", lineHeight: "1.6" },
  });
}

function changeFontSize(delta) {
  fontSize = Math.min(26, Math.max(10, fontSize + delta));
  editor.dispatch({ effects: fontSizeComp.reconfigure(fontTheme(fontSize)) });
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

const mathOptions = [
  snippetCompletion("math.random(${1})",        { label: "math.random", type: "function", detail: "([m [, n]])" }),
  snippetCompletion("math.floor(${1:x})",       { label: "math.floor",  type: "function", detail: "(x)" }),
  snippetCompletion("math.ceil(${1:x})",        { label: "math.ceil",   type: "function", detail: "(x)" }),
  snippetCompletion("math.abs(${1:x})",         { label: "math.abs",    type: "function", detail: "(x)" }),
  snippetCompletion("math.sqrt(${1:x})",        { label: "math.sqrt",   type: "function", detail: "(x)" }),
  snippetCompletion("math.max(${1:a}, ${2:b})", { label: "math.max",    type: "function", detail: "(...)" }),
  snippetCompletion("math.min(${1:a}, ${2:b})", { label: "math.min",    type: "function", detail: "(...)" }),
  { label: "math.huge", type: "constant", detail: "∞"        },
  { label: "math.pi",   type: "constant", detail: "3.14159…" },
];

const stringOptions = [
  snippetCompletion("string.len(${1:s})",                           { label: "string.len",     type: "function", detail: "(s)" }),
  snippetCompletion("string.sub(${1:s}, ${2:i})",                   { label: "string.sub",     type: "function", detail: "(s, i [, j])" }),
  snippetCompletion("string.upper(${1:s})",                         { label: "string.upper",   type: "function", detail: "(s)" }),
  snippetCompletion("string.lower(${1:s})",                         { label: "string.lower",   type: "function", detail: "(s)" }),
  snippetCompletion("string.rep(${1:s}, ${2:n})",                   { label: "string.rep",     type: "function", detail: "(s, n)" }),
  snippetCompletion("string.reverse(${1:s})",                       { label: "string.reverse", type: "function", detail: "(s)" }),
  snippetCompletion("string.find(${1:s}, ${2:pattern})",            { label: "string.find",    type: "function", detail: "(s, pattern)" }),
  snippetCompletion("string.match(${1:s}, ${2:pattern})",           { label: "string.match",   type: "function", detail: "(s, pattern)" }),
  snippetCompletion("string.format(${1:fmt})",                      { label: "string.format",  type: "function", detail: "(fmt, ...)" }),
  snippetCompletion("string.gsub(${1:s}, ${2:pattern}, ${3:repl})", { label: "string.gsub",    type: "function", detail: "(s, pattern, repl)" }),
  snippetCompletion("string.byte(${1:s})",                          { label: "string.byte",    type: "function", detail: "(s [, i])" }),
  snippetCompletion("string.char(${1:n})",                          { label: "string.char",    type: "function", detail: "(...)" }),
];

const tableOptions = [
  snippetCompletion("table.insert(${1:t}, ${2:value})", { label: "table.insert", type: "function", detail: "(t, [pos,] value)" }),
  snippetCompletion("table.remove(${1:t})",             { label: "table.remove", type: "function", detail: "(t [, pos])" }),
  snippetCompletion("table.sort(${1:t})",               { label: "table.sort",   type: "function", detail: "(t [, comp])" }),
  snippetCompletion("table.concat(${1:t}, ${2:sep})",   { label: "table.concat", type: "function", detail: "(t [, sep])" }),
];

const globalOptions = [
  ...["while","for","if","else","elseif","then","do","end","return","break",
      "local","function","repeat","until","not","and","or","nil","in"].map(kw => ({
    label: kw, type: "keyword",
  })),
  { label: "true",  type: "constant" },
  { label: "false", type: "constant" },
  snippetCompletion("print(${1})",                    { label: "print",        type: "function", detail: "(...)" }),
  snippetCompletion("pairs(${1:t})",                  { label: "pairs",        type: "function", detail: "(t)" }),
  snippetCompletion("ipairs(${1:t})",                 { label: "ipairs",       type: "function", detail: "(t)" }),
  snippetCompletion("type(${1})",                     { label: "type",         type: "function", detail: "(v)" }),
  snippetCompletion("tostring(${1})",                 { label: "tostring",     type: "function", detail: "(v)" }),
  snippetCompletion("tonumber(${1})",                 { label: "tonumber",     type: "function", detail: "(e)" }),
  snippetCompletion("error(${1:msg})",                { label: "error",        type: "function", detail: "(msg [, level])" }),
  snippetCompletion("assert(${1:v})",                 { label: "assert",       type: "function", detail: "(v [, msg])" }),
  snippetCompletion("pcall(${1:f})",                  { label: "pcall",        type: "function", detail: "(f, ...)" }),
  snippetCompletion("unpack(${1:t})",                 { label: "unpack",       type: "function", detail: "(t)" }),
  snippetCompletion("select(${1:index}, ${2:...})",   { label: "select",       type: "function", detail: "(index, ...)" }),
  snippetCompletion("rawget(${1:t}, ${2:k})",         { label: "rawget",       type: "function" }),
  snippetCompletion("rawset(${1:t}, ${2:k}, ${3:v})", { label: "rawset",       type: "function" }),
  snippetCompletion("setmetatable(${1:t}, ${2:mt})",  { label: "setmetatable", type: "function" }),
  snippetCompletion("getmetatable(${1:t})",           { label: "getmetatable", type: "function" }),
  { label: "math",   type: "namespace", detail: "math library"   },
  { label: "string", type: "namespace", detail: "string library" },
  { label: "table",  type: "namespace", detail: "table library"  },
  { label: "os",     type: "namespace", detail: "os library"     },
  { label: "io",     type: "namespace", detail: "io library"     },
];

// ─── Run logic ────────────────────────────────────────────────────────────────

function runCode() {
  const code     = preprocessLua(editor.state.doc.toString());
  const outputEl = document.getElementById("output");
  if (!outputEl) return;

  if (worker) worker.terminate();
  worker = new Worker(new URL("./luaWorker.js", import.meta.url), { type: "module" });

  clearErrorHighlight();
  outputEl.textContent = "Running…";
  outputEl.className   = "";

  const timeout = setTimeout(() => {
    worker.terminate();
    outputEl.textContent = "❌ Timed out — check for infinite loops (a loop with no exit condition)";
    outputEl.className   = "output-error";
  }, 1000);

  worker.onmessage = (e) => {
    clearTimeout(timeout);
    const raw     = e.data.output || "";
    const isError = /\[string /.test(raw) || /stack overflow/.test(raw);

    if (isError) {
      const { lineNum, msg } = friendlyError(raw, code);
      const lineInfo = lineNum ? ` (line ${lineNum})` : "";
      outputEl.textContent = `❌ Error${lineInfo}: ${msg}`;
      outputEl.className   = "output-error";
      if (lineNum) highlightErrorLine(lineNum);
    } else {
      outputEl.textContent = raw || "(no output)";
      outputEl.className   = "";
    }
  };

  worker.postMessage(code);
}

// ─── Editor ───────────────────────────────────────────────────────────────────

const editor = new EditorView({
  state: EditorState.create({
    doc: `local limit = 6

local function meetsLimit()
  local randomNumber = math.random(1, 10)

  if randomNumber > limit then
    return randomNumber.." > 6"
  else
    return randomNumber.." <= 6"
  end
end

for i = 1, 5 do
  print(i..": "..meetsLimit())
end
`,
    extensions: [

      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) updateStatus(update.view);
        if (update.docChanged) clearErrorHighlight();
      }),

      keymap.of([
        // Run
        { key: "Mod-Enter", run: () => { runCode(); return true; } },

        // Font size
        { key: "Mod-=", run: () => { changeFontSize(+2); return true; } },
        { key: "Mod--", run: () => { changeFontSize(-2); return true; } },

        // Enter / block handling
        {
          key: "Enter",
          run: (view) => {
            const { state }    = view;
            const pos          = state.selection.main.from;
            const line         = state.doc.lineAt(pos);
            const text         = line.text;
            const indent       = text.match(/^\s*/)[0];
            const cursorInLine = pos - line.from;
            const atEndOfLine  = cursorInLine >= text.trimEnd().length;
            const innerIndent  = indent + "  ";

            if (isElseBranch(text) && atEndOfLine) {
              view.dispatch({
                changes:   { from: pos, to: pos, insert: "\n" + innerIndent },
                selection: { anchor: pos + 1 + innerIndent.length },
              });
              return true;
            }

            if (atEndOfLine) {
              const docText = state.doc.toString();
              const closer  = getCloserInfo(docText, text);

              if (closer) {
                const insert = "\n" + innerIndent +
                  (closer.needsCloser ? "\n" + indent + closer.closerText : "");

                view.dispatch({
                  changes:   { from: pos, to: pos, insert },
                  selection: { anchor: pos + 1 + innerIndent.length },
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
      syntaxHighlighting(luaTheme),
      closeBrackets(),
      keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap]),
      StreamLanguage.define(lua),
      errorLineField,
      fontSizeComp.of(fontTheme(fontSize)),

      autocompletion({
        activateOnTyping: true,
        override: [
          (context) => {
            const word = context.matchBefore(/[\w.]*/);
            if (!word || (word.from === word.to && !context.explicit)) return null;
            const prefix = word.text;
            if (prefix.startsWith("math."))   return { from: word.from, options: mathOptions };
            if (prefix.startsWith("string.")) return { from: word.from, options: stringOptions };
            if (prefix.startsWith("table."))  return { from: word.from, options: tableOptions };
            return { from: word.from, options: globalOptions };
          },
        ],
      }),
    ],
  }),
  parent: document.getElementById("editor"),
});

updateStatus(editor);

// ─── Buttons ──────────────────────────────────────────────────────────────────

let worker;

document.getElementById("run").onclick   = runCode;
document.getElementById("clear").onclick = () => {
  document.getElementById("output").textContent = "";
  document.getElementById("output").className   = "";
  clearErrorHighlight();
};