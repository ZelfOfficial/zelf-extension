import { filterTokensByEnabledNetworkIds, tokenNetworkToLicenseId } from "./token-network-id.util";

describe("token-network-id.util", () => {
    it("maps display network labels to license ids", () => {
        expect(tokenNetworkToLicenseId("Ethereum")).toBe("ethereum");
        expect(tokenNetworkToLicenseId("Binance")).toBe("binance");
        expect(tokenNetworkToLicenseId("BlockDAG")).toBe("blockdag");
    });

    it("filters tokens using license ids, not raw labels", () => {
        const tokens = [
            { symbol: "ETH", network: "Ethereum", fiatBalance: 10 },
            { symbol: "BNB", network: "Binance", fiatBalance: 5 },
            { symbol: "SOL", network: "Solana", fiatBalance: 1 },
        ];

        const filtered = filterTokensByEnabledNetworkIds(tokens, ["ethereum", "solana"]);

        expect(filtered.map((t) => t.symbol)).toEqual(["ETH", "SOL"]);
    });
});
