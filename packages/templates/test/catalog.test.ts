import { describe, expect, it } from "vitest";

import {
  CATALOG,
  TEMPLATE_IDS,
  getTemplate,
  isCopyPending,
  slotsOf,
  templateBody,
  templatesPendingCopy,
} from "../src/index.js";
import type { MetaTemplateCategory } from "../src/index.js";

const VALID_CATEGORIES: readonly MetaTemplateCategory[] = [
  "UTILITY",
  "MARKETING",
  "AUTHENTICATION",
];

describe("template catalog", () => {
  it("defines the six MVP templates with stable ids", () => {
    expect(TEMPLATE_IDS).toEqual([
      "request_received",
      "request_approved",
      "request_declined",
      "money_sent",
      "money_arrived",
      "invitation",
    ]);
    expect(CATALOG.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
  });

  it("uses only Meta's template categories", () => {
    for (const template of CATALOG) {
      expect(VALID_CATEGORIES).toContain(template.category);
    }
  });

  it("marks the invitation as MARKETING and transactional templates as UTILITY", () => {
    expect(getTemplate("invitation")?.category).toBe("MARKETING");
    for (const id of TEMPLATE_IDS.filter((t) => t !== "invitation")) {
      expect(getTemplate(id)?.category).toBe("UTILITY");
    }
  });

  it("declares the slots each template accepts", () => {
    expect(slotsOf("request_received")).toEqual(["senderName", "amount", "purpose"]);
    expect(slotsOf("request_approved")).toEqual(["senderName", "amount"]);
    expect(slotsOf("request_declined")).toEqual(["senderName", "amount"]);
    expect(slotsOf("money_sent")).toEqual(["senderName", "amount"]);
    expect(slotsOf("money_arrived")).toEqual(["senderName", "amount"]);
    expect(slotsOf("invitation")).toEqual(["inviterName"]);
    for (const template of CATALOG) {
      expect(template.slots).toEqual(slotsOf(template.id));
    }
  });

  it("has a body per template per locale referencing only declared slots", () => {
    for (const template of CATALOG) {
      for (const locale of ["es", "en"] as const) {
        const body = templateBody(template.id, locale);
        expect(body.length).toBeGreaterThan(0);
        for (const match of body.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
          expect(template.slots).toContain(match[1]);
        }
      }
    }
  });

  it("returns undefined for an unknown template id", () => {
    expect(getTemplate("no_such_template")).toBeUndefined();
  });

  it("reports all six templates as pending copy (issue #46 owns the final wording)", () => {
    // The copy sheet has no WhatsApp template wording, so every body is a
    // TODO(copy) sentinel. When Claude writes the final copy, update this
    // test alongside the locale files.
    for (const id of TEMPLATE_IDS) {
      expect(isCopyPending(id, "es")).toBe(true);
      expect(isCopyPending(id, "en")).toBe(true);
    }
    expect(templatesPendingCopy()).toEqual([...TEMPLATE_IDS]);
  });

  it("keeps template ids unique", () => {
    expect(new Set(TEMPLATE_IDS).size).toBe(TEMPLATE_IDS.length);
  });
});
