/**
 * themes/index.js — theme registry.
 *
 * Each theme is a plain object:
 *   { name, css, highlight, isDark }
 *
 * The app loads CSS + highlight style from the active theme and
 * can swap themes at runtime by reconfiguring the editor.
 */

import retroDark  from "./retro-dark.js";
import retroLight from "./retro-light.js";

export const themes = {
  dark:  retroDark,
  light: retroLight,
};

export const DEFAULT_THEME = "dark";

export function getTheme(name) {
  return themes[name] || themes[DEFAULT_THEME];
}