import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { AssistantScreen } from "../src/screens/AssistantScreen";
import { GoalScreen } from "../src/screens/GoalScreen";
import { HistoryScreen } from "../src/screens/HistoryScreen";
import { HomeScreen } from "../src/screens/HomeScreen";

afterEach(cleanup);

describe("HomeScreen", () => {
  it("renders greeting, balances, goal card, and recent activity", () => {
    render(<HomeScreen />);
    expect(screen.getByText("Buenos días, Carlos")).toBeTruthy();
    expect(screen.getByText("Aquí (EE.UU.)")).toBeTruthy();
    expect(screen.getByText("Allá (Guatemala)")).toBeTruthy();
    expect(screen.getByText("$1,240.00")).toBeTruthy();
    expect(screen.getByText("2 pedidos esperando tu respuesta")).toBeTruthy();
    expect(screen.getByText("Casa en Chimaltenango")).toBeTruthy();
    expect(screen.getByText("Actividad reciente")).toBeTruthy();
  });
});

describe("ApprovalScreen", () => {
  it("renders recipient, amount, plan match, and both actions", () => {
    render(<ApprovalScreen />);
    expect(screen.getByText("María")).toBeTruthy();
    expect(screen.getByText("Tu esposa")).toBeTruthy();
    expect(screen.getByText("$95.00")).toBeTruthy();
    expect(screen.getByText("✓ Esto está dentro de tu plan")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aprobar $95.00" })).toBeTruthy();
    // "Ahorita no" is a text link, never a button.
    expect(screen.getByRole("link", { name: "Ahorita no" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ahorita no" })).toBeNull();
  });
});

describe("GoalScreen", () => {
  it("renders the goal, progress, and all four stages", () => {
    render(<GoalScreen />);
    expect(screen.getByText("Casa en Chimaltenango")).toBeTruthy();
    expect(screen.getByText("Empezaste en marzo de 2025")).toBeTruthy();
    expect(screen.getByText("$8,400")).toBeTruthy();
    expect(screen.getByText("Faltan $6,600 para los $15,000")).toBeTruthy();
    expect(screen.getByText(/Terreno comprado/)).toBeTruthy();
    expect(screen.getByText(/Cimientos y bloques/)).toBeTruthy();
    expect(screen.getByText(/Paredes y techo/)).toBeTruthy();
    expect(screen.getByText(/Acabados/)).toBeTruthy();
  });
});

describe("HistoryScreen", () => {
  it("renders title, filters, groups, and transactions", () => {
    render(<HistoryScreen />);
    expect(screen.getByText("Historial")).toBeTruthy();
    expect(screen.getByText("Todos")).toBeTruthy();
    expect(screen.getByText("Aprobados")).toBeTruthy();
    expect(screen.getAllByText("Ayer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Urgente")).toBeTruthy();
    expect(screen.getByText("En pausa")).toBeTruthy();
  });

  it("switches the active filter pill", () => {
    render(<HistoryScreen />);
    const pill = screen.getByRole("button", { name: "Pendientes" });
    fireEvent.click(pill);
    expect(screen.getByRole("button", { name: "Pendientes" })).toBeTruthy();
  });
});

describe("AssistantScreen", () => {
  it("renders the scope line, greeting, and the refusal", () => {
    render(<AssistantScreen />);
    expect(screen.getByText("Asistente")).toBeTruthy();
    expect(
      screen.getByText("Te explico lo que pasa con tu dinero. Moverlo siempre lo decides tú."),
    ).toBeTruthy();
    expect(screen.getByText("Buenos días, Carlos. ¿Qué quieres saber?")).toBeTruthy();
    // The refusal is a first-class string.
    expect(
      screen.getByText(
        "Ese dato no lo tengo aquí. El tipo de cambio te lo muestra la pantalla de envío, antes de que confirmes nada.",
      ),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Escribe tu pregunta…")).toBeTruthy();
  });
});
