import { dedupeBalanceTokens, sumFiatBalance } from "./balance-tokens.util";
import { applyEnvelopeNativeBalance, applyResponseEnvelopes, isNativeChainToken, resolveTokenFiat } from "./token-balance.util";

describe("token balance reports", () => {
    it("uses amount × price when fiat is 0 and keeps a true 0", () => {
        expect(resolveTokenFiat({ fiatBalance: "0" }, 1.5, 2000)).toBe(3000);
        expect(resolveTokenFiat({ fiatBalance: "0" }, 0, 2389.89)).toBe(0);
        expect(resolveTokenFiat({ fiatBalance: null }, null, 2389.89)).toBeNull();
    });

    it("copies a positive envelope balance onto a native row that reported 0", () => {
        const updated = applyEnvelopeNativeBalance(
            [{ symbol: "ETH", name: "Ethereum", network: "Optimism", tokenType: "ETH", amount: 0, balance: 0, price: "2389.89", fiatBalance: 0 }],
            "Optimism",
            { balance: "0.18107", account: { price: "2389.89" }, fiatBalance: 0 }
        );

        expect(updated.length).toBe(1);
        expect(updated[0].network).toBe("Optimism");
        expect(updated[0].amount).toBeCloseTo(0.18107, 5);
        expect(updated[0].fiatBalance).toBeCloseTo(0.18107 * 2389.89, 2);
    });

    it("creates the native row from the envelope when the token list was empty", () => {
        const created = applyResponseEnvelopes<Record<string, any>>([], {
            ethereum: { data: { balance: "2", account: { price: "100" }, tokenHoldings: { tokens: [] } } },
            optimism: { data: { balance: "0", account: { price: "100" }, tokenHoldings: { tokens: [] } } },
        });

        expect(created.find((token) => token.network === "Ethereum")!.amount).toBe(2);
        expect(created.find((token) => token.network === "Ethereum")!.fiatBalance).toBe(200);
        expect(created.find((token) => token.network === "Optimism")!.amount).toBe(0);
        expect(created.filter((token) => token.network === "Optimism").length).toBe(1);
    });

    it("keeps one Polygon card when the API types the native coin as MATIC", () => {
        const matic = {
            symbol: "POL",
            name: "Polygon",
            network: "Polygon",
            tokenType: "MATIC",
            amount: 592.7198,
            balance: 592.7198,
            price: 0.0906,
            fiatBalance: 53.7,
        };

        expect(isNativeChainToken(matic)).toBeTrue();

        const withEnvelope = applyResponseEnvelopes([matic], {
            polygon: {
                data: {
                    balance: "592.7198",
                    fiatBalance: 53.7,
                    account: { price: "0.0906" },
                    tokenHoldings: { tokens: [matic] },
                },
            },
        });
        const collapsed = dedupeBalanceTokens([
            matic,
            { symbol: "POL", name: "Polygon", network: "Polygon", tokenType: "POL", amount: 592.7198, balance: 592.7198, fiatBalance: 53.7 },
        ]);

        expect(withEnvelope.length).toBe(1);
        expect(withEnvelope[0].amount).toBeCloseTo(592.7198, 4);
        expect(collapsed.length).toBe(1);
        expect(sumFiatBalance(collapsed)).toBeCloseTo(53.7, 2);
    });

    it("does not replace a reported native balance with a zero envelope", () => {
        const kept = applyEnvelopeNativeBalance(
            [{ symbol: "BDAG", name: "BlockDAG", network: "BlockDAG", tokenType: "BDAG", amount: 4, fiatBalance: 0.2, price: 0.05 }],
            "BlockDAG",
            { balance: "0", fiatBalance: "0", account: { price: "0" }, tokenHoldings: { tokens: [] } }
        );

        expect(kept.length).toBe(1);
        expect(kept[0].amount).toBe(4);
    });

    it("does not move an Optimism balance onto Ethereum", () => {
        const updated = applyResponseEnvelopes(
            [
                { symbol: "ETH", name: "Ethereum", network: "Ethereum", tokenType: "ETH", amount: 1, fiatBalance: 100, price: 100 },
                { symbol: "ETH", name: "Ethereum", network: "Optimism", tokenType: "ETH", amount: 0, fiatBalance: 0, price: 100 },
            ],
            { optimism: { data: { balance: "0.5", account: { price: "100" } } } }
        );

        expect(updated.find((token) => token.network === "Ethereum")!.amount).toBe(1);
        expect(updated.find((token) => token.network === "Optimism")!.amount).toBe(0.5);
    });
});
