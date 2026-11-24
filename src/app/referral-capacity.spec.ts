import { evaluateReferralLink, parseReferralAvailability, referralLimitFromLicense, ReferralAvailability } from "./referral-capacity";

const open = (overrides: Partial<ReferralAvailability> = {}): ReferralAvailability => ({
    exists: true,
    acceptsNewReferrals: true,
    limit: 10,
    spotsRemaining: 4,
    ...overrides,
});

describe("referral link capacity (#181)", () => {
    it("reads a positive integer cap from the license and ignores anything else", () => {
        expect(referralLimitFromLicense({ tags: { referrals: { limit: 5 } } } as any)).toBe(5);
        expect(referralLimitFromLicense({ tags: { referrals: { limit: "8" } } } as any)).toBe(8);
        expect(referralLimitFromLicense({ tags: {} } as any)).toBeNull();
        expect(referralLimitFromLicense({ tags: { referrals: { limit: 0 } } } as any)).toBeNull();
        expect(referralLimitFromLicense(null)).toBeNull();
    });

    it("parses the public availability payload", () => {
        expect(
            parseReferralAvailability({
                data: { exists: true, limit: 10, spotsRemaining: 0, acceptsNewReferrals: false },
            })
        ).toEqual({ exists: true, limit: 10, spotsRemaining: 0, acceptsNewReferrals: false });

        expect(parseReferralAvailability({ exists: false })).toEqual({
            exists: false,
            limit: null,
            spotsRemaining: null,
            acceptsNewReferrals: false,
        });
        expect(parseReferralAvailability(null)).toBeNull();
    });

    it("accepts a referrer that still has room", () => {
        expect(evaluateReferralLink(open(), null)).toBe("accepted");
        expect(evaluateReferralLink(open({ limit: 5, spotsRemaining: 1 }), 5)).toBe("accepted");
    });

    it("blocks a referrer the availability check says is full, without a local cap", () => {
        expect(evaluateReferralLink(open({ spotsRemaining: 0, acceptsNewReferrals: false }), null)).toBe("limit_reached");
        expect(evaluateReferralLink(open({ acceptsNewReferrals: false, spotsRemaining: 2 }), null)).toBe("limit_reached");
    });

    it("blocks when occupied slots already meet the license cap, even if the server cap is higher", () => {
        expect(evaluateReferralLink(open({ limit: 10, spotsRemaining: 4, acceptsNewReferrals: true }), 5)).toBe("limit_reached");
        expect(evaluateReferralLink(open({ limit: 10, spotsRemaining: 6, acceptsNewReferrals: true }), 5)).toBe("accepted");
    });

    it("does not treat an unknown wallet as a full wallet", () => {
        expect(evaluateReferralLink(open({ exists: false, acceptsNewReferrals: false, spotsRemaining: 0 }), 5)).toBe("unknown");
        expect(evaluateReferralLink(null, 5)).toBe("unknown");
    });
});
