/**
 * Maps token `network` labels (from AssetService.processTokens) to license / settings chain ids.
 */
const TOKEN_NETWORK_TO_LICENSE_ID: Record<string, string> = {
    ethereum: "ethereum",
    solana: "solana",
    avalanche: "avalanche",
    binance: "binance",
    blockdag: "blockdag",
    polygon: "polygon",
    optimism: "optimism",
    arbitrum: "arbitrum",
    base: "base",
    sui: "sui",
    ton: "ton",
    aptos: "aptos",
    polkadot: "polkadot",
    kusama: "kusama",
    stellar: "stellar",
    bitcoin: "bitcoin",
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

    const allowed = new Set(enabledNetworkIds.map((id) => id.toLowerCase()));

    return (tokens || []).filter((token) => allowed.has(tokenNetworkToLicenseId(token.network)));
}
