/**
 * Activity history paging against the v4 Zelf API (issue #120, QA on PR #121).
 *
 * The API does not share one page contract. Each chain below follows the v4 controller:
 *
 * - Ethereum is 1-based. RouteScan reads the query param `nextCursor` (not `cursor`) and,
 *   when that param is present, returns that page directly. Without it, `page=2` is the
 *   next window. Sending `cursor` while staying on page 1 repeats rows 0–9.
 * - Optimism and Arbitrum are 1-based. `page=0` is coerced to page 1, so a 0-based client
 *   fetches the same rows twice.
 * - Aptos, Sui and BlockDAG are 0-based (`offset = page * show`). Sui also accepts `cursor`
 *   and returns `pagination.nextCursor` / `hasNextPage`.
 * - Solana's RPC source ignores `page` and returns the newest `show` rows (v4 capped at 25).
 * - Stellar sets `next: true` when the page is full but does not return a cursor, and the
 *   cursor it accepts is not usable from this client. v4 capped at 25.
 * - Bitcoin ignores `page` and slices the first `show` txids (v4 used 25).
 * - TON computes `page * show` and then does not send it; only `limit` / `before_lt` apply,
 *   and the response has no `before_lt`.
 * - Avalanche's list endpoint returns `data` as an array. Prod fallbacks ignore `page`.
 *   The address screen asks for show=100, which is the most this client can get in one call.
 * - Polygon ignores `show` (page 0 returned ~1000 rows) and the next numbered page repeats.
 *
 * Chains that cannot page request the same window v4 already showed, then hide Load more.
 * Chains that can page keep one show value so the next page starts where the previous ended.
 */

export const TRANSACTION_HISTORY_PAGE_SIZE = 10;

/** Largest window v4's Load more asked for on endpoints that ignore `page`. */
export const UNPAGED_HISTORY_SHOW = 25;

export type HistoryPageConvention = "zero-based" | "one-based" | "window";

export type HistoryCursorParam = "cursor" | "nextCursor";

export interface HistoryPageRequest {
    page: number;
    show: number;
    cursor?: string;
    /** Query-string name the v4 controller actually reads. Omitted when the API has no cursor. */
    cursorParam?: HistoryCursorParam;
}

export type HistoryPaginationInput = HistoryPageRequest | Record<string, HistoryPageRequest>;

export interface ChainHistoryProfile {
    convention: HistoryPageConvention;
    show: number;
    /** False when another request cannot return rows this one did not already include. */
    canPage: boolean;
    cursorParam?: HistoryCursorParam;
}

export interface ChainHistoryState {
    network: string;
    convention: HistoryPageConvention;
    /** Next numbered page to send. Cursor follow-ups keep the page the API pairs with the cursor. */
    page: number;
    show: number;
    canPage: boolean;
    cursor?: string;
    cursorParam?: HistoryCursorParam;
    hasNextPage: boolean;
    loaded: boolean;
}

export interface HistoryPageSignals {
    transactions: unknown[];
    nextCursor?: string | null;
    hasNextPage?: boolean;
}

/**
 * Profiles taken from zelf-online-version v4 modules plus the prod traces in the PR #121 QA notes.
 * `canPage: false` is an API limitation, not a client choice — noted as a follow-up, not patched here.
 */
export const CHAIN_HISTORY_PROFILES: Record<string, ChainHistoryProfile> = {
    ethereum: { convention: "one-based", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: true, cursorParam: "nextCursor" },
    optimism: { convention: "one-based", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: true },
    arbitrum: { convention: "one-based", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: true },
    aptos: { convention: "zero-based", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: true },
    sui: { convention: "zero-based", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: true, cursorParam: "cursor" },
    base: { convention: "zero-based", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: true },
    binance: { convention: "zero-based", show: UNPAGED_HISTORY_SHOW, canPage: true },
    blockdag: { convention: "zero-based", show: 20, canPage: true },
    solana: { convention: "window", show: UNPAGED_HISTORY_SHOW, canPage: false },
    stellar: { convention: "window", show: UNPAGED_HISTORY_SHOW, canPage: false },
    bitcoin: { convention: "window", show: UNPAGED_HISTORY_SHOW, canPage: false },
    ton: { convention: "window", show: UNPAGED_HISTORY_SHOW, canPage: false },
    avalanche: { convention: "window", show: 100, canPage: false },
    polygon: { convention: "window", show: TRANSACTION_HISTORY_PAGE_SIZE, canPage: false },
};

const HISTORY_NETWORKS = new Set(Object.keys(CHAIN_HISTORY_PROFILES));

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

export function chainHistoryProfile(network: string): ChainHistoryProfile {
    return CHAIN_HISTORY_PROFILES[(network || "").toLowerCase()] || {
        convention: "zero-based",
        show: TRANSACTION_HISTORY_PAGE_SIZE,
        canPage: true,
    };
}

export function historyPageConvention(network: string): HistoryPageConvention {
    return chainHistoryProfile(network).convention;
}

export function supportsTransactionHistory(network: string): boolean {
    return HISTORY_NETWORKS.has((network || "").toLowerCase());
}

export function historyNetworkForToken(token?: string | null): string | undefined {
    if (!token) return undefined;

    return TOKEN_NETWORK[token.trim().toUpperCase()];
}

export function createChainHistoryState(network: string): ChainHistoryState {
    const profile = chainHistoryProfile(network);

    return {
        network,
        convention: profile.convention,
        page: profile.convention === "one-based" ? 1 : 0,
        show: profile.show,
        canPage: profile.canPage,
        cursorParam: profile.cursorParam,
        hasNextPage: profile.canPage,
        loaded: false,
    };
}

export function historyRequestFor(state: ChainHistoryState): HistoryPageRequest {
    const request: HistoryPageRequest = {
        page: state.page,
        show: state.show,
    };

    if (state.cursorParam) request.cursorParam = state.cursorParam;
    if (state.cursor) request.cursor = state.cursor;

    return request;
}

/** Inclusive-exclusive row window a numbered page covers. Window chains do not use this. */
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
    const profile = chainHistoryProfile(fallbackNetwork);
    const request: HistoryPageRequest = {
        page: source.page,
        show: source.show && source.show > 0 ? source.show : profile.show,
    };

    if (source.cursorParam) request.cursorParam = source.cursorParam;
    else if (profile.cursorParam) request.cursorParam = profile.cursorParam;
    if (source.cursor) request.cursor = source.cursor;

    return request;
}

/** Numbered history query. The cursor is sent under the name that chain's controller reads. */
export function historyQueryParams(
    pagination?: { page?: number; show?: number; cursor?: string; cursorParam?: HistoryCursorParam } | null
): Record<string, string | number> {
    const params: Record<string, string | number> = {
        page: typeof pagination?.page === "number" ? pagination.page : 0,
        show: pagination?.show && pagination.show > 0 ? pagination.show : TRANSACTION_HISTORY_PAGE_SIZE,
    };

    if (pagination?.cursor && pagination.cursorParam) params[pagination.cursorParam] = pagination.cursor;

    return params;
}

/** Stellar history speaks Horizon `limit` and also accepts `show`. It does not return a cursor. */
export function stellarHistoryQueryParams(
    pagination?: { page?: number; show?: number; cursor?: string; cursorParam?: HistoryCursorParam } | null
): Record<string, string | number> {
    const show = pagination?.show && pagination.show > 0 ? pagination.show : UNPAGED_HISTORY_SHOW;
    const params: Record<string, string | number> = {
        limit: show,
        show,
    };

    if (pagination?.cursor && pagination.cursorParam === "cursor") params.cursor = pagination.cursor;

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

/**
 * Rows from a history response. Avalanche's list endpoint sets `data` to the array itself;
 * the other chains use `data.transactions`.
 */
export function extractHistoryTransactions(response: unknown): any[] {
    if (!response) return [];

    if (Array.isArray(response)) return response;

    const root = asRecord(response);
    if (!root) return [];

    if (Array.isArray(root.data)) return root.data;
    if (Array.isArray(root.data?.transactions)) return root.data.transactions;
    if (Array.isArray(root.transactions)) return root.transactions;

    return [];
}

export function readHistoryPageSignals(payload: unknown): HistoryPageSignals {
    const root = asRecord(payload);
    const nested = root && asRecord(root.data) ? (root.data as Record<string, any>) : null;
    const body = nested || root || {};
    const transactions = extractHistoryTransactions(payload);
    const pagination = asRecord(body.pagination) || {};
    const nextCursor = firstNonEmptyString(body.nextCursor, pagination.nextCursor, body.cursor, pagination.cursor) ?? null;
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
 * Moves a chain to its next request. A cursor is followed under that chain's query name and the
 * page index stays put, because RouteScan and Sui ignore `page` once the cursor is set. A chain
 * that cannot page, or that returned more rows than `show` (Polygon), is finished.
 */
export function advanceChainHistoryState(state: ChainHistoryState, payload: unknown): ChainHistoryState {
    const signals = readHistoryPageSignals(payload);
    const count = signals.transactions.length;
    const cursor = firstNonEmptyString(signals.nextCursor);

    if (!state.canPage || count > state.show) {
        return { ...state, cursor: undefined, hasNextPage: false, loaded: true };
    }

    let hasNext: boolean;

    if (typeof signals.hasNextPage === "boolean") hasNext = signals.hasNextPage;
    else if (cursor) hasNext = true;
    else hasNext = count >= state.show;

    const followCursor = !!cursor && !!state.cursorParam && hasNext;
    const nextPage = hasNext && !followCursor ? state.page + 1 : state.page;

    return {
        ...state,
        page: nextPage,
        cursor: followCursor ? cursor : undefined,
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
 * A page of only hashes we already showed does not continue, unless the API moved the cursor
 * and explicitly said another page exists. That stops Solana/Stellar repeats without hiding a
 * real next page when new rows arrived and shifted the window.
 */
export function hasNextPageAfterDedupe(
    state: ChainHistoryState,
    freshCount: number,
    explicitHasNextPage: boolean | undefined,
    previousCursor?: string
): boolean {
    if (!state.canPage) return false;
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
