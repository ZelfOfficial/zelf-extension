/**
 * Helpers for the Activity / Recent transactions list (v3 #270).
 */

type TxLike = {
    hash?: string;
    from?: string | string[];
    date?: string | number;
    timestamp?: string | number;
    timeStamp?: string | number;
    blocktime?: string | number;
    blockTime?: string | number;
    created_at?: string | number;
    timestampMs?: string | number;
    traffic?: string;
    method?: string;
};

const ZERO_HASH = /^(0x)?0+$/i;

/**
 * Normalises the different date shapes the network APIs return into epoch milliseconds.
 * - numbers / numeric strings below 1e12 are unix seconds (TON, EVM, ...),
 *   between 1e14 and 1e17 are microseconds (Aptos), >= 1e17 are nanoseconds, otherwise milliseconds
 * - other strings go through Date.parse ("2026-09-30 19:15:09", ISO, ...)
 * Returns null for missing or unparsable values such as "N/A".
 */
export function transactionTimestampMs(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;

    const numeric = typeof value === "number" ? value : /^\d+(\.\d+)?$/.test(String(value).trim()) ? Number(value) : NaN;

    if (Number.isFinite(numeric)) {
        if (numeric <= 0) return null;
        if (numeric < 1e12) return Math.round(numeric * 1000);
        if (numeric >= 1e17) return Math.round(numeric / 1e6);
        if (numeric >= 1e14) return Math.round(numeric / 1000);

        return Math.round(numeric);
    }

    if (typeof value !== "string") return null;

    // "2026-09-30 19:15:09" is not ISO for every engine; make it so.
    const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value.trim()) ? value.trim().replace(" ", "T") : value.trim();
    const parsed = Date.parse(normalised);

    return Number.isFinite(parsed) ? parsed : null;
}

/** Best timestamp for a transaction: `date`, falling back across known provider timestamp fields. */
export function transactionTime(tx: TxLike): number | null {
    return (
        transactionTimestampMs(tx?.date) ??
        transactionTimestampMs(tx?.timestamp) ??
        transactionTimestampMs(tx?.timeStamp) ??
        transactionTimestampMs(tx?.blocktime) ??
        transactionTimestampMs(tx?.blockTime) ??
        transactionTimestampMs(tx?.created_at) ??
        transactionTimestampMs(tx?.timestampMs)
    );
}

/**
 * The history API sets this when every upstream for that chain failed.
 * An empty transaction list on its own means the address has no rows.
 */
export function historyRefreshFailed(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;

    const root = payload as Record<string, any>;
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
    const code = String(data.error || data.clientCode || "").toUpperCase();

    return data.transactionsUnavailable === true || code === "HISTORY_UNAVAILABLE";
}

/**
 * Filters out entries that are not real transactions: backend error placeholders
 * (zero hash / traffic "ERROR" / method "Error"), and rows without sender or a usable date.
 * Rendering those used to throw in the date pipe (NG02100) and could leave the list blank.
 */
export function isDisplayableTransaction(tx: TxLike | null | undefined): boolean {
    if (!tx) return false;

    const hash = (tx.hash || "").toString().trim();
    if (!hash || ZERO_HASH.test(hash)) return false;

    if ((tx.traffic || "").toString().toUpperCase() === "ERROR") return false;
    if ((tx.method || "").toString().toLowerCase() === "error") return false;

    const from = Array.isArray(tx.from) ? tx.from[0] : tx.from;
    if (!from) return false;

    return transactionTime(tx) !== null;
}
