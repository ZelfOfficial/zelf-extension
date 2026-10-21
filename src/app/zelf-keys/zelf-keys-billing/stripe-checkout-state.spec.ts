import {
    buildStripeCheckoutSnapshot,
    nextPhaseAfterPollAttempt,
    nextPhaseAfterSubscriptionCheck,
    shouldRestoreStripeCheckoutRoute,
    shouldStopStripeCheckoutPolling,
    STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS,
} from "./stripe-checkout-state";

describe("stripe-checkout-state", () => {
    const plan = { id: "basic", name: "Basic Plan", price: 4.99, currency: "usd", interval: "month" };

    it("transitions waiting to confirmed when subscription is active", () => {
        expect(nextPhaseAfterSubscriptionCheck(true, "waiting")).toBe("confirmed");
        expect(nextPhaseAfterSubscriptionCheck(false, "waiting")).toBe("waiting");
    });

    it("transitions waiting to expired after max poll attempts", () => {
        expect(nextPhaseAfterPollAttempt(STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS, "waiting")).toBe("expired");
        expect(nextPhaseAfterPollAttempt(STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS - 1, "waiting")).toBe("waiting");
    });

    it("stops polling on final and expired phases", () => {
        expect(shouldStopStripeCheckoutPolling("confirmed")).toBeTrue();
        expect(shouldStopStripeCheckoutPolling("cancelled")).toBeTrue();
        expect(shouldStopStripeCheckoutPolling("failed")).toBeTrue();
        expect(shouldStopStripeCheckoutPolling("expired")).toBeTrue();
        expect(shouldStopStripeCheckoutPolling("waiting")).toBeFalse();
    });

    it("restores stripe route for waiting and expired", () => {
        expect(shouldRestoreStripeCheckoutRoute("waiting")).toBeTrue();
        expect(shouldRestoreStripeCheckoutRoute("expired")).toBeTrue();
        expect(shouldRestoreStripeCheckoutRoute("confirmed")).toBeFalse();
    });

    it("buildStripeCheckoutSnapshot stores session and plan metadata", () => {
        const snapshot = buildStripeCheckoutSnapshot({
            sessionId: "cs_test_123",
            checkoutUrl: "https://checkout.stripe.com/pay/cs_test_123",
            plan,
        });

        expect(snapshot.sessionId).toBe("cs_test_123");
        expect(snapshot.planId).toBe("basic");
        expect(snapshot.phase).toBe("waiting");
    });
});
