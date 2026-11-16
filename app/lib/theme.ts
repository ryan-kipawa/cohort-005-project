/** The localStorage key `root.tsx` reads before first paint to pick a theme. */
export const THEME_STORAGE_KEY = "cadence-theme";

type ThemeRoot = { classList: { toggle(token: string, force: boolean): void } };
type ThemeStorage = { setItem(key: string, value: string): void };

/**
 * Switch the page to dark or light and remember the choice. A storage that
 * refuses the write (private browsing, quota) still leaves the page switched.
 */
export function applyTheme(
  dark: boolean,
  root: ThemeRoot,
  storage: ThemeStorage
) {
  root.classList.toggle("dark", dark);
  try {
    storage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {}
}
