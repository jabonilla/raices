import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../src/i18n";
import { Button } from "../src/components/Button";
import { CountBadge, StatusDot } from "../src/components/indicators";
import { TransactionCard } from "../src/components/TransactionCard";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { AssistantScreen } from "../src/screens/AssistantScreen";
import { GoalScreen } from "../src/screens/GoalScreen";
import { HistoryScreen } from "../src/screens/HistoryScreen";
import { HomeScreen } from "../src/screens/HomeScreen";
import type { ScreenContentState } from "../src/components/ScreenState";

const SCREENS = {
  home: HomeScreen,
  approval: ApprovalScreen,
  goal: GoalScreen,
  history: HistoryScreen,
  assistant: AssistantScreen,
} as const;

const STATES: ScreenContentState[] = ["content", "loading", "empty", "error", "offline"];

/**
 * Minimal DOM surface the audit needs. The mobile tsconfig has no DOM lib,
 * so this structural cast keeps the test honest about what it touches.
 */
interface AuditElement {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly outerHTML: string;
  closest(selectors: string): unknown;
}

function asAudit(element: object): AuditElement {
  return element as unknown as AuditElement;
}

/**
 * K2.23 accessibility audit, runtime counterpart to the K2.7 baseline:
 * - every interactive element in every screen and every screen state has an
 *   accessible name (the K2.7 lint rule enforces the static side; this
 *   enforces the rendered side, where labels resolve through i18n keys);
 * - assistive-tech labels are localized, never hardcoded Spanish;
 * - decorative glyphs are hidden from assistive tech.
 *
 * What this does NOT cover (see the PR body): on-device TalkBack/VoiceOver
 * behavior and largest-font rendering were reasoned about, not exercised.
 */
describe("K2.23 audit: interactive elements are labeled in every screen state", () => {
  for (const [name, Screen] of Object.entries(SCREENS)) {
    for (const state of STATES) {
      it(`${name} / ${state}: every button and link has a non-empty accessible name`, () => {
        const { unmount } = render(<Screen screenState={state} />);
        try {
          for (const role of ["button", "link"] as const) {
            for (const el of screen.queryAllByRole(role)) {
              const dom = asAudit(el);
              const name = dom.getAttribute("aria-label") ?? dom.textContent ?? "";
              expect(
                name.trim().length,
                `${name}/${state}: <${role}> without accessible name: ${dom.outerHTML.slice(0, 120)}`,
              ).toBeGreaterThan(0);
            }
          }
        } finally {
          unmount();
        }
      });
    }
  }
});

describe("K2.23 audit: assistive-tech labels are localized", () => {
  it("Button loading spinner announces through the locale, not hardcoded Spanish", async () => {
    await i18n.changeLanguage("es-US");
    try {
      const { unmount } = render(<Button variant="primary" label="X" onPress={() => {}} loading />);
      expect(screen.getByLabelText("Cargando…")).toBeTruthy();
      unmount();
    } finally {
      await i18n.changeLanguage("es-US");
    }

    await i18n.changeLanguage("en-US");
    try {
      const { unmount } = render(<Button variant="primary" label="X" onPress={() => {}} loading />);
      expect(screen.getByLabelText("Loading…")).toBeTruthy();
      // The old hardcoded Spanish string must be gone in every locale.
      expect(screen.queryByLabelText("Cargando")).toBeNull();
      unmount();
    } finally {
      await i18n.changeLanguage("es-US");
    }
  });

  it("StatusDot and CountBadge labels resolve through locale keys", async () => {
    const { unmount: u1 } = render(<StatusDot tone="ok" />);
    expect(screen.getByLabelText("Conectado")).toBeTruthy();
    u1();
    const { unmount: u2 } = render(<CountBadge count={3} />);
    expect(screen.getByLabelText("3 pendientes")).toBeTruthy();
    u2();

    await i18n.changeLanguage("en-US");
    try {
      const { unmount: u3 } = render(<StatusDot tone="emergency" pulse />);
      expect(screen.getByLabelText("Urgent")).toBeTruthy();
      u3();
      const { unmount: u4 } = render(<CountBadge count={12} />);
      expect(screen.getByLabelText("12 pending")).toBeTruthy();
      u4();
    } finally {
      await i18n.changeLanguage("es-US");
    }
  });
});

describe("K2.23 audit: decorative glyphs are hidden from assistive tech", () => {
  it("TransactionCard category icon is aria-hidden (the label text carries the meaning)", () => {
    render(
      <TransactionCard
        category="housing"
        categoryLabel="Vivienda"
        status="approved"
        amountText="$1,200.00"
        purpose="Renta"
        timestamp="Ayer"
      />,
    );
    const icon = asAudit(screen.getByText("🏠"));
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
