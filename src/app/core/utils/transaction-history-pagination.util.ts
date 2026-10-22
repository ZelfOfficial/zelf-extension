/**
 * Activity history paging (issue #120).
 *
 * The address endpoints preview about 10 rows. "Load more" used to request `page=1&show=25`.
 * On 0-based APIs that window is rows 25–49, so rows 10–24 never appeared. Every request now
 * uses {@link TRANSACTION_HISTORY_PAGE_SIZE}, and the next page starts where the previous one ended.
 *
 * Conventions (what the Zelf API expects, not the upstream explorer):
 * - zero-based: first page is `page=0` (Sui, Solana, Aptos, OKLink-style chains, BlockDAG).
 *   Row window is `[page * show, page * show + show)`.
 * - one-based: first page is `page=1` (Ethereum / Etherscan-style).
 *   Row window is `[(page - 1) * show, page * show)`.
 * - cursor: Stellar (Horizon). Send `nextCursor` when the response includes one, and stop when
 *   `hasNextPage` / `next` is false or no cursor was returned.
 */

export const TRANSACTION_HISTORY_PAGE_SIZE = 10;

export type HistoryPageConvention = "zero-based" | "one-based" | "cursor";

export interface HistoryPageRequest {
    page: number;
    show: number;
    cursor?: string;
}

export type HistoryPaginationInput = HistoryPageRequest | Record<string, HistoryPageRequest>;

export interface ChainHistoryState {
    network: string;
    convention: HistoryPageConvention;
    /** Next numbered page to request. Cursor chains keep the page they started with. */
    page: number;
    /** Page size shared by the first request and every "Load more" for this chain. */
    show: number;
    cursor?: string;
    hasNextPage: boolean;
    loaded: boolean;
}

export interface HistoryPageSignals {
    transactions: unknown[];
    nextCursor?: string | null;
    hasNextPage?: boolean;
}

/** First page index is 0. `page * show` is the first row of that page. */
export const ZERO_BASED_HISTORY_NETWORKS = [
    "sui",
    "solana",
    "aptos",
    "avalanche",
    "binance",
    "bitcoin",
    "blockdag",
    "polygon",
    "optimism",
    "arbitrum",
    "base",
    "ton",
] as const;

const ONE_BASED_NETWORKS = new Set(["ethereum"]);
const CURSOR_NETWORKS = new Set(["stellar"]);

const HISTORY_NETWORKS = new Set<string>([...ZERO_BASED_HISTORY_NETWORKS, ...ONE_BASED_NETWORKS, ...CURSOR_NETWORKS]);

const TOKEN_NETWORK: Record<string, string> = {
    APT: "aptos",
    ARB: "arbitrum",
    AVAX: "avalanche",
    BDAG: "blockdag",
    BNB: "binance",
    BTC: "bitcoin",
    DOT: "polkadot",
    ETH: "ethereum",
    KSM: "kusama",
    MATIC: "polygon",
    OP: "optimism",
    POL: "polygon",
    SOL: "solana",
    SUI: "sui",
    TON: "ton",
    XLM: "stellar",
};

export function historyPageConvention(network: string): HistoryPageConvention {
    const id = (network || "").toLowerCase();

    if (CURSOR_NETWORKS.has(id)) return "cursor";
    if (ONE_BASED_NETWORKS.has(id)) return "one-based";

    return "zero-based";
}

export function supportsTransactionHistory(network: string): boolean {
    return HISTORY_NETWORKS.has((network || "").toLowerCase());
}

export function historyNetworkForToken(token?: string | null): string | undefined {
    if (!token) return undefined;

    return TOKEN_NETWORK[token.trim().toUpperCase()];
}

export function createChainHistoryState(network: string, pageSize: number = TRANSACTION_HISTORY_PAGE_SIZE): ChainHistoryState {
    const convention = historyPageConvention(network);

    return {
        network,
        convention,
        page: convention === "one-based" ? 1 : 0,
        show: pageSize,
        hasNextPage: true,
        loaded: false,
    };
}

export function historyRequestFor(state: ChainHistoryState): HistoryPageRequest {
    const request: HistoryPageRequest = {
        page: state.page,
        show: state.show,
    };

    if (state.cursor) request.cursor = state.cursor;

    return request;
}

/** Inclusive-exclusive row window a numbered page covers. Cursor chains do not use this. */
export function numberedPageRange(convention: HistoryPageConvention, page: number, show: number): { start: number; end: number } {
    const index = convention === "one-based" ? Math.max(0, page - 1) : page;
    const start = index * show;

    return { start, end: start + show };
}

export function isSharedHistoryQuery(pagination: HistoryPaginationInput): pagination is HistoryPageRequest {
    return typeof (pagination as HistoryPageRequest).page === "number";
}

export function historyQueryForNetwork(network: string, pagination: HistoryPaginationInput): HistoryPageRequest {
    const fallbackNetwork = network === "bitcoinTestnet" ? "bitcoin" : network;
    const source = isSharedHistoryQuery(pagination)
        ? pagination
        : pagination[network] || pagination[fallbackNetwork] || historyRequestFor(createChainHistoryState(fallbackNetwork));

    const request: HistoryPageRequest = {
        page: source.page,
        show: source.show && source.show > 0 ? source.show : TRANSACTION_HISTORY_PAGE_SIZE,
    };

    if (source.cursor) request.cursor = source.cursor;

    return request;
}

/** Query string shared by the numbered history endpoints. `page` 0 is preserved. */
export function historyQueryParams(pagination?: { page?: number; show?: number; cursor?: string } | null): Record<string, string | number> {
    const params: Record<string, string | number> = {
        page: typeof pagination?.page === "number" ? pagination.page : 0,
        show: pagination?.show && pagination.show > 0 ? pagination.show : TRANSACTION_HISTORY_PAGE_SIZE,
    };

    if (pagination?.cursor) params.cursor = pagination.cursor;

    return params;
}

/** Stellar history speaks Horizon `limit` + `cursor` and also accepts `show`. */
export function stellarHistoryQueryParams(pagination?: { page?: number; show?: number; cursor?: string } | null): Record<string, string | number> {
    const show = pagination?.show && pagination.show > 0 ? pagination.show : TRANSACTION_HISTORY_PAGE_SIZE;
    const params: Record<string, string | number> = {
        limit: show,
        show,
    };

    if (pagination?.cursor) params.cursor = pagination.cursor;

    return params;
}

function asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    return value as Record<string, any>;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    return undefined;
}

export function readHistoryPageSignals(payload: unknown): HistoryPageSignals {
    const root = asRecord(payload);
    const nested = root && asRecord(root.data) ? (root.data as Record<string, any>) : null;
    const body = nested || root || {};
    const transactions = Array.isArray(body.transactions)
        ? body.transactions
        : Array.isArray(root?.data)
          ? (root.data as unknown[])
          : Array.isArray(payload)
            ? payload
            : [];
    const pagination = asRecord(body.pagination) || {};
    const nextCursor = firstNonEmptyString(body.nextCursor, body.cursor, pagination.nextCursor, pagination.cursor) ?? null;
    const flag = [body.hasNextPage, pagination.hasNextPage, body.next, body.transactionsNext, pagination.next].find((value) => typeof value === "boolean") as
        | boolean
        | undefined;

    return {
        transactions,
        nextCursor,
        hasNextPage: flag,
    };
}

export function mergeHistoryPageSignals(parts: HistoryPageSignals[]): HistoryPageSignals {
    const transactions = parts.flatMap((part) => part.transactions || []);
    const nextCursor = parts.map((part) => part.nextCursor).find((cursor) => !!cursor) || null;
    const flags = parts.map((part) => part.hasNextPage).filter((flag): flag is boolean => typeof flag === "boolean");
    let hasNextPage: boolean | undefined;

    if (flags.some((flag) => flag)) hasNextPage = true;
    else if (parts.length > 0 && flags.length === parts.length) hasNextPage = false;

    return { transactions, nextCursor, hasNextPage };
}

/**
 * Moves the chain to the following page. A returned cursor replaces the page index so the next
 * request does not also skip ahead by `show` rows.
 */
export function advanceChainHistoryState(state: ChainHistoryState, payload: unknown): ChainHistoryState {
    const signals = readHistoryPageSignals(payload);
    const cursor = firstNonEmptyString(signals.nextCursor);
    const count = signals.transactions.length;
    let hasNext: boolean;

    if (typeof signals.hasNextPage === "boolean") hasNext = signals.hasNextPage;
    else if (cursor) hasNext = true;
    else if (state.convention === "cursor") hasNext = false;
    else hasNext = count >= state.show;

    if (state.convention === "cursor" && hasNext && !cursor) hasNext = false;

    const followCursor = !!cursor && hasNext;
    const nextPage = hasNext && !followCursor && state.convention !== "cursor" ? state.page + 1 : state.page;

    return {
        ...state,
        page: nextPage,
        cursor: hasNext ? cursor || state.cursor : undefined,
        hasNextPage: hasNext,
        loaded: true,
    };
}

export function dedupeTransactionsByHash<T extends { hash?: string }>(seen: Set<string>, transactions: readonly T[] | null | undefined): T[] {
    const fresh: T[] = [];

    for (const tx of transactions || []) {
        const hash = (tx?.hash || "").toString().trim();

        if (!hash || seen.has(hash)) continue;

        seen.add(hash);
        fresh.push(tx);
    }

    return fresh;
}

/**
 * Numbered pages overlap when new transactions arrive and shift older rows down. Rows we already
 * showed are dropped. A page that adds nothing, and whose cursor did not move, has no next page
 * even if the payload still says the page was full — otherwise "Load more" would repeat forever
 * when an endpoint ignores `page`. An explicit `hasNextPage: true` with a new cursor still continues.
 */
export function hasNextPageAfterDedupe(
    state: ChainHistoryState,
    freshCount: number,
    explicitHasNextPage: boolean | undefined,
    previousCursor?: string
): boolean {
    if (explicitHasNextPage === false) return false;
    if (freshCount === 0 && (!state.cursor || state.cursor === previousCursor)) return false;
    if (explicitHasNextPage === true) return true;
    if (freshCount === 0) return false;

    return state.hasNextPage;
}

export function anyChainHasNextPage(states: Iterable<ChainHistoryState>): boolean {
    for (const state of states) {
        if (state.hasNextPage) return true;
    }

    return false;
}
