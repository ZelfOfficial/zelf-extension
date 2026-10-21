import { Injectable, OnDestroy } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { BillingService, type PricingPlan } from "app/services/billing.service";
import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";

import {
    buildBillingUiSessionState,
    finalizeBillingUiAfterSubscriptionSuccess,
    loadBillingUiSessionState,
    persistBillingUiSessionState,
    resolveBillingWalletOwnerTag,
    type BillingUiSessionState,
} from "./billing-session-state";
import {
    buildStripeCheckoutSnapshot,
    nextPhaseAfterPollAttempt,
    nextPhaseAfterSubscriptionCheck,
    shouldStopStripeCheckoutPolling,
    STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS,
    STRIPE_CHECKOUT_POLL_INTERVAL_MS,
    type StripeCheckoutPhase,
    type StripeCheckoutSnapshot,
} from "./stripe-checkout-state";

@Injectable({
    providedIn: "root",
})
export class StripeCheckoutTrackerService implements OnDestroy {
    private _pollTimer: ReturnType<typeof setInterval> | null = null;
    private _session: BillingUiSessionState | null = null;
    private _snapshot$ = new BehaviorSubject<StripeCheckoutSnapshot | null>(null);
    private _walletOwnerTag: string | null = null;

    constructor(
        private _billingService: BillingService,
        private _chromeService: ChromeService,
        private _walletService: WalletService
    ) {}

    get snapshot$(): Observable<StripeCheckoutSnapshot | null> {
        return this._snapshot$.asObservable();
    }

    get snapshot(): StripeCheckoutSnapshot | null {
        return this._snapshot$.value;
    }

    ngOnDestroy(): void {
        this.stopPolling();
    }

    async bootstrapFromStorage(): Promise<StripeCheckoutSnapshot | null> {
        await this._refreshWalletTag();
        this._session = await loadBillingUiSessionState(this._chromeService, this._walletOwnerTag);
        const stripe = this._session?.stripeCheckout ?? null;

        this._snapshot$.next(stripe);

        if (stripe && !shouldStopStripeCheckoutPolling(stripe.phase)) {
            this.startPolling();
        }

        return stripe;
    }

    async beginCheckout(input: {
        checkoutUrl: string;
        plan: PricingPlan;
        sessionId: string;
        sessionBase: Omit<BillingUiSessionState, "stripeCheckout" | "savedAt">;
    }): Promise<void> {
        await this._refreshWalletTag();

        const stripeCheckout = buildStripeCheckoutSnapshot({
            sessionId: input.sessionId,
            checkoutUrl: input.checkoutUrl,
            plan: input.plan,
        });

        this._session = buildBillingUiSessionState({
            ...input.sessionBase,
            stripeCheckout,
            walletOwnerTag: this._walletOwnerTag ?? "_none",
        });

        await persistBillingUiSessionState(this._chromeService, this._session);
        this._snapshot$.next(stripeCheckout);
        this.startPolling();
    }

    startPolling(): void {
        const snapshot = this._snapshot$.value;

        if (!snapshot || shouldStopStripeCheckoutPolling(snapshot.phase)) return;

        this.stopPolling();

        this._pollTimer = setInterval(() => {
            void this._pollTick();
        }, STRIPE_CHECKOUT_POLL_INTERVAL_MS);

        void this._pollTick();
    }

    stopPolling(): void {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    async checkNow(): Promise<void> {
        const snapshot = this._snapshot$.value;

        if (!snapshot) return;

        if (snapshot.phase === "expired") {
            await this._updateStripePhase("waiting", 0);
            this.startPolling();
        }

        await this._checkSubscription();
    }

    async reopenCheckoutTab(): Promise<void> {
        const url = this._snapshot$.value?.checkoutUrl;

        if (!url) return;

        await this._chromeService.openExternalUrl(url);
    }

    async markCancelled(): Promise<void> {
        await this._updateStripePhase("cancelled");
        this.stopPolling();
        await this._persistCurrentSession();
    }

    async markFailed(): Promise<void> {
        await this._updateStripePhase("failed");
        this.stopPolling();
        await this._persistCurrentSession();
    }

    async continueAfterSuccess(): Promise<void> {
        await finalizeBillingUiAfterSubscriptionSuccess(this._chromeService);
        this._session = null;
        this._snapshot$.next(null);
        this.stopPolling();
    }

    private async _pollTick(): Promise<void> {
        const snapshot = this._snapshot$.value;

        if (!snapshot || snapshot.phase !== "waiting") return;

        const attempts = snapshot.pollAttempts + 1;
        const phase = nextPhaseAfterPollAttempt(attempts, snapshot.phase);

        await this._updateStripePhase(phase, attempts);

        if (phase === "expired") {
            this.stopPolling();
            return;
        }

        await this._checkSubscription();
    }

    private async _checkSubscription(): Promise<void> {
        try {
            const response = await this._billingService.getActiveSubscription();
            const hasSubscription = Boolean(response.success && response.data);
            const current = this._snapshot$.value?.phase ?? "waiting";
            const next = nextPhaseAfterSubscriptionCheck(hasSubscription, current);

            if (next === "confirmed") {
                await this._updateStripePhase("confirmed");
                this.stopPolling();
            }
        } catch {
            await this._updateStripePhase("failed");
            this.stopPolling();
        }
    }

    private async _updateStripePhase(phase: StripeCheckoutPhase, pollAttempts?: number): Promise<void> {
        const snapshot = this._snapshot$.value;

        if (!snapshot) return;

        const updated: StripeCheckoutSnapshot = {
            ...snapshot,
            phase,
            pollAttempts: pollAttempts ?? snapshot.pollAttempts,
        };

        this._snapshot$.next(updated);

        if (this._session) {
            this._session = { ...this._session, stripeCheckout: updated };
            await persistBillingUiSessionState(this._chromeService, this._session);
        }
    }

    private async _persistCurrentSession(): Promise<void> {
        if (!this._session || !this._snapshot$.value) return;

        this._session = { ...this._session, stripeCheckout: this._snapshot$.value };
        await persistBillingUiSessionState(this._chromeService, this._session);
    }

    private async _refreshWalletTag(): Promise<void> {
        const wallet = await this._walletService.getFirstWalletFromStorage();

        this._walletOwnerTag = resolveBillingWalletOwnerTag(wallet as Partial<TagModel>);
    }
}
