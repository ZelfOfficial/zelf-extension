import { blockdagHistoryNeedsExplorerFallback, blockscoutHistoryPage, mapBlockscoutTransaction } from "./blockdag-blockscout-history.util";

const ADDRESS = "0x1BC125bC681685f216935798453F70fb423eB392";

describe("blockdag blockscout history", () => {
    it("keeps the chain timestamp as the calendar date", () => {
        const row = mapBlockscoutTransaction(
            {
                hash: "0xabc",
                timestamp: "2026-06-17T02:25:39.000000Z",
                from: { hash: "0x1111111111111111111111111111111111111111" },
                to: { hash: ADDRESS },
                value: "102485000000000000",
                status: "ok",
                result: "success",
                raw_input: "0x",
            },
            ADDRESS
        );

        expect(row["date"]).toBe("2026-06-17 02:25:39");
        expect(row["traffic"]).toBe("IN");
        expect(row["amount"]).toBe("0.102485");
        expect(row["asset"]).toBe("BDAG");
        expect(row["timestamp"]).toBe(Math.floor(Date.parse("2026-06-17T02:25:39.000000Z") / 1000));
    });

    it("asks the explorer again only when the API did not actually answer", () => {
        expect(blockdagHistoryNeedsExplorerFallback({ data: { transactions: [] } })).toBeTrue();
        expect(blockdagHistoryNeedsExplorerFallback({ data: { transactions: [], transactionsUnavailable: true, error: "HISTORY_UNAVAILABLE" } })).toBeTrue();
        expect(blockdagHistoryNeedsExplorerFallback({ data: { transactions: [], source: "bdagscan" } })).toBeFalse();
        expect(blockdagHistoryNeedsExplorerFallback({ data: { transactions: [{ hash: "0x1" }] } })).toBeFalse();
    });

    it("slices the requested page", () => {
        const items = Array.from({ length: 3 }, (_, index) => ({
            hash: `0x${index}`,
            timestamp: "2026-06-17T02:25:39.000000Z",
            from: { hash: ADDRESS },
            to: { hash: "0x2222222222222222222222222222222222222222" },
            value: "1000000000000000000",
            status: "ok",
        }));
        const page = blockscoutHistoryPage(items, ADDRESS, 0, 2, true);

        expect(page.data.transactions.length).toBe(2);
        expect(page.data.hasNextPage).toBeTrue();
        expect(page.data.source).toBe("blockscout");
    });
});
