import { dedupeBalanceTokens, mergeBalanceTokens, sumFiatBalance } from "./balance-tokens.util";

const t = (symbol: string, network: string, fiatBalance: number | string, tokenType = symbol) => ({ symbol, network, tokenType, fiatBalance });

describe("balance-tokens util", () => {
    it("dedupes by network + type + symbol, keeping the higher fiat row", () => {
        const out = dedupeBalanceTokens([t("ETH", "Ethereum", 10), t("ETH", "Ethereum", 12), t("ETH", "Optimism", 1)]);

        expect(out.length).toBe(2);
        expect(out.find((x) => x.network === "Ethereum")!.fiatBalance).toBe(12);
    });

    it("dedupes by chain identity, not display name, and keeps distinct ETH chains", () => {
        const out = dedupeBalanceTokens([
            t("ETH", "Ethereum", 10),
            t("ETH", "Ether", 4),
            t("ETH", "ETH", 1),
            { symbol: "ETH", network: "Optimism", tokenType: "ETH", name: "Ethereum", fiatBalance: 2 },
            { symbol: "ETH", network: "Arbitrum", tokenType: "ETH", name: "Ethereum", fiatBalance: 3 },
            { symbol: "SUI", network: "Sui", tokenType: "0xabc::spam::SUI", name: "Sui", fiatBalance: 1 },
            t("SUI", "Sui", 8),
        ]);

        const chains = out.map((row) => `${row.network}:${row.symbol}:${row.tokenType}`).sort();

        expect(out.filter((row) => row.symbol === "ETH" && row.network !== "Optimism" && row.network !== "Arbitrum").length).toBe(1);
        expect(out.find((row) => row.network === "Ethereum" || row.network === "Ether" || row.network === "ETH")!.fiatBalance).toBe(10);
        expect(out.find((row) => row.network === "Optimism")!.fiatBalance).toBe(2);
        expect(out.find((row) => row.network === "Arbitrum")!.fiatBalance).toBe(3);
        expect(out.filter((row) => row.symbol === "SUI").length).toBe(2);
        expect(chains).toContain("Optimism:ETH:ETH");
    });

    it("treats legacy MATIC and POL as one Polygon native card", () => {
        const out = dedupeBalanceTokens([
            { symbol: "POL", network: "Polygon", tokenType: "MATIC", name: "Polygon", fiatBalance: 53.7, amount: 592.7198 },
            { symbol: "MATIC", network: "Polygon", tokenType: "MATIC", name: "Matic", fiatBalance: 53.7, amount: 592.7198 },
            { symbol: "USDC", network: "Polygon", tokenType: "ERC-20", fiatBalance: 2, amount: 2 },
        ]);

        expect(out.filter((row) => row.symbol === "POL" || row.symbol === "MATIC").length).toBe(1);
        expect(out.find((row) => row.symbol === "USDC")).toBeTruthy();
        expect(sumFiatBalance(out)).toBeCloseTo(55.7, 2);
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

    it("a newer reported 0 replaces a stale balance, and a placeholder does not", () => {
        const spent = mergeBalanceTokens([t("ETH", "Ethereum", 120)], [t("ETH", "Ethereum", 0)]);

        expect(spent.length).toBe(1);
        expect(sumFiatBalance(spent)).toBe(0);

        const kept = mergeBalanceTokens(
            [t("ETH", "Ethereum", 120)],
            [{ symbol: "ETH", network: "Ethereum", tokenType: "ETH", amount: null, balance: null, fiatBalance: null } as any]
        );

        expect(sumFiatBalance(kept)).toBe(120);
    });
});
