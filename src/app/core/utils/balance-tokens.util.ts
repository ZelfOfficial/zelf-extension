/**
 * Shared helpers for the Home / Wallet balance lists.
 */

import { DEFAULT_NETWORK_CONFIGS } from "app/core/network-settings.util";
import { hasReportedBalance } from "app/core/utils/token-balance.util";
import { tokenNetworkToLicenseId } from "app/core/utils/token-network-id.util";

/**
 * Identity of a balance row: license chain id + token type + symbol.
 * The same chain under different display names ("Ethereum", "Ether", "ETH") collapses.
 * Optimism ETH stays distinct from Ethereum ETH because the chain id differs.
 * A non-native coin that reuses the chain symbol (spam SUI) keeps its own token type.
 */
export function balanceChainIdentityKey(token: any): string {
    const chainId = tokenNetworkToLicenseId(token?.network);
    const symbol = (token?.symbol || "").toString().trim().toUpperCase();
    const name = (token?.name || "").toString().trim().toUpperCase();
    const type = (token?.tokenType || "").toString().trim().toUpperCase();
    const config = DEFAULT_NETWORK_CONFIGS.find((network) => network.id === chainId);
    const nativeSymbol = (config?.symbol || "").toUpperCase();
    const chainName = (config?.name || "").toUpperCase();
    const typeIsNative = !!nativeSymbol && (!type || type === nativeSymbol || type === chainName || type === chainId.toUpperCase());
    const labelIsNative = !!nativeSymbol && (symbol === nativeSymbol || symbol === chainName || name === nativeSymbol || name === chainName);
    const tokenType = typeIsNative && labelIsNative ? nativeSymbol : type;
    const id = symbol || name;

    return `${chainId}|${tokenType}|${id}`;
}

/** One row per chain identity; on duplicates in a single payload keep the higher fiat row. */
export function dedupeBalanceTokens<T = any>(tokens: ReadonlyArray<T> | null | undefined): T[] {
    const byKey = new Map<string, any>();

    for (const token of (tokens || []) as any[]) {
        const key = balanceChainIdentityKey(token);

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
    const byKey = new Map<string, any>();

    for (const token of (loaded || []) as any[]) {
        const key = balanceChainIdentityKey(token);

        if (!byKey.has(key)) byKey.set(key, token);
    }

    for (const token of (incoming || []) as any[]) {
        const key = balanceChainIdentityKey(token);
        const existing = byKey.get(key);

        // A newer reported balance replaces the previous row, including a real 0.
        // A placeholder with no reported amount/fiat must not wipe a balance we already have.
        if (!existing || hasReportedBalance(token) || !hasReportedBalance(existing)) {
            byKey.set(key, token);
        }
    }

    return Array.from(byKey.values());
}

/** Sum of `fiatBalance` over all rows (non-numeric values count as 0). */
export function sumFiatBalance(tokens: ReadonlyArray<any> | null | undefined): number {
    return (tokens || []).reduce((total, token) => total + (parseFloat(token?.fiatBalance) || 0), 0);
}
