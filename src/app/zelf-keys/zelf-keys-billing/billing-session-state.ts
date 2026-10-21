import type { ChromeService } from "app/chrome.service";
import type { TagModel } from "app/tags.service";

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
    /** Lowercase wallet tag (fullTagName / tagName) so another wallet cannot restore this snapshot. */
    walletOwnerTag: string;
}

export function resolveBillingWalletOwnerTag(wallet: Partial<TagModel> | null | undefined): string {
    const raw = wallet?.fullTagName || wallet?.publicData?.tagName || wallet?.tagName || wallet?.name || "";
    const tag = String(raw).trim().toLowerCase();

    return tag || "_none";
}

export function buildBillingUiSessionState(input: {
    activeSubscription: unknown | null;
    cryptoPayment: BillingCryptoPaymentSnapshot | null;
    currentPlan: string;
    hasActiveSubscription: boolean;
    plans: PricingPlan[];
    showCryptoPayment: boolean;
    stripeCheckoutPending: boolean;
    walletOwnerTag: string;
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

export function shouldRestoreCryptoPaymentMonitoring(state: BillingUiSessionState | null | undefined): boolean {
    return Boolean(state?.showCryptoPayment && state.cryptoPayment?.lockedPriceToken);
}

/** Call before reloading billing after subscription activation so restore cannot re-arm crypto polling. */
export async function finalizeBillingUiAfterSubscriptionSuccess(chromeService: ChromeService): Promise<void> {
    await clearBillingUiSessionState(chromeService);
}

export async function loadBillingUiSessionState(
    chromeService: ChromeService,
    walletOwnerTag: string | null
): Promise<BillingUiSessionState | null> {
    try {
        const stored = await chromeService.getItemSession<BillingUiSessionState>(BILLING_UI_SESSION_KEY);

        if (!isBillingUiSessionStateFresh(stored)) {
            await clearBillingUiSessionState(chromeService);

            return null;
        }

        if (!walletOwnerTag || !stored?.walletOwnerTag || stored.walletOwnerTag !== walletOwnerTag) {
            await clearBillingUiSessionState(chromeService);

            return null;
        }

        return stored;
    } catch {
        try {
            await clearBillingUiSessionState(chromeService);
        } catch {
            /* ignore secondary storage errors */
        }

        return null;
    }
}

export async function persistBillingUiSessionState(chromeService: ChromeService, state: BillingUiSessionState): Promise<void> {
    await chromeService.setItemSession(BILLING_UI_SESSION_KEY, state);
}

export async function clearBillingUiSessionState(chromeService: ChromeService): Promise<void> {
    await chromeService.removeItemSession(BILLING_UI_SESSION_KEY);
}
