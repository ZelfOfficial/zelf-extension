/**
 * LI.FI (li.quest) chain ids.
 * The tokens and quote APIs accept these numbers. The chain key for BNB Smart Chain is `bsc` (56);
 * `BNB` is rejected with 400 and fails the whole `chains` list.
 */

export interface LifiChain {
    chainId: string;
    /** Internal network slug (`settings` id / swap picker network). */
    network: string;
    /** Wallet bucket symbol used by `LifiService.getTokens()`. */
    walletSymbol: string;
}

export const LIFI_CHAINS: readonly LifiChain[] = [
    { chainId: "1", network: "ethereum", walletSymbol: "ETH" },
    { chainId: "10", network: "optimism", walletSymbol: "OP" },
    { chainId: "56", network: "binance", walletSymbol: "BNB" },
    { chainId: "137", network: "polygon", walletSymbol: "POL" },
    { chainId: "8453", network: "base", walletSymbol: "BASE" },
    { chainId: "42161", network: "arbitrum", walletSymbol: "ARB" },
    { chainId: "43114", network: "avalanche", walletSymbol: "AVAX" },
    { chainId: "1151111081099710", network: "solana", walletSymbol: "SOL" },
    { chainId: "9270000000000000", network: "sui", walletSymbol: "SUI" },
    { chainId: "20000000000001", network: "bitcoin", walletSymbol: "BTC" },
];

/** Internal names and LI.FI chain keys that must not be sent as-is (`bnb` is not a LI.FI key). */
const NETWORK_ALIASES: Record<string, string> = {
    ethereum: "1",
    eth: "1",
    optimism: "10",
    opt: "10",
    op: "10",
    binance: "56",
    bnb: "56",
    bsc: "56",
    polygon: "137",
    pol: "137",
    matic: "137",
    base: "8453",
    bas: "8453",
    arbitrum: "42161",
    arb: "42161",
    avalanche: "43114",
    ava: "43114",
    avax: "43114",
    solana: "1151111081099710",
    sol: "1151111081099710",
    sui: "9270000000000000",
    bitcoin: "20000000000001",
    btc: "20000000000001",
};

const BY_CHAIN_ID = new Map(LIFI_CHAINS.map((chain) => [chain.chainId, chain]));

export function lifiTokenCatalogChainIds(): string[] {
    return LIFI_CHAINS.map((chain) => chain.chainId);
}

/** Numeric LI.FI chain id for an internal network, chain key, or chain id. Unsupported networks return null. */
export function lifiChainIdForNetwork(network: string | null | undefined): string | null {
    const key = String(network ?? "")
        .trim()
        .toLowerCase();

    if (!key) return null;

    if (BY_CHAIN_ID.has(key)) return key;

    return NETWORK_ALIASES[key] ?? null;
}

export function lifiNetworkForChainId(chainId: string | number | null | undefined): string | null {
    const id = String(chainId ?? "").trim();

    return BY_CHAIN_ID.get(id)?.network ?? null;
}

/**
 * Maps a LI.FI `/tokens` bucket key (numeric chain id or chain key) to the internal network slug.
 * Unknown keys stay unknown so one bad bucket cannot be treated as a supported chain.
 */
export function lifiBucketKeyToNetwork(bucketKey: string | number): string {
    const raw = String(bucketKey ?? "").trim();

    if (!raw) return "unknown";

    const byId = lifiNetworkForChainId(raw);

    if (byId) return byId;

    const chainId = NETWORK_ALIASES[raw.toLowerCase()];

    if (chainId) return lifiNetworkForChainId(chainId) || "unknown";

    return "unknown";
}

/** Wallet symbol for a response bucket (`56` or `bsc` → `BNB`). */
export function lifiWalletSymbolForChainKey(key: string | number): string | null {
    const raw = String(key ?? "").trim();

    if (!raw) return null;

    const direct = BY_CHAIN_ID.get(raw);

    if (direct) return direct.walletSymbol;

    const chainId = lifiChainIdForNetwork(raw);

    if (!chainId) return null;

    return BY_CHAIN_ID.get(chainId)?.walletSymbol ?? null;
}
