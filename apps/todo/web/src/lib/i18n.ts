// i18n utilities ported from app.js

export type Lang = "en" | "zh-cn";

let DICT: Record<string, string> | null = null;
let LANG: Lang = "en";

export function getLang(): Lang {
  return LANG;
}

export function setLang(lang: Lang) {
  LANG = lang;
  localStorage.setItem("moonwitness-dx.lang", lang);
}

export async function loadDictionary(): Promise<void> {
  if (LANG === "en") {
    DICT = null;
    return;
  }
  try {
    const res = await fetch(`/i18n/${LANG}.js`);
    if (res.ok) {
      const text = await res.text();
      // The i18n file is a JS file that assigns to window.DICT
      // We'll evaluate it in a safe way
      const module = { exports: {} };
      // eslint-disable-next-line no-eval
      eval(text);
      DICT = (window as any).DICT || null;
    }
  } catch {
    DICT = null;
  }
}

export function tr(key: string, ...args: (string | number)[]): string {
  let s = DICT?.[key] ?? key;
  for (let i = 0; i < args.length; i++) {
    s = s.replace(new RegExp(`\\{${i}\\}`, "g"), String(args[i]));
  }
  return s;
}

export function initLang(): Lang {
  const saved = localStorage.getItem("moonwitness-dx.lang");
  if (saved === "zh-cn" || saved === "en") {
    LANG = saved;
  } else {
    LANG = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-cn" : "en";
  }
  return LANG;
}