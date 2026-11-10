/**
 * Native APT sends pay the transfer and the fee from the same balance.
 * Comparisons use integer octas (1 APT = 1e8) so exact covers do not fail on float noise.
 * Max/ALL sends the balance minus the fee. The review amount stays the typed value unless the user picked max.
 */

export type AptosSendBlock = "zero_balance" | "exceeds_balance";

const OCTAS_PER_APT = 100_000_000n;
const APT_DECIMALS = 8;

function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;

    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());

    return Number.isFinite(n) ? n : null;
}

/** Decimal APT to octas. Zero and invalid values are 0. Extra decimals round at the 8th place. */
export function aptToOctasExact(value: unknown): bigint {
    if (typeof value === "bigint") return value > 0n ? value : 0n;

    let text: string;

    if (typeof value === "number") {
        if (!Number.isFinite(value) || value <= 0) return 0n;
        text = value.toFixed(APT_DECIMALS);
    } else {
        text = String(value ?? "").replace(/,/g, "").trim();
        if (!text || text.startsWith("-")) return 0n;
        if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
            const n = Number(text);
            if (!Number.isFinite(n) || n <= 0) return 0n;
            text = n.toFixed(APT_DECIMALS);
        }
    }

    const [whole, fraction = ""] = text.split(".");
    const head = (fraction + "0".repeat(APT_DECIMALS)).slice(0, APT_DECIMALS);
    let octas = BigInt(whole || "0") * OCTAS_PER_APT + BigInt(head || "0");

    if (fraction.length > APT_DECIMALS && fraction[APT_DECIMALS] >= "5") octas += 1n;

    return octas;
}

export function formatAptOctas(octas: bigint): string {
    if (octas <= 0n) return "0";

    const whole = octas / OCTAS_PER_APT;
    const frac = octas % OCTAS_PER_APT;

    if (frac === 0n) return whole.toString();

    const fracText = frac.toString().padStart(APT_DECIMALS, "0").replace(/0+$/, "");

    return `${whole}.${fracText}`;
}

/** Balance minus fee, as a decimal APT string. Null when the fee leaves nothing to send. */
export function aptRemainder(balance: unknown, fee: unknown): string | null {
    const available = aptToOctasExact(balance);
    const gas = aptToOctasExact(fee);

    if (available <= gas) return null;

    return formatAptOctas(available - gas);
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

export function readAptSendAmount(amountInput: unknown, amount: unknown, sendAll = false): number {
    if (sendAll) {
        const adjusted = finiteNumber(amount);

        if (adjusted !== null) return Math.max(0, adjusted);
    }

    const typed = finiteNumber(amountInput);

    if (typed !== null) return Math.max(0, typed);

    const fallback = finiteNumber(amount);

    return fallback !== null ? Math.max(0, fallback) : 0;
}

/**
 * Block when the balance is 0, or the amount plus the fee is above it.
 * Max/ALL is affordable when the balance is greater than the fee: the transfer is balance minus fee.
 * A fee of 0 here means "no fee applied yet", not a failed quote. Callers treat a failed quote on their own.
 */
export function aptosSendBlockReason(balance: number | string, amount: number | string, fee: number | string = 0, sendAll = false): AptosSendBlock | null {
    const available = aptToOctasExact(balance);

    if (available <= 0n) return "zero_balance";

    const gas = aptToOctasExact(fee);

    if (sendAll) return available > gas ? null : "exceeds_balance";

    const sending = aptToOctasExact(amount);

    if (sending + gas > available) return "exceeds_balance";

    return null;
}

export function aptosSendErrorKey(reason: AptosSendBlock | null): string | null {
    if (reason === "zero_balance") return "send.aptos_zero_balance";
    if (reason === "exceeds_balance") return "send.aptos_amount_plus_fee";

    return null;
}

/** A quote that returned 0 or a non-number did not produce a usable fee. */
export function aptosFeeQuoteFailed(fee: unknown): boolean {
    const n = typeof fee === "number" ? fee : Number(fee);

    return !Number.isFinite(n) || n <= 0;
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
