/**
 * Maps EVM chainId values to backend RPC proxy path keys (`/api/protected/rpc/:chainKey` and `/api/rpc/:chainKey`).
 */
export const CHAIN_KEY_BY_CHAIN_ID: Readonly<Record<number, string>> = {
    1: "ethereum",
    10: "optimism",
    56: "bsc",
    137: "polygon",
    8453: "base",
    42161: "arbitrum",
    43114: "avalanche",
    1404: "blockdag",
    11155111: "sepolia",
};

const CHAIN_KEY_BY_NETWORK: Readonly<Record<string, string>> = {
    ethereum: "ethereum",
    sepolia: "sepolia",
    "ethereum-sepolia": "sepolia",
    polygon: "polygon",
    avalanche: "avalanche",
    bsc: "bsc",
    binance: "bsc",
    arbitrum: "arbitrum",
    optimism: "optimism",
    base: "base",
    blockdag: "blockdag",
};

export function getChainKeyFromChainId(chainId: number): string | null {
    if (!Number.isFinite(chainId)) return null;
    return CHAIN_KEY_BY_CHAIN_ID[chainId] ?? null;
}

export function getChainKeyFromNetwork(network?: string | null): string | null {
    if (!network) return null;

    return CHAIN_KEY_BY_NETWORK[network.trim().toLowerCase()] ?? null;
}

/**
 * Chains where asset sends must use JWT + `/api/protected/rpc/:chainKey` (no silent direct RPC fallback).
 * Aligns with server `EXTENSION_*_RPC_URL` tracking.
 */
/**
 * Chains that never fall back to a URL shipped in the extension.
 * BlockDAG's public scan hosts are retired, so its RPC stays on the Zelf API proxy.
 */
export const STRICT_PROTECTED_RPC_CHAIN_KEYS = new Set<string>(["ethereum", "sepolia", "bsc", "polygon", "avalanche", "blockdag"]);

/** When `false`, RpcProviderService must not fall back to direct env RPC (session required). */
export function allowDirectFallbackForChainKey(chainKey: string): boolean {
    return !STRICT_PROTECTED_RPC_CHAIN_KEYS.has(chainKey);
}

/** Unknown chainIds stay permissive so other flows keep optional fallback. */
export function allowDirectFallbackForChainId(chainId: number): boolean {
    const key = getChainKeyFromChainId(chainId);
    if (!key) return true;
    return allowDirectFallbackForChainKey(key);
}
