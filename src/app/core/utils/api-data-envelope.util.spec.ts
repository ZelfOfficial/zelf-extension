import { ensureDataEnvelope } from "./api-data-envelope.util";

describe("ensureDataEnvelope", () => {
    const bare = {
        address: "0xabc",
        balance: 0.18,
        tokenHoldings: { total: 1, balance: "0", tokens: [{ symbol: "ETH", amount: "0.18" }] },
    };

    it("wraps a bare address payload (Optimism/Arbitrum/Base shape) in { data }", () => {
        const wrapped = ensureDataEnvelope(bare);

        expect(wrapped).toEqual({ data: bare });
        expect(wrapped.data.tokenHoldings.tokens[0].symbol).toBe("ETH");
    });

    it("leaves an already wrapped payload untouched", () => {
        const already = { data: bare };

        expect(ensureDataEnvelope(already)).toBe(already);
    });

    it("leaves error payloads untouched", () => {
        const err = { error: "Internal server error" };

        expect(ensureDataEnvelope(err)).toBe(err);
    });

    it("passes through null, undefined, arrays and primitives", () => {
        expect(ensureDataEnvelope(null)).toBeNull();
        expect(ensureDataEnvelope(undefined)).toBeUndefined();
        expect(ensureDataEnvelope([])).toEqual([]);
        expect(ensureDataEnvelope("x")).toBe("x");
    });
});
