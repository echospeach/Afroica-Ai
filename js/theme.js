// Theme (background/appearance) selection — applied via data-theme on
// <html>, persisted in localStorage. Every other rule in style.css reads
// the same CSS custom properties (--bg, --surface, --gold, etc.), so
// adding a new theme only ever means one new :root[data-theme="..."]
// block in style.css plus one swatch button in index.html — nothing else
// needs to know themes exist.
//
// The actual applied-before-first-paint logic is duplicated as a small
// inline script in index.html's <head> (an ES module can't run early
// enough to avoid a flash of the default theme) — keep THEMES/DEFAULT_THEME
// in sync with that script if either ever changes.
const STORAGE_KEY = 'afroica_theme';
const THEMES = ['afroica', 'midnight', 'slate', 'light'];
const DEFAULT_THEME = 'afroica';

export function getStoredTheme(){
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(stored) ? stored : DEFAULT_THEME;
}

export function applyTheme(name){
  const theme = THEMES.includes(name) ? name : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
  return theme;
}
