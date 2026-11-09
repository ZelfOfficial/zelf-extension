import { of, throwError } from "rxjs";

import { LifiService } from "./lifi.service";
import { lifiTokenCatalogChainIds } from "./lifi-chains";

describe("LifiService chain identifiers", () => {
    function service(): LifiService {
        return new LifiService({} as any, {} as any, {} as any);
    }

    it("maps internal networks to numeric LI.FI chain ids", () => {
        const s = service();

        expect(s.getChainIdentifier("ethereum")).toBe("1");
        expect(s.getChainIdentifier("optimism")).toBe("10");
        expect(s.getChainIdentifier("arbitrum")).toBe("42161");
        expect(s.getChainIdentifier("base")).toBe("8453");
        expect(s.getChainIdentifier("avalanche")).toBe("43114");
        expect(s.getChainIdentifier("polygon")).toBe("137");
        expect(s.getChainIdentifier("binance")).toBe("56");
        expect(s.getChainIdentifier("BNB")).toBe("56");
        expect(s.getChainIdentifier("solana")).toBe("1151111081099710");
        expect(s.getChainIdentifier("sui")).toBe("9270000000000000");
        expect(s.getChainIdentifier("bitcoin")).toBe("20000000000001");
    });

    it("does not turn an unsupported network into a chain key that would fail the batch", () => {
        const s = service();

        expect(s.getChainIdentifier("stellar")).toBe("");
        expect(s.getChainIdentifier("ton")).toBe("");
    });

    it("keeps quote and step-transaction chain ids numeric, including BSC 56", () => {
        const s = service();

        expect(s.getChainIdentifierFromChainId(1)).toBe("1");
        expect(s.getChainIdentifierFromChainId(10)).toBe("10");
        expect(s.getChainIdentifierFromChainId(56)).toBe("56");
        expect(s.getChainIdentifierFromChainId("BNB")).toBe("56");
        expect(s.getChainIdentifierFromChainId(8453)).toBe("8453");
        expect(s.getChainIdentifierFromChainId(42161)).toBe("42161");
        expect(s.getChainIdentifierFromChainId(43114)).toBe("43114");
        expect(s.getChainIdentifierFromChainId("9270000000000000")).toBe("9270000000000000");
        expect(s.getChainIdentifierFromChainId("20000000000001")).toBe("20000000000001");
        expect(s.getChainIdentifierFromChainId("FOO")).toBe("");
    });

    it("resolves token buckets for Optimism, Arbitrum, Base, Sui, and Bitcoin", () => {
        const s = service();

        expect(s.chainBucketKeyToInternalNetwork("OPT")).toBe("optimism");
        expect(s.chainBucketKeyToInternalNetwork("ARB")).toBe("arbitrum");
        expect(s.chainBucketKeyToInternalNetwork("BAS")).toBe("base");
        expect(s.chainBucketKeyToInternalNetwork(10)).toBe("optimism");
        expect(s.chainBucketKeyToInternalNetwork(42161)).toBe("arbitrum");
        expect(s.chainBucketKeyToInternalNetwork(8453)).toBe("base");
        expect(s.chainBucketKeyToInternalNetwork("9270000000000000")).toBe("sui");
        expect(s.chainBucketKeyToInternalNetwork("20000000000001")).toBe("bitcoin");
        expect(s.chainBucketKeyToInternalNetwork("56")).toBe("binance");
    });
});

describe("LifiService.requestTokens", () => {
    function token(chainId: string) {
        return {
            symbol: "T",
            address: "0x1",
            chainId,
            decimals: 18,
            coinKey: "T",
            name: "T",
            logoURI: "",
            priceUSD: "1",
        };
    }

    function http(failWhen: (chains: string) => boolean) {
        const calls: string[] = [];
        const client = {
            calls,
            get(_url: string, options?: { params?: { chains?: string } }) {
                const chains = String(options?.params?.chains || "");

                calls.push(chains);

                if (failWhen(chains)) return throwError(() => ({ status: 400 }));

                const tokens: Record<string, ReturnType<typeof token>[]> = {};

                for (const id of chains.split(",").filter(Boolean)) tokens[id] = [token(id)];

                return of({ data: { tokens } });
            },
        };

        return client;
    }

    it("asks for numeric chain ids and never sends BNB", async () => {
        const client = http(() => false);
        const s = new LifiService(client as any, {} as any, {} as any);

        const result = await s.requestTokens();

        expect(client.calls.length).toBe(1);
        expect(client.calls[0].split(",")).toEqual(lifiTokenCatalogChainIds());
        expect(client.calls[0]).not.toContain("BNB");
        expect(client.calls[0]).toContain("56");
        expect(result.tokens["56"]?.[0].symbol).toBe("T");
        expect(result.tokens["1151111081099710"]?.[0].symbol).toBe("T");
        expect(result.tokens["9270000000000000"]?.[0].symbol).toBe("T");
        expect(result.tokens["20000000000001"]?.[0].symbol).toBe("T");
    });

    it("requests only chain 56 when the picker is locked to BNB Chain", async () => {
        const client = http(() => false);
        const s = new LifiService(client as any, {} as any, {} as any);

        const result = await s.requestTokens("binance");

        expect(client.calls).toEqual(["56"]);
        expect(Object.keys(result.tokens)).toEqual(["56"]);
    });

    it("skips an unsupported locked chain instead of fetching the whole catalog", async () => {
        const client = http(() => false);
        const s = new LifiService(client as any, {} as any, {} as any);

        const result = await s.requestTokens("stellar");

        expect(client.calls).toEqual([]);
        expect(result.tokens).toEqual({});
    });

    it("keeps the other chains when one chain id is rejected", async () => {
        const rejected = "20000000000001";
        const client = http((chains) => chains.split(",").length > 1 || chains === rejected);
        const s = new LifiService(client as any, {} as any, {} as any);

        const result = await s.requestTokens();
        const loaded = Object.keys(result.tokens);

        expect(client.calls[0].split(",").length).toBeGreaterThan(1);
        expect(loaded).toContain("1");
        expect(loaded).toContain("56");
        expect(loaded).toContain("1151111081099710");
        expect(loaded).toContain("9270000000000000");
        expect(loaded).not.toContain(rejected);
        expect(client.calls).toContain(rejected);
    });
});
