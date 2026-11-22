// Theme hook ported from app.js

import { useEffect, useState } from "react";
import { localStorageGet, localStorageSet } from "../api";

type ThemePreference = "light" | "dark" | "system";

export function useTheme() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = localStorageGet("moonwitness-dx.theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });

  const [dark, setDark] = useState(false);

  const applyTheme = () => {
    const isDark = themePreference === "dark" || (themePreference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark ? "#0e0e10" : "#f3efe4");
  };

  useEffect(() => {
    applyTheme();
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (themePreference === "system") applyTheme();
    };
    mediaQuery.addEventListener?.("change", handler);
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "moonwitness-dx.theme" || e.key === null) {
        const saved = localStorageGet("moonwitness-dx.theme");
        setThemePreference(saved === "light" || saved === "dark" ? saved : "system");
      }
    };
    window.addEventListener("storage", storageHandler);
    return () => {
      mediaQuery.removeEventListener?.("change", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [themePreference]);

  const setTheme = (pref: ThemePreference) => {
    setThemePreference(pref);
    localStorageSet("moonwitness-dx.theme", pref);
  };

  return { themePreference, dark, setTheme };
}