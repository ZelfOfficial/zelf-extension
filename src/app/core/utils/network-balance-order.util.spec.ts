import {
    buildNetworkFiatTotals,
    effectiveNetworkUsd,
    networkFiatTotalsFromTokens,
    orderTokensByNetworkBalance,
    sortNetworkIdsByBalance,
    sumReportedNetworkUsd,
} from "./network-balance-order.util";

const token = (symbol: string, network: string, fiat: number | null, tokenType = symbol, extra: Record<string, unknown> = {}) => ({
    symbol,
    network,
    tokenType,
    amount: fiat === null ? null : 1,
    fiatBalance: fiat,
    ...extra,
});

const DEFAULT_ORDER = ["ethereum", "solana", "bitcoin", "polygon", "stellar"];

describe("network balance order", () => {
    it("sums every asset on a chain into one USD total", () => {
        const tokens = [token("ETH", "Ethereum", 1), token("USDC", "Ethereum", 50, "ERC-20"), token("SOL", "Solana", 40)];

        expect(sumReportedNetworkUsd(tokens, "ethereum")).toBe(51);
        expect(sumReportedNetworkUsd(tokens, "solana")).toBe(40);
        expect(sumReportedNetworkUsd([token("ETH", "Ethereum", null)], "ethereum")).toBeNull();
    });

    it("orders chains by total USD, highest first, with the default order as a tie-break", () => {
        const tokens = [
            token("ETH", "Ethereum", 0.43),
            token("SOL", "Solana", 0.08),
            token("ZNS", "Solana", 0, "SPL"),
            token("POL", "Polygon", 0.29),
            token("XLM", "Stellar", 0.87),
            token("BTC", "Bitcoin", 0),
        ];

        expect(sortNetworkIdsByBalance(DEFAULT_ORDER, tokens)).toEqual(["stellar", "ethereum", "polygon", "solana", "bitcoin"]);
    });

    it("puts confirmed zero chains last and keeps equal values in the current default order", () => {
        const tokens = [token("ETH", "Ethereum", 0), token("SOL", "Solana", 0), token("BTC", "Bitcoin", 2)];

        expect(sortNetworkIdsByBalance(["ethereum", "solana", "bitcoin"], tokens)).toEqual(["bitcoin", "ethereum", "solana"]);
    });

    it("keeps a chain that is still loading ahead of confirmed zeros", () => {
        const tokens = [token("BTC", "Bitcoin", 0), token("ETH", "Ethereum", null)];
        const status = { ethereum: "loading", bitcoin: "loaded", solana: "pending" };

        expect(sortNetworkIdsByBalance(["bitcoin", "solana", "ethereum"], tokens, status)).toEqual(["solana", "ethereum", "bitcoin"]);
    });

    it("keeps the previous order while balances are loading when a last-known total exists", () => {
        const status = { stellar: "pending", ethereum: "loading", solana: "pending", bitcoin: "pending", polygon: "pending" };
        const lastKnown = { stellar: 5, ethereum: 1, bitcoin: 0 };

        expect(sortNetworkIdsByBalance(DEFAULT_ORDER, [], status, lastKnown)).toEqual(["stellar", "ethereum", "solana", "polygon", "bitcoin"]);
    });

    it("does not treat a failed query as a zero balance", () => {
        const tokens = [token("BTC", "Bitcoin", 0)];
        const status = { ethereum: "error", bitcoin: "loaded", solana: "loaded" };

        expect(effectiveNetworkUsd("ethereum", tokens, "error", null)).toBeNull();
        expect(sortNetworkIdsByBalance(["bitcoin", "ethereum", "solana"], tokens, status)).toEqual(["ethereum", "bitcoin", "solana"]);
    });

    it("keeps a failed query at its last known value", () => {
        const status = { ethereum: "error", solana: "loaded", bitcoin: "loaded" };
        const tokens = [token("SOL", "Solana", 3), token("BTC", "Bitcoin", 0)];

        expect(sortNetworkIdsByBalance(["solana", "bitcoin", "ethereum"], tokens, status, { ethereum: 10 })).toEqual([
            "ethereum",
            "solana",
            "bitcoin",
        ]);
    });

    it("moves a chain when its loaded balance replaces the last known value", () => {
        const tokens = [token("ETH", "Ethereum", 0), token("SOL", "Solana", 4)];
        const status = { ethereum: "loaded", solana: "loaded" };

        expect(sortNetworkIdsByBalance(["ethereum", "solana"], tokens, status, { ethereum: 25 })).toEqual(["solana", "ethereum"]);
    });

    it("uses amount times price when fiat was not filled in", () => {
        const priced = token("ETH", "Ethereum", 0, "ETH", { amount: 2, price: 3 });

        expect(sumReportedNetworkUsd([priced], "ethereum")).toBe(6);
    });

    it("groups token rows by chain total, then by each token's USD", () => {
        const tokens = [
            token("BTC", "Bitcoin", 0),
            token("ZNS", "Solana", 0, "SPL"),
            token("SOL", "Solana", 0.08),
            token("ETH", "Ethereum", 1),
            token("USDC", "Ethereum", 50, "ERC-20"),
        ];

        expect(orderTokensByNetworkBalance(tokens).map((row) => `${row.symbol}:${row.network}`)).toEqual([
            "USDC:Ethereum",
            "ETH:Ethereum",
            "SOL:Solana",
            "ZNS:Solana",
            "BTC:Bitcoin",
        ]);
    });

    it("keeps pinned tokens above the balance order", () => {
        const tokens = [token("ETH", "Ethereum", 20), token("BTC", "Bitcoin", 0, "BTC", { isPinned: true })];

        expect(orderTokensByNetworkBalance(tokens, { pinnedFirst: true }).map((row) => row.symbol)).toEqual(["BTC", "ETH"]);
    });

    it("remembers a loaded empty chain as zero and keeps an untouched chain", () => {
        const totals = buildNetworkFiatTotals([token("ETH", "Ethereum", 10)], ["ethereum", "bitcoin"], { polygon: 8, ethereum: 1 });

        expect(totals).toEqual({ polygon: 8, ethereum: 10, bitcoin: 0 });
        expect(networkFiatTotalsFromTokens([token("ETH", "Ethereum", 10)])).toEqual({ ethereum: 10 });
    });
});
