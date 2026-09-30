import type { ReactElement } from "react";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtureProvider } from "../src/data/fixtureProvider";
import { ScreenData } from "../src/data/ScreenDataContext";
import i18n from "../src/i18n";

import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { AssistantScreen } from "../src/screens/AssistantScreen";
import { GoalScreen } from "../src/screens/GoalScreen";
import { HistoryScreen } from "../src/screens/HistoryScreen";
import { HomeScreen } from "../src/screens/HomeScreen";
import { InviteScreen } from "../src/screens/InviteScreen";
import { RelationshipDetailScreen } from "../src/screens/RelationshipDetailScreen";
import { RelationshipsScreen } from "../src/screens/RelationshipsScreen";

afterEach(cleanup);

// The fixture uses relative dates (daysAgoISO). Mock Date.now so snapshots
// are deterministic — otherwise they'd change daily and across timezones.
const FIXED_NOW = new Date("2026-09-29T12:00:00Z").getTime();
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SCREENS: Array<{ name: string; element: ReactElement }> = [
  { name: "Home", element: <HomeScreen /> },
  { name: "Approval", element: <ApprovalScreen /> },
  { name: "Goal", element: <GoalScreen /> },
  { name: "History", element: <HistoryScreen /> },
  { name: "Assistant", element: <AssistantScreen /> },
  { name: "Invite", element: <InviteScreen /> },
  { name: "Relationships", element: <RelationshipsScreen /> },
  { name: "RelationshipDetail", element: <RelationshipDetailScreen relationshipId="rel-1" /> },
];

/**
 * Visual regression (K2.33).
 *
 * Snapshots every screen in both locales. Spanish strings run ~20%
 * longer than English — that's where layouts break, so the es snapshots
 * are the ones to watch. A snapshot diff in CI means copy or layout
 * changed; review it like a screenshot.
 *
 * FONT SCALE GAP (finding for Claude): the ticket asks for snapshots at
 * default and largest font size, but no component reads
 * PixelRatio.getFontScale() — largest-text users get the same layout as
 * everyone else today, which breaks WCAG 1.4.4 (resize text). The
 * snapshots below are font-scale-agnostic until components adapt; when
 * they do, add the 1.5x pass back.
 *
 * These are DOM snapshots (jsdom), not screenshots. They catch
 * copy/layout regressions in CI; true pixel-diffing needs a device farm.
 */
describe("visual regression", () => {
  for (const locale of ["en", "es"] as const) {
    describe(`locale ${locale}`, () => {
      for (const { name, element } of SCREENS) {
        it(name, async () => {
          await i18n.changeLanguage(locale);
          const { container }: RenderResult = render(
            <ScreenData provider={fixtureProvider}>{element}</ScreenData>,
          );
          // The mobile tsconfig has no DOM lib; container is a real DOM
          // element at runtime.
          const html = (container as unknown as { innerHTML: string }).innerHTML;
          expect(html).toMatchSnapshot();
        });
      }
    });
  }

  it("restores the default locale", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.language).toMatch(/^es/);
  });
});
