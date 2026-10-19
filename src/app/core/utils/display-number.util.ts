/**
 * Display-only number formatting (Miguel, 2026-10-19): balances, amounts, fiat values and prices show at most
 * 4 decimals. Non-zero values below 0.0001 show as "<0.0001" / "<$0.0001" so they never look like 0.
 * Never use these for send inputs or calculations; they return strings for the UI only.
 */

export const DISPLAY_MAX_DECIMALS = 4;
export const DISPLAY_MIN_VALUE = 0.0001;

export type DisplayRounding = "round" | "floor";

export interface DisplayAmountOptions {
    /** Minimum fraction digits (default 0: 4.0001, 3.0494, 1,652.9, 0). */
    minDecimals?: number;
    /** "floor" never shows more than the real value (e.g. available-to-send). Default "round". */
    rounding?: DisplayRounding;
}

const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
};

const applyRounding = (n: number, rounding: DisplayRounding): number => {
    if (rounding !== "floor") return n;
    const factor = 10 ** DISPLAY_MAX_DECIMALS;
    // tiny epsilon so 0.3 * 1e4 = 2999.9999999 doesn't floor to 0.2999
    return (n < 0 ? -1 : 1) * (Math.floor(Math.abs(n) * factor + 1e-9) / factor);
};

const format = (n: number, minDecimals: number, currency: boolean): string =>
    n.toLocaleString("en-US", {
        ...(currency ? { style: "currency", currency: "USD" } : {}),
        minimumFractionDigits: Math.min(minDecimals, DISPLAY_MAX_DECIMALS),
        maximumFractionDigits: DISPLAY_MAX_DECIMALS,
    });

/** Token amount for display: "0.0003", "3.0494", "1,652.9", "0", "<0.0001". Returns "" for null/invalid. */
export function formatDisplayAmount(value: unknown, options: DisplayAmountOptions = {}): string {
    const n = toNumber(value);
    if (n === null) return "";
    if (n !== 0 && Math.abs(n) < DISPLAY_MIN_VALUE) return n < 0 ? "-<0.0001" : "<0.0001";
    const shown = applyRounding(n, options.rounding ?? "round");
    return format(Object.is(shown, -0) ? 0 : shown, options.minDecimals ?? 0, false);
}

/** USD value or price for display: "$2.9768", "$0.7009", "$0.00", "<$0.0001", "$81,914.76". Returns "" for null/invalid. */
export function formatDisplayFiat(value: unknown, options: { minDecimals?: number } = {}): string {
    const n = toNumber(value);
    if (n === null) return "";
    if (n !== 0 && Math.abs(n) < DISPLAY_MIN_VALUE) return n < 0 ? "-<$0.0001" : "<$0.0001";
    return format(n, options.minDecimals ?? 2, true);
}
