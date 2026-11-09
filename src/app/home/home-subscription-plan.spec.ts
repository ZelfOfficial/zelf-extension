import { resolveHomeSubscriptionTier } from "./home-subscription-plan";

describe("home subscription plan", () => {
    it("shows Free when /api/zelf-keys/limits reports plan=free for a mainnet name like jimbot.zelf", () => {
        expect(
            resolveHomeSubscriptionTier({
                limitsPlan: "free",
                licensePlan: undefined,
            })
        ).toBe("free");
    });

    it("prefers the limits plan over a stale license plan", () => {
        expect(
            resolveHomeSubscriptionTier({
                limitsPlan: "free",
                myPlan: "premium",
                licensePlan: "premium",
            })
        ).toBe("free");
    });

    it("uses my-plan when limits are unavailable", () => {
        expect(resolveHomeSubscriptionTier({ limitsPlan: null, myPlan: "free" })).toBe("free");
        expect(resolveHomeSubscriptionTier({ limitsPlan: null, myPlan: "premium" })).toBe("paid");
    });

    it("uses the license plan on the Zelf ID when neither API has a plan", () => {
        expect(resolveHomeSubscriptionTier({ licensePlan: "free" })).toBe("free");
        expect(resolveHomeSubscriptionTier({ licensePlan: "Premium" })).toBe("paid");
    });

    it("treats premium and unlimited as paid plans", () => {
        expect(resolveHomeSubscriptionTier({ limitsPlan: "premium" })).toBe("paid");
        expect(resolveHomeSubscriptionTier({ limitsPlan: "unlimited" })).toBe("paid");
    });

    it("does not invent Premium when no plan has been reported", () => {
        expect(resolveHomeSubscriptionTier({})).toBe("unknown");
        expect(resolveHomeSubscriptionTier({ limitsPlan: "  ", myPlan: null, licensePlan: "" })).toBe("unknown");
    });
});