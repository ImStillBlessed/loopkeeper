import { useState } from "react";

export type Theme = "light" | "dark";

/** Light is the Ednovax brand; dark is a choice remembered in this browser. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("lk-theme", next);
    } catch {
      // Private windows may refuse storage; the toggle still works for this visit.
    }
    setTheme(next);
  };
  return [theme, toggle];
}
