import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "../src/i18n";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { CountBadge, StatusDot } from "../src/components/indicators";
import { StatusBadge } from "../src/components/StatusBadge";
import { TextInput } from "../src/components/TextInput";
import { TransactionCard } from "../src/components/TransactionCard";
import { tokens } from "../src/theme/tokens";

describe("Button", () => {
  it("renders the label and fires onPress", () => {
    const onPress = vi.fn();
    render(<Button variant="primary" label="Aprobar" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("renders all five variants", () => {
    for (const variant of ["primary", "secondary", "ghost", "destructive", "emergency"] as const) {
      const { unmount } = render(<Button variant={variant} label="X" onPress={() => {}} />);
      expect(screen.getByRole("button", { name: "X" })).toBeTruthy();
      unmount();
    }
  });

  it("disables interaction when disabled or loading", () => {
    const onPress = vi.fn();
    const { rerender } = render(<Button variant="primary" label="A" onPress={onPress} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onPress).not.toHaveBeenCalled();

    rerender(<Button variant="primary" label="A" onPress={onPress} loading />);
    expect(screen.getByLabelText("Cargando")).toBeTruthy();
  });

  it("exposes an accessible label", () => {
    render(<Button variant="ghost" label="X" onPress={() => {}} accessibilityLabel="Cancelar" />);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });
});

describe("TextInput", () => {
  it("renders label and calls onChangeText", () => {
    const onChangeText = vi.fn();
    render(<TextInput label="Nombre" value="" onChangeText={onChangeText} />);
    const input = screen.getByLabelText("Nombre");
    fireEvent.change(input, { target: { value: "María" } });
    expect(onChangeText).toHaveBeenCalledWith("María");
  });

  it("shows the error in the flagged tone", () => {
    render(<TextInput label="Monto" value="" onChangeText={() => {}} error="Requerido" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Requerido")).toBeTruthy();
  });
});

describe("Card", () => {
  it("renders children", () => {
    render(
      <Card>
        <span>hola</span>
      </Card>,
    );
    expect(screen.getByText("hola")).toBeTruthy();
  });
});

describe("StatusBadge", () => {
  it.each([
    ["approved", "✓ Enviado"],
    ["pending", "Esperando"],
    ["flagged", "Para revisar"],
    ["emergency", "Urgente"],
    ["declined", "En pausa"],
    ["failed", "No llegó"],
  ] as const)("renders %s as %s", (status, copy) => {
    const { unmount } = render(<StatusBadge status={status} />);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByLabelText(`Estado: ${copy}`)).toBeTruthy();
    unmount();
  });

  it("renders the English fallback when the locale is English", async () => {
    await i18n.changeLanguage("en-US");
    try {
      const { unmount } = render(<StatusBadge status="failed" />);
      expect(screen.getByText("Didn't arrive")).toBeTruthy();
      expect(screen.getByLabelText("Status: Didn't arrive")).toBeTruthy();
      unmount();
    } finally {
      await i18n.changeLanguage("es-US");
    }
  });

  it("never hardcodes user-facing copy: every status resolves through locale keys", () => {
    // If a status label ever falls back to a hardcoded string, the English
    // test above fails — this pins the mechanism, not just the Spanish copy.
    for (const status of [
      "approved",
      "pending",
      "flagged",
      "emergency",
      "declined",
      "failed",
    ] as const) {
      expect(i18n.exists(`statusBadge.${status}`, { lng: "es-US" })).toBe(true);
      expect(i18n.exists(`statusBadge.${status}`, { lng: "en-US" })).toBe(true);
    }
    expect(i18n.exists("statusBadge.statusLabel", { lng: "es-US" })).toBe(true);
    expect(i18n.exists("statusBadge.statusLabel", { lng: "en-US" })).toBe(true);
  });
});

describe("TransactionCard", () => {
  const props = {
    category: "housing" as const,
    categoryLabel: "Vivienda",
    status: "pending" as const,
    amountText: "$1,200.00",
    purpose: "Renta de marzo",
    timestamp: "Ayer",
  };

  it("renders who, amount, purpose, and status", () => {
    render(<TransactionCard {...props} />);
    expect(screen.getByText("Vivienda")).toBeTruthy();
    expect(screen.getByText("$1,200.00")).toBeTruthy();
    expect(screen.getByText("Renta de marzo")).toBeTruthy();
    expect(screen.getByText("Esperando")).toBeTruthy();
    expect(screen.getByText("Ayer")).toBeTruthy();
  });

  it("shows the stage on planned-investment tier", () => {
    render(<TransactionCard {...props} tier="planned-investment" stageText="Etapa 2 de 4" />);
    expect(screen.getByText("Etapa 2 de 4")).toBeTruthy();
  });

  it("never formats money: amount is rendered verbatim", () => {
    render(<TransactionCard {...props} amountText="Q 9,999.99" />);
    expect(screen.getByText("Q 9,999.99")).toBeTruthy();
  });
});

describe("indicators", () => {
  it("StatusDot renders ok and emergency tones", () => {
    const { unmount } = render(<StatusDot tone="ok" />);
    expect(screen.getByLabelText("Conectado")).toBeTruthy();
    unmount();
    render(<StatusDot tone="emergency" pulse />);
    expect(screen.getByLabelText("Urgente")).toBeTruthy();
  });

  it("CountBadge renders the count", () => {
    render(<CountBadge count={3} />);
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("token values", () => {
  it("matches the design system spec", () => {
    expect(tokens.color.tierra).toBe("#2D4A3E");
    expect(tokens.color.oro).toBe("#C4922A");
    expect(tokens.type.amount.size).toBe(28);
    expect(tokens.spacing.s4).toBe(16);
    expect(tokens.radius.md).toBe(10);
    expect(tokens.touchTarget.min).toBe(44);
  });
});
