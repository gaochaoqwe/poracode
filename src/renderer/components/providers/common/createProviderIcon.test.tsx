import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createProviderIcon } from "./createProviderIcon";

const PRIMARY_PATH = "M0 0 H10 V10 H0 Z";
const SECONDARY_PATH = "M2 2 H8 V8 H2 Z";

describe("createProviderIcon", () => {
  it("passes title, fill rule, secondary path, and default tone to StatusIcon", () => {
    const TestIcon = createProviderIcon({
      cssPrefix: "test-provider-icon",
      path: PRIMARY_PATH,
      secondaryPath: SECONDARY_PATH,
      fillRule: "evenodd",
      viewBox: "0 0 10 10",
      defaultTone: "working",
    });

    const { container } = render(<TestIcon className="extra-class" title="Test provider" />);

    expect(container.firstElementChild).toHaveClass(
      "agentemployee-provider-icon--working",
      "test-provider-icon--working",
      "extra-class",
    );
    const svg = screen.getByRole("img", { name: "Test provider" });
    expect(svg).toHaveAttribute("viewBox", "0 0 10 10");

    const paths = Array.from(svg.querySelectorAll("path"));
    expect(
      paths.some(
        (path) =>
          path.getAttribute("d") === SECONDARY_PATH &&
          path.getAttribute("fill-rule") === "evenodd" &&
          path.getAttribute("clip-rule") === "evenodd",
      ),
    ).toBe(true);
    expect(paths.some((path) => path.getAttribute("d") === PRIMARY_PATH)).toBe(true);
  });

  it("uses the provided tone and hides untitled SVGs from accessibility", () => {
    const TestIcon = createProviderIcon({
      cssPrefix: "test-provider-icon",
      path: PRIMARY_PATH,
      viewBox: "0 0 10 10",
    });

    const { container } = render(<TestIcon tone="done" />);

    expect(container.firstElementChild).toHaveClass(
      "agentemployee-provider-icon--done",
      "test-provider-icon--done",
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });

  it("leaves the paint to currentColor when no brand is declared", () => {
    const TestIcon = createProviderIcon({
      cssPrefix: "test-provider-icon",
      path: PRIMARY_PATH,
      viewBox: "0 0 10 10",
    });

    const { container } = render(<TestIcon />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--lc-brand")).toBe("");
    expect(root.style.getPropertyValue("--lc-brand-dark")).toBe("");
    expect(container.querySelector("defs")).toBeNull();
  });

  it("exposes brand paint as CSS variables, falling back to light for dark", () => {
    const TestIcon = createProviderIcon({
      cssPrefix: "test-provider-icon",
      path: PRIMARY_PATH,
      secondaryPath: SECONDARY_PATH,
      viewBox: "0 0 10 10",
      brand: { light: "#d97757" },
      secondaryBrand: { light: "#111111", dark: "#eeeeee" },
    });

    const { container } = render(<TestIcon />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--lc-brand")).toBe("#d97757");
    expect(root.style.getPropertyValue("--lc-brand-dark")).toBe("#d97757");
    expect(root.style.getPropertyValue("--lc-brand-2")).toBe("#111111");
    expect(root.style.getPropertyValue("--lc-brand-2-dark")).toBe("#eeeeee");
    expect(root.style.getPropertyValue("--lc-brand-2-opacity")).toBe("1");
  });

  it("renders a gradient definition addressed by the brand variables", () => {
    const TestIcon = createProviderIcon({
      cssPrefix: "test-provider-icon",
      path: PRIMARY_PATH,
      viewBox: "0 0 10 10",
      brandGradient: { from: "#b1a7ff", via: "#7a9dff", to: "#3941ff" },
    });

    const { container } = render(<TestIcon />);

    const gradient = container.querySelector("defs linearGradient");
    expect(gradient).not.toBeNull();
    expect(
      Array.from(gradient!.querySelectorAll("stop")).map((s) => s.getAttribute("stop-color")),
    ).toEqual(["#b1a7ff", "#7a9dff", "#3941ff"]);
    const root = container.firstElementChild as HTMLElement;
    const paint = root.style.getPropertyValue("--lc-brand");
    expect(paint).toBe(`url(#${gradient!.id})`);
    expect(root.style.getPropertyValue("--lc-brand-dark")).toBe(paint);
  });
});
