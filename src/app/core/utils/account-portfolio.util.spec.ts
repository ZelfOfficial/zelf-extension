import { selectAccountPortfolioSeed } from "./account-portfolio.util";

const row = (symbol: string, network: string, fiat: number, tokenType = symbol) => ({
    symbol,
    network,
    tokenType,
    fiatBalance: fiat,
    amount: fiat,
});

const aliceRows = [row("USDT", "Ethereum", 1000, "ERC-20"), row("PEPE", "Ethereum", 50, "ERC-20"), row("UNI", "Ethereum", 20, "ERC-20"), row("AVAX", "Avalanche", 80)];
const bobNative = [row("ETH", "Ethereum", 0), row("POL", "Polygon", 0)];

describe("account portfolio seed", () => {
    it("does not leak account A into account B", () => {
        const seed = selectAccountPortfolioSeed({
            accountId: "bob.zelf",
            inMemoryAccountId: "alice.zelf",
            inMemoryTokens: aliceRows,
            sessionAccountId: "alice.zelf",
            sessionTokens: aliceRows,
            persistedByAccount: {
                "alice.zelf": aliceRows,
                "bob.zelf": bobNative,
            },
        });

        expect(seed.map((token) => token.symbol).sort()).toEqual(["ETH", "POL"]);
        expect(seed.some((token) => token.fiatBalance > 0)).toBeFalse();
    });

    it("restores account A when switching back and does not keep B's in-memory rows", () => {
        const seed = selectAccountPortfolioSeed({
            accountId: "alice.zelf",
            inMemoryAccountId: "bob.zelf",
            inMemoryTokens: bobNative,
            sessionAccountId: "bob.zelf",
            sessionTokens: bobNative,
            persistedByAccount: {
                "alice.zelf": aliceRows,
                "bob.zelf": bobNative,
            },
        });

        expect(seed.map((token) => token.symbol).sort()).toEqual(["AVAX", "PEPE", "UNI", "USDT"]);
        expect(seed.some((token) => token.symbol === "POL" && token.fiatBalance === 0)).toBeFalse();
    });

    it("keeps a failed refetch on the same account from falling back to the other account", () => {
        const seed = selectAccountPortfolioSeed({
            accountId: "bob.zelf",
            inMemoryAccountId: "bob.zelf",
            inMemoryTokens: bobNative,
            sessionAccountId: "alice.zelf",
            sessionTokens: aliceRows,
            persistedByAccount: { "alice.zelf": aliceRows },
        });

        expect(seed).toEqual(bobNative);
    });
});
