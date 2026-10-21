import { Location } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";

import { ZelfKeysBillingComponent } from "./zelf-keys-billing.component";

describe("ZelfKeysBillingComponent goBack (Refs #69)", () => {
    const build = (overrides: { previousUrl?: string | null; redirect?: string | null; historyLength?: number }) => {
        const location = { back: jasmine.createSpy("back") } as unknown as Location;
        const navigateByUrl = jasmine.createSpy("navigateByUrl").and.resolveTo(true);
        const router = {
            lastSuccessfulNavigation: overrides.previousUrl
                ? {
                      previousNavigation: {
                          finalUrl: {},
                      },
                  }
                : null,
            serializeUrl: () => overrides.previousUrl ?? "",
            navigateByUrl,
        } as unknown as Router;

        const activatedRoute = {
            snapshot: {
                queryParamMap: {
                    get: (key: string) => (key === "redirect" ? overrides.redirect ?? null : null),
                },
            },
        } as ActivatedRoute;

        if (overrides.historyLength !== undefined) {
            Object.defineProperty(window.history, "length", { configurable: true, get: () => overrides.historyLength });
        }

        const component = new ZelfKeysBillingComponent(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            router,
            {} as any,
            {} as any,
            {} as any,
            activatedRoute,
            location,
            {} as any
        );

        return { component, location, navigateByUrl };
    };

    afterEach(() => {
        Object.defineProperty(window.history, "length", { configurable: true, get: () => 2 });
    });

    it("navigates to the router previous in-app URL (e.g. Settings) instead of Home", () => {
        const { component, location, navigateByUrl } = build({ previousUrl: "/settings", redirect: "/settings" });

        component.goBack();

        expect(navigateByUrl).toHaveBeenCalledWith("/settings");
        expect(location.back).not.toHaveBeenCalled();
    });

    it("calls Location.back when browser history exists and there is no router previous URL", () => {
        const { component, location, navigateByUrl } = build({ historyLength: 3, redirect: "/settings" });

        component.goBack();

        expect(location.back).toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it("uses redirect when opened directly without history", () => {
        const { component, location, navigateByUrl } = build({ historyLength: 1, redirect: "/settings" });

        component.goBack();

        expect(navigateByUrl).toHaveBeenCalledWith("/settings");
        expect(location.back).not.toHaveBeenCalled();
    });

    it("falls back to /settings when there is no history and no redirect", () => {
        const { component, navigateByUrl } = build({ historyLength: 1, redirect: null });

        component.goBack();

        expect(navigateByUrl).toHaveBeenCalledWith("/settings");
    });
});
