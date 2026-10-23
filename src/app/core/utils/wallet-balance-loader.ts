import { Subject, firstValueFrom, of } from "rxjs";
import { catchError, takeUntil, timeout } from "rxjs/operators";

import { TagModel } from "app/tags.service";
import { AssetService } from "app/asset.service";
import { BlockchainTransactionsService } from "app/services/blockchain-transactions.service";
import {
    BACKGROUND_BALANCE_CONCURRENCY,
    SUPPORTED_NETWORK_IDS,
    splitBalanceStages,
} from "app/core/network-settings.util";
import { balancePayloadFailed } from "app/core/utils/balance-fetch-result.util";
import { dedupeBalanceTokens, mergeBalanceTokens, sumFiatBalance } from "app/core/utils/balance-tokens.util";
import { projectHomeNetworkTokens, uniqueChainIds } from "app/core/utils/home-network-list.util";
import { forEachWithConcurrency } from "app/core/utils/concurrency.util";

export const BALANCE_NETWORK_TIMEOUT_MS = 25_000;
export const BALANCE_NETWORK_RETRY_DELAY_MS = 400;

export type NetworkBalanceStatus = "pending" | "loading" | "loaded" | "error";

export interface WalletBalanceCacheSnapshot {
    tagName: string;
    tokens: any[];
    totalFiatBalance: number;
    loadedNetworkIds: string[];
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
    callbacks: WalletBalanceLoadCallbacks
): void {
    for (const id of ids) {
        status[id] = value;
    }

    callbacks.onNetworkStatus?.({ ...status });
}

async function fetchNetworks(
    ctx: WalletBalanceLoadContext,
    networkIds: string[],
    status: Record<string, NetworkBalanceStatus>
): Promise<any | null> {
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
            setNetworkStatuses(status, networkIds, "error", ctx.callbacks);
        } else {
            const failed = networkIds.filter((id) => balancePayloadFailed(response, id));
            const loaded = networkIds.filter((id) => !failed.includes(id));

            if (loaded.length) setNetworkStatuses(status, loaded, "loaded", ctx.callbacks);
            if (failed.length) setNetworkStatuses(status, failed, "error", ctx.callbacks);
        }
    } catch (err) {
        console.warn("[WalletBalanceLoader] network fetch error:", networkIds, err);
        setNetworkStatuses(status, networkIds, "error", ctx.callbacks);
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

async function fetchNetworkWithRetry(ctx: WalletBalanceLoadContext, networkId: string, status: Record<string, NetworkBalanceStatus>): Promise<any | null> {
    const response = await fetchNetworks(ctx, [networkId], status);

    return retryFailedBalanceNetworks(ctx, [networkId], response, status);
}

function publishTokens(
    ctx: WalletBalanceLoadContext,
    tokens: any[],
    enabledNetworkIds: string[] | undefined,
    status: Record<string, NetworkBalanceStatus>,
    lastKnownTotal: number | null | undefined
): void {
    const visible = projectHomeNetworkTokens(tokens, enabledNetworkIds);
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

    let tokens = dedupeBalanceTokens(ctx.getLoadedTokens());
    let lastKnownTotal = tokens.length ? sumFiatBalance(projectHomeNetworkTokens(tokens, enabledIds)) : null;

    if (!ctx.forceNetworkRefresh) {
        const sessionTokens = await ctx.assetService.loadTokensFromSession();

        if (sessionTokens?.length) {
            tokens = mergeBalanceTokens(tokens, sessionTokens);
        } else if (ctx.persistedCache?.tokens?.length) {
            tokens = mergeBalanceTokens(tokens, ctx.persistedCache.tokens);
        }

        if (tokens.length && ctx.shouldContinue()) {
            lastKnownTotal = sumFiatBalance(projectHomeNetworkTokens(tokens, enabledIds));
            publishTokens(ctx, tokens, enabledIds, status, lastKnownTotal);
        }
    }

    const walletTag = ctx.wallet?.tagName || ctx.wallet?.name;

    ctx.callbacks.onLoadingFlags?.(true, background.length > 0);

    try {
        const priorityResponse = await retryFailedBalanceNetworks(ctx, priority, await fetchNetworks(ctx, priority, status), status);

        if (!ctx.shouldContinue() || (ctx.wallet?.tagName || ctx.wallet?.name) !== walletTag) return;

        if (priorityResponse && priority.some((id) => !balancePayloadFailed(priorityResponse, id))) {
            const result = await ctx.assetService.processTokensFromResponse(priorityResponse);
            tokens = mergeBalanceTokens(tokens, result.tokens);
            publishTokens(ctx, tokens, enabledIds, status, lastKnownTotal);
            await ctx.assetService.saveTokensToSession(tokens, "merge");
            await ctx.onPersistCache?.(
                buildBalanceCacheSnapshot(ctx.wallet, tokens, priority.filter((id) => status[id] === "loaded"))
            );
        }
    } finally {
        ctx.callbacks.onLoadingFlags?.(false, background.length > 0);
    }

    if (!background.length) {
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
                    publishTokens(ctx, tokens, enabledIds, status, lastKnownTotal);
                    await ctx.assetService.saveTokensToSession(tokens, "merge");
                    await ctx.onPersistCache?.(
                        buildBalanceCacheSnapshot(
                            ctx.wallet,
                            tokens,
                            allIds.filter((id) => status[id] === "loaded")
                        )
                    );
                }
            }
        },
        ctx.shouldContinue
    );

    ctx.callbacks.onLoadingFlags?.(false, false);
}

export function buildBalanceCacheSnapshot(wallet: Partial<TagModel>, tokens: any[], loadedNetworkIds: string[]): WalletBalanceCacheSnapshot {
    const tagName = (wallet?.tagName || wallet?.name || "") as string;
    const deduped = dedupeBalanceTokens(tokens);

    return {
        tagName,
        tokens: deduped,
        totalFiatBalance: sumFiatBalance(deduped),
        loadedNetworkIds: [...loadedNetworkIds],
        updatedAtMs: Date.now(),
    };
}

export function mergeBalanceCacheSnapshots(previous: WalletBalanceCacheSnapshot | null, next: WalletBalanceCacheSnapshot): WalletBalanceCacheSnapshot {
    if (!previous || previous.tagName !== next.tagName) return next;

    const tokens = mergeBalanceTokens(previous.tokens, next.tokens);
    const loadedNetworkIds = [...new Set([...previous.loadedNetworkIds, ...next.loadedNetworkIds])];

    return {
        tagName: next.tagName,
        tokens,
        totalFiatBalance: sumFiatBalance(tokens),
        loadedNetworkIds,
        updatedAtMs: next.updatedAtMs,
    };
}
