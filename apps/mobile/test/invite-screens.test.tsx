import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScreenData } from "../src/data/ScreenDataContext";
import { fixtureProvider, uglyFixtureProvider } from "../src/data/fixtureProvider";
import { validatePhoneE164 } from "../src/components/PhoneInput";
import { InviteScreen } from "../src/screens/InviteScreen";
import { RelationshipDetailScreen } from "../src/screens/RelationshipDetailScreen";
import { RelationshipsScreen } from "../src/screens/RelationshipsScreen";
import { fullDaysRemaining, isInvitationExpired } from "../src/screens/relationshipExpiry";

afterEach(cleanup);

function renderWithFixture(ui: React.ReactElement) {
  return render(<ScreenData provider={fixtureProvider}>{ui}</ScreenData>);
}

describe("relationships fixture data (K2.27)", () => {
  it("covers every P2.2 status", () => {
    const statuses = fixtureProvider.getRelationshipsData().relationships.map((r) => r.status);
    for (const s of ["invited", "active", "paused", "terminated"] as const) {
      expect(statuses).toContain(s);
    }
  });

  it("derives expiry as invitedAt + 14 days", () => {
    for (const rel of fixtureProvider.getRelationshipsData().relationships) {
      const expected = new Date(rel.invitedAtISO).getTime() + 14 * 24 * 60 * 60 * 1000;
      expect(new Date(rel.expiresAtISO).getTime()).toBe(expected);
    }
  });

  it("has an invited relationship with time remaining and an expired one", () => {
    const rels = fixtureProvider.getRelationshipsData().relationships;
    const live = rels.find((r) => r.id === "rel-2");
    const expired = rels.find((r) => r.id === "rel-3");
    expect(live, "fixture rel-2").toBeDefined();
    expect(expired, "fixture rel-3").toBeDefined();
    if (live === undefined || expired === undefined) {
      throw new Error("fixture is missing rel-2 or rel-3");
    }
    expect(live.status).toBe("invited");
    expect(isInvitationExpired(live.expiresAtISO)).toBe(false);
    expect(fullDaysRemaining(live.expiresAtISO)).toBeGreaterThan(10);
    expect(expired.status).toBe("invited");
    expect(isInvitationExpired(expired.expiresAtISO)).toBe(true);
  });

  it("lets one person appear in several relationships", () => {
    const mamas = fixtureProvider
      .getRelationshipsData()
      .relationships.filter((r) => r.phoneE164 === "+50255501111");
    expect(mamas.map((r) => r.id).sort()).toEqual(["rel-1", "rel-6"]);
  });

  it("ugly fixtures stress long names and the sub-24h boundary", () => {
    const rels = uglyFixtureProvider.getRelationshipsData().relationships;
    expect(rels[0]?.displayName).toHaveLength(18);
    expect(isInvitationExpired(rels[1]?.expiresAtISO ?? "")).toBe(false);
    expect(fullDaysRemaining(rels[1]?.expiresAtISO ?? "")).toBe(0);
  });
});

describe("validatePhoneE164", () => {
  it.each([
    ["", "phone.errors.required"],
    ["+", "phone.errors.required"],
    ["55501234", "phone.errors.plus"],
    ["+502 abc", "phone.errors.digits"],
    ["+502 5550 1234", "phone.errors.digits"],
    ["+1", "phone.errors.tooShort"],
    ["+1234567890123456", "phone.errors.tooLong"],
  ])("rejects %s with %s", (input, key) => {
    expect(validatePhoneE164(input)).toBe(key);
  });

  it("accepts well-formed E.164", () => {
    expect(validatePhoneE164("+50255501111")).toBeNull();
    expect(validatePhoneE164("+15025550555")).toBeNull();
  });
});

describe("InviteScreen", () => {
  it("requires both fields and explains in plain Spanish", () => {
    renderWithFixture(<InviteScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    expect(screen.getByText("Escribe cómo le dices a esta persona. Es lo que verá en tu lista.")).toBeTruthy();
    expect(screen.getByText("Escribe el número de teléfono.")).toBeTruthy();
  });

  it("rejects a malformed phone in plain Spanish", () => {
    renderWithFixture(<InviteScreen />);
    fireEvent.change(screen.getByLabelText("¿Cómo le dices a esta persona?"), {
      target: { value: "Mamá" },
    });
    fireEvent.change(screen.getByLabelText("Número de teléfono"), { target: { value: "555" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    expect(screen.getByText("El número está muy corto. Revisa que esté completo.")).toBeTruthy();
  });

  it("confirms a valid invite without any API call", () => {
    renderWithFixture(<InviteScreen />);
    fireEvent.change(screen.getByLabelText("¿Cómo le dices a esta persona?"), {
      target: { value: "Mamá" },
    });
    fireEvent.change(screen.getByLabelText("Número de teléfono"), { target: { value: "55501111" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    // GT is the default country: the E.164 number is composed for the user.
    expect(screen.getByText("+50255501111")).toBeTruthy();
    expect(screen.getByText("Mamá")).toBeTruthy();
  });
});

describe("RelationshipsScreen", () => {
  it("renders every relationship, including one person twice", () => {
    renderWithFixture(<RelationshipsScreen />);
    expect(screen.getAllByText("Mamá")).toHaveLength(2);
    expect(screen.getByText("Tío Jorge")).toBeTruthy();
    expect(screen.getByText("Prima Ana")).toBeTruthy();
  });

  it("shows all four status badges", () => {
    renderWithFixture(<RelationshipsScreen />);
    // Two invited relationships (one live, one expired) → two badges.
    expect(screen.getAllByText("Invitada")).toHaveLength(2);
    expect(screen.getByText("Activa")).toBeTruthy();
    // Two paused relationships in the fixture.
    expect(screen.getAllByText("En pausa")).toHaveLength(2);
    expect(screen.getByText("Terminada")).toBeTruthy();
  });

  it("shows time remaining on a live invitation", () => {
    renderWithFixture(<RelationshipsScreen />);
    expect(screen.getByText(/Vence en \d+ días/)).toBeTruthy();
  });

  it("renders an expired invitation as expired with a resend action", () => {
    renderWithFixture(<RelationshipsScreen />);
    expect(screen.getByText("Vencida")).toBeTruthy();
    const resend = screen.getByRole("button", { name: "Reenviar invitación" });
    fireEvent.click(resend);
    expect(screen.getByText("Invitación reenviada.")).toBeTruthy();
  });

  it("notifies on row select", () => {
    const onSelect = vi.fn();
    renderWithFixture(<RelationshipsScreen onSelectRelationship={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Tío Jorge/ }));
    expect(onSelect).toHaveBeenCalledWith("rel-2");
  });
});

describe("RelationshipDetailScreen", () => {
  it("renders the relationship detail", () => {
    renderWithFixture(<RelationshipDetailScreen relationshipId="rel-1" />);
    expect(screen.getByText("Mamá")).toBeTruthy();
    expect(screen.getByText("+50255501111")).toBeTruthy();
    // Badge plus the status row both render the status label.
    expect(screen.getAllByText("Activa")).toHaveLength(2);
  });

  it("shows the countdown on an invited relationship", () => {
    renderWithFixture(<RelationshipDetailScreen relationshipId="rel-2" />);
    expect(screen.getByText(/Vence en \d+ días/)).toBeTruthy();
  });

  it("shows expired + resend on an expired invitation", () => {
    renderWithFixture(<RelationshipDetailScreen relationshipId="rel-3" />);
    expect(screen.getByText("Vencida")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reenviar invitación" }));
    expect(screen.getByText("Invitación reenviada.")).toBeTruthy();
  });

  it("renders an error state for an unknown id", () => {
    renderWithFixture(<RelationshipDetailScreen relationshipId="nope" />);
    expect(screen.getByText("Personas")).toBeTruthy();
  });
});

describe("displayName is PII: never logged (K2.27)", () => {
  const NAMES = ["Mamá", "Tío Jorge", "Prima Ana", "Hermano Luis", "Vecino Pedro"];

  it("no console call carries a display name during render and interaction", () => {
    const calls: string[] = [];
    const spy = (...args: unknown[]) => {
      calls.push(args.map(String).join(" "));
    };
    const methods = ["log", "warn", "error", "debug", "info"] as const;
    const con = console as unknown as Record<(typeof methods)[number], (...args: unknown[]) => void>;
    const originals = methods.map((m) => con[m]);
    methods.forEach((m) => {
      con[m] = spy;
    });
    try {
      renderWithFixture(
        <>
          <InviteScreen />
          <RelationshipsScreen />
          <RelationshipDetailScreen relationshipId="rel-3" />
        </>,
      );
      fireEvent.change(screen.getByLabelText("¿Cómo le dices a esta persona?"), {
        target: { value: "Mamá" },
      });
      fireEvent.change(screen.getByLabelText("Número de teléfono"), { target: { value: "55501111" } });
      fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
      fireEvent.click(screen.getAllByRole("button", { name: "Reenviar invitación" })[0]);
    } finally {
      methods.forEach((m, i) => {
        con[m] = originals[i] as (...args: unknown[]) => void;
      });
    }
    for (const name of NAMES) {
      expect(
        calls.some((c) => c.includes(name)),
        `console output must never contain the display name "${name}"`,
      ).toBe(false);
    }
  });

  it("no new screen or component source contains a console call", () => {
    for (const file of [
      "InviteScreen.tsx",
      "RelationshipsScreen.tsx",
      "RelationshipDetailScreen.tsx",
      "PhoneInput.tsx",
      "RelationshipStatusBadge.tsx",
      "relationshipExpiry.ts",
    ]) {
      const dir = file.endsWith(".ts") && !file.endsWith(".tsx") ? "screens" : file === "PhoneInput.tsx" || file === "RelationshipStatusBadge.tsx" ? "components" : "screens";
      const source = readFileSync(join(__dirname, "..", "src", dir, file), "utf8");
      expect(source, `${file} must not log (displayName is PII)`).not.toMatch(/console\./);
    }
  });
});
