import type { ChromeService } from "app/chrome.service";

import type { PricingPlan } from "../../services/billing.service";

/** Survives popup close while the user is on Stripe or another external checkout tab. */
export const BILLING_UI_SESSION_KEY = "zelf-keys-billing-ui-state";

const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface BillingCryptoPaymentSnapshot {
    amount: number;
    avaxPrice?: number;
    currency: string;
    expiresAt: string;
    isDemoMode?: boolean;
    lockedPriceToken?: string;
    paymentAddress: string;
    planId: string;
    usdAmount: number;
    originalAmount?: {
        usd: number;
        avax: number;
    };
}

export interface BillingUiSessionState {
    activeSubscription: unknown | null;
    cryptoPayment: BillingCryptoPaymentSnapshot | null;
    currentPlan: string;
    hasActiveSubscription: boolean;
    plans: PricingPlan[];
    savedAt: number;
    showCryptoPayment: boolean;
    stripeCheckoutPending: boolean;
}

export function buildBillingUiSessionState(input: {
    activeSubscription: unknown | null;
    cryptoPayment: BillingCryptoPaymentSnapshot | null;
    currentPlan: string;
    hasActiveSubscription: boolean;
    plans: PricingPlan[];
    showCryptoPayment: boolean;
    stripeCheckoutPending: boolean;
}): BillingUiSessionState {
    return {
        ...input,
        savedAt: Date.now(),
    };
}

export function isBillingUiSessionStateFresh(state: BillingUiSessionState | null | undefined, now = Date.now()): boolean {
    if (!state?.savedAt) return false;

    return now - state.savedAt <= MAX_AGE_MS;
}

/** Stripe polling used `loading` while plans were already loaded, which hid the whole billing UI. */
export function shouldClearStuckBillingLoading(loading: boolean, loadingPlans: boolean, loadingCurrentPlan: boolean): boolean {
    return loading && !loadingPlans && !loadingCurrentPlan;
}

export async function loadBillingUiSessionState(chromeService: ChromeService): Promise<BillingUiSessionState | null> {
    const stored = await chromeService.getItemSession<BillingUiSessionState>(BILLING_UI_SESSION_KEY);

    if (!isBillingUiSessionStateFresh(stored)) {
        await chromeService.removeItemSession(BILLING_UI_SESSION_KEY);

        return null;
    }

    return stored ?? null;
}

export async function persistBillingUiSessionState(chromeService: ChromeService, state: BillingUiSessionState): Promise<void> {
    await chromeService.setItemSession(BILLING_UI_SESSION_KEY, state);
}

export async function clearBillingUiSessionState(chromeService: ChromeService): Promise<void> {
    await chromeService.removeItemSession(BILLING_UI_SESSION_KEY);
}
