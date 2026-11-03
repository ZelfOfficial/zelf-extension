import { ZelfIdSearchResponse, ZelfIdsService } from "app/zelf-ids.service";

import { buildZelfIdPaymentUrl, defaultPlanSelection, ownedNamePaymentQuery, resolveZelfIdPlanCatalog } from "./plan-pricing";

const PREMIUM = { "1": 29, "2": 43.49, "3": 56.99, lifetime: 144.99 };
const UNLIMITED = { "1": 99, "2": 148.99, "3": 192.99, lifetime: 494.99 };

describe("Zelf ID plan pricing", () => {
    it("reads the new search shape, including free term, limits, and sorted durations", () => {
        const response: ZelfIdSearchResponse = {
            available: true,
            tagName: "auditxq7name.zelf",
            domain: "zelf",
            plan: "free",
            allowedPlans: ["free", "premium", "unlimited"],
            currency: "USD",
            eligibility: { premium: true, unlimited: true, shortName: false, freeTermYears: 100 },
            plans: {
                free: {
                    price: 0,
                    termYears: 100,
                    currency: "USD",
                    limits: { passwords: 5, authenticators: { limit: 3 }, notes: 10 },
                },
                premium: { "5": 70, lifetime: 144.99, "1": 29, "4": 60, "3": 56.99, "2": 43.49 },
                unlimited: UNLIMITED,
            },
            price: { price: 0, currency: "USD", plan: "free", quotedPlan: "premium", duration: "1" },
            ipfs: [],
            arweave: [],
        };

        const catalog = resolveZelfIdPlanCatalog(response, "auditxq7name");

        expect(catalog.freePrice).toBe(0);
        expect(catalog.freeTermYears).toBe(100);
        expect(catalog.emphasizePaid).toBeFalse();
        expect(catalog.isShortName).toBeFalse();
        expect(catalog.recordPlan).toBe("free");
        expect(catalog.plans.map((plan) => plan.id)).toEqual(["free", "premium", "unlimited"]);
        expect(catalog.plans[1].durations.map((duration) => duration.key)).toEqual(["1", "2", "3", "4", "5", "lifetime"]);
        expect(catalog.plans[1].durations.map((duration) => duration.price)).toEqual([29, 43.49, 56.99, 60, 70, 144.99]);
        expect(catalog.plans[2].durations.map((duration) => duration.price)).toEqual([99, 148.99, 192.99, 494.99]);
        expect(catalog.limits.map((line) => line.key)).toEqual(["passwords", "authenticators", "notes"]);
        expect(defaultPlanSelection(catalog, "register")).toEqual({ plan: "free", duration: "" });
    });

    it("hides Premium on a 1-year short name and leads with Unlimited", () => {
        const response: ZelfIdSearchResponse = {
            available: true,
            tagName: "xq7k",
            domain: "zelf",
            plan: "free",
            allowedPlans: ["free", "unlimited"],
            eligibility: { premium: false, unlimited: true, shortName: true, freeTermYears: 1 },
            plans: {
                free: { price: 0, termYears: 1, currency: "USD" },
                unlimited: UNLIMITED,
            },
            price: { price: 0, currency: "USD", plan: "free", allowedPlans: ["free", "unlimited"] },
            ipfs: [],
            arweave: [],
        };

        const catalog = resolveZelfIdPlanCatalog(response, "xq7k");

        expect(catalog.freeTermYears).toBe(1);
        expect(catalog.emphasizePaid).toBeTrue();
        expect(catalog.isShortName).toBeTrue();
        expect(catalog.plans.map((plan) => plan.id)).toEqual(["unlimited", "free"]);
        expect(catalog.plans[0].recommended).toBeTrue();
        expect(catalog.plans[0].durations[0]).toEqual({ key: "1", price: 99 });
        expect(defaultPlanSelection(catalog, "register")).toEqual({ plan: "unlimited", duration: "1" });
    });

    it("derives Free at $0 from today's search, which has no plans.free or eligibility", () => {
        const longName: ZelfIdSearchResponse = {
            available: true,
            tagName: "auditxq7name",
            domain: "zelf",
            plan: "free",
            allowedPlans: ["free", "premium", "unlimited"],
            plans: { premium: PREMIUM, unlimited: UNLIMITED },
            price: {
                price: 29,
                currency: "USD",
                plan: "free",
                duration: "1",
                allowedPlans: ["free", "premium", "unlimited"],
            },
            ipfs: [],
            arweave: [],
        };
        const shortName: ZelfIdSearchResponse = {
            available: true,
            tagName: "xq7k",
            domain: "zelf",
            plan: "free",
            allowedPlans: ["free", "unlimited"],
            plans: { unlimited: UNLIMITED },
            price: { price: 99, currency: "USD", plan: "free", allowedPlans: ["free", "unlimited"] },
            ipfs: [],
            arweave: [],
        };

        const longCatalog = resolveZelfIdPlanCatalog(longName, "auditxq7name");
        const shortCatalog = resolveZelfIdPlanCatalog(shortName, "xq7k");

        expect(longCatalog.freePrice).toBe(0);
        expect(longCatalog.freeTermYears).toBe(100);
        expect(longCatalog.plans.find((plan) => plan.id === "premium")?.durations[0].price).toBe(29);
        expect(longCatalog.plans.some((plan) => plan.price === 29)).toBeFalse();
        expect(shortCatalog.freePrice).toBe(0);
        expect(shortCatalog.freeTermYears).toBe(1);
        expect(shortCatalog.plans.map((plan) => plan.id)).toEqual(["unlimited", "free"]);
        expect(shortCatalog.isShortName).toBeTrue();
    });

    it("keeps the length rule as a last resort and ignores it when the server lists plans", () => {
        const hint = ZelfIdsService.prototype.resolvePlanHint;

        expect(hint.call({}, null, "ab")).toEqual({
            plan: "free",
            allowedPlans: ["free", "unlimited"],
            isShortName: true,
        });
        expect(hint.call({}, null, "auditxq7name")).toEqual({
            plan: "free",
            allowedPlans: ["free", "premium", "unlimited"],
            isShortName: false,
        });

        const serverSaysLong = hint.call(
            {},
            {
                available: true,
                ipfs: [],
                arweave: [],
                tagName: "ab",
                allowedPlans: ["free", "premium", "unlimited"],
                plans: { premium: PREMIUM, unlimited: UNLIMITED },
                price: { plan: "free" },
            } as ZelfIdSearchResponse,
            "ab"
        );

        expect(serverSaysLong.isShortName).toBeFalse();
        expect(serverSaysLong.allowedPlans).toEqual(["free", "premium", "unlimited"]);
        expect(serverSaysLong.plan).toBe("free");

        const termFromServer = resolveZelfIdPlanCatalog(
            {
                available: true,
                tagName: "auditxq7name",
                eligibility: { premium: true, unlimited: true, shortName: false, freeTermYears: 1 },
                plans: { premium: PREMIUM },
                ipfs: [],
                arweave: [],
            },
            "auditxq7name"
        );

        expect(termFromServer.freeTermYears).toBe(1);
        expect(termFromServer.isShortName).toBeFalse();
        expect(termFromServer.emphasizePaid).toBeTrue();

        const planTermWins = resolveZelfIdPlanCatalog(
            {
                available: true,
                tagName: "xq7k",
                eligibility: { shortName: true, freeTermYears: 1, premium: false, unlimited: true },
                plans: { free: { price: 0, termYears: 100, currency: "eur" }, unlimited: UNLIMITED },
                ipfs: [],
                arweave: [],
            },
            "xq7k"
        );

        expect(planTermWins.freeTermYears).toBe(100);
        expect(planTermWins.currency).toBe("EUR");
        expect(planTermWins.emphasizePaid).toBeFalse();
    });

    it("omits a paid plan the server did not offer, even if a price map is present", () => {
        const catalog = resolveZelfIdPlanCatalog(
            {
                available: true,
                tagName: "xq7k",
                allowedPlans: ["free", "unlimited"],
                plans: { premium: PREMIUM, unlimited: UNLIMITED },
                ipfs: [],
                arweave: [],
            },
            "xq7k"
        );

        expect(catalog.plans.map((plan) => plan.id)).not.toContain("premium");
    });

    it("builds the pricing URL with plan and duration and no length price", () => {
        expect(
            buildZelfIdPaymentUrl("https://zelf.world/zelf-ids/payment", {
                tagName: "xq7k.zelf",
                domain: "zelf",
                plan: "unlimited",
                duration: "lifetime",
            })
        ).toBe("https://zelf.world/zelf-ids/payment?tagname=xq7k&domain=zelf&duration=lifetime&plan=unlimited");

        expect(
            ownedNamePaymentQuery({ tagName: "xq7k", domain: "bdag", currentPlan: "free", currentDuration: "999" })
        ).toEqual({ tagName: "xq7k", domain: "bdag", plan: "unlimited", duration: "lifetime" });
        expect(ownedNamePaymentQuery({ tagName: "auditxq7name", domain: "zelf", currentPlan: "premium", currentDuration: "3" })).toEqual({
            tagName: "auditxq7name",
            domain: "zelf",
            plan: "premium",
            duration: "3",
        });
        expect(ownedNamePaymentQuery({ tagName: "auditxq7name", currentPlan: "" }).plan).toBe("premium");
    });

    it("shows string and list limits when the license sends them", () => {
        const catalog = resolveZelfIdPlanCatalog(
            {
                available: true,
                tagName: "auditxq7name",
                plans: { free: { price: 0, termYears: 100, limits: ["Up to 5 passwords", { label: "Notes", value: "10" }] } },
                ipfs: [],
                arweave: [],
            },
            "auditxq7name"
        );

        expect(catalog.limits[0]).toEqual({ key: "text", text: "Up to 5 passwords" });
        expect(catalog.limits[1].key).toBe("notes");
        expect(catalog.limits[1].count).toBe(10);
    });
});
