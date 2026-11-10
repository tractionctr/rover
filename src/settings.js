/**
 * settings.js — Rover configuration schema.
 *
 * A "settings" object describes how a particular host wants Rover to behave.
 * It is plain JSON, validated here, and merged with sensible defaults so a
 * host can override only what it cares about.
 *
 * Consumed by the worker (sandbox / speed / errors) and by the host API
 * (globals / algebra). The editor UI does not need to know the schema.
 *
 * Example (a pixel host):
 *   {
 *     sandbox: { blockedKeywords: ["while", "repeat", "goto"] },
 *     runtime: { globals: { setPixel: (L, x, y, r, g, b) => { ... } } },
 *     errors: { patterns: [{ re: "bad pixel", msg: "Use setPixel() instead." }] }
 *   }
 */

/** Default settings — safe, permissive, nothing surprising. */
export const DEFAULT_SETTINGS = {
  sandbox: {
    // Statements/keywords the script is not allowed to use. Checked by
    // regex against the source before execution. Empty = everything allowed.
    blockedKeywords: [],
    // Hard instruction budget. 0 = unlimited. Enforced via lua_sethook.
    maxInstructions: 0,
    // Wall-clock seconds before the run is aborted. 0 = no timeout.
    maxSeconds: 0,
  },
  runtime: {
    // Host globals injected into the Lua state. Each value is either:
    //   - a JS function (L, ...args) -> number of stack values pushed
    //   - a plain JS value (number/string/boolean/object/array) — wrapped
    globals: {},
    // Remove the standard globals a host does not want exposed.
    removeGlobals: [],
  },
  algebra: {
    // How table arithmetic is handled. "strict" = error, "lenient" = allow.
    tableArithmetic: "strict",
  },
  errors: {
    // Lua error messages matching any of these regexes are rewritten.
    patterns: [],
  },
};

/** Single keyword entry: a string or { pattern, message } object. */
function normalizeKeyword(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") return { pattern: entry, message: `Keyword "${entry}" is not allowed.` };
  if (typeof entry === "object" && typeof entry.pattern === "string") {
    return { pattern: entry.pattern, message: entry.message || `Keyword "${entry.pattern}" is not allowed.` };
  }
  return null;
}

/** Validate and merge user settings onto defaults. Returns a new object. */
export function mergeSettings(user) {
  if (user == null) return structuredClone(DEFAULT_SETTINGS);
  if (typeof user !== "object" || Array.isArray(user))
    throw new TypeError("settings must be an object");

  const out = structuredClone(DEFAULT_SETTINGS);

  // sandbox
  if (user.sandbox != null) {
    if (typeof user.sandbox !== "object") throw new TypeError("sandbox must be an object");
    if (user.sandbox.blockedKeywords != null) {
      if (!Array.isArray(user.sandbox.blockedKeywords))
        throw new TypeError("sandbox.blockedKeywords must be an array");
      out.sandbox.blockedKeywords = user.sandbox.blockedKeywords
        .map(normalizeKeyword)
        .filter(Boolean);
    }
    if (user.sandbox.maxInstructions != null) {
      const n = Number(user.sandbox.maxInstructions);
      if (!Number.isFinite(n) || n < 0) throw new TypeError("sandbox.maxInstructions must be >= 0");
      out.sandbox.maxInstructions = Math.floor(n);
    }
    if (user.sandbox.maxSeconds != null) {
      const n = Number(user.sandbox.maxSeconds);
      if (!Number.isFinite(n) || n < 0) throw new TypeError("sandbox.maxSeconds must be >= 0");
      out.sandbox.maxSeconds = Math.floor(n);
    }
  }

  // runtime
  if (user.runtime != null) {
    if (typeof user.runtime !== "object") throw new TypeError("runtime must be an object");
    if (user.runtime.globals != null) {
      if (typeof user.runtime.globals !== "object" || Array.isArray(user.runtime.globals))
        throw new TypeError("runtime.globals must be an object");
      out.runtime.globals = { ...user.runtime.globals };
    }
    if (user.runtime.removeGlobals != null) {
      if (!Array.isArray(user.runtime.removeGlobals))
        throw new TypeError("runtime.removeGlobals must be an array");
      out.runtime.removeGlobals = [...user.runtime.removeGlobals];
    }
  }

  // algebra
  if (user.algebra != null) {
    if (typeof user.algebra !== "object") throw new TypeError("algebra must be an object");
    if (user.algebra.tableArithmetic != null) {
      const v = String(user.algebra.tableArithmetic);
      if (!["strict", "lenient"].includes(v)) throw new TypeError("algebra.tableArithmetic must be 'strict' or 'lenient'");
      out.algebra.tableArithmetic = v;
    }
  }

  // errors
  if (user.errors != null) {
    if (typeof user.errors !== "object") throw new TypeError("errors must be an object");
    if (user.errors.patterns != null) {
      if (!Array.isArray(user.errors.patterns))
        throw new TypeError("errors.patterns must be an array");
      out.errors.patterns = user.errors.patterns.map((p) => {
        if (typeof p === "string") return { re: p, msg: p };
        if (typeof p === "object" && typeof p.re === "string")
          return { re: p.re, msg: p.msg || p.re };
        throw new TypeError("error pattern must be a string or { re, msg }");
      });
    }
  }

  return out;
}