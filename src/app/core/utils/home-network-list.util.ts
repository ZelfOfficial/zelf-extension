import { DEFAULT_NETWORK_CONFIGS } from "app/core/network-settings.util";
import { dedupeBalanceTokens } from "app/core/utils/balance-tokens.util";
import { filterTokensByEnabledNetworkIds, tokenNetworkToLicenseId } from "app/core/utils/token-network-id.util";

/** License / settings chain ids, de-duplicated by chain identity, original order kept. */
export function uniqueChainIds(ids: readonly string[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    for (const raw of ids || []) {
        const id = tokenNetworkToLicenseId(raw);

        if (!id || seen.has(id)) continue;

        seen.add(id);
        out.push(id);
    }

    return out;
}

/** A row for an enabled chain that has not reported a balance yet. Amount stays null so the UI does not show a fake 0. */
export function nativeNetworkPlaceholder(chainId: string): {
    symbol: string;
    name: string;
    network: string;
    tokenType: string;
    amount: null;
    balance: null;
    fiatBalance: null;
    price: null;
} {
    const config = DEFAULT_NETWORK_CONFIGS.find((network) => network.id === chainId);
    const symbol = config?.symbol || chainId.toUpperCase();
    const name = config?.name || chainId;

    return {
        symbol,
        name,
        network: name,
        tokenType: symbol,
        amount: null,
        balance: null,
        fiatBalance: null,
        price: null,
    };
}

/**
 * Home / Wallet asset list:
 * - one row per chain identity (display-name duplicates collapse)
 * - only chains the license/user enabled, when that list is known
 * - a placeholder for every enabled chain that has no row yet, so toggling a network on shows it
 */
export function projectHomeNetworkTokens<T extends { network?: string }>(
    tokens: ReadonlyArray<T> | null | undefined,
    enabledNetworkIds: readonly string[] | null | undefined
): T[] {
    const chainIds = enabledNetworkIds?.length ? uniqueChainIds(enabledNetworkIds) : undefined;
    const visible = filterTokensByEnabledNetworkIds(dedupeBalanceTokens(tokens), chainIds);

    if (!chainIds?.length) return visible;

    const present = new Set(visible.map((token) => tokenNetworkToLicenseId(token.network)));
    const placeholders = chainIds.filter((id) => !present.has(id)).map((id) => nativeNetworkPlaceholder(id) as unknown as T);

    return [...visible, ...placeholders];
}
