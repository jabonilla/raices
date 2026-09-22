import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Index from "../app/index";

describe("placeholder screen", () => {
  it('renders "Raíces"', () => {
    render(<Index />);
    expect(screen.getByText("Raíces")).toBeTruthy();
  });
});
