import type { ReactElement } from "react";
import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fixtureProvider } from "../src/data/fixtureProvider";
import { ScreenData } from "../src/data/ScreenDataContext";

import i18n from "../src/i18n";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { AssistantScreen } from "../src/screens/AssistantScreen";
import { GoalScreen } from "../src/screens/GoalScreen";
import { HistoryScreen } from "../src/screens/HistoryScreen";
import { HomeScreen } from "../src/screens/HomeScreen";

afterEach(cleanup);

/** Screens read data through the ScreenDataProvider interface (K2.24). */
function renderWithData(element: ReactElement): RenderResult {
  return render(<ScreenData provider={fixtureProvider}>{element}</ScreenData>);
}

const screens = {
  home: HomeScreen,
  history: HistoryScreen,
  goal: GoalScreen,
  approval: ApprovalScreen,
  assistant: AssistantScreen,
} as const;

/** Screens whose empty state carries the single primary CTA (DS §13.4). */
const screensWithEmptyAction: ReadonlySet<keyof typeof screens> = new Set([
  "home",
  "history",
  "goal",
]);

/**
 * i18n keys for empty-state titles, by screen.
 * The test looks these up via i18n.t() — it verifies the screen renders
 * the text for the correct key, not a hardcoded literal. Copy changes
 * move both sides at once; only a missing or wrongly-keyed string fails.
 */
const emptyTitleKeys: Record<keyof typeof screens, string> = {
  home: "home.states.emptyTitle",
  history: "history.states.emptyTitle",
  goal: "goal.states.emptyTitle",
  approval: "approval.states.emptyTitle",
  assistant: "assistant.states.emptyTitle",
};

/** i18n keys for error-state titles, by screen. See emptyTitleKeys. */
const errorTitleKeys: Record<keyof typeof screens, string> = {
  home: "home.states.errorTitle",
  history: "history.states.errorTitle",
  goal: "goal.states.errorTitle",
  approval: "approval.states.errorTitle",
  assistant: "assistant.states.errorTitle",
};

describe.each(Object.keys(screens) as (keyof typeof screens)[])("%s screen states", (name) => {
  const Screen = screens[name];

  it("renders the loading state", () => {
    renderWithData(<Screen screenState="loading" />);
    const loadingText = i18n.t("states.loading");
    expect(screen.getByText(loadingText)).toBeTruthy();
    expect(screen.getByLabelText(loadingText)).toBeTruthy();
  });

  it("renders the offline state explicitly", () => {
    renderWithData(<Screen screenState="offline" />);
    // Offline must be explicit: never stale data presented as live.
    expect(screen.getByText(i18n.t("states.offlineTitle"))).toBeTruthy();
    expect(screen.getByText(i18n.t("states.offlineBody"))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the empty state", () => {
    renderWithData(<Screen screenState="empty" />);
    expect(screen.getByText(i18n.t(emptyTitleKeys[name]))).toBeTruthy();
    if (screensWithEmptyAction.has(name)) {
      // DS §13.4: one primary action, never a secondary.
      expect(screen.getByRole("button")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    } else {
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    }
  });

  it("renders the error state without any raw error", () => {
    renderWithData(<Screen screenState="error" />);
    expect(screen.getByText(i18n.t(errorTitleKeys[name]))).toBeTruthy();
    // What happened + what to do next, in the user's language (DS §13.1).
    expect(screen.getByText(i18n.t("states.errorBody"))).toBeTruthy();
    // DS §13.3 pattern: primary action + "Ask AI".
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Preguntar al asistente" })).toBeTruthy();
    // Never a raw error: no codes, no traces, no technical tokens.
    for (const token of ["Error:", "error code", "stack trace", "undefined", "TypeError", "500"]) {
      expect(screen.queryByText(new RegExp(token, "i"))).toBeNull();
    }
  });

  it("defaults to the happy-path content", () => {
    renderWithData(<Screen />);
    expect(screen.queryByText("Sin conexión")).toBeNull();
    expect(screen.queryByText("Cargando…")).toBeNull();
  });
});

describe("screen states in English", () => {
  it("resolves the shared offline copy through i18n", async () => {
    await i18n.changeLanguage("en-US");
    try {
      renderWithData(<HistoryScreen screenState="offline" />);
      expect(screen.getByText(i18n.t("states.offlineTitle"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("es-US");
    }
  });
});
