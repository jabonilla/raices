import { describe, expect, it } from "vitest";

import en from "../src/i18n/en.json";
import es from "../src/i18n/es.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return flattenKeys(value as Record<string, unknown>, full);
    }
    return [full];
  });
}

describe("locale parity", () => {
  it("es and en define the same keys", () => {
    const esKeys = new Set(flattenKeys(es));
    const enKeys = new Set(flattenKeys(en));
    const missingInEn = [...esKeys].filter((k) => !enKeys.has(k));
    const missingInEs = [...enKeys].filter((k) => !esKeys.has(k));
    expect({ missingInEn, missingInEs }).toEqual({ missingInEn: [], missingInEs: [] });
  });
});
