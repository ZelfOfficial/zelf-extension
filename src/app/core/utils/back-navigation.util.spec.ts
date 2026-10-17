import { isSafeInternalRoute, resolveBackNavigation } from "./back-navigation.util";

describe("back-navigation.util", () => {
    it("goes back through history when there is a previous screen", () => {
        expect(resolveBackNavigation({ hasPreviousInAppNavigation: true, redirect: "/settings", fallback: "/zelf-keys" })).toEqual({ kind: "history" });
    });

    it("uses the redirect query param when the screen was opened directly (no history)", () => {
        expect(resolveBackNavigation({ hasPreviousInAppNavigation: false, redirect: "/settings", fallback: "/zelf-keys" })).toEqual({ kind: "route", url: "/settings" });
    });

    it("falls back when redirect is missing or unsafe", () => {
        expect(resolveBackNavigation({ hasPreviousInAppNavigation: false, fallback: "/zelf-keys" })).toEqual({ kind: "route", url: "/zelf-keys" });
        expect(resolveBackNavigation({ hasPreviousInAppNavigation: false, redirect: "https://evil.example", fallback: "/zelf-keys" })).toEqual({
            kind: "route",
            url: "/zelf-keys",
        });
        expect(resolveBackNavigation({ hasPreviousInAppNavigation: false, redirect: "//evil.example", fallback: "/zelf-keys" })).toEqual({
            kind: "route",
            url: "/zelf-keys",
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
});
