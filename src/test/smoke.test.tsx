import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("smoke test", () => {
	it("renders text and matches with jest-dom", () => {
		render(<h1>Hello, world</h1>);
		expect(screen.getByText("Hello, world")).toBeInTheDocument();
	});
});
