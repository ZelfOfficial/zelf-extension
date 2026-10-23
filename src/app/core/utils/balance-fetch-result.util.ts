/** Marker for a balance call that failed, timed out, or was rate-limited. Not an API balance of 0. */
export const BALANCE_FETCH_FAILED = "__balanceFetchFailed";

export type BalanceFetchFailureReason = "timeout" | "error" | "rate_limited";

export interface BalanceFetchFailure {
    [BALANCE_FETCH_FAILED]: true;
    reason: BalanceFetchFailureReason;
    detail: string;
}

export function balanceFailureReasonFromError(error: unknown): BalanceFetchFailureReason {
    const err = error as { status?: number; statusCode?: number; message?: string; response?: { status?: number } } | null;
    const status = err?.status || err?.statusCode || err?.response?.status;
    const message = String(err?.message || error || "").toLowerCase();

    if (status === 429 || message.includes("rate")) return "rate_limited";
    if (message.includes("timeout") || message.includes("timed out")) return "timeout";

    return "error";
}

export function balanceFetchFailure(reason: BalanceFetchFailureReason, detail = ""): BalanceFetchFailure {
    return { [BALANCE_FETCH_FAILED]: true, reason, detail };
}

export function failedBalanceFetch(error: unknown): BalanceFetchFailure {
    const detail = error instanceof Error ? error.message : String(error || "");

    return balanceFetchFailure(balanceFailureReasonFromError(error), detail);
}

export function isBalanceFetchFailure(value: unknown): value is BalanceFetchFailure {
    return !!value && typeof value === "object" && (value as BalanceFetchFailure)[BALANCE_FETCH_FAILED] === true;
}

/** True when this chain's payload is missing or is a failure marker, so it must not be stored as 0. */
export function balancePayloadFailed(response: any, networkId: string): boolean {
    if (!response || typeof response !== "object" || Array.isArray(response)) return true;

    const payload = response[networkId];

    if (isBalanceFetchFailure(payload)) return true;

    return payload == null;
}
