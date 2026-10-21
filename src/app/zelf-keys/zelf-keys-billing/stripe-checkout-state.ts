import type { PricingPlan } from "../../services/billing.service";

export type StripeCheckoutPhase = "waiting" | "confirmed" | "cancelled" | "failed" | "expired";

export const STRIPE_CHECKOUT_POLL_INTERVAL_MS = 2000;
export const STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS = 60;

export interface StripeCheckoutSnapshot {
    checkoutUrl: string;
    phase: StripeCheckoutPhase;
    planCurrency: string;
    planId: string;
    planInterval: string;
    planName: string;
    planPrice: number;
    pollAttempts: number;
    sessionId: string;
    startedAt: number;
}

export function buildStripeCheckoutSnapshot(input: {
    checkoutUrl: string;
    plan: Pick<PricingPlan, "id" | "name" | "price" | "currency" | "interval">;
    sessionId: string;
    phase?: StripeCheckoutPhase;
    pollAttempts?: number;
    startedAt?: number;
}): StripeCheckoutSnapshot {
    return {
        sessionId: input.sessionId,
        checkoutUrl: input.checkoutUrl,
        planId: input.plan.id,
        planName: input.plan.name,
        planPrice: input.plan.price,
        planCurrency: input.plan.currency,
        planInterval: input.plan.interval,
        phase: input.phase ?? "waiting",
        pollAttempts: input.pollAttempts ?? 0,
        startedAt: input.startedAt ?? Date.now(),
    };
}

export function isStripeCheckoutFinalPhase(phase: StripeCheckoutPhase): boolean {
    return phase === "confirmed" || phase === "cancelled" || phase === "failed";
}

export function shouldStopStripeCheckoutPolling(phase: StripeCheckoutPhase): boolean {
    return isStripeCheckoutFinalPhase(phase) || phase === "expired";
}

export function shouldRestoreStripeCheckoutRoute(phase: StripeCheckoutPhase | undefined): boolean {
    return phase === "waiting" || phase === "expired";
}

export function nextPhaseAfterSubscriptionCheck(hasActiveSubscription: boolean, current: StripeCheckoutPhase): StripeCheckoutPhase {
    if (hasActiveSubscription) return "confirmed";
    return current === "expired" ? "expired" : "waiting";
}

export function nextPhaseAfterPollAttempt(attempts: number, current: StripeCheckoutPhase): StripeCheckoutPhase {
    if (current !== "waiting") return current;
    if (attempts >= STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS) return "expired";

    return "waiting";
}

export function formatPlanPriceLine(snapshot: StripeCheckoutSnapshot): string {
    const currency = snapshot.planCurrency?.toUpperCase() === "USD" ? "$" : `${snapshot.planCurrency} `;

    return `${currency}${snapshot.planPrice}/${snapshot.planInterval}`;
}
