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
 * Home / Wallet balance loading: these chains load first (one call) to unblock the UI.
 */
export const BALANCE_PRIORITY_NETWORKS: readonly string[] = ["ethereum", "solana"];

/**
 * Home / Wallet balance loading: every other chain in {@link DEFAULT_NETWORK_CONFIGS}, fetched one by one
 * in the background, in this order. Must cover every default network id that is not a priority network,
 * otherwise that chain's balance never loads (Optimism/Arbitrum/Base were missing here before).
 */
export const BALANCE_SECONDARY_NETWORKS: readonly string[] = [
    "avalanche",
    "binance",
    "polygon",
    "optimism",
    "arbitrum",
    "base",
    "bitcoin",
    "sui",
    "ton",
    "aptos",
    "stellar",
    "polkadot",
    "kusama",
    "blockdag",
];

const isNetworkEnabled = (id: string, enabledNetworks?: string[] | null): boolean =>
    !enabledNetworks || enabledNetworks.includes(id);

/** Priority balance networks the user has enabled (all of them when no filter is given). */
export function getPriorityBalanceNetworks(enabledNetworks?: string[] | null): string[] {
    return BALANCE_PRIORITY_NETWORKS.filter((id) => isNetworkEnabled(id, enabledNetworks));
}

/**
 * Background balance networks the user has enabled. Any default network id missing from
 * {@link BALANCE_SECONDARY_NETWORKS} is appended so a newly added chain is never silently skipped.
 */
export function getSecondaryBalanceNetworks(enabledNetworks?: string[] | null): string[] {
    const ordered = [...BALANCE_SECONDARY_NETWORKS];

    for (const { id } of DEFAULT_NETWORK_CONFIGS) {
        if (!BALANCE_PRIORITY_NETWORKS.includes(id) && !ordered.includes(id)) ordered.push(id);
    }

    return ordered.filter((id) => !BALANCE_PRIORITY_NETWORKS.includes(id) && isNetworkEnabled(id, enabledNetworks));
}

/**
 * Chain ids the app supports but `tags.wallet.networks` on the domain license may omit.
 * Merge these into the license allowlist so Manage Networks matches {@link DEFAULT_NETWORK_CONFIGS}.
 */
export const NETWORK_IDS_ENSURED_FROM_LICENSE_GAP: readonly string[] = [
    "stellar",
    "bitcoin",
    "sui",
    "ton",
    "aptos",
    "polkadot",
    "kusama",
    "optimism",
    "arbitrum",
    "base",
];

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
