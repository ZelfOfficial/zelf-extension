import { LifiService } from "./lifi.service";

describe("LifiService chain identifiers (#146)", () => {
    function service(): LifiService {
        return new LifiService({} as any, {} as any, {} as any);
    }

    it("maps optimism, arbitrum, and base to OPT, ARB, and BAS instead of ETH", () => {
        const s = service();

        expect(s.getChainIdentifier("ethereum")).toBe("ETH");
        expect(s.getChainIdentifier("optimism")).toBe("OPT");
        expect(s.getChainIdentifier("arbitrum")).toBe("ARB");
        expect(s.getChainIdentifier("base")).toBe("BAS");
        expect(s.getChainIdentifier("avalanche")).toBe("AVA");
        expect(s.getChainIdentifier("polygon")).toBe("POL");
        expect(s.getChainIdentifier("binance")).toBe("BNB");
        expect(s.getChainIdentifier("solana")).toBe("SOL");
    });

    it("maps numeric chain IDs 10, 8453, and 42161 to OPT, BAS, and ARB", () => {
        const s = service();

        expect(s.getChainIdentifierFromChainId(1)).toBe("ETH");
        expect(s.getChainIdentifierFromChainId(10)).toBe("OPT");
        expect(s.getChainIdentifierFromChainId(8453)).toBe("BAS");
        expect(s.getChainIdentifierFromChainId(42161)).toBe("ARB");
        expect(s.getChainIdentifierFromChainId(43114)).toBe("AVA");
    });

    it("resolves chainBucketKeyToInternalNetwork for OPT, ARB, and BAS", () => {
        const s = service();

        expect(s.chainBucketKeyToInternalNetwork("OPT")).toBe("optimism");
        expect(s.chainBucketKeyToInternalNetwork("ARB")).toBe("arbitrum");
        expect(s.chainBucketKeyToInternalNetwork("BAS")).toBe("base");
        expect(s.chainBucketKeyToInternalNetwork(10)).toBe("optimism");
        expect(s.chainBucketKeyToInternalNetwork(42161)).toBe("arbitrum");
        expect(s.chainBucketKeyToInternalNetwork(8453)).toBe("base");
    });
});
