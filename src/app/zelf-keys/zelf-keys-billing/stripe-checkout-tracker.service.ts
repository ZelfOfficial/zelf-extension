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
    classifySubscriptionCheckError,
    classifySubscriptionCheckResponse,
    nextConsecutiveSubscriptionErrors,
    nextPhaseAfterPollAttempt,
    shouldMarkStripeCheckoutFailed,
    shouldStopStripeCheckoutPolling,
    STRIPE_CHECKOUT_POLL_INTERVAL_MS,
    type StripeCheckoutPhase,
    type StripeCheckoutSnapshot,
} from "./stripe-checkout-state";

@Injectable({
    providedIn: "root",
})
export class StripeCheckoutTrackerService implements OnDestroy {
    private _consecutiveCheckErrors = 0;
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
        this._consecutiveCheckErrors = 0;

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
        this._consecutiveCheckErrors = 0;

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

        if (snapshot.phase === "expired" || snapshot.phase === "failed") {
            await this._resumeWaitingFromStalePhase();
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

    async abandonCheckoutForNavigation(): Promise<void> {
        this.stopPolling();
        this._consecutiveCheckErrors = 0;

        if (!this._session) return;

        this._session = { ...this._session, stripeCheckout: null };
        await persistBillingUiSessionState(this._chromeService, this._session);
        this._snapshot$.next(null);
    }

    async retryStripeCheckoutForSamePlan(): Promise<void> {
        const planId = this._snapshot$.value?.planId;
        const plan = this._session?.plans.find((entry) => entry.id === planId);

        if (!plan || !this._session || !planId) return;

        const response = await this._billingService.createCheckoutSession(planId);

        if (!response.success || !response.checkoutUrl || !response.sessionId) {
            await this._updateStripePhase("failed");
            this.stopPolling();

            return;
        }

        await this.beginCheckout({
            checkoutUrl: response.checkoutUrl,
            sessionId: response.sessionId,
            plan,
            sessionBase: {
                plans: this._session.plans,
                currentPlan: this._session.currentPlan,
                hasActiveSubscription: this._session.hasActiveSubscription,
                activeSubscription: this._session.activeSubscription,
                showCryptoPayment: this._session.showCryptoPayment,
                cryptoPayment: this._session.cryptoPayment,
                walletOwnerTag: this._session.walletOwnerTag,
            },
        });

        await this._chromeService.openExternalUrl(response.checkoutUrl);
    }

    async continueAfterSuccess(): Promise<void> {
        await finalizeBillingUiAfterSubscriptionSuccess(this._chromeService);
        this._session = null;
        this._snapshot$.next(null);
        this.stopPolling();
        this._consecutiveCheckErrors = 0;
    }

    private async _resumeWaitingFromStalePhase(): Promise<void> {
        await this._updateStripePhase("waiting", 0);
        this._consecutiveCheckErrors = 0;
        this.startPolling();
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
        const currentPhase = this._snapshot$.value?.phase ?? "waiting";

        if (currentPhase !== "waiting" && currentPhase !== "expired") return;

        try {
            const response = await this._billingService.getActiveSubscription();
            await this._applySubscriptionOutcome(classifySubscriptionCheckResponse(response), currentPhase);
        } catch (error) {
            await this._applySubscriptionOutcome(classifySubscriptionCheckError(error), currentPhase);
        }
    }

    private async _applySubscriptionOutcome(
        outcome: ReturnType<typeof classifySubscriptionCheckResponse>,
        currentPhase: StripeCheckoutPhase
    ): Promise<void> {
        this._consecutiveCheckErrors = nextConsecutiveSubscriptionErrors(outcome, this._consecutiveCheckErrors);

        if (outcome.kind === "active") {
            await this._updateStripePhase("confirmed");
            this.stopPolling();
            this._consecutiveCheckErrors = 0;

            return;
        }

        if (shouldMarkStripeCheckoutFailed(this._consecutiveCheckErrors)) {
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
