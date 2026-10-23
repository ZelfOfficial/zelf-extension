import { applyEnvelopeNativeBalance, applyResponseEnvelopes, resolveTokenFiat } from "./token-balance.util";

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

        expect(created.length).toBe(1);
        expect(created[0].network).toBe("Ethereum");
        expect(created[0].amount).toBe(2);
        expect(created[0].fiatBalance).toBe(200);
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
