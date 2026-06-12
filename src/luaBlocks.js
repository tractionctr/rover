/**
 * luaBlocks.js
 *
 * A small, dependency-free block-structure analyzer for Lua source code.
 *
 * Why this exists:
 * Previous approaches tried to match `end` to its opener using regex depth
 * counting and/or indentation comparisons. Both break down in real code:
 *   - Indentation comparisons fail when a user's `end` is indented
 *     differently than its opener (by any amount).
 *   - Regex counting fails on strings/comments containing keywords, e.g.
 *     print("function") or -- if x then.
 *
 * This module instead does what an actual Lua tokenizer does:
 *   1. Strip out comments and string contents (preserving line numbers).
 *   2. Walk the remaining keywords in document order using a stack.
 *   3. Every `function` / `if...then` / `for...do` / `while...do` / `do` /
 *      `repeat` pushes a block onto the stack. Every `end` pops whatever is
 *      on top; every `until` pops a `repeat`.
 *
 * This is exactly how Lua itself resolves block structure, so it's correct
 * for any indentation, any nesting depth, and any string/comment content.
 */

/**
 * Strips line comments, block comments (--[[ ]]), and string literals
 * ("...", '...', [[...]]) from Lua source, while preserving the exact
 * number of lines (so line numbers stay accurate for the caller).
 *
 * @param {string} code
 * @returns {string[]} cleaned lines, same length as code.split("\n")
 */
export function stripLuaNoise(code) {
  const lines = code.split("\n");
  const out = [];

  // null, or { } while inside a --[[ ]] block comment or [[ ]] long string
  let inBlock = false;

  for (const line of lines) {
    let result = "";
    let i = 0;

    while (i < line.length) {
      if (inBlock) {
        const closeIdx = line.indexOf("]]", i);
        if (closeIdx === -1) {
          i = line.length; // rest of line is inside the block
        } else {
          i = closeIdx + 2;
          inBlock = false;
        }
        continue;
      }

      // Block comment start: --[[
      if (line[i] === "-" && line[i + 1] === "-" && line[i + 2] === "[" && line[i + 3] === "[") {
        inBlock = true;
        i += 4;
        continue;
      }

      // Line comment: -- (rest of line discarded)
      if (line[i] === "-" && line[i + 1] === "-") {
        break;
      }

      // Long string start: [[
      if (line[i] === "[" && line[i + 1] === "[") {
        inBlock = true;
        i += 2;
        continue;
      }

      // Double-quoted string
      if (line[i] === '"') {
        i++;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === "\\") i++; // skip escaped character
          i++;
        }
        i++; // skip closing quote (or run past end if unterminated)
        continue;
      }

      // Single-quoted string
      if (line[i] === "'") {
        i++;
        while (i < line.length && line[i] !== "'") {
          if (line[i] === "\\") i++;
          i++;
        }
        i++;
        continue;
      }

      result += line[i];
      i++;
    }

    out.push(result);
  }

  return out;
}

// Keywords that affect block structure. Order doesn't matter for the regex,
// but `then`, `elseif`, `else` are intentionally included as no-ops so the
// regex consumes them too (avoids accidentally matching "then" inside other
// identifiers via word-boundary edge cases — harmless either way, but clearer).
const KEYWORD_RE = /\b(function|if|then|elseif|else|for|while|do|repeat|until|end)\b/g;

/**
 * Parses the full document and returns a list of block descriptors:
 *   { type: 'function'|'if'|'for'|'while'|'do'|'repeat', openLine, closeLine }
 *
 * `closeLine` is null if the block has no matching closer in the document.
 * `openLine` / `closeLine` are 1-indexed line numbers.
 *
 * @param {string} code
 * @returns {{type: string, openLine: number, closeLine: number|null}[]}
 */
export function analyzeBlocks(code) {
  const lines = stripLuaNoise(code);
  const stack = [];
  const blocks = [];

  // How many "for"/"while" blocks are waiting for their `do` token.
  // for/while always push immediately; their `do` is consumed here rather
  // than pushing a separate `do` block.
  let pendingDo = 0;

  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const line = lines[lineNum - 1];
    let m;
    KEYWORD_RE.lastIndex = 0;

    while ((m = KEYWORD_RE.exec(line)) !== null) {
      const kw = m[1];

      switch (kw) {
        case "function":
          stack.push({ type: "function", openLine: lineNum });
          break;

        case "if":
          stack.push({ type: "if", openLine: lineNum });
          break;

        case "for":
          stack.push({ type: "for", openLine: lineNum });
          pendingDo++;
          break;

        case "while":
          stack.push({ type: "while", openLine: lineNum });
          pendingDo++;
          break;

        case "do":
          if (pendingDo > 0) {
            // This `do` belongs to the most recent for/while — already on stack
            pendingDo--;
          } else {
            stack.push({ type: "do", openLine: lineNum });
          }
          break;

        case "repeat":
          stack.push({ type: "repeat", openLine: lineNum });
          break;

        case "until": {
          // `until` closes the nearest `repeat`
          if (stack.length && stack[stack.length - 1].type === "repeat") {
            const entry = stack.pop();
            blocks.push({ ...entry, closeLine: lineNum });
          }
          // If top isn't `repeat`, this `until` is malformed/orphaned — ignore.
          break;
        }

        case "end": {
          // `end` closes whatever block is currently on top
          const entry = stack.pop();
          if (entry) {
            blocks.push({ ...entry, closeLine: lineNum });
          }
          // If stack was empty, this `end` is an extra/orphaned `end` — ignore.
          break;
        }

        // "then" / "elseif" / "else" don't affect the stack
        default:
          break;
      }
    }
  }

  // Anything still on the stack never got closed
  for (const entry of stack) {
    blocks.push({ ...entry, closeLine: null });
  }

  return blocks;
}

/**
 * Returns the block descriptor that OPENS on `lineNum` (1-indexed), or null
 * if that line doesn't open a block.
 *
 * @param {string} code
 * @param {number} lineNum
 * @returns {{type: string, openLine: number, closeLine: number|null}|null}
 */
export function getBlockOpenedOn(code, lineNum) {
  const blocks = analyzeBlocks(code);
  return blocks.find(b => b.openLine === lineNum) || null;
}

/**
 * Returns true if the block opened on `lineNum` already has a matching
 * closer (`end` or `until`) somewhere in the document.
 *
 * @param {string} code
 * @param {number} lineNum
 * @returns {boolean}
 */
export function hasMatchingEnd(code, lineNum) {
  const block = getBlockOpenedOn(code, lineNum);
  return block ? block.closeLine !== null : false;
}

/**
 * Returns the number of blocks in the document that have no matching closer.
 * Used for the "N blocks not closed" status indicator.
 *
 * @param {string} code
 * @returns {number}
 */
export function countUnclosedBlocks(code) {
  return analyzeBlocks(code).filter(b => b.closeLine === null).length;
}

/**
 * Returns the type of block the given single line opens
 * ('function' | 'if' | 'for' | 'do' | 'repeat'), or null if the line
 * (after stripping strings/comments) doesn't open a block.
 *
 * Only matches lines that END with the relevant keyword/character
 * (then / do / `)` / repeat), matching the "press Enter at end of an
 * opener line" use case. Mid-line constructs aren't matched.
 *
 * Note: `for` and `while` both map to "for" here since both close with
 * `end` — the distinction doesn't matter for closer-insertion purposes.
 *
 * @param {string} lineText  a single line (no newlines)
 * @returns {string|null}
 */
export function getOpenedBlockType(lineText) {
  const [t] = stripLuaNoise(lineText);
  if (!t) return null;

  if (/\bif\b/.test(t) && /\bthen\s*$/.test(t) && !/\belseif\b/.test(t)) return "if";
  if (/\b(?:for|while)\b/.test(t) && /\bdo\s*$/.test(t))                 return "for";
  if (/\bfunction\b.*\)\s*$/.test(t))                                    return "function";
  if (/^do\s*$/.test(t))                                                 return "do";
  if (/^repeat\s*$/.test(t))                                             return "repeat";
  return null;
}

/**
 * Decides whether pressing Enter at the end of `lineText` (the line the
 * cursor is on, BEFORE the new line is inserted) should auto-insert a
 * block closer, and what that closer should be.
 *
 * The decision is deliberately GLOBAL and indentation-independent:
 * if the whole document (including the line just typed) has more
 * openers than closers, something needs closing — and since the user
 * just typed a new opener, that's the natural thing to close. If the
 * document is already balanced, nothing is added (even if some
 * individual `end` is misindented relative to its opener — indentation
 * is never consulted).
 *
 * @param {string} docText   full document text, opener line included
 * @param {string} lineText  the line the cursor is on
 * @returns {{type: string, closerText: string}|null}
 *          null if the line doesn't open a block; otherwise the block
 *          type and the text to insert as its closer ("end" or
 *          "until true" for repeat) — caller decides whether to use
 *          closerText based on whether a closer is actually needed.
 */
export function getCloserInfo(docText, lineText) {
  const type = getOpenedBlockType(lineText);
  if (!type) return null;

  const needsCloser = countUnclosedBlocks(docText) > 0;
  const closerText  = type === "repeat" ? "until true" : "end";

  return { type, needsCloser, closerText };
}