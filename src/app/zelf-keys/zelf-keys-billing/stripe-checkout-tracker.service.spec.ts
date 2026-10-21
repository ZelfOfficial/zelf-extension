import { BillingService } from "app/services/billing.service";
import { WalletService } from "app/wallet.service";

import { buildBillingUiSessionState, persistBillingUiSessionState } from "./billing-session-state";
import { buildStripeCheckoutSnapshot, shouldStopStripeCheckoutPolling } from "./stripe-checkout-state";
import { StripeCheckoutTrackerService } from "./stripe-checkout-tracker.service";

describe("StripeCheckoutTrackerService", () => {
    const plan = {
        id: "basic",
        name: "Basic Plan",
        price: 4.99,
        currency: "USD",
        interval: "month",
        description: "",
        buttonText: "",
        buttonClass: "",
    };

    const createChrome = () => {
        const store = new Map<string, unknown>();

        return {
            getItemSession: async (key: string) => store.get(key),
            setItemSession: async (key: string, value: unknown) => store.set(key, value),
            removeItemSession: async (key: string) => store.delete(key),
            openExternalUrl: async () => undefined,
        };
    };

    const createService = (billing: Partial<BillingService>, wallet: Partial<WalletService>, chrome: ReturnType<typeof createChrome>) => {
        return new StripeCheckoutTrackerService(billing as BillingService, chrome as any, wallet as WalletService);
    };

    it("restores waiting checkout from storage and resumes polling until confirmed", async () => {
        const chrome = createChrome();
        const billing = {
            getActiveSubscription: jasmine.createSpy("getActiveSubscription").and.resolveTo({ success: true, data: { id: "sub_1" } }),
        };
        const wallet = {
            getFirstWalletFromStorage: jasmine.createSpy("getFirstWalletFromStorage").and.resolveTo({ fullTagName: "alice.zelf" }),
        };

        const stripeCheckout = buildStripeCheckoutSnapshot({
            sessionId: "cs_test",
            checkoutUrl: "https://checkout.stripe.test",
            plan,
        });

        await persistBillingUiSessionState(
            chrome as any,
            buildBillingUiSessionState({
                plans: [plan],
                currentPlan: "free",
                hasActiveSubscription: false,
                activeSubscription: null,
                showCryptoPayment: false,
                cryptoPayment: null,
                stripeCheckout,
                walletOwnerTag: "alice.zelf",
            })
        );

        const service = createService(billing, wallet, chrome);
        const restored = await service.bootstrapFromStorage();

        expect(restored?.sessionId).toBe("cs_test");
        await service.checkNow();

        expect(service.snapshot?.phase).toBe("confirmed");
        expect(shouldStopStripeCheckoutPolling(service.snapshot!.phase)).toBeTrue();
        expect(billing.getActiveSubscription).toHaveBeenCalled();
    });

    it("stops polling after cancelled and persists phase", async () => {
        const chrome = createChrome();
        const billing = {
            getActiveSubscription: jasmine.createSpy("getActiveSubscription").and.resolveTo({ success: false, data: null }),
        };
        const wallet = {
            getFirstWalletFromStorage: jasmine.createSpy("getFirstWalletFromStorage").and.resolveTo({ fullTagName: "alice.zelf" }),
        };

        const service = createService(billing, wallet, chrome);

        await service.beginCheckout({
            checkoutUrl: "https://checkout.stripe.test",
            sessionId: "cs_cancel",
            plan,
            sessionBase: {
                plans: [plan],
                currentPlan: "free",
                hasActiveSubscription: false,
                activeSubscription: null,
                showCryptoPayment: false,
                cryptoPayment: null,
                walletOwnerTag: "alice.zelf",
            },
        });

        await service.markCancelled();

        expect(service.snapshot?.phase).toBe("cancelled");
        expect(shouldStopStripeCheckoutPolling(service.snapshot!.phase)).toBeTrue();
    });
});
