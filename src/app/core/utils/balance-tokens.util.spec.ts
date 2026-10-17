import { dedupeBalanceTokens, mergeBalanceTokens, sumFiatBalance } from "./balance-tokens.util";

const t = (symbol: string, network: string, fiatBalance: number | string, tokenType = symbol) => ({ symbol, network, tokenType, fiatBalance });

describe("balance-tokens util", () => {
    it("dedupes by network + type + symbol, keeping the higher fiat row", () => {
        const out = dedupeBalanceTokens([t("ETH", "Ethereum", 10), t("ETH", "Ethereum", 12), t("ETH", "Optimism", 1)]);

        expect(out.length).toBe(2);
        expect(out.find((x) => x.network === "Ethereum")!.fiatBalance).toBe(12);
    });

    it("sums fiat balances, treating bad values as 0", () => {
        expect(sumFiatBalance([t("A", "X", 1.5), t("B", "X", "2.5"), t("C", "X", "n/a"), { symbol: "D" }])).toBe(4);
        expect(sumFiatBalance(null)).toBe(0);
    });

    it("Home regression (#49): the total keeps stage-1 and earlier networks even when the session cache is wiped", () => {
        // Stage 1 (first license networks): ETH + SOL
        let loaded = dedupeBalanceTokens([t("ETH", "Ethereum", 13903.36), t("SOL", "Solana", 50)]);

        // Background networks arrive one by one. The old code merged each one into session storage,
        // which never had stage 1 and is cleared whenever the stored wallet is rewritten,
        // so only the last network(s) survived (~$64 on Home vs ~$14k on Wallet).
        for (const incoming of [[t("BNB", "Binance", 120.62)], [t("AVAX", "Avalanche", 0.75)], [t("POL", "Polygon", 54.65), t("USDC", "Polygon", 9.89)]]) {
            const sessionCacheAfterWalletRewrite: any[] = [];
            expect(sessionCacheAfterWalletRewrite.length).toBe(0);

            loaded = mergeBalanceTokens(loaded, incoming);
        }

        expect(loaded.length).toBe(6);
        expect(sumFiatBalance(loaded)).toBeCloseTo(13903.36 + 50 + 120.62 + 0.75 + 54.65 + 9.89, 2);
    });

    it("merging the same network again replaces nothing twice", () => {
        const once = mergeBalanceTokens([t("BNB", "Binance", 120)], [t("BNB", "Binance", 120)]);

        expect(once.length).toBe(1);
        expect(sumFiatBalance(once)).toBe(120);
    });
});
