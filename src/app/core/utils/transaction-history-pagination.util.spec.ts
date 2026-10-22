import {
    TRANSACTION_HISTORY_PAGE_SIZE,
    advanceChainHistoryState,
    anyChainHasNextPage,
    createChainHistoryState,
    dedupeTransactionsByHash,
    hasNextPageAfterDedupe,
    historyPageConvention,
    historyQueryParams,
    historyRequestFor,
    numberedPageRange,
    readHistoryPageSignals,
    stellarHistoryQueryParams,
    ZERO_BASED_HISTORY_NETWORKS,
} from "./transaction-history-pagination.util";

function hashes(count: number, prefix = "tx"): { hash: string }[] {
    return Array.from({ length: count }, (_, index) => ({ hash: `${prefix}-${index}` }));
}

describe("transaction history pagination", () => {
    const pageSize = TRANSACTION_HISTORY_PAGE_SIZE;

    describe("zero-based pages", () => {
        it("uses page 0 for Sui, Solana, Aptos and the other offset indexes", () => {
            for (const network of ["sui", "solana", "aptos", ...ZERO_BASED_HISTORY_NETWORKS]) {
                expect(historyPageConvention(network)).toBe("zero-based");
                expect(historyRequestFor(createChainHistoryState(network))).toEqual({ page: 0, show: pageSize });
            }
        });

        it("continues at the first page's last row instead of jumping to row 25", () => {
            // The old "Load more" request was page=1&show=25. On a 0-based API that starts at row 25
            // and skips rows 10–24 after a 10-row first page.
            const state = createChainHistoryState("sui");
            const first = historyRequestFor(state);
            const second = historyRequestFor(
                advanceChainHistoryState(state, { data: { transactions: hashes(first.show) } })
            );
            const firstWindow = numberedPageRange("zero-based", first.page, first.show);
            const secondWindow = numberedPageRange("zero-based", second.page, second.show);

            expect(first).toEqual({ page: 0, show: pageSize });
            expect(second.show).toBe(first.show);
            expect(second.page).toBe(1);
            expect(secondWindow.start).toBe(firstWindow.end);
            expect(secondWindow.start).toBe(pageSize);
        });

        it("walks three pages with no gap and no overlap", () => {
            let state = createChainHistoryState("solana");
            const windows = [];

            for (let step = 0; step < 3; step++) {
                const request = historyRequestFor(state);

                windows.push(numberedPageRange("zero-based", request.page, request.show));
                state = advanceChainHistoryState(state, { data: { transactions: hashes(request.show, `p${step}`) } });
            }

            expect(windows).toEqual([
                { start: 0, end: pageSize },
                { start: pageSize, end: pageSize * 2 },
                { start: pageSize * 2, end: pageSize * 3 },
            ]);
        });

        it("hides the next page when the API returns a short page or hasNextPage false", () => {
            const short = advanceChainHistoryState(createChainHistoryState("aptos"), { data: { transactions: hashes(3) } });
            const explicit = advanceChainHistoryState(createChainHistoryState("ton"), {
                data: { transactions: hashes(pageSize), hasNextPage: false },
            });

            expect(short.hasNextPage).toBeFalse();
            expect(explicit.hasNextPage).toBeFalse();
            expect(anyChainHasNextPage([short, explicit])).toBeFalse();
        });

        it("follows nextCursor instead of skipping another numbered page", () => {
            const state = advanceChainHistoryState(createChainHistoryState("sui"), {
                data: { transactions: hashes(pageSize), nextCursor: "cursor-9", hasNextPage: true },
            });
            const next = historyRequestFor(state);

            expect(next).toEqual({ page: 0, show: pageSize, cursor: "cursor-9" });
            expect(state.hasNextPage).toBeTrue();
        });
    });

    describe("one-based pages", () => {
        it("starts Ethereum at page 1 and keeps the same show", () => {
            const state = createChainHistoryState("ethereum");
            const first = historyRequestFor(state);
            const second = historyRequestFor(
                advanceChainHistoryState(state, { data: { transactions: hashes(first.show) } })
            );

            expect(historyPageConvention("ethereum")).toBe("one-based");
            expect(first).toEqual({ page: 1, show: pageSize });
            expect(second).toEqual({ page: 2, show: pageSize });
            expect(numberedPageRange("one-based", second.page, second.show).start).toBe(
                numberedPageRange("one-based", first.page, first.show).end
            );
        });

        it("stops when the page is shorter than show", () => {
            const state = advanceChainHistoryState(createChainHistoryState("ethereum"), {
                data: { transactions: hashes(pageSize - 1) },
            });

            expect(state.hasNextPage).toBeFalse();
            expect(state.page).toBe(1);
        });
    });

    describe("cursor pages", () => {
        it("sends the first Stellar request without a cursor and the same page size", () => {
            const request = historyRequestFor(createChainHistoryState("stellar"));

            expect(historyPageConvention("stellar")).toBe("cursor");
            expect(request.cursor).toBeUndefined();
            expect(request.show).toBe(pageSize);
            expect(stellarHistoryQueryParams(request)).toEqual({ limit: pageSize, show: pageSize });
        });

        it("uses nextCursor while hasNextPage is true and stops when the API says there is no next page", () => {
            let state = createChainHistoryState("stellar");

            state = advanceChainHistoryState(state, {
                data: { transactions: hashes(pageSize), nextCursor: "horizon-1", hasNextPage: true },
            });

            expect(state.hasNextPage).toBeTrue();
            expect(historyRequestFor(state).cursor).toBe("horizon-1");
            expect(historyRequestFor(state).show).toBe(pageSize);

            state = advanceChainHistoryState(state, {
                data: { transactions: hashes(2, "tail"), nextCursor: null, hasNextPage: false },
            });

            expect(state.hasNextPage).toBeFalse();
            expect(state.cursor).toBeUndefined();
        });

        it("reads Stellar's next flag and does not continue without a cursor", () => {
            const signals = readHistoryPageSignals({ data: { transactions: hashes(pageSize), next: true } });
            const state = advanceChainHistoryState(createChainHistoryState("stellar"), {
                data: { transactions: hashes(pageSize), next: true },
            });

            expect(signals.hasNextPage).toBeTrue();
            expect(state.hasNextPage).toBeFalse();

            const done = advanceChainHistoryState(createChainHistoryState("stellar"), {
                data: { transactions: hashes(pageSize), next: false },
            });

            expect(done.hasNextPage).toBeFalse();
        });
    });

    describe("duplicates", () => {
        it("drops transaction hashes that already shifted onto the next page", () => {
            const seen = new Set(["tx-0", "tx-1"]);
            const fresh = dedupeTransactionsByHash(seen, [{ hash: "tx-1" }, { hash: "tx-2" }, { hash: " tx-2 " }, { hash: "" }]);

            expect(fresh.map((tx) => tx.hash)).toEqual(["tx-2"]);
            expect(seen.has("tx-2")).toBeTrue();
        });

        it("hides Load more when a full page is only duplicates and the cursor did not move", () => {
            const state = advanceChainHistoryState(createChainHistoryState("sui"), {
                data: { transactions: hashes(pageSize) },
            });

            expect(state.hasNextPage).toBeTrue();
            expect(hasNextPageAfterDedupe(state, 0, undefined)).toBeFalse();
            expect(hasNextPageAfterDedupe(state, 0, true, "same")).toBeFalse();
            expect(hasNextPageAfterDedupe({ ...state, cursor: "next" }, 0, true, "prev")).toBeTrue();
            expect(anyChainHasNextPage([{ ...state, hasNextPage: false }])).toBeFalse();
        });
    });

    it("builds numbered query params without turning page 0 into the old show of 25", () => {
        expect(historyQueryParams({ page: 0, show: pageSize })).toEqual({ page: 0, show: pageSize });
        expect(historyQueryParams({ page: 2, show: pageSize, cursor: "abc" })).toEqual({ page: 2, show: pageSize, cursor: "abc" });
    });
});
