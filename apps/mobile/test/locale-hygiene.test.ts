import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const I18N_DIR = join(__dirname, "../src/i18n");
const SRC_DIR = join(__dirname, "../src");
// app/ holds the expo-router entry points (index, _layout) which also call
// t(). The unused-key scan must cover it — app.name/app.getStarted were
// wrongly flagged as dead because only src/ was walked (PR #96 CI fix).
const APP_DIR = join(__dirname, "../app");

interface FlatMap {
  [key: string]: string;
}

function flatten(obj: unknown, prefix = ""): FlatMap {
  const out: FlatMap = {};
  if (typeof obj !== "object" || obj === null) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) {
      Object.assign(out, flatten(v, key));
    } else if (typeof v === "string") {
      out[key] = v;
    }
  }
  return out;
}

function loadLocale(locale: string): FlatMap {
  const content = readFileSync(join(I18N_DIR, `${locale}.json`), "utf-8");
  return flatten(JSON.parse(content));
}

/** All t("...") key usages in source, excluding tests.
 * Handles:
 * - String literals: t("key"), t('key')
 * - Template literals in t(): t(`prefix.${dynamic}`)
 * - Key construction: `prefix.${dynamic}.suffix` (passed to t() elsewhere)
 * Returns { used: Set<string>, prefixes: Set<string> } */
function findUsedKeys(): { used: Set<string>; prefixes: Set<string> } {
  const used = new Set<string>();
  const prefixes = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test" && entry.name !== "__tests__") walk(path);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const content = readFileSync(path, "utf-8");
        // t("key") and t('key')
        for (const m of content.matchAll(/\bt\(\s*["']([^"'`]+)["']/g)) {
          const key = m[1];
          if (key) used.add(key);
        }
        // Quoted key-like strings used as mapping values
        // e.g., title: "notifications.transfer_received.title"
        for (const m of content.matchAll(/["']([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)["']/g)) {
          const key = m[1];
          if (key) used.add(key);
        }
        // t(`prefix.${dynamic}`) — capture static prefix
        for (const m of content.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)) {
          const prefix = m[1];
          if (prefix) prefixes.add(prefix);
        }
        // Key construction: `prefix.${x}.suffix` or "prefix." + x
        // e.g., `apiErrors.${code}.title` — capture "apiErrors." as prefix
        for (const m of content.matchAll(/[`"']([a-zA-Z0-9_.]+\.)\$\{/g)) {
          const prefix = m[1];
          if (prefix) prefixes.add(prefix);
        }
      }
    }
  };
  walk(SRC_DIR);
  walk(APP_DIR);
  return { used, prefixes };
}

describe("locale hygiene (K2.38)", () => {
  const en = loadLocale("en");
  const es = loadLocale("es");
  const enKeys = Object.keys(en);
  const esKeys = Object.keys(es);

  it("every key exists in both locales", () => {
    const missingInEs = enKeys.filter((k) => !(k in es));
    const missingInEn = esKeys.filter((k) => !(k in en));
    expect(missingInEs, `Keys in en but missing in es: ${missingInEs.join(", ")}`).toEqual([]);
    expect(missingInEn, `Keys in es but missing in en: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("every defined key is used in code", () => {
    const { used, prefixes } = findUsedKeys();
    const isUsed = (key: string): boolean => {
      if (used.has(key)) return true;
      return [...prefixes].some((p) => key.startsWith(p));
    };
    const unusedEn = enKeys.filter((k) => !isUsed(k));
    // Allowlist: keys kept for future use or external reference
    const allowlist: string[] = [
      // Tab labels — not yet wired to navigation, but the design calls for them
      "tabs.assistant",
      "tabs.goal",
      "tabs.history",
      "tabs.home",
      "tabs.send",
    ];
    const trulyUnused = unusedEn.filter((k) => !allowlist.includes(k));
    expect(trulyUnused, `Defined but never used: ${trulyUnused.join(", ")}`).toEqual([]);
  });

  it("no duplicate values that should share a key", () => {
    // If two keys have the same value, they should either share a key
    // or be explicitly allowlisted (e.g., coincidental matches that
    // may diverge).
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const existing = seen.get(value);
      if (existing) {
        duplicates.push(`"${value}" in ${existing} and ${key}`);
      } else {
        seen.set(value, key);
      }
    }
    // Allowlist: duplicates that are intentionally separate
    const allowlisted = [
      // Screen titles vs tab labels — may diverge (short tab vs full title)
      '"Assistant" in assistant.title and tabs.assistant',
      '"History" in history.title and tabs.history',
    ];
    const real = duplicates.filter((d) => !allowlisted.includes(d));
    expect(real, `Duplicate values: ${real.join("; ")}`).toEqual([]);
  });

  it("keys are sorted deterministically", () => {
    const sortedEn = [...enKeys].sort();
    const sortedEs = [...esKeys].sort();
    expect(enKeys, "en.json keys are not sorted").toEqual(sortedEn);
    expect(esKeys, "es.json keys are not sorted").toEqual(sortedEs);
  });
});
