import type { ChromeService } from "app/chrome.service";

import {
    BILLING_UI_SESSION_KEY,
    buildBillingUiSessionState,
    finalizeBillingUiAfterSubscriptionSuccess,
    isBillingUiSessionStateFresh,
    loadBillingUiSessionState,
    persistBillingUiSessionState,
    resolveBillingWalletOwnerTag,
    shouldClearStuckBillingLoading,
    shouldRestoreCryptoPaymentMonitoring,
} from "./billing-session-state";

describe("billing-session-state (Refs #111)", () => {
    const createMemoryChrome = (): ChromeService => {
        const store = new Map<string, unknown>();

        return {
            getItemSession: async <T>(key: string) => store.get(key) as T,
            setItemSession: async (key: string, value: unknown) => {
                store.set(key, value);
            },
            removeItemSession: async (key: string) => {
                store.delete(key);
            },
        } as ChromeService;
    };

    const sampleCryptoState = () =>
        buildBillingUiSessionState({
            plans: [{ id: "basic", name: "Basic", price: 4.99, currency: "USD", interval: "month", description: "", buttonText: "", buttonClass: "" }],
            currentPlan: "free",
            hasActiveSubscription: false,
            activeSubscription: null,
            showCryptoPayment: true,
            cryptoPayment: {
                amount: 1,
                currency: "AVAX",
                expiresAt: new Date().toISOString(),
                lockedPriceToken: "locked-token",
                paymentAddress: "0xabc",
                planId: "basic",
                usdAmount: 4.99,
            },
            stripeCheckoutPending: false,
            walletOwnerTag: "alice.zelf",
        });

    it("buildBillingUiSessionState stamps savedAt", () => {
        const state = buildBillingUiSessionState({
            plans: [],
            currentPlan: "free",
            hasActiveSubscription: false,
            activeSubscription: null,
            showCryptoPayment: false,
            cryptoPayment: null,
            stripeCheckoutPending: true,
            walletOwnerTag: "alice.zelf",
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
            walletOwnerTag: "alice.zelf",
        });

        expect(isBillingUiSessionStateFresh({ ...state, savedAt: now }, now + 1000)).toBeTrue();
        expect(isBillingUiSessionStateFresh({ ...state, savedAt: now }, now + 3 * 60 * 60 * 1000)).toBeFalse();
    });

    it("shouldClearStuckBillingLoading detects the empty UI condition after Stripe redirect", () => {
        expect(shouldClearStuckBillingLoading(true, false, false)).toBeTrue();
        expect(shouldClearStuckBillingLoading(true, true, false)).toBeFalse();
        expect(shouldClearStuckBillingLoading(false, false, false)).toBeFalse();
    });

    it("resolveBillingWalletOwnerTag normalizes wallet identity", () => {
        expect(resolveBillingWalletOwnerTag({ fullTagName: "Alice.Zelf" })).toBe("alice.zelf");
        expect(resolveBillingWalletOwnerTag(null)).toBe("_none");
    });

    it("does not restore billing UI for a different wallet", async () => {
        const chrome = createMemoryChrome();
        await persistBillingUiSessionState(chrome, sampleCryptoState());

        const restored = await loadBillingUiSessionState(chrome, "bob.zelf");

        expect(restored).toBeNull();
        expect(await chrome.getItemSession(BILLING_UI_SESSION_KEY)).toBeUndefined();
    });

    it("finalizeBillingUiAfterSubscriptionSuccess prevents crypto restore polling loop", async () => {
        const chrome = createMemoryChrome();
        const pending = sampleCryptoState();

        await persistBillingUiSessionState(chrome, pending);
        expect(shouldRestoreCryptoPaymentMonitoring(pending)).toBeTrue();

        await finalizeBillingUiAfterSubscriptionSuccess(chrome);

        const restored = await loadBillingUiSessionState(chrome, "alice.zelf");
        expect(restored).toBeNull();
        expect(shouldRestoreCryptoPaymentMonitoring(restored)).toBeFalse();
    });

    it("loadBillingUiSessionState returns null on storage read failure", async () => {
        const chrome = {
            getItemSession: async () => {
                throw new Error("session unavailable");
            },
            removeItemSession: async () => undefined,
        } as unknown as ChromeService;

        const restored = await loadBillingUiSessionState(chrome, "alice.zelf");

        expect(restored).toBeNull();
    });
});
