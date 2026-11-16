import { useEffect, useState } from "react";
import { applyTheme } from "~/lib/theme";

/** Whether the page is in dark mode, and a toggle that flips and remembers it. */
export function useDarkMode() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleDarkMode() {
    const next = !isDark;
    setIsDark(next);
    // Read localStorage only inside applyTheme's try: a sandboxed frame throws
    // on the read itself, not just on the write.
    applyTheme(next, document.documentElement, {
      setItem: (key, value) => localStorage.setItem(key, value),
    });
  }

  return { isDark, toggleDarkMode };
}
