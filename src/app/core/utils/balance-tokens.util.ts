/**
 * Shared helpers for the Home / Wallet balance lists.
 */

/** One row per network + token type + symbol (or name); on duplicates keep the row with the higher fiat value. */
export function dedupeBalanceTokens<T = any>(tokens: ReadonlyArray<T> | null | undefined): T[] {
    const byKey = new Map<string, any>();

    for (const token of (tokens || []) as any[]) {
        const symbol = (token?.symbol || "").toString().trim();
        const name = (token?.name || "").toString().trim();
        const id = (symbol || name).toUpperCase();
        const network = (token?.network || "").toString();
        const tokenType = (token?.tokenType || "").toString();
        const key = `${network}|${tokenType}|${id}`;

        if (!byKey.has(key)) {
            byKey.set(key, token);
            continue;
        }

        const existingFiat = parseFloat(byKey.get(key)?.fiatBalance || "0") || 0;
        const candidateFiat = parseFloat(token?.fiatBalance || "0") || 0;

        if (candidateFiat > existingFiat) byKey.set(key, token);
    }

    return Array.from(byKey.values());
}

/**
 * Add one network's tokens to the tokens already loaded in this view. The merge base is the
 * in-memory list, not session storage: session `tokens` is only a cache and is wiped whenever the
 * stored wallet is rewritten (e.g. the public-data refresh that runs while balances load).
 */
export function mergeBalanceTokens<T = any>(loaded: ReadonlyArray<T> | null | undefined, incoming: ReadonlyArray<T> | null | undefined): T[] {
    return dedupeBalanceTokens([...(loaded || []), ...(incoming || [])]);
}

/** Sum of `fiatBalance` over all rows (non-numeric values count as 0). */
export function sumFiatBalance(tokens: ReadonlyArray<any> | null | undefined): number {
    return (tokens || []).reduce((total, token) => total + (parseFloat(token?.fiatBalance) || 0), 0);
}
