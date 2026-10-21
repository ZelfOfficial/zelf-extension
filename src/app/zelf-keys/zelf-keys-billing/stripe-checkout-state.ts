import type { PricingPlan } from "../../services/billing.service";

export type StripeCheckoutPhase = "waiting" | "confirmed" | "cancelled" | "failed" | "expired";

export const STRIPE_CHECKOUT_POLL_INTERVAL_MS = 2000;
export const STRIPE_CHECKOUT_MAX_POLL_ATTEMPTS = 60;
export const STRIPE_SUBSCRIPTION_CHECK_MAX_CONSECUTIVE_ERRORS = 3;

export type SubscriptionCheckOutcomeKind = "active" | "not_active" | "retryable_error";

export interface SubscriptionCheckOutcome {
    kind: SubscriptionCheckOutcomeKind;
}

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

export function planCurrencySymbol(currency: string): string {
    const normalized = currency?.toUpperCase() ?? "";

    if (normalized === "USD") return "$";

    return `${normalized} `;
}

export function classifySubscriptionCheckResponse(response: { success?: boolean; data?: unknown } | null | undefined): SubscriptionCheckOutcome {
    if (response?.success && response.data) {
        return { kind: "active" };
    }

    return { kind: "not_active" };
}

export function classifySubscriptionCheckError(error: unknown): SubscriptionCheckOutcome {
    const status = extractHttpStatus(error);

    if (status === 404 || status === 204) {
        return { kind: "not_active" };
    }

    if (status !== undefined && status >= 400 && status < 500) {
        return { kind: "not_active" };
    }

    return { kind: "retryable_error" };
}

export function nextConsecutiveSubscriptionErrors(outcome: SubscriptionCheckOutcome, current: number): number {
    if (outcome.kind === "active" || outcome.kind === "not_active") {
        return 0;
    }

    return current + 1;
}

export function shouldMarkStripeCheckoutFailed(consecutiveErrors: number, maxErrors = STRIPE_SUBSCRIPTION_CHECK_MAX_CONSECUTIVE_ERRORS): boolean {
    return consecutiveErrors >= maxErrors;
}

function extractHttpStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;

    const candidate = error as { status?: number; statusCode?: number; error?: { status?: number; statusCode?: number } };

    if (typeof candidate.status === "number") return candidate.status;
    if (typeof candidate.statusCode === "number") return candidate.statusCode;
    if (typeof candidate.error?.status === "number") return candidate.error.status;
    if (typeof candidate.error?.statusCode === "number") return candidate.error.statusCode;

    return undefined;
}
