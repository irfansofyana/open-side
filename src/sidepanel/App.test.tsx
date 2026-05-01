import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

import { App } from "./App";

test("renders the connect server placeholder", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Connect server" })).toBeInTheDocument();
});
