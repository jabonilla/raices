import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, type ApiClient } from "../src/data/apiClient";
import { AuthScreen } from "../src/screens/AuthScreen";

afterEach(cleanup);

const TOKEN = "b".repeat(43);
const CHALLENGE = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function stubClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    revokeSession: vi.fn(),
    listRelationships: vi.fn(),
    getRelationship: vi.fn(),
    inviteRelationship: vi.fn(),
    actOnRelationship: vi.fn(),
    listRequests: vi.fn(),
    getRequest: vi.fn(),
    submitRequest: vi.fn(),
    resolveRequest: vi.fn(),
    ...overrides,
  };
}

async function goToCodeStep(client: ApiClient): Promise<void> {
  render(<AuthScreen client={client} onAuthenticated={() => {}} />);
  fireEvent.change(screen.getByLabelText("Tu número de teléfono"), {
    target: { value: "5551234567" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Mandar código" }));
  await screen.findByText("Te mandamos un código por WhatsApp. Escríbelo aquí.");
}

describe("AuthScreen (S5)", () => {
  it("renders the phone step first", () => {
    const client = stubClient({});
    render(<AuthScreen client={client} onAuthenticated={() => {}} />);
    expect(screen.getByText("Iniciar sesión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mandar código" })).toBeTruthy();
  });

  it("requires a phone number before sending a code", () => {
    const requestOtp = vi.fn();
    const client = stubClient({ requestOtp });
    render(<AuthScreen client={client} onAuthenticated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Mandar código" }));
    expect(screen.getByText("Escribe el número de teléfono.")).toBeTruthy();
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it("requests a code for a valid number and advances to the code step", async () => {
    const requestOtp = vi.fn(() => Promise.resolve({ challengeId: CHALLENGE }));
    const client = stubClient({ requestOtp });
    await goToCodeStep(client);
    expect(requestOtp).toHaveBeenCalledWith("+15551234567");
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeTruthy();
  });

  it("verifies the code and reports the session", async () => {
    const session = { token: TOKEN, userId: USER_ID, expiresAt: "2026-10-27T00:00:00.000Z" };
    const verifyOtp = vi.fn(() => Promise.resolve(session));
    const onAuthenticated = vi.fn();
    const client = stubClient({
      requestOtp: vi.fn(() => Promise.resolve({ challengeId: CHALLENGE })),
      verifyOtp,
    });
    render(<AuthScreen client={client} onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText("Tu número de teléfono"), {
      target: { value: "5551234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mandar código" }));
    await screen.findByText("Te mandamos un código por WhatsApp. Escríbelo aquí.");
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await vi.waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith(session);
    });
    expect(verifyOtp).toHaveBeenCalledWith(CHALLENGE, "123456");
  });

  it("says the code does not match on a rejected verify, and stays on the code step", async () => {
    const client = stubClient({
      requestOtp: vi.fn(() => Promise.resolve({ challengeId: CHALLENGE })),
      verifyOtp: vi.fn(() => Promise.reject(new ApiClientError("unauthorized", 401))),
    });
    await goToCodeStep(client);
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByText("Ese código no coincide. Revisa y prueba otra vez.");
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeTruthy();
  });

  it("shows the offline body when the code request has no connection", async () => {
    const client = stubClient({
      requestOtp: vi.fn(() => Promise.reject(new ApiClientError("offline"))),
    });
    render(<AuthScreen client={client} onAuthenticated={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tu número de teléfono"), {
      target: { value: "5551234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mandar código" }));
    await screen.findByText(
      "Sin señal por un momento. Todo sigue guardado — intenta cuando tengas conexión.",
    );
  });

  it("lets the sender switch numbers from the code step", async () => {
    const client = stubClient({
      requestOtp: vi.fn(() => Promise.resolve({ challengeId: CHALLENGE })),
    });
    await goToCodeStep(client);
    fireEvent.click(screen.getByRole("button", { name: "Usar otro número" }));
    expect(screen.getByRole("button", { name: "Mandar código" })).toBeTruthy();
  });
});
