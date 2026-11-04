import { Subject, firstValueFrom, of } from "rxjs";
import { catchError, takeUntil, timeout } from "rxjs/operators";

import { TagModel } from "app/tags.service";
import { AssetService } from "app/asset.service";
import { BlockchainTransactionsService } from "app/services/blockchain-transactions.service";
import { BACKGROUND_BALANCE_CONCURRENCY, SUPPORTED_NETWORK_IDS, splitBalanceStages } from "app/core/network-settings.util";
import { selectAccountPortfolioSeed } from "app/core/utils/account-portfolio.util";
import { balancePayloadFailed } from "app/core/utils/balance-fetch-result.util";
import { dedupeBalanceTokens, mergeBalanceTokens, sumFiatBalance } from "app/core/utils/balance-tokens.util";
import { projectHomeNetworkTokens, uniqueChainIds } from "app/core/utils/home-network-list.util";
import { buildNetworkFiatTotals, networkFiatTotalsFromTokens, orderTokensByNetworkBalance } from "app/core/utils/network-balance-order.util";
import { hasReportedBalance } from "app/core/utils/token-balance.util";
import { tokenNetworkToLicenseId } from "app/core/utils/token-network-id.util";
import { forEachWithConcurrency } from "app/core/utils/concurrency.util";

export const BALANCE_NETWORK_TIMEOUT_MS = 25_000;
export const BALANCE_NETWORK_RETRY_DELAY_MS = 400;

export type NetworkBalanceStatus = "pending" | "loading" | "loaded" | "error";

export interface WalletBalanceCacheSnapshot {
    tagName: string;
    tokens: any[];
    totalFiatBalance: number;
    loadedNetworkIds: string[];
    /** Last confirmed USD total per chain, so the next open can sort before the refresh finishes. */
    networkFiatTotals?: Record<string, number>;
    updatedAtMs: number;
}

export interface WalletBalanceLoadCallbacks {
    onTokensUpdated: (tokens: any[], totalFiatBalance: number) => void;
    onNetworkStatus?: (status: Record<string, NetworkBalanceStatus>) => void;
    onLoadingFlags?: (priorityLoading: boolean, backgroundSyncing: boolean) => void;
}

export interface WalletBalanceLoadContext {
    wallet: Partial<TagModel>;
    enabledNetworkIds: string[] | undefined;
    assetService: AssetService;
    blockchainTransactionsService: BlockchainTransactionsService;
    getLoadedTokens: () => any[];
    /** When set, in-memory rows, session tokens, and the persisted cache are used only for this account. */
    accountId?: string;
    loadedAccountId?: string;
    callbacks: WalletBalanceLoadCallbacks;
    shouldContinue: () => boolean;
    abort$: Subject<void>;
    /** When true, skip session cache for the initial paint but still merge in memory. */
    forceNetworkRefresh?: boolean;
    /** Optional persisted last-known snapshot (chrome local storage). */
    persistedCache?: WalletBalanceCacheSnapshot | null;
    onPersistCache?: (snapshot: WalletBalanceCacheSnapshot) => void | Promise<void>;
}

export function createNetworkStatusMap(networkIds: readonly string[]): Record<string, NetworkBalanceStatus> {
    const status: Record<string, NetworkBalanceStatus> = {};

    for (const id of networkIds) {
        status[id] = "pending";
    }

    return status;
}

export function networksStillSyncing(status: Record<string, NetworkBalanceStatus>): boolean {
    return Object.values(status).some((s) => s === "pending" || s === "loading");
}

/** Avoid flashing $0 while enabled networks are still fetching and we have no settled total yet. */
export function shouldDeferZeroTotalDisplay(
    totalFiatBalance: number,
    status: Record<string, NetworkBalanceStatus>,
    lastKnownTotal: number | null | undefined
): boolean {
    if (totalFiatBalance > 0) return false;
    if (!networksStillSyncing(status)) return false;

    return (lastKnownTotal ?? 0) > 0 || Object.values(status).some((s) => s === "loading");
}

export function displayTotalFiatBalance(
    totalFiatBalance: number,
    status: Record<string, NetworkBalanceStatus>,
    lastKnownTotal: number | null | undefined
): number | null {
    if (shouldDeferZeroTotalDisplay(totalFiatBalance, status, lastKnownTotal)) {
        return lastKnownTotal ?? null;
    }

    return totalFiatBalance;
}

function setNetworkStatuses(
    status: Record<string, NetworkBalanceStatus>,
    ids: readonly string[],
    value: NetworkBalanceStatus,
    callbacks: WalletBalanceLoadCallbacks,
    emit = true
): void {
    for (const id of ids) {
        status[id] = value;
    }

    // Terminal states are emitted with the merged rows (see publish). Emitting "loaded"
    // before those rows exist makes the chain look like a confirmed zero for one paint.
    if (emit) callbacks.onNetworkStatus?.({ ...status });
}

async function fetchNetworks(ctx: WalletBalanceLoadContext, networkIds: string[], status: Record<string, NetworkBalanceStatus>): Promise<any | null> {
    if (!networkIds.length) return null;

    setNetworkStatuses(status, networkIds, "loading", ctx.callbacks);

    const request$ = ctx.blockchainTransactionsService.getAddressData(ctx.wallet as TagModel, networkIds).pipe(
        timeout(BALANCE_NETWORK_TIMEOUT_MS),
        takeUntil(ctx.abort$),
        catchError((err) => {
            console.warn("[WalletBalanceLoader] network fetch failed:", networkIds, err);
            return of(null);
        })
    );

    let response: any = null;

    try {
        response = await firstValueFrom(request$);

        if (!response) {
            setNetworkStatuses(status, networkIds, "error", ctx.callbacks, false);
        } else {
            const failed = networkIds.filter((id) => balancePayloadFailed(response, id));
            const loaded = networkIds.filter((id) => !failed.includes(id));

            if (loaded.length) setNetworkStatuses(status, loaded, "loaded", ctx.callbacks, false);
            if (failed.length) setNetworkStatuses(status, failed, "error", ctx.callbacks, false);
        }
    } catch (err) {
        console.warn("[WalletBalanceLoader] network fetch error:", networkIds, err);
        setNetworkStatuses(status, networkIds, "error", ctx.callbacks, false);
    }

    return response;
}

async function retryFailedBalanceNetworks(
    ctx: WalletBalanceLoadContext,
    networkIds: string[],
    response: any | null,
    status: Record<string, NetworkBalanceStatus>
): Promise<any | null> {
    const failed = networkIds.filter((id) => balancePayloadFailed(response, id));

    if (!failed.length || !ctx.shouldContinue()) return response;

    await new Promise((r) => setTimeout(r, BALANCE_NETWORK_RETRY_DELAY_MS));

    let merged = response;

    for (const networkId of failed) {
        if (!ctx.shouldContinue()) return merged;

        const retry = await fetchNetworks(ctx, [networkId], status);

        if (!balancePayloadFailed(retry, networkId)) {
            merged = { ...(merged || {}), ...(retry || {}) };
        }
    }

    return merged;
}

async function fetchNetworkWithRetry(
    ctx: WalletBalanceLoadContext,
    networkId: string,
    status: Record<string, NetworkBalanceStatus>
): Promise<any | null> {
    const response = await fetchNetworks(ctx, [networkId], status);

    return retryFailedBalanceNetworks(ctx, [networkId], response, status);
}

/** Recompute card hints after one network settles, including when that network added no rows. */
export function cardsAfterNetworkSettled(
    tokens: readonly any[] | null | undefined,
    status: Record<string, NetworkBalanceStatus>,
    networkId: string,
    outcome: NetworkBalanceStatus,
    enabledNetworkIds?: readonly string[]
): { tokens: any[]; status: Record<string, NetworkBalanceStatus> } {
    const nextStatus = { ...status, [networkId]: outcome };
    const enabled = enabledNetworkIds?.length ? enabledNetworkIds : Object.keys(nextStatus);

    return {
        status: nextStatus,
        tokens: withBalanceHints(projectHomeNetworkTokens(tokens, enabled), nextStatus),
    };
}

function withBalanceHints(tokens: any[], status: Record<string, NetworkBalanceStatus>): any[] {
    return tokens.map((token) => {
        if (hasReportedBalance(token)) return { ...token, balanceState: undefined };

        const state = status?.[tokenNetworkToLicenseId(token?.network)];

        if (state === "error") return { ...token, balanceState: "unavailable" };
        if (state === "pending" || state === "loading") return { ...token, balanceState: "pending" };

        return { ...token, balanceState: undefined };
    });
}

function publishTokens(
    ctx: WalletBalanceLoadContext,
    tokens: any[],
    enabledNetworkIds: string[] | undefined,
    status: Record<string, NetworkBalanceStatus>,
    _lastKnownTotal: number | null | undefined,
    lastKnownNetworkUsd?: Record<string, number> | null
): void {
    const visible = orderTokensByNetworkBalance(withBalanceHints(projectHomeNetworkTokens(tokens, enabledNetworkIds), status), {
        networkOrder: enabledNetworkIds,
        status,
        lastKnownUsd: lastKnownNetworkUsd,
        pinnedFirst: true,
    });
    const total = sumFiatBalance(visible);

    ctx.callbacks.onTokensUpdated(visible, total);
}

/**
 * Stale-while-revalidate balance load for Home / Wallet: show session or in-memory tokens immediately,
 * always refresh from the API without wiping the list, and fetch background networks in parallel.
 */
export async function loadWalletBalances(ctx: WalletBalanceLoadContext): Promise<void> {
    // undefined: legacy "no license yet" still fetches the chains this build can talk to.
    // A provided list is the license allowlist (minus chains the user switched off), never the catalog.
    const enabledIds = ctx.enabledNetworkIds == null ? undefined : uniqueChainIds(ctx.enabledNetworkIds);
    const fetchIds = enabledIds ?? [...SUPPORTED_NETWORK_IDS];
    const { priority, background } = splitBalanceStages(fetchIds);
    const allIds = [...priority, ...background];
    const status = createNetworkStatusMap(allIds);

    ctx.callbacks.onNetworkStatus?.({ ...status });

    const sessionTokens = !ctx.forceNetworkRefresh ? await ctx.assetService.loadTokensFromSession(ctx.accountId) : [];
    let tokens = ctx.accountId
        ? selectAccountPortfolioSeed({
              accountId: ctx.accountId,
              inMemoryAccountId: ctx.loadedAccountId || "",
              inMemoryTokens: ctx.getLoadedTokens(),
              sessionAccountId: sessionTokens.length ? ctx.accountId : "",
              sessionTokens,
              persistedByAccount:
                  !ctx.forceNetworkRefresh && ctx.persistedCache?.tokens?.length ? { [ctx.accountId]: ctx.persistedCache.tokens } : {},
          })
        : dedupeBalanceTokens(ctx.getLoadedTokens());

    if (!ctx.accountId && !ctx.forceNetworkRefresh) {
        if (sessionTokens?.length) tokens = mergeBalanceTokens(tokens, sessionTokens);
        else if (ctx.persistedCache?.tokens?.length) tokens = mergeBalanceTokens(tokens, ctx.persistedCache.tokens);
    }

    let lastKnownTotal = tokens.length ? sumFiatBalance(projectHomeNetworkTokens(tokens, enabledIds)) : null;
    let networkFiatTotals: Record<string, number> = {
        ...networkFiatTotalsFromTokens(ctx.persistedCache?.tokens),
        ...(ctx.persistedCache?.networkFiatTotals || {}),
    };

    const loadedIds = () => allIds.filter((id) => status[id] === "loaded");

    const syncTotals = () => {
        networkFiatTotals = buildNetworkFiatTotals(tokens, loadedIds(), networkFiatTotals);
    };

    const publish = () => {
        syncTotals();
        ctx.callbacks.onNetworkStatus?.({ ...status });
        publishTokens(ctx, tokens, enabledIds, status, lastKnownTotal, networkFiatTotals);
    };

    const persist = async () => {
        syncTotals();
        await ctx.onPersistCache?.(buildBalanceCacheSnapshot(ctx.wallet, tokens, loadedIds(), networkFiatTotals));
    };

    if (tokens.length && ctx.shouldContinue()) {
        publish();
    }

    const walletTag = ctx.wallet?.tagName || ctx.wallet?.name;

    ctx.callbacks.onLoadingFlags?.(true, background.length > 0);

    try {
        const priorityResponse = await retryFailedBalanceNetworks(ctx, priority, await fetchNetworks(ctx, priority, status), status);

        if (!ctx.shouldContinue() || (ctx.wallet?.tagName || ctx.wallet?.name) !== walletTag) return;

        if (priorityResponse && priority.some((id) => !balancePayloadFailed(priorityResponse, id))) {
            const result = await ctx.assetService.processTokensFromResponse(priorityResponse);
            tokens = mergeBalanceTokens(tokens, result.tokens);
            publish();

            if (ctx.shouldContinue() && (ctx.wallet?.tagName || ctx.wallet?.name) === walletTag) {
                await ctx.assetService.saveTokensToSession(tokens, "merge");
                await persist();
            }
        }

        if (ctx.shouldContinue() && (ctx.wallet?.tagName || ctx.wallet?.name) === walletTag) {
            publish();
        }
    } finally {
        ctx.callbacks.onLoadingFlags?.(false, background.length > 0);
    }

    if (!background.length) {
        if (ctx.shouldContinue() && (ctx.wallet?.tagName || ctx.wallet?.name) === walletTag) {
            publish();
            await persist();
        }

        ctx.callbacks.onLoadingFlags?.(false, false);
        return;
    }

    ctx.callbacks.onLoadingFlags?.(false, true);

    await forEachWithConcurrency(
        background,
        BACKGROUND_BALANCE_CONCURRENCY,
        async (networkId) => {
            const response = await fetchNetworkWithRetry(ctx, networkId, status);

            if (!ctx.shouldContinue() || (ctx.wallet?.tagName || ctx.wallet?.name) !== walletTag) return;

            if (response && !balancePayloadFailed(response, networkId)) {
                const result = await ctx.assetService.processTokensFromResponse(response);

                if (result?.tokens?.length) {
                    tokens = mergeBalanceTokens(tokens, result.tokens);

                    if (ctx.shouldContinue() && (ctx.wallet?.tagName || ctx.wallet?.name) === walletTag) {
                        await ctx.assetService.saveTokensToSession(tokens, "merge");
                        await persist();
                    }
                }
            }

            if (ctx.shouldContinue() && (ctx.wallet?.tagName || ctx.wallet?.name) === walletTag) {
                publish();
            }
        },
        ctx.shouldContinue
    );

    if (ctx.shouldContinue() && (ctx.wallet?.tagName || ctx.wallet?.name) === walletTag) {
        publish();
        await persist();
    }

    ctx.callbacks.onLoadingFlags?.(false, false);
}

export function buildBalanceCacheSnapshot(
    wallet: Partial<TagModel>,
    tokens: any[],
    loadedNetworkIds: string[],
    networkFiatTotals?: Record<string, number> | null
): WalletBalanceCacheSnapshot {
    const tagName = (wallet?.tagName || wallet?.name || "") as string;
    const deduped = dedupeBalanceTokens(tokens);

    return {
        tagName,
        tokens: deduped,
        totalFiatBalance: sumFiatBalance(deduped),
        loadedNetworkIds: [...loadedNetworkIds],
        networkFiatTotals: networkFiatTotals ? { ...networkFiatTotals } : buildNetworkFiatTotals(deduped, loadedNetworkIds),
        updatedAtMs: Date.now(),
    };
}

export function mergeBalanceCacheSnapshots(
    previous: WalletBalanceCacheSnapshot | null,
    next: WalletBalanceCacheSnapshot
): WalletBalanceCacheSnapshot {
    if (!previous || previous.tagName !== next.tagName) return next;

    const tokens = mergeBalanceTokens(previous.tokens, next.tokens);
    const loadedNetworkIds = [...new Set([...previous.loadedNetworkIds, ...next.loadedNetworkIds])];

    return {
        tagName: next.tagName,
        tokens,
        totalFiatBalance: sumFiatBalance(tokens),
        loadedNetworkIds,
        networkFiatTotals: buildNetworkFiatTotals(tokens, loadedNetworkIds, {
            ...(previous.networkFiatTotals || networkFiatTotalsFromTokens(previous.tokens)),
            ...(next.networkFiatTotals || {}),
        }),
        updatedAtMs: next.updatedAtMs,
    };
}
