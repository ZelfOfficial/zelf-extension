import { NetworkConfig } from "app/models/settings.model";

/** Canonical list; keep in sync with BlockchainTransactionsService chain ids. */
export const DEFAULT_NETWORK_CONFIGS: NetworkConfig[] = [
    { id: "ethereum", name: "Ethereum", symbol: "ETH", enabled: true },
    { id: "avalanche", name: "Avalanche", symbol: "AVAX", enabled: true },
    { id: "binance", name: "BNB Chain", symbol: "BNB", enabled: true },
    { id: "bitcoin", name: "Bitcoin", symbol: "BTC", enabled: true },
    { id: "blockdag", name: "BlockDAG", symbol: "BDAG", enabled: true },
    { id: "polygon", name: "Polygon", symbol: "POL", enabled: true },
    { id: "optimism", name: "Optimism", symbol: "ETH", enabled: true },
    { id: "arbitrum", name: "Arbitrum", symbol: "ETH", enabled: true },
    { id: "base", name: "Base", symbol: "ETH", enabled: true },
    { id: "solana", name: "Solana", symbol: "SOL", enabled: true },
    { id: "stellar", name: "Stellar", symbol: "XLM", enabled: true },
    { id: "sui", name: "Sui", symbol: "SUI", enabled: true },
    { id: "ton", name: "TON", symbol: "TON", enabled: true },
    { id: "aptos", name: "Aptos", symbol: "APT", enabled: true },
    { id: "polkadot", name: "Polkadot", symbol: "DOT", enabled: true },
    { id: "kusama", name: "Kusama", symbol: "KSM", enabled: true },
];

/**
 * Chain ids the extension can talk to. This is a capability catalog only: which chains a user
 * actually sees is decided by the domain license (`tags.wallet.networks`), see
 * {@link getLicenseWalletNetworkIds}.
 */
export const SUPPORTED_NETWORK_IDS: readonly string[] = DEFAULT_NETWORK_CONFIGS.map((n) => n.id);

/** Minimal license shape we read: `tags.wallet.networks = { [chainId]: { enabled } }`, set by the license admin. */
export interface LicenseWithWalletNetworks {
    tags?: { wallet?: { networks?: Record<string, { enabled?: boolean } | null | undefined> } };
}

/**
 * Wallet chain ids the license administrator enabled, in license order, limited to chains this
 * build supports. Returns null when the license has no wallet network config (nothing to apply).
 */
export function getLicenseWalletNetworkIds(license: LicenseWithWalletNetworks | null | undefined): string[] | null {
    const networks = license?.tags?.wallet?.networks;

    if (!networks || typeof networks !== "object") return null;

    return Object.entries(networks)
        .filter(([id, cfg]) => !!cfg?.enabled && SUPPORTED_NETWORK_IDS.includes(id))
        .map(([id]) => id);
}

/**
 * Chains to show/fetch: the license allowlist minus chains the user switched off in Manage networks.
 * - licenseIds null (license never loaded): legacy behaviour, the user's toggles or no filter.
 * - user switched every licensed chain off: same as legacy "all off" = the full license list.
 */
export function resolveEnabledNetworkIds(
    licenseIds: readonly string[] | null,
    userNetworks?: NetworkConfig[] | null
): string[] | undefined {
    const userOff = new Set((userNetworks || []).filter((n) => n && n.enabled === false).map((n) => n.id));

    if (!licenseIds) {
        if (!userNetworks?.length) return undefined;

        const ids = userNetworks.filter((n) => n.enabled).map((n) => n.id);

        return ids.length ? ids : undefined;
    }

    const ids = licenseIds.filter((id) => !userOff.has(id));

    return ids.length ? ids : [...licenseIds];
}

/** How many background networks Home / Wallet fetch at the same time after the priority stage (v3 #263). */
export const BACKGROUND_BALANCE_CONCURRENCY = 4;

/**
 * Home / Wallet load balances in two stages: the first `priorityCount` chains (license order) in one
 * call to unblock the UI, then the rest in the background (BACKGROUND_BALANCE_CONCURRENCY at a time).
 */
export function splitBalanceStages(networkIds: readonly string[], priorityCount = 2): { priority: string[]; background: string[] } {
    const ids = [...new Set(networkIds)];

    return { priority: ids.slice(0, priorityCount), background: ids.slice(priorityCount) };
}

/**
 * Merge saved toggles into defaults so new chains (e.g. stellar) appear enabled
 * for users whose stored settings predate them.
 */
export function mergeNetworkSettings(saved: NetworkConfig[] | undefined | null): NetworkConfig[] {
    if (!Array.isArray(saved) || !saved.length) {
        return DEFAULT_NETWORK_CONFIGS.map((n) => ({ ...n }));
    }

    return DEFAULT_NETWORK_CONFIGS.map((def) => {
        const existing = saved.find((s) => s.id === def.id);

        return existing ? { ...def, ...existing } : { ...def };
    });
}

/** True when persisted list is missing any default network id (needs re-save). */
export function shouldPersistNetworkMerge(saved: NetworkConfig[] | undefined | null, merged: NetworkConfig[]): boolean {
    if (!Array.isArray(saved) || !saved.length) {
        return merged.length > 0;
    }

    const savedIds = new Set(saved.map((n) => n.id));

    return DEFAULT_NETWORK_CONFIGS.some((d) => !savedIds.has(d.id));
}
