// UI language selection and the message table lookup.
import en from "./locales/en.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };
import type { Env } from "./types.js";

export type Lang = "en" | "ko";
export type MessageKey = keyof typeof en;

export const MESSAGES: Record<Lang, Record<string, string>> = { en, ko };

function fromLocale(value: string | undefined): Lang | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "") return null;
  return v.startsWith("ko") ? "ko" : "en";
}

/** Parse an explicit language value; unknown values return null. */
export function parseLang(value: string | undefined): Lang | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "en" || v === "ko") return v;
  return null;
}

/**
 * Decide the UI language.
 * Order: --lang > AGENTSMD_LAZYLOAD_LANG > LC_ALL > LC_MESSAGES > LANG. Anything that is not Korean is English.
 */
export function resolveLang(flag: string | undefined, env: Env): Lang {
  const flagLang = parseLang(flag);
  if (flagLang) return flagLang;
  const own = parseLang(env.AGENTSMD_LAZYLOAD_LANG);
  if (own) return own;
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const l = fromLocale(env[name]);
    if (l) return l;
  }
  return "en";
}

/** Look up a message and fill `{name}` placeholders. */
export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
