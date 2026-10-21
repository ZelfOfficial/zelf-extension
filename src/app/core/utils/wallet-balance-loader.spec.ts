import {
    createNetworkStatusMap,
    displayTotalFiatBalance,
    mergeBalanceCacheSnapshots,
    networksStillSyncing,
    shouldDeferZeroTotalDisplay,
} from "./wallet-balance-loader";

describe("wallet-balance-loader helpers", () => {
    it("tracks pending/loading networks as syncing", () => {
        const status = createNetworkStatusMap(["ethereum", "polygon"]);

        status.ethereum = "loading";

        expect(networksStillSyncing(status)).toBe(true);
        status.ethereum = "loaded";
        status.polygon = "loaded";
        expect(networksStillSyncing(status)).toBe(false);
    });

    it("defers showing $0 while networks are still loading when a last-known total exists", () => {
        const status = createNetworkStatusMap(["ethereum", "bsc"]);
        status.ethereum = "loaded";
        status.bsc = "loading";

        expect(shouldDeferZeroTotalDisplay(0, status, 1200)).toBe(true);
        expect(displayTotalFiatBalance(0, status, 1200)).toBe(1200);
    });

    it("shows 0 once every network has settled", () => {
        const status = createNetworkStatusMap(["ethereum"]);
        status.ethereum = "loaded";

        expect(shouldDeferZeroTotalDisplay(0, status, 500)).toBe(false);
        expect(displayTotalFiatBalance(0, status, 500)).toBe(0);
    });

    it("merges balance cache snapshots per wallet tag", () => {
        const prev = {
            tagName: "alice",
            tokens: [{ symbol: "ETH", network: "Ethereum", fiatBalance: 10 }],
            totalFiatBalance: 10,
            loadedNetworkIds: ["ethereum"],
            updatedAtMs: 1,
        };
        const next = {
            tagName: "alice",
            tokens: [{ symbol: "BNB", network: "Binance", fiatBalance: 5 }],
            totalFiatBalance: 5,
            loadedNetworkIds: ["binance"],
            updatedAtMs: 2,
        };

        const merged = mergeBalanceCacheSnapshots(prev, next);

        expect(merged.tokens.length).toBe(2);
        expect(merged.totalFiatBalance).toBe(15);
        expect(merged.loadedNetworkIds).toEqual(["ethereum", "binance"]);
    });
});
