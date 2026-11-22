import { defineI18n } from "fumadocs-core/i18n";
import { en } from "./en";

export const i18n = defineI18n({ languages: ["en"], defaultLanguage: "en", hideLocale: "default-locale" });

export type Key = keyof typeof en;

const translations = i18n
  .translations()
  .extend({ keys: Object.keys(en) as Key[] })
  .add({
    en: Object.fromEntries(Object.entries(en).map(([key, { text }]) => [key, text])) as Record<Key, string>,
  });

export function t(key: Key, vars: Record<string, string | number> = {}, lang = i18n.defaultLanguage): string {
  const text = translations.get(lang)?.[key] ?? en[key].text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function isSuggested(key: Key): boolean {
  return "suggested" in en[key];
}
