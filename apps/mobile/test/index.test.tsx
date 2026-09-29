import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Index from "../app/index";

afterEach(cleanup);

const push = vi.fn();

vi.mock("expo-router", () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

describe("placeholder screen", () => {
  it('renders "Raíces"', () => {
    render(<Index />);
    expect(screen.getByText("Raíces")).toBeTruthy();
  });

  it("navigates to the relationship list on Comenzar", () => {
    render(<Index />);
    fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));
    expect(push).toHaveBeenCalledWith("/relationships");
  });
});
