import { describe, expect, it } from "vitest";
import { legacyBrowserRouteUrl, mobileRouterBasePath, mobileServiceWorkerScope } from "./routing";

describe("mobileRouterBasePath", () => {
  it("resolves hosted, desktop-served, and development bases", () => {
    expect(mobileRouterBasePath("/pwa/settings/appearance", "/pwa/")).toBe("/pwa");
    expect(mobileRouterBasePath("/app/settings/appearance", "/app/")).toBe("/app");
    expect(mobileRouterBasePath("/app-nightly/settings/appearance", "/app-nightly/")).toBe(
      "/app-nightly",
    );
    expect(mobileRouterBasePath("/app/settings/appearance", "/")).toBe("/app");
    expect(mobileRouterBasePath("/settings/appearance", "/")).toBe("/");
  });
});

describe("mobileServiceWorkerScope", () => {
  it("owns the origin for desktop-served builds and stays inside a channel base", () => {
    expect(mobileServiceWorkerScope("./")).toBe("/");
    expect(mobileServiceWorkerScope("/")).toBe("/");
    expect(mobileServiceWorkerScope("/app/")).toBe("/app/");
    expect(mobileServiceWorkerScope("/app-nightly/")).toBe("/app-nightly/");
  });
});

describe("legacyBrowserRouteUrl", () => {
  it("keeps the internal Connections landing at the hosted PWA root", () => {
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/desktops", "/pwa/")).toBe(
      "https://agentemployee.com/pwa",
    );
  });

  it("converts real screens to clean browser paths", () => {
    expect(
      legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more/settings/appearance", "/pwa/"),
    ).toBe("https://agentemployee.com/pwa/settings/appearance");
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more", "/pwa/")).toBe(
      "https://agentemployee.com/pwa/settings",
    );
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more/usage", "/pwa/")).toBe(
      "https://agentemployee.com/pwa/usage",
    );
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more/projects", "/pwa/")).toBe(
      "https://agentemployee.com/pwa/projects",
    );
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more/browser", "/pwa/")).toBe(
      "https://agentemployee.com/pwa/browser",
    );
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more/ports", "/pwa/")).toBe(
      "https://agentemployee.com/pwa/ports",
    );
    expect(legacyBrowserRouteUrl("https://agentemployee.com/pwa#/more/settings", "/pwa/")).toBe(
      "https://agentemployee.com/pwa/settings/desktop",
    );
  });

  it("migrates the previous state-backed route at the development root", () => {
    expect(legacyBrowserRouteUrl("http://localhost:3100/", "/", "/settings/appearance")).toBe(
      "http://localhost:3100/settings/appearance",
    );
  });
});
