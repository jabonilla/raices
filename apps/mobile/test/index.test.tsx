import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Index from "../app/index";
import { SessionProvider } from "../src/data/SessionContext";

afterEach(cleanup);
afterEach(() => {
  delete process.env.EXPO_PUBLIC_DATA_PROVIDER;
});

const push = vi.fn();

vi.mock("expo-router", () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

describe("placeholder screen", () => {
  it('renders "Raíces"', () => {
    render(
      <SessionProvider>
        <Index />
      </SessionProvider>,
    );
    expect(screen.getByText("Raíces")).toBeTruthy();
  });

  it("navigates to home on Comenzar (K2.48: app entry)", () => {
    render(
      <SessionProvider>
        <Index />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("navigates to sign-in on Comenzar for the real build without a session (S5)", () => {
    process.env.EXPO_PUBLIC_DATA_PROVIDER = "real";
    render(
      <SessionProvider>
        <Index />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));
    expect(push).toHaveBeenCalledWith("/auth");
  });
});
