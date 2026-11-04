import { uniqueChainIds } from "app/core/utils/home-network-list.util";
import { hasReportedBalance, readPrice, readReportedAmount, readReportedFiat, resolveTokenFiat } from "app/core/utils/token-balance.util";
import { tokenNetworkToLicenseId } from "app/core/utils/token-network-id.util";

/**
 * Bands used to order networks by USD value.
 * Confirmed zeros stay after networks whose balance is still unknown, so a
 * query that has not finished (or failed) is not pushed to the bottom as $0.
 */
const BAND_POSITIVE = 0;
const BAND_UNKNOWN = 1;
const BAND_ZERO = 2;

export interface NetworkBalanceOrderOptions {
    /** License / default order. Ties and unknown networks keep this order. */
    networkOrder?: readonly string[] | null;
    /** Per-chain fetch state. Missing status means the list is already settled. */
    status?: Record<string, string> | null;
    /** Last confirmed USD total per chain, used while a chain is not loaded. */
    lastKnownUsd?: Record<string, number> | null;
    /** Wallet asset list keeps pinned rows above the balance order. */
    pinnedFirst?: boolean;
}

/** USD already reported for one chain, or null when no row has a real balance yet. */
export function sumReportedNetworkUsd(tokens: readonly any[] | null | undefined, networkId: string): number | null {
    const id = tokenNetworkToLicenseId(networkId);
    let saw = false;
    let sum = 0;

    for (const token of tokens || []) {
        if (tokenNetworkToLicenseId(token?.network) !== id) continue;
        if (!hasReportedBalance(token)) continue;

        const fiat = resolveTokenFiat(token, readReportedAmount(token), readPrice(token?.price));

        saw = true;
        sum += fiat ?? 0;
    }

    return saw ? sum : null;
}

/** Confirmed USD totals keyed by license chain id. Rows with no reported balance are skipped. */
export function networkFiatTotalsFromTokens(tokens: readonly any[] | null | undefined): Record<string, number> {
    const totals: Record<string, number> = {};

    for (const id of uniqueChainIds((tokens || []).map((token) => token?.network))) {
        const usd = sumReportedNetworkUsd(tokens, id);

        if (usd !== null) totals[id] = usd;
    }

    return totals;
}

/**
 * Remembered totals for the balance cache.
 * A chain that finished loading and has no reported row is stored as 0 so the
 * next open keeps it at the end. Chains that are only in `previous` stay put.
 */
export function buildNetworkFiatTotals(
    tokens: readonly any[] | null | undefined,
    loadedNetworkIds?: readonly string[] | null,
    previous?: Record<string, number> | null
): Record<string, number> {
    const totals: Record<string, number> = {};

    if (previous) {
        for (const [rawId, value] of Object.entries(previous)) {
            const id = tokenNetworkToLicenseId(rawId);

            if (!id || !Number.isFinite(value)) continue;

            totals[id] = value;
        }
    }

    const fromTokens = networkFiatTotalsFromTokens(tokens);

    Object.assign(totals, fromTokens);

    for (const rawId of loadedNetworkIds || []) {
        const id = tokenNetworkToLicenseId(rawId);

        if (!id || fromTokens[id] !== undefined) continue;

        totals[id] = 0;
    }

    return totals;
}

function readStatus(status: Record<string, string> | null | undefined, networkId: string): string | undefined {
    if (!status) return undefined;

    return status[networkId] ?? status[tokenNetworkToLicenseId(networkId)];
}

function readLastKnown(lastKnownUsd: Record<string, number> | null | undefined, networkId: string): number | null {
    if (!lastKnownUsd) return null;

    const value = lastKnownUsd[networkId] ?? lastKnownUsd[tokenNetworkToLicenseId(networkId)];

    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * USD used to place one chain.
 * - loaded: the fresh sum, and an empty result is a real zero
 * - pending / loading / error: the rows still on screen, otherwise the last confirmed total
 * - no status (settled pickers): the reported sum, otherwise the last confirmed total, otherwise zero
 * Returns null when the value is still unknown. Null is not zero.
 */
export function effectiveNetworkUsd(
    networkId: string,
    tokens: readonly any[] | null | undefined,
    status?: string | null,
    lastKnownUsd?: number | null
): number | null {
    const reported = sumReportedNetworkUsd(tokens, networkId);
    const remembered = typeof lastKnownUsd === "number" && Number.isFinite(lastKnownUsd) ? lastKnownUsd : null;

    if (status === "loaded") return reported ?? 0;

    if (status === "pending" || status === "loading" || status === "error") {
        if (reported !== null) return reported;
        if (remembered !== null) return remembered;

        return null;
    }

    if (reported !== null) return reported;
    if (remembered !== null) return remembered;

    return 0;
}

function bandFor(usd: number | null): number {
    if (usd === null) return BAND_UNKNOWN;
    if (usd > 0) return BAND_POSITIVE;

    return BAND_ZERO;
}

/** Enabled chain ids, highest USD total first. Unknown queries stay between funded chains and confirmed zeros. */
export function sortNetworkIdsByBalance(
    ids: readonly string[] | null | undefined,
    tokens?: readonly any[] | null,
    status?: Record<string, string> | null,
    lastKnownUsd?: Record<string, number> | null
): string[] {
    const order = uniqueChainIds(ids);
    const index = new Map(order.map((id, position) => [id, position]));

    return order
        .map((id) => {
            const usd = effectiveNetworkUsd(id, tokens, readStatus(status, id), readLastKnown(lastKnownUsd, id));

            return { id, usd, band: bandFor(usd), index: index.get(id) ?? 0 };
        })
        .sort((a, b) => {
            if (a.band !== b.band) return a.band - b.band;
            if (a.band === BAND_POSITIVE && a.usd !== b.usd) return (b.usd as number) - (a.usd as number);

            return a.index - b.index;
        })
        .map((entry) => entry.id);
}

function tokenUsd(token: any): number | null {
    if (!hasReportedBalance(token)) return null;

    const fiat = resolveTokenFiat(token, readReportedAmount(token), readPrice(token?.price));

    return fiat ?? readReportedFiat(token) ?? 0;
}

/** Same network order as {@link sortNetworkIdsByBalance}. Rows on one chain stay together, highest token USD first. */
export function orderTokensByNetworkBalance<T extends { network?: string; isPinned?: boolean; symbol?: string; tokenType?: string }>(
    tokens: readonly T[] | null | undefined,
    options?: NetworkBalanceOrderOptions
): T[] {
    const list = [...(tokens || [])];
    const seen = uniqueChainIds(list.map((token) => token?.network || ""));
    const networkOrder = uniqueChainIds([...(options?.networkOrder || []), ...seen]);
    const ranked = sortNetworkIdsByBalance(networkOrder, list, options?.status, options?.lastKnownUsd);
    const rank = new Map(ranked.map((id, position) => [id, position]));

    const decorated = list.map((token, index) => ({ token, index }));

    decorated.sort((a, b) => {
        if (options?.pinnedFirst && !!a.token?.isPinned !== !!b.token?.isPinned) {
            return a.token?.isPinned ? -1 : 1;
        }

        const aRank = rank.get(tokenNetworkToLicenseId(a.token?.network)) ?? ranked.length;
        const bRank = rank.get(tokenNetworkToLicenseId(b.token?.network)) ?? ranked.length;

        if (aRank !== bRank) return aRank - bRank;

        const aUsd = tokenUsd(a.token);
        const bUsd = tokenUsd(b.token);

        if (aUsd !== bUsd) {
            if (aUsd === null) return 1;
            if (bUsd === null) return -1;

            return bUsd - aUsd;
        }

        const symbol = String(a.token?.symbol || "").localeCompare(String(b.token?.symbol || ""));

        if (symbol) return symbol;

        const tokenType = String(a.token?.tokenType || "").localeCompare(String(b.token?.tokenType || ""));

        if (tokenType) return tokenType;

        return a.index - b.index;
    });

    return decorated.map((entry) => entry.token);
}
