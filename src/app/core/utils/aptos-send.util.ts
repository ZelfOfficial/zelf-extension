/**
 * Native APT sends pay the transfer and the fee from the same balance.
 * The review amount stays the value the user typed unless they picked Max/ALL.
 */

export type AptosSendBlock = "zero_balance" | "exceeds_balance";

function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;

    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());

    return Number.isFinite(n) ? n : null;
}

/**
 * Balance shown on Send. An explicit 0 stays 0 and does not fall through to
 * another field that may hold a raw or unrelated number.
 */
export function readAptBalance(token: { amount?: unknown; balance?: unknown } | null | undefined): number {
    const amount = finiteNumber(token?.amount);

    if (amount !== null) return Math.max(0, amount);

    const balance = finiteNumber(token?.balance);

    return balance !== null ? Math.max(0, balance) : 0;
}

export function readAptSendAmount(amountInput: unknown, amount: unknown): number {
    const typed = finiteNumber(amountInput);

    if (typed !== null) return Math.max(0, typed);

    const fallback = finiteNumber(amount);

    return fallback !== null ? Math.max(0, fallback) : 0;
}

/** Block when the balance is 0, or the amount plus the estimated fee is above it. */
export function aptosSendBlockReason(balance: number, amount: number, fee = 0): AptosSendBlock | null {
    const available = Number.isFinite(balance) ? balance : 0;
    const sending = Number.isFinite(amount) ? amount : 0;
    const gas = Number.isFinite(fee) && fee > 0 ? fee : 0;

    if (available <= 0) return "zero_balance";
    if (sending + gas > available) return "exceeds_balance";

    return null;
}

export function aptosSendErrorKey(reason: AptosSendBlock | null): string | null {
    if (reason === "zero_balance") return "send.aptos_zero_balance";
    if (reason === "exceeds_balance") return "send.aptos_amount_plus_fee";

    return null;
}

function isMaxWord(value: string, allLabel: string): boolean {
    const upper = value.toUpperCase();

    return upper === "ALL" || upper === allLabel.toUpperCase();
}

/**
 * Review headline. "ALL" only when the user picked max.
 * A typed amount stays as entered, even if a fee quote tried to relabel it.
 */
export function reviewSendAmountLabel(options: {
    amount?: unknown;
    amountInput?: string | null;
    sendAll?: boolean;
    allLabel: string;
}): string {
    const allLabel = options.allLabel || "ALL";

    if (options.sendAll === true) return allLabel;

    const typed = String(options.amountInput ?? "").trim();

    if (typed && !isMaxWord(typed, allLabel)) return typed;

    const current = String(options.amount ?? "").trim();

    if (current && !isMaxWord(current, allLabel)) return current;

    return "";
}
