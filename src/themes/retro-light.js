/**
 * retro-light.js — light variant, same layout, bright palette.
 */
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: tags.keyword,                         color: "#0000ff" },
  { tag: tags.definition(tags.variableName),    color: "#008000" },
  { tag: tags.variableName,                     color: "#000000" },
  { tag: tags.string,                           color: "#a31515" },
  { tag: tags.number,                           color: "#098658" },
  { tag: tags.comment,                          color: "#008000" },
  { tag: tags.operator,                         color: "#000000" },
  { tag: tags.punctuation,                      color: "#000000" },
  { tag: tags.atom,                             color: "#098658" },
  { tag: tags.bracket,                          color: "#808080" },
]);

const css = `
/* ── Light palette ─────────────────────────────────────────────────────────── */
:root[data-theme="light"] {
  --bg:          #ffffff;
  --surface:     #f3f3f3;
  --surface-alt: #e8e8e8;
  --border:      #d4d4d4;
  --fg:          #333333;
  --fg-muted:    #6d6d6d;
  --accent:      #007acc;
  --accent-hover:#1a8fe0;
  --err:         #d32f2f;
  --ok:          #2e7d32;
  --mono:        "Cascadia Code", "Fira Code", Consolas, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  height: 100%;
  overflow: hidden;
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.main-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 12px;
  user-select: none;
}

.title-left { display: flex; align-items: center; gap: 10px; }
.logo {
  width: 16px; height: 16px;
  background: var(--accent);
  border-radius: 3px;
  display: grid; place-items: center;
  font-size: 10px; font-weight: 700; color: white;
}
.title-name { color: var(--fg); font-weight: 500; }
.title-meta { color: var(--fg-muted); font-size: 11px; }

.kbd-hint {
  display: inline-flex; align-items: center; gap: 3px;
  color: var(--fg-muted); font-size: 11px;
}
kbd {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 3px; padding: 0 4px;
  font-size: 10px; font-family: var(--mono);
  color: var(--fg-muted);
}

.theme-toggle {
  background: transparent; border: 1px solid var(--border);
  border-radius: 6px; color: var(--fg-muted);
  cursor: pointer; padding: 3px 10px;
  font-size: 11px; display: flex; align-items: center; gap: 4px;
  transition: all 0.15s; font-family: inherit;
}
.theme-toggle:hover { background: var(--surface-alt); color: var(--fg); }

.toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 12px; background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.btn {
  appearance: none; background: transparent;
  border: 1px solid transparent; border-radius: 6px;
  color: var(--fg); padding: 5px 12px;
  font-size: 12px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  transition: background 0.12s, border-color 0.12s;
  font-family: inherit; line-height: 1;
}
.btn:hover { background: var(--surface-alt); border-color: var(--border); }
.btn:active { background: var(--border); }

.btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
.btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: white; }

.tool-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }

.font-btn {
  width: 28px; height: 26px; padding: 0;
  justify-content: center; font-size: 13px; font-weight: 600;
}
.font-label {
  font-size: 11px; color: var(--fg-muted);
  padding: 0 6px; font-family: var(--mono); min-width: 38px; text-align: center;
}
.toolbar-spacer { flex: 1; }

.editor-pane { flex: 1 1 auto; min-height: 0; border-bottom: 1px solid var(--border); overflow: auto; }
.splitter {
  flex: 0 0 auto; height: 5px; background: var(--border);
  cursor: row-resize; transition: background 0.1s;
}
.splitter:hover, .splitter.dragging { background: var(--accent); }
#editor { width: 100%; height: 100%; }

.cm-editor { background: var(--bg) !important; }
.cm-scroller { font-family: var(--mono); font-size: 13px; }
.cm-content  { color: var(--fg) !important; caret-color: var(--fg) !important; }
.cm-cursor, .cm-dropCursor { border-left: 2px solid var(--fg) !important; }
.cm-activeLine { background: rgba(0,0,0,0.04) !important; }
.cm-selectionBackground, .cm-content ::selection { background: rgba(0,122,204,0.18) !important; }
.cm-gutters  { background: var(--bg) !important; border-right: 1px solid var(--border) !important; }
.cm-lineNumbers .cm-gutterElement { color: var(--fg-muted) !important; font-size: 12px; }
.cm-activeLineGutter { background: var(--surface) !important; }
.cm-activeLineGutter .cm-gutterElement { color: var(--fg) !important; }
.cm-tooltip-autocomplete {
  background: var(--surface) !important;
  border: 1px solid var(--border) !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.cm-completionItem { color: var(--fg) !important; }
.cm-completionSelected { background: rgba(0,122,204,0.15) !important; }
.cm-error-line   { background: rgba(211,47,47,0.08) !important; }

.output-section {
  flex: 0 0 auto; display: flex; flex-direction: column;
  background: var(--surface); border-top: 1px solid var(--border);
  max-height: 45vh; overflow: hidden;
}
.output-tabbar {
  display: flex; align-items: center;
  border-bottom: 1px solid var(--border);
  padding: 0 8px; min-height: 28px;
}
.tab {
  padding: 4px 12px; font-size: 11px;
  color: var(--fg-muted); cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.1s, border-color 0.1s; user-select: none;
}
.tab.active { color: var(--fg); border-bottom-color: var(--accent); }
.tab:hover:not(.active) { color: var(--fg); }
.history-count { margin-left: auto; font-size: 11px; color: var(--fg-muted); padding-right: 8px; }

.history-toggle {
  margin-left: auto;
  font-size: 11px;
  color: var(--fg-muted);
  cursor: pointer;
  user-select: none;
  padding: 2px 8px;
  border-radius: 3px;
  transition: color 0.1s, background 0.1s;
}
.history-toggle:hover { color: var(--fg); background: var(--surface-alt); }
.history-toggle.active { color: var(--accent); }

.output-body.collapsed #history { display: none; }

.output-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
#history { overflow-y: auto; flex: 0 0 auto; max-height: 40%; }

.history-entry summary {
  padding: 4px 12px; cursor: pointer; font-size: 12px;
  display: flex; align-items: center; gap: 8px;
  list-style: none; color: var(--fg-muted); transition: background 0.08s;
}
.history-entry summary::before { content: "▸"; font-size: 9px; transition: transform 0.1s; }
.history-entry[open] summary::before { content: "▼"; }
.history-entry summary:hover { background: var(--surface-alt); }
.history-entry .time { color: var(--fg-muted); font-size: 11px; }
.history-entry .badge { font-size: 11px; }
.history-entry .excerpt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.history-entry pre.body {
  margin: 0; padding: 6px 12px 6px 24px;
  font-family: var(--mono); font-size: 12px;
  white-space: pre-wrap; word-break: break-all;
  background: var(--bg); color: var(--fg);
  line-height: 1.5; max-height: 180px; overflow-y: auto;
}
.history-entry.is-error pre.body { color: var(--err); }

#output {
  padding: 8px 12px; font-family: var(--mono); font-size: 12px;
  white-space: pre-wrap; word-break: break-word;
  color: var(--fg); background: var(--bg);
  border-top: 1px solid var(--border);
  line-height: 1.5;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
#output.output-ok       { color: var(--ok); }
#output.output-running  { color: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
#output.output-error    { color: var(--err); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.status-bar {
  display: flex; align-items: center;
  height: 22px; padding: 0 10px;
  background: var(--accent); color: white;
  font-size: 11px; gap: 16px; flex-shrink: 0;
}
.status-item { display: flex; align-items: center; gap: 4px; }
.status-warn { color: #f9a825; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: #aaa; }

@media (max-width: 600px) {
  .toolbar { padding: 4px 8px; gap: 2px; }
  .kbd-hint { display: none; }
  .output-section { max-height: 50vh; }
}
`;

export default { name: "Rover Light", css, highlight, isDark: false };