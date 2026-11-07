import { NetworkConfig } from "app/models/settings.model";

/** BlockDAG mainnet. Support ended with no grace period. */
export const BLOCKDAG_NETWORK_ID = "blockdag";
export const BLOCKDAG_CHAIN_ID = 1404;
export const BLOCKDAG_DOMAIN = "bdag";
export const BLOCKDAG_DEPRECATION_CODE = "BDAG_DEPRECATED";
export const BLOCKDAG_NOTICE_STORAGE_KEY = "blockdagSupportNoticeDismissed";
export const BLOCKDAG_SUPPORT_ENDED_KEY = "errors.BDAG_DEPRECATED";

const BLOCKDAG_SYMBOLS = new Set(["BDAG", "BLOCKDAG", "BDAG-20"]);

export function isBlockdagNetworkId(id: string | null | undefined): boolean {
    const normalized = (id || "").trim().toLowerCase();

    return normalized === BLOCKDAG_NETWORK_ID || normalized === BLOCKDAG_DOMAIN;
}

export function isBlockdagDomain(domain: string | null | undefined): boolean {
    return (domain || "").trim().toLowerCase().replace(/^\./, "") === BLOCKDAG_DOMAIN;
}

export function isBlockdagName(name: string | null | undefined): boolean {
    return (name || "").trim().toLowerCase().endsWith(`.${BLOCKDAG_DOMAIN}`);
}

export function isBlockdagToken(token: { network?: string | null; symbol?: string | null; tokenType?: string | null } | null | undefined): boolean {
    if (!token) return false;

    if (isBlockdagNetworkId(token.network)) return true;

    const symbol = (token.symbol || "").toUpperCase();
    const tokenType = (token.tokenType || "").toUpperCase();

    return BLOCKDAG_SYMBOLS.has(symbol) || BLOCKDAG_SYMBOLS.has(tokenType);
}

/** True only when the user already turned BlockDAG on. A missing or off toggle cannot be activated. */
export function userHadBlockdagEnabled(networks: ReadonlyArray<Pick<NetworkConfig, "id" | "enabled">> | null | undefined): boolean {
    return (networks || []).some((network) => isBlockdagNetworkId(network?.id) && network.enabled === true);
}

export function tokenHasBlockdagBalance(token: {
    network?: string | null;
    symbol?: string | null;
    tokenType?: string | null;
    amount?: unknown;
    balance?: unknown;
    fiatBalance?: unknown;
} | null | undefined): boolean {
    if (!isBlockdagToken(token)) return false;

    const amount = Number(token?.amount ?? token?.balance ?? 0);
    const fiat = Number(token?.fiatBalance ?? 0);

    return (Number.isFinite(amount) && amount > 0) || (Number.isFinite(fiat) && fiat > 0);
}

/** Home notice audience: the network was already on, a balance exists, or the wallet name is .bdag. */
export function walletQualifiesForBlockdagNotice(input: {
    networks?: ReadonlyArray<Pick<NetworkConfig, "id" | "enabled">> | null;
    tokens?: ReadonlyArray<{
        network?: string | null;
        symbol?: string | null;
        tokenType?: string | null;
        amount?: unknown;
        balance?: unknown;
        fiatBalance?: unknown;
    }> | null;
    domain?: string | null;
    tagName?: string | null;
}): boolean {
    if (userHadBlockdagEnabled(input.networks)) return true;
    if (isBlockdagDomain(input.domain) || isBlockdagName(input.tagName)) return true;

    return (input.tokens || []).some((token) => tokenHasBlockdagBalance(token));
}

/** Drop BlockDAG from a resolved chain list unless this wallet already had it enabled. Keep it when it was. */
export function applyBlockdagNetworkVisibility(ids: readonly string[], userNetworks?: ReadonlyArray<Pick<NetworkConfig, "id" | "enabled">> | null): string[] {
    const without = ids.filter((id) => !isBlockdagNetworkId(id));

    if (!userHadBlockdagEnabled(userNetworks)) return without;
    if (ids.some((id) => isBlockdagNetworkId(id))) return [...ids];

    return [...without, BLOCKDAG_NETWORK_ID];
}

export function selectableNameDomains<T extends { name?: string | null }>(domains: readonly T[] | null | undefined): T[] {
    return (domains || []).filter((domain) => !isBlockdagDomain(domain?.name));
}

/** New-name flows cannot stay on .bdag. Existing names are not passed through here. */
export function coerceSelectableDomain(domain: string | null | undefined): string {
    const normalized = (domain || "").trim().toLowerCase().replace(/^\./, "");

    return !normalized || normalized === BLOCKDAG_DOMAIN ? "zelf" : normalized;
}

export function withoutBdagPaymentCurrencies(currencies: readonly string[] | null | undefined): string[] {
    return (currencies || []).filter((currency) => (currency || "").trim().toUpperCase() !== "BDAG");
}

const DEAD_BDAGSCAN_HOSTS = ["rpc.bdagscan.com", "api.bdagscan.com", "bdagscan.com"];

/** True for the retired BlockDAGScan hosts. Other BlockDAG explorers are not matched. */
export function isDeadBdagscanUrl(url: string | null | undefined): boolean {
    const raw = (url || "").trim();

    if (!raw) return false;

    try {
        const host = new URL(raw).hostname.toLowerCase();

        return DEAD_BDAGSCAN_HOSTS.some((dead) => host === dead || host.endsWith(`.${dead}`));
    } catch {
        const lower = raw.toLowerCase();

        return DEAD_BDAGSCAN_HOSTS.some((dead) => lower.includes(dead));
    }
}
