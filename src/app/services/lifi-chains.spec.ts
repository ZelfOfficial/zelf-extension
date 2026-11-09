import { lifiBucketKeyToNetwork, lifiChainIdForNetwork, lifiTokenCatalogChainIds, lifiWalletSymbolForChainKey } from "./lifi-chains";

describe("LI.FI chain ids", () => {
    const expected: Array<[string, string]> = [
        ["ethereum", "1"],
        ["optimism", "10"],
        ["arbitrum", "42161"],
        ["base", "8453"],
        ["avalanche", "43114"],
        ["polygon", "137"],
        ["binance", "56"],
        ["bnb", "56"],
        ["bsc", "56"],
        ["solana", "1151111081099710"],
        ["sui", "9270000000000000"],
        ["bitcoin", "20000000000001"],
        ["btc", "20000000000001"],
    ];

    expected.forEach(([network, chainId]) => {
        it(`maps ${network} to chain id ${chainId}`, () => {
            expect(lifiChainIdForNetwork(network)).toBe(chainId);
            expect(lifiChainIdForNetwork(network.toUpperCase())).toBe(chainId);
        });
    });

    it("does not send the rejected BNB chain key", () => {
        expect(lifiChainIdForNetwork("binance")).not.toBe("BNB");
        expect(lifiChainIdForNetwork("BNB")).toBe("56");
        expect(lifiTokenCatalogChainIds()).toContain("56");
        expect(lifiTokenCatalogChainIds().join(",")).not.toContain("BNB");
    });

    it("leaves unsupported networks out of the LI.FI query", () => {
        expect(lifiChainIdForNetwork("stellar")).toBeNull();
        expect(lifiChainIdForNetwork("ton")).toBeNull();
        expect(lifiChainIdForNetwork("")).toBeNull();
        expect(lifiBucketKeyToNetwork("FOO")).toBe("unknown");
    });

    it("maps response buckets for the audited chains back to internal networks", () => {
        expect(lifiBucketKeyToNetwork("56")).toBe("binance");
        expect(lifiBucketKeyToNetwork("BSC")).toBe("binance");
        expect(lifiBucketKeyToNetwork("BNB")).toBe("binance");
        expect(lifiBucketKeyToNetwork("1")).toBe("ethereum");
        expect(lifiBucketKeyToNetwork("10")).toBe("optimism");
        expect(lifiBucketKeyToNetwork("OPT")).toBe("optimism");
        expect(lifiBucketKeyToNetwork("42161")).toBe("arbitrum");
        expect(lifiBucketKeyToNetwork("8453")).toBe("base");
        expect(lifiBucketKeyToNetwork("43114")).toBe("avalanche");
        expect(lifiBucketKeyToNetwork("137")).toBe("polygon");
        expect(lifiBucketKeyToNetwork("1151111081099710")).toBe("solana");
        expect(lifiBucketKeyToNetwork("SOL")).toBe("solana");
        expect(lifiBucketKeyToNetwork("9270000000000000")).toBe("sui");
        expect(lifiBucketKeyToNetwork("SUI")).toBe("sui");
        expect(lifiBucketKeyToNetwork("20000000000001")).toBe("bitcoin");
        expect(lifiBucketKeyToNetwork("BTC")).toBe("bitcoin");
        expect(lifiWalletSymbolForChainKey("56")).toBe("BNB");
        expect(lifiWalletSymbolForChainKey("bsc")).toBe("BNB");
        expect(lifiWalletSymbolForChainKey("20000000000001")).toBe("BTC");
    });
});
