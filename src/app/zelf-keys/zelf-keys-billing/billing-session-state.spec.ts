import {
    buildBillingUiSessionState,
    isBillingUiSessionStateFresh,
    shouldClearStuckBillingLoading,
} from "./billing-session-state";

describe("billing-session-state (Refs #111)", () => {
    it("buildBillingUiSessionState stamps savedAt", () => {
        const state = buildBillingUiSessionState({
            plans: [],
            currentPlan: "free",
            hasActiveSubscription: false,
            activeSubscription: null,
            showCryptoPayment: false,
            cryptoPayment: null,
            stripeCheckoutPending: true,
        });

        expect(state.savedAt).toBeGreaterThan(0);
    });

    it("isBillingUiSessionStateFresh respects max age", () => {
        const now = 1_700_000_000_000;
        const state = buildBillingUiSessionState({
            plans: [],
            currentPlan: "free",
            hasActiveSubscription: false,
            activeSubscription: null,
            showCryptoPayment: false,
            cryptoPayment: null,
            stripeCheckoutPending: false,
        });

        expect(isBillingUiSessionStateFresh({ ...state, savedAt: now }, now + 1000)).toBeTrue();
        expect(isBillingUiSessionStateFresh({ ...state, savedAt: now }, now + 3 * 60 * 60 * 1000)).toBeFalse();
    });

    it("shouldClearStuckBillingLoading detects the empty UI condition after Stripe redirect", () => {
        expect(shouldClearStuckBillingLoading(true, false, false)).toBeTrue();
        expect(shouldClearStuckBillingLoading(true, true, false)).toBeFalse();
        expect(shouldClearStuckBillingLoading(false, false, false)).toBeFalse();
    });
});
