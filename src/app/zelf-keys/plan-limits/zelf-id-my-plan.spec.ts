import {
    isMyPlanFallbackError,
    parseMyPlan,
    planEndLabel,
    planExpiryLabel,
    resolveMyPlanZelfName,
    upgradeTarget,
    ZELF_ID_PRICING_URL,
} from "./zelf-id-my-plan";

describe("GET /api/zelf-ids/my-plan", () => {
    it("reads plan, expiry, and upgrade.action", () => {
        const plan = parseMyPlan({
            data: {
                plan: "premium",
                expiresAt: "2027-10-24T00:00:00.000Z",
                upgrade: { action: "stripe_portal", url: "https://billing.stripe.com/p/session/test" },
            },
        });

        expect(plan?.plan).toBe("premium");
        expect(plan?.planExpiresAt).toBe("2027-10-24T00:00:00.000Z");
        expect(plan?.expiresAt).toBe("2027-10-24T00:00:00.000Z");
        expect(upgradeTarget(plan)).toEqual({ kind: "url", url: "https://billing.stripe.com/p/session/test" });
    });

    it("opens checkout urls and ignores non-http urls", () => {
        const checkout = parseMyPlan({
            plan: "free",
            upgrade: { action: "checkout", url: "https://zelf.world/checkout?name=alice&plan=premium" },
        });

        expect(upgradeTarget(checkout)).toEqual({
            kind: "url",
            url: "https://zelf.world/checkout?name=alice&plan=premium",
        });

        const bad = parseMyPlan({ upgrade: { action: "checkout", url: "javascript:alert(1)" } });

        expect(upgradeTarget(bad)).toEqual({ kind: "url", url: ZELF_ID_PRICING_URL });
    });

    it("keeps mobile upgrades inside the app and hides Upgrade on the top plan", () => {
        expect(upgradeTarget(parseMyPlan({ upgrade: { action: "mobile_store" } }))).toEqual({ kind: "mobile" });
        expect(upgradeTarget(parseMyPlan({ plan: "unlimited", upgrade: { action: "none" } }))).toEqual({ kind: "hidden" });
    });

    it("falls back when the route is missing or the session is not verified", () => {
        expect(isMyPlanFallbackError({ status: 401 })).toBeTrue();
        expect(isMyPlanFallbackError({ status: 403, error: { code: "ERR_SESSION_NOT_VERIFIED" } })).toBeTrue();
        expect(isMyPlanFallbackError({ status: 404 })).toBeTrue();
        expect(isMyPlanFallbackError({ status: 500 })).toBeFalse();
        expect(upgradeTarget(null)).toEqual({ kind: "url", url: ZELF_ID_PRICING_URL });
    });

    it("formats a paid expiry and treats a 100-year date as open", () => {
        const now = Date.parse("2026-10-24T00:00:00.000Z");

        expect(planExpiryLabel("2027-10-24T00:00:00.000Z", now)).toEqual({ kind: "date", label: "Oct 24, 2027" });
        expect(planExpiryLabel("2126-10-24T00:00:00.000Z", now)).toEqual({ kind: "open" });
        expect(planExpiryLabel(null, now)).toBeNull();
    });

    it("uses planExpiresAt for the plan line and ignores the name lease", () => {
        const now = Date.parse("2026-10-24T00:00:00.000Z");
        const premium = parseMyPlan({
            plan: "premium",
            planExpiresAt: "2027-10-24T00:00:00.000Z",
            leaseExpiresAt: "2030-01-01T00:00:00.000Z",
            expiresAt: "2026-01-01T00:00:00.000Z",
            upgrade: { action: "checkout", url: "https://zelf.world/pricing?plan=unlimited" },
        });

        expect(premium?.planExpiresAt).toBe("2027-10-24T00:00:00.000Z");
        expect(premium?.leaseExpiresAt).toBe("2030-01-01T00:00:00.000Z");
        expect(premium?.expiresAt).toBe("2027-10-24T00:00:00.000Z");
        expect(planEndLabel(premium, now)).toEqual({ kind: "date", label: "Oct 24, 2027" });

        const free = parseMyPlan({
            plan: "free",
            leaseExpiresAt: "2126-10-24T00:00:00.000Z",
            upgrade: { action: "checkout", url: "https://zelf.world/pricing?plan=premium" },
        });

        expect(free?.planExpiresAt).toBeNull();
        expect(planEndLabel(free, now)).toEqual({ kind: "open" });
        expect(planEndLabel({ plan: "premium", duration: "1y", planExpiresAt: null, expiresAt: null }, now)).toEqual({ kind: "open" });
        expect(
            planEndLabel({ plan: "unlimited", duration: "lifetime", planExpiresAt: "2027-10-24T00:00:00.000Z", expiresAt: null }, now)
        ).toEqual({ kind: "open" });
    });

    it("reads the unwrapped my-plan body and the zelfName the route requires", () => {
        const plan = parseMyPlan({
            zelfName: "myname.zelf",
            plan: "premium",
            duration: "1y",
            expiresAt: "2027-10-24T18:00:00.000Z",
            paymentMethod: "coupon",
            nextPlans: ["unlimited"],
            upgrade: {
                action: "checkout",
                url: "https://zelf.world/pricing?tagname=myname&domain=zelf&duration=1&plan=unlimited&zelfName=myname.zelf",
            },
        });

        expect(plan?.duration).toBe("1y");
        expect(plan?.upgrade.action).toBe("checkout");
        expect(upgradeTarget(plan).kind).toBe("url");
        expect(resolveMyPlanZelfName({ explicit: "JimBot.Zelf" })).toBe("jimbot.zelf");
        expect(resolveMyPlanZelfName({ walletTag: "alice", walletDomain: "zelf" })).toBe("alice.zelf");
        expect(resolveMyPlanZelfName({})).toBeNull();
    });
});
