/**
 * Maps token `network` labels (from AssetService.processTokens) to license / settings chain ids.
 */
const TOKEN_NETWORK_TO_LICENSE_ID: Record<string, string> = {
    ethereum: "ethereum",
    ether: "ethereum",
    eth: "ethereum",
    solana: "solana",
    sol: "solana",
    avalanche: "avalanche",
    avax: "avalanche",
    binance: "binance",
    "bnb chain": "binance",
    bsc: "binance",
    bnb: "binance",
    blockdag: "blockdag",
    bdag: "blockdag",
    polygon: "polygon",
    matic: "polygon",
    pol: "polygon",
    optimism: "optimism",
    "op mainnet": "optimism",
    op: "optimism",
    arbitrum: "arbitrum",
    "arbitrum one": "arbitrum",
    arb: "arbitrum",
    base: "base",
    sui: "sui",
    ton: "ton",
    toncoin: "ton",
    aptos: "aptos",
    apt: "aptos",
    polkadot: "polkadot",
    dot: "polkadot",
    kusama: "kusama",
    ksm: "kusama",
    stellar: "stellar",
    xlm: "stellar",
    bitcoin: "bitcoin",
    btc: "bitcoin",
};

/** @returns license chain id, or lowercased label when unknown */
export function tokenNetworkToLicenseId(networkLabel: string | null | undefined): string {
    const key = (networkLabel || "").trim().toLowerCase();

    return TOKEN_NETWORK_TO_LICENSE_ID[key] ?? key;
}

export function filterTokensByEnabledNetworkIds<T extends { network?: string }>(
    tokens: ReadonlyArray<T> | null | undefined,
    enabledNetworkIds: readonly string[] | null | undefined
): T[] {
    if (!enabledNetworkIds?.length) return [...(tokens || [])];

    const allowed = new Set(enabledNetworkIds.map((id) => tokenNetworkToLicenseId(id)));

    return (tokens || []).filter((token) => allowed.has(tokenNetworkToLicenseId(token.network)));
}
