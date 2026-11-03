/**
 * Public Blockscout explorers for BlockDAG mainnet (chain 1404).
 * api.bdagscan.com answers 403/530 from the Zelf API host, and that failure used to
 * come back as an empty history. These explorers stay synced with the chain head.
 */
export const BLOCKDAG_BLOCKSCOUT_EXPLORERS = [
    "https://explorer.east.bdag-us.org",
    "https://explorer.west.bdag-us.org",
    "https://explorer.brazil.bdag-us.org",
];

export interface BlockdagHistoryPage {
    data: {
        pagination: { records: string; pages: string; page: string; hasNextPage: boolean };
        hasNextPage: boolean;
        source: "blockscout";
        transactions: Record<string, unknown>[];
    };
}

const blockscoutAddress = (field: unknown): string => {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (typeof field === "object" && field && "hash" in field) return String((field as { hash?: unknown }).hash || "");
    return "";
};

const formatWei = (wei: unknown): string => {
    try {
        const value = BigInt(String(wei || "0"));
        const negative = value < 0n;
        const absolute = negative ? -value : value;
        const base = 10n ** 18n;
        const whole = absolute / base;
        const fraction = (absolute % base).toString().padStart(18, "0").replace(/0+$/, "");
        const text = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
        return negative ? `-${text}` : text;
    } catch {
        return "0";
    }
};

const calendarDate = (timestampSeconds: number): string => {
    const iso = new Date(timestampSeconds * 1000).toISOString();
    return iso.slice(0, 19).replace("T", " ");
};

export function mapBlockscoutTransaction(tx: Record<string, any>, address: string): Record<string, unknown> {
    const from = blockscoutAddress(tx?.from) || address;
    const to = blockscoutAddress(tx?.to) || address;
    const parsed = Date.parse(String(tx?.timestamp || ""));
    const timestamp = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
    const outgoing = from.toLowerCase() === String(address).toLowerCase();

    return {
        hash: tx?.hash || "",
        method: tx?.method || (tx?.raw_input && tx.raw_input !== "0x" ? "Contract" : "Transfer"),
        block: tx?.block_number || tx?.block || "N/A",
        date: timestamp ? calendarDate(timestamp) : "",
        timestamp,
        from,
        to,
        traffic: outgoing ? "OUT" : "IN",
        amount: formatWei(tx?.value),
        asset: "BDAG",
        fiatAmount: "0.00",
        txnFee: tx?.fee?.value != null ? formatWei(tx.fee.value) : "0",
        status: tx?.status === "ok" || tx?.result === "success" ? "success" : tx?.status || tx?.result || "success",
    };
}

export function blockscoutHistoryPage(items: Record<string, any>[], address: string, page: number, show: number, hasMore: boolean): BlockdagHistoryPage {
    const start = Math.max(0, page) * show;
    const transactions = items.slice(start, start + show).map((tx) => mapBlockscoutTransaction(tx, address));

    return {
        data: {
            pagination: {
                records: String(transactions.length),
                pages: hasMore ? String(page + 2) : String(page + 1),
                page: String(page),
                hasNextPage: hasMore,
            },
            hasNextPage: hasMore,
            source: "blockscout",
            transactions,
        },
    };
}

/** The Zelf API returned no rows and did not name a source that actually answered. */
export function blockdagHistoryNeedsExplorerFallback(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return true;

    const root = payload as Record<string, any>;
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
    const transactions = Array.isArray(data.transactions) ? data.transactions : Array.isArray(data) ? data : [];

    if (transactions.length) return false;
    if (data.source === "bdagscan" || data.source === "blockscout" || data.source === "rpc") return false;

    return true;
}
