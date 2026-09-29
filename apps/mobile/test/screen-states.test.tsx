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

const emptyTitles: Record<keyof typeof screens, string> = {
  home: "Todavía no has enviado nada.",
  history: "Cuando envíes tu primer pago, lo vas a ver aquí.",
  goal: "¿Para qué estás ahorrando?",
  approval: "Todo al día.",
  assistant: "Todavía no hay conversación.",
};

const errorTitles: Record<keyof typeof screens, string> = {
  home: "No pudimos cargar tu inicio.",
  history: "No pudimos cargar tu historial.",
  goal: "No pudimos cargar tu meta.",
  approval: "No pudimos cargar este pedido.",
  assistant: "No pudimos cargar la conversación.",
};

describe.each(Object.keys(screens) as (keyof typeof screens)[])("%s screen states", (name) => {
  const Screen = screens[name];

  it("renders the loading state", () => {
    renderWithData(<Screen screenState="loading" />);
    expect(screen.getByText("Cargando…")).toBeTruthy();
    expect(screen.getByLabelText("Cargando…")).toBeTruthy();
  });

  it("renders the offline state explicitly", () => {
    renderWithData(<Screen screenState="offline" />);
    // Offline must be explicit: never stale data presented as live.
    expect(screen.getByText("Sin conexión")).toBeTruthy();
    expect(
      screen.getByText(
        "Sin señal por un momento. Todo sigue guardado — intenta cuando tengas conexión.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the empty state", () => {
    renderWithData(<Screen screenState="empty" />);
    expect(screen.getByText(emptyTitles[name])).toBeTruthy();
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
    expect(screen.getByText(errorTitles[name])).toBeTruthy();
    // What happened + what to do next, in the user's language (DS §13.1).
    expect(
      screen.getByText(
        "Intenta de nuevo en unos minutos. Si sigue sin funcionar, pregúntale al asistente.",
      ),
    ).toBeTruthy();
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
      expect(screen.getByText("You're offline")).toBeTruthy();
    } finally {
      await i18n.changeLanguage("es-US");
    }
  });
});
