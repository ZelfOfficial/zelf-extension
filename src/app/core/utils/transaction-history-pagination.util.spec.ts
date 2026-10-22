import {
    advanceChainHistoryState,
    anyChainHasNextPage,
    createChainHistoryState,
    dedupeTransactionsByHash,
    extractHistoryTransactions,
    hasNextPageAfterDedupe,
    historyQueryParams,
    historyRequestFor,
    numberedPageRange,
    stellarHistoryQueryParams,
} from "./transaction-history-pagination.util";

function hashes(count: number, prefix = "tx"): { hash: string }[] {
    return Array.from({ length: count }, (_, index) => ({ hash: `${prefix}-${index}` }));
}

describe("transaction history pagination", () => {
    describe("ethereum (1-based, nextCursor)", () => {
        const firstPage = {
            data: {
                pagination: { page: "1", records: "10", show: "10", nextCursor: "route-1" },
                transactions: hashes(10, "eth"),
            },
        };

        it("starts at page 1 and sends the cursor as nextCursor, not cursor", () => {
            const first = historyRequestFor(createChainHistoryState("ethereum"));
            const next = historyRequestFor(advanceChainHistoryState(createChainHistoryState("ethereum"), firstPage));

            expect(first).toEqual({ page: 1, show: 10, cursorParam: "nextCursor" });
            expect(historyQueryParams(first)).toEqual({ page: 1, show: 10 });
            expect(next.page).toBe(1);
            expect(next.show).toBe(10);
            expect(next.cursor).toBe("route-1");
            expect(historyQueryParams(next)).toEqual({ page: 1, show: 10, nextCursor: "route-1" });
            expect(historyQueryParams(next).cursor).toBeUndefined();
        });

        it("advances the page when the response has no cursor (etherscan fallback)", () => {
            const next = historyRequestFor(
                advanceChainHistoryState(createChainHistoryState("ethereum"), {
                    data: {
                        pagination: { page: "1", records: "10", show: "10" },
                        transactions: hashes(10, "eth"),
                    },
                })
            );

            expect(historyQueryParams(next)).toEqual({ page: 2, show: 10 });
            expect(numberedPageRange("one-based", next.page, next.show).start).toBe(10);
        });

        it("stops when the page is short", () => {
            const state = advanceChainHistoryState(createChainHistoryState("ethereum"), {
                data: { pagination: { page: "3", records: "4" }, transactions: hashes(4, "eth") },
            });

            expect(state.hasNextPage).toBeFalse();
        });
    });

    describe("optimism and arbitrum (page 0 is page 1)", () => {
        it("starts at page 1 so the first two requests are not the same window", () => {
            for (const network of ["optimism", "arbitrum"]) {
                const first = historyRequestFor(createChainHistoryState(network));
                const second = historyRequestFor(
                    advanceChainHistoryState(createChainHistoryState(network), {
                        data: {
                            pagination: { page: "1", records: "10", pages: "4" },
                            transactions: hashes(10, network),
                        },
                    })
                );

                expect(first.page).toBe(1);
                expect(first.show).toBe(second.show);
                expect(second.page).toBe(2);
                expect(numberedPageRange("one-based", second.page, second.show).start).toBe(
                    numberedPageRange("one-based", first.page, first.show).end
                );
            }
        });
    });

    describe("aptos and sui (0-based)", () => {
        it("keeps Aptos on show=10 so page 1 starts at row 10", () => {
            const state = createChainHistoryState("aptos");
            const first = historyRequestFor(state);
            const second = historyRequestFor(
                advanceChainHistoryState(state, {
                    data: {
                        pagination: { page: "0", records: "10", show: "10" },
                        transactions: hashes(10, "apt"),
                    },
                })
            );

            expect(first).toEqual({ page: 0, show: 10 });
            expect(second).toEqual({ page: 1, show: 10 });
            expect(numberedPageRange("zero-based", second.page, second.show).start).toBe(10);
            expect(second.page * second.show).not.toBe(25);
        });

        it("follows Sui's pagination.nextCursor as the cursor query param", () => {
            const next = historyRequestFor(
                advanceChainHistoryState(createChainHistoryState("sui"), {
                    data: {
                        pagination: {
                            hasNextPage: true,
                            nextCursor: "older-digest",
                            page: "0",
                            records: "10",
                            show: "10",
                        },
                        transactions: hashes(10, "sui"),
                    },
                })
            );

            expect(historyQueryParams(next)).toEqual({ page: 0, show: 10, cursor: "older-digest" });
            expect(next.page).toBe(0);
        });

        it("stops Sui when hasNextPage is false", () => {
            const state = advanceChainHistoryState(createChainHistoryState("sui"), {
                data: {
                    pagination: { hasNextPage: false, nextCursor: null, page: "1", records: "4", show: "10" },
                    transactions: hashes(4, "sui"),
                },
            });

            expect(state.hasNextPage).toBeFalse();
        });
    });

    describe("blockdag (0-based client page, show 20)", () => {
        it("requests page 0 then page 1 at show 20", () => {
            const first = historyRequestFor(createChainHistoryState("blockdag"));
            const second = historyRequestFor(
                advanceChainHistoryState(createChainHistoryState("blockdag"), {
                    data: {
                        pagination: { records: "20", pages: "3", page: "0" },
                        transactions: hashes(20, "bdag"),
                    },
                })
            );

            expect(first).toEqual({ page: 0, show: 20 });
            expect(second).toEqual({ page: 1, show: 20 });
        });
    });

    describe("chains whose API cannot page", () => {
        it("asks Solana for the 25-row window v4 showed and does not offer another page", () => {
            const first = historyRequestFor(createChainHistoryState("solana"));
            const done = advanceChainHistoryState(createChainHistoryState("solana"), {
                data: {
                    pagination: { records: "25", pages: "0", page: 0 },
                    transactions: hashes(25, "sol"),
                },
            });

            expect(historyQueryParams(first)).toEqual({ page: 0, show: 25 });
            expect(done.hasNextPage).toBeFalse();
        });

        it("asks Stellar for 25 rows and hides Load more when next is true but no cursor is returned", () => {
            const first = historyRequestFor(createChainHistoryState("stellar"));
            const done = advanceChainHistoryState(createChainHistoryState("stellar"), {
                data: { transactions: hashes(25, "xlm"), next: true },
            });

            expect(stellarHistoryQueryParams(first)).toEqual({ limit: 25, show: 25 });
            expect(done.hasNextPage).toBeFalse();
            expect(anyChainHasNextPage([done])).toBeFalse();
        });

        it("asks Bitcoin and TON for 25 rows in one shot", () => {
            for (const network of ["bitcoin", "ton"]) {
                const request = historyRequestFor(createChainHistoryState(network));
                const done = advanceChainHistoryState(createChainHistoryState(network), {
                    data: { pagination: { records: "25", page: "0", show: "25" }, transactions: hashes(25, network) },
                });

                expect(request.show).toBe(25);
                expect(done.hasNextPage).toBeFalse();
            }
        });

        it("reads Avalanche's bare data array and does not page past that window", () => {
            const rows = hashes(17, "avax").map((tx, index) => ({ ...tx, from: "0xabc", date: "2026-09-30 19:15:09" }));
            const payload = { data: rows };

            expect(extractHistoryTransactions(payload).length).toBe(17);
            expect(historyRequestFor(createChainHistoryState("avalanche")).show).toBe(100);

            const done = advanceChainHistoryState(createChainHistoryState("avalanche"), payload);

            expect(done.hasNextPage).toBeFalse();
        });

        it("treats Polygon's oversized page as the whole list", () => {
            const done = advanceChainHistoryState(createChainHistoryState("polygon"), {
                data: {
                    pagination: { records: "1000", pages: "1", page: "0" },
                    transactions: hashes(1000, "pol"),
                },
            });

            expect(done.hasNextPage).toBeFalse();
            expect(historyRequestFor(createChainHistoryState("polygon")).show).toBe(10);
        });
    });

    describe("duplicates", () => {
        it("drops hashes that shifted onto the next page", () => {
            const seen = new Set(["eth-0", "eth-1"]);
            const fresh = dedupeTransactionsByHash(seen, [{ hash: "eth-1" }, { hash: "eth-2" }, { hash: " eth-2 " }]);

            expect(fresh.map((tx) => tx.hash)).toEqual(["eth-2"]);
        });

        it("hides Load more when a full page is only duplicates", () => {
            const state = advanceChainHistoryState(createChainHistoryState("aptos"), {
                data: { pagination: { page: "1", records: "10", show: "10" }, transactions: hashes(10, "apt") },
            });

            expect(state.hasNextPage).toBeTrue();
            expect(hasNextPageAfterDedupe(state, 0, undefined)).toBeFalse();
            expect(hasNextPageAfterDedupe({ ...state, cursor: "older" }, 0, true, "prev")).toBeTrue();
        });
    });
});
