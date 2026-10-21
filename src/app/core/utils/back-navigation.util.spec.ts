import {
    canUseBrowserHistoryBack,
    isSafeInternalRoute,
    resolveBackNavigation,
    resolveBillingBackNavigation,
    serializeRouterPreviousUrl,
} from "./back-navigation.util";

describe("back-navigation.util", () => {
    it("navigates to the router previous in-app URL when available (Settings > Subscription)", () => {
        expect(
            resolveBackNavigation({
                previousUrl: "/settings",
                canUseBrowserHistory: false,
                redirect: "/home",
                fallback: "/settings",
            })
        ).toEqual({ kind: "route", url: "/settings" });
    });

    it("uses browser history when there is no recorded previous URL but history.length > 1", () => {
        expect(resolveBackNavigation({ canUseBrowserHistory: true, fallback: "/settings" })).toEqual({ kind: "history" });
    });

    it("uses the redirect query param when the screen was opened directly (no history)", () => {
        expect(
            resolveBackNavigation({ canUseBrowserHistory: false, redirect: "/settings", fallback: "/zelf-keys" })
        ).toEqual({ kind: "route", url: "/settings" });
    });

    it("falls back when redirect is missing or unsafe", () => {
        expect(resolveBackNavigation({ canUseBrowserHistory: false, fallback: "/settings" })).toEqual({ kind: "route", url: "/settings" });
        expect(resolveBackNavigation({ canUseBrowserHistory: false, redirect: "https://evil.example", fallback: "/settings" })).toEqual({
            kind: "route",
            url: "/settings",
        });
        expect(resolveBackNavigation({ canUseBrowserHistory: false, redirect: "//evil.example", fallback: "/settings" })).toEqual({
            kind: "route",
            url: "/settings",
        });
    });

    it("only accepts in-app routes", () => {
        expect(isSafeInternalRoute("/settings")).toBeTrue();
        expect(isSafeInternalRoute("/zelf-keys/billing?redirect=%2Fsettings")).toBeTrue();
        expect(isSafeInternalRoute("settings")).toBeFalse();
        expect(isSafeInternalRoute("javascript:alert(1)")).toBeFalse();
        expect(isSafeInternalRoute("/\\evil")).toBeFalse();
        expect(isSafeInternalRoute(undefined)).toBeFalse();
    });

    it("serializeRouterPreviousUrl returns the previous navigation when it is in-app", () => {
        const router = {
            lastSuccessfulNavigation: {
                previousNavigation: {
                    finalUrl: { toString: () => "/settings" },
                },
            },
            serializeUrl: () => "/settings",
        };

        expect(serializeRouterPreviousUrl(router as any)).toBe("/settings");
    });

    it("resolveBillingBackNavigation prefers router previous URL over redirect", () => {
        const router = {
            lastSuccessfulNavigation: {
                previousNavigation: {
                    finalUrl: {},
                },
            },
            serializeUrl: () => "/settings",
        };

        expect(resolveBillingBackNavigation(router as any, "/home")).toEqual({ kind: "route", url: "/settings" });
    });

    it("resolveBillingBackNavigation uses redirect when opened directly without router history", () => {
        Object.defineProperty(window.history, "length", { configurable: true, get: () => 1 });
        const router = { lastSuccessfulNavigation: null, serializeUrl: () => "" };

        expect(resolveBillingBackNavigation(router as any, "/settings")).toEqual({ kind: "route", url: "/settings" });
    });

    it("resolveBillingBackNavigation falls back to /settings", () => {
        Object.defineProperty(window.history, "length", { configurable: true, get: () => 1 });
        const router = { lastSuccessfulNavigation: null, serializeUrl: () => "" };

        expect(resolveBillingBackNavigation(router as any, null)).toEqual({ kind: "route", url: "/settings" });
    });

    it("canUseBrowserHistoryBack is false with a single history entry", () => {
        const original = window.history.length;
        Object.defineProperty(window.history, "length", { configurable: true, get: () => 1 });
        expect(canUseBrowserHistoryBack()).toBeFalse();
        Object.defineProperty(window.history, "length", { configurable: true, get: () => original });
    });
});
