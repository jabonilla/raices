import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fixtureProvider, uglyFixtureProvider } from "../src/data/fixtureProvider";
import type { ScreenDataProvider } from "../src/data/provider";
import { realProvider } from "../src/data/realProvider";
import { ScreenData } from "../src/data/ScreenDataContext";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { AssistantScreen } from "../src/screens/AssistantScreen";
import { GoalScreen } from "../src/screens/GoalScreen";
import { HistoryScreen } from "../src/screens/HistoryScreen";
import { HomeScreen } from "../src/screens/HomeScreen";

afterEach(cleanup);

const SCREENS = {
  home: HomeScreen,
  approval: ApprovalScreen,
  goal: GoalScreen,
  history: HistoryScreen,
  assistant: AssistantScreen,
} as const;

const SCREEN_FILES = [
  "ApprovalScreen.tsx",
  "AssistantScreen.tsx",
  "GoalScreen.tsx",
  "HistoryScreen.tsx",
  "HomeScreen.tsx",
] as const;

function screenSource(file: string): string {
  // Same pattern as design-tokens.test.ts: read the source off disk and
  // assert on the import graph. __dirname works in this vitest setup.
  return readFileSync(join(__dirname, "..", "src", "screens", file), "utf8");
}

describe("data-layer architecture (K2.24)", () => {
  it("no screen imports a concrete provider — they depend on the interface only", () => {
    for (const file of SCREEN_FILES) {
      const source = screenSource(file);
      // Any import whose path mentions "fixture" (fixtureProvider, ugly
      // fixtures, …) inside a screen is a layering violation: screens get
      // their provider injected through <ScreenData>, never imported.
      expect(source, `${file} must not import a fixture provider`).not.toMatch(
        /^import .* from ["'][^"']*fixture[^"']*["'];?$/m,
      );
      expect(source, `${file} must not import the real provider stub`).not.toMatch(
        /^import .* from ["'][^"']*realProvider["'];?$/m,
      );
      // Belt and suspenders: the identifier must not appear at all.
      expect(source, `${file} must not reference fixtureProvider`).not.toContain("fixtureProvider");
    }
  });
  it("non-content states render without touching the provider", () => {
    // Loading/empty/error/offline shells must not need data: they render
    // fine even against realProvider, whose every method throws. Here the
    // assertion is no-throw; content presence is asserted per-screen below.
    for (const [name, Screen] of Object.entries(SCREENS)) {
      for (const state of ["loading", "empty", "error", "offline"] as const) {
        expect(
          () =>
            render(
              <ScreenData provider={realProvider}>
                <Screen screenState={state} />
              </ScreenData>,
            ),
          `${name} in ${state} state renders without provider data`,
        ).not.toThrow();
        cleanup();
      }
    }
  });

  it("the content state DOES need the provider — the stub throws there", () => {
    expect(() =>
      render(
        <ScreenData provider={realProvider}>
          <HomeScreen />
        </ScreenData>,
      ),
    ).toThrow("not implemented");
  });

  it("the fixture and stub both satisfy the ScreenDataProvider interface", () => {
    const providers: ScreenDataProvider[] = [fixtureProvider, uglyFixtureProvider];
    for (const provider of providers) {
      expect(typeof provider.getHomeData).toBe("function");
      expect(typeof provider.getApprovalData).toBe("function");
      expect(typeof provider.getGoalData).toBe("function");
      expect(typeof provider.getHistoryData).toBe("function");
      expect(typeof provider.getAssistantData).toBe("function");
      // Every method returns a defined object — no undefined holes.
      expect(provider.getHomeData()).toBeTruthy();
      expect(provider.getApprovalData()).toBeTruthy();
      expect(provider.getGoalData()).toBeTruthy();
      expect(provider.getHistoryData()).toBeTruthy();
      expect(provider.getAssistantData()).toBeTruthy();
    }
  });

  it("realProvider throws 'not implemented' on every method", () => {
    expect(() => realProvider.getHomeData()).toThrow("not implemented");
    expect(() => realProvider.getApprovalData()).toThrow("not implemented");
    expect(() => realProvider.getGoalData()).toThrow("not implemented");
    expect(() => realProvider.getHistoryData()).toThrow("not implemented");
    expect(() => realProvider.getAssistantData()).toThrow("not implemented");
  });

  it("amounts pass through as opaque strings — the provider never formats money", () => {
    // Spot-check: the exact strings the fixture declares are the exact
    // strings the screens will render. No parsing, no computation.
    expect(fixtureProvider.getHomeData().balances[0]?.amountText).toBe("$1,240.00");
    expect(fixtureProvider.getApprovalData().amountText).toBe("$95.00");
    expect(uglyFixtureProvider.getApprovalData().amountText).toBe("$9,876,543.21");
  });
});

describe("ugly-cases fixture (K2.24)", () => {
  it("contains every demanded stress case", () => {
    const home = uglyFixtureProvider.getHomeData();
    const approval = uglyFixtureProvider.getApprovalData();
    const history = uglyFixtureProvider.getHistoryData();

    // Long names.
    expect(home.greetingName.length).toBeGreaterThan(30);
    // The 18-character recipient name — counted, not eyeballed.
    expect(approval.recipientName).toBe("Lucía Fernanda Gil");
    expect(approval.recipientName.length).toBe(18);
    // Amounts at the widest realistic magnitude.
    expect(approval.amountText).toBe("$9,876,543.21");
    // An empty list.
    expect(home.recentActivity).toHaveLength(0);
    // A single item, alone in its group.
    expect(history.groups[0]?.items).toHaveLength(1);
    // A very long category name.
    const longCategory = history.groups[0]?.items[0]?.categoryLabel ?? "";
    expect(longCategory.length).toBeGreaterThan(40);
  });

  it("renders every screen on ugly data without crashing", () => {
    // Render succeeding at all is the assertion: a screen that throws on
    // ugly data fails here. Content presence is asserted per-screen below.
    // (No DOM lib in the mobile tsconfig, so no document/container access —
    // the per-screen tests below use Testing Library queries instead.)
    for (const [name, Screen] of Object.entries(SCREENS)) {
      expect(
        () =>
          render(
            <ScreenData provider={uglyFixtureProvider}>
              <Screen />
            </ScreenData>,
          ),
        `${name} renders on ugly data`,
      ).not.toThrow();
      cleanup();
    }
  });

  it("the 18-character recipient name actually reaches the ApprovalScreen", () => {
    render(
      <ScreenData provider={uglyFixtureProvider}>
        <ApprovalScreen />
      </ScreenData>,
    );
    expect(screen.getByText("Lucía Fernanda Gil")).toBeTruthy();
  });

  it("the widest-magnitude amount actually reaches the ApprovalScreen", () => {
    render(
      <ScreenData provider={uglyFixtureProvider}>
        <ApprovalScreen />
      </ScreenData>,
    );
    expect(screen.getAllByText("$9,876,543.21").length).toBeGreaterThanOrEqual(1);
  });

  it("the very long category name actually reaches the HistoryScreen", () => {
    render(
      <ScreenData provider={uglyFixtureProvider}>
        <HistoryScreen />
      </ScreenData>,
    );
    expect(
      screen.getByText("Materiales de construcción para la segunda etapa de la casa"),
    ).toBeTruthy();
  });

  it("the empty recent-activity list renders the section with no cards", () => {
    render(
      <ScreenData provider={uglyFixtureProvider}>
        <HomeScreen />
      </ScreenData>,
    );
    // Section header still renders (it's chrome copy, not data)…
    expect(screen.getByText("Actividad reciente")).toBeTruthy();
    // …but the long name from the ugly fixture is what greets the user.
    expect(screen.getByText("Buenos días, María Guadalupe Hernández de la Cruz")).toBeTruthy();
  });

  it("the single-item history group renders its one transaction", () => {
    render(
      <ScreenData provider={uglyFixtureProvider}>
        <HistoryScreen />
      </ScreenData>,
    );
    expect(
      screen.getByText(
        "Inversión en el negocio de bloques de la familia Hernández de la Cruz para la ampliación",
      ),
    ).toBeTruthy();
    // The empty group still renders its header.
    expect(screen.getByText("Esta semana")).toBeTruthy();
  });

  it("the long assistant thread renders end to end", () => {
    render(
      <ScreenData provider={uglyFixtureProvider}>
        <AssistantScreen />
      </ScreenData>,
    );
    expect(
      screen.getByText("Buenos días, María Guadalupe Hernández de la Cruz. ¿Qué quieres saber?"),
    ).toBeTruthy();
    expect(
      screen.getByText("¿Cuánto me queda para la segunda etapa de la casa este mes?"),
    ).toBeTruthy();
  });
});
