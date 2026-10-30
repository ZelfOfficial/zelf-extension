/**
 * Display-only number formatting.
 * Token amounts show at most 5 decimals. Non-zero values below 0.00001 show as "<0.00001"
 * so they never look like 0. USD values and prices stay at most 4 decimals, with "<$0.0001" for dust.
 * Never use these for send inputs or calculations; they return strings for the UI only.
 */

export const DISPLAY_AMOUNT_MAX_DECIMALS = 5;
export const DISPLAY_AMOUNT_MIN_VALUE = 0.00001;

export const DISPLAY_FIAT_MAX_DECIMALS = 4;
export const DISPLAY_FIAT_MIN_VALUE = 0.0001;

export type DisplayRounding = "round" | "floor";

export interface DisplayAmountOptions {
    /** Minimum fraction digits (default 0: 4.00011, 3.04945, 1,652.90001, 0). */
    minDecimals?: number;
    /** "floor" never shows more than the real value (e.g. available-to-send). Default "round". */
    rounding?: DisplayRounding;
}

const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
};

const applyRounding = (n: number, rounding: DisplayRounding, maxDecimals: number): number => {
    if (rounding !== "floor") return n;
    const factor = 10 ** maxDecimals;
    // tiny epsilon so binary fractions such as 0.3 * 1e5 don't floor a digit short
    return (n < 0 ? -1 : 1) * (Math.floor(Math.abs(n) * factor + 1e-9) / factor);
};

const format = (n: number, minDecimals: number, maxDecimals: number, currency: boolean): string =>
    n.toLocaleString("en-US", {
        ...(currency ? { style: "currency", currency: "USD" } : {}),
        minimumFractionDigits: Math.min(minDecimals, maxDecimals),
        maximumFractionDigits: maxDecimals,
    });

const dustLabel = (minValue: number, maxDecimals: number, currency: boolean): string => {
    const body = minValue.toLocaleString("en-US", {
        ...(currency ? { style: "currency", currency: "USD" } : {}),
        minimumFractionDigits: maxDecimals,
        maximumFractionDigits: maxDecimals,
    });

    return `<${body}`;
};

/** Token amount for display: "0.00029", "3.04945", "1,652.90001", "0", "<0.00001". Returns "" for null/invalid. */
export function formatDisplayAmount(value: unknown, options: DisplayAmountOptions = {}): string {
    const n = toNumber(value);
    if (n === null) return "";
    if (n !== 0 && Math.abs(n) < DISPLAY_AMOUNT_MIN_VALUE) {
        const label = dustLabel(DISPLAY_AMOUNT_MIN_VALUE, DISPLAY_AMOUNT_MAX_DECIMALS, false);
        return n < 0 ? `-${label}` : label;
    }
    const shown = applyRounding(n, options.rounding ?? "round", DISPLAY_AMOUNT_MAX_DECIMALS);
    return format(Object.is(shown, -0) ? 0 : shown, options.minDecimals ?? 0, DISPLAY_AMOUNT_MAX_DECIMALS, false);
}

/** USD value or price for display: "$2.9768", "$0.7009", "$0.00", "<$0.0001", "$81,914.76". Returns "" for null/invalid. */
export function formatDisplayFiat(value: unknown, options: { minDecimals?: number } = {}): string {
    const n = toNumber(value);
    if (n === null) return "";
    if (n !== 0 && Math.abs(n) < DISPLAY_FIAT_MIN_VALUE) {
        const label = dustLabel(DISPLAY_FIAT_MIN_VALUE, DISPLAY_FIAT_MAX_DECIMALS, true);
        return n < 0 ? `-${label}` : label;
    }
    return format(n, options.minDecimals ?? 2, DISPLAY_FIAT_MAX_DECIMALS, true);
}
