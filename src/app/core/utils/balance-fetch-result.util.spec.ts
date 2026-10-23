import { applyResponseEnvelopes } from "./token-balance.util";
import { balanceFetchFailure, balancePayloadFailed, failedBalanceFetch, isBalanceFetchFailure } from "./balance-fetch-result.util";

const polygon = {
    symbol: "POL",
    name: "Polygon",
    network: "Polygon",
    tokenType: "MATIC",
    amount: 592.7198,
    balance: 592.7198,
    fiatBalance: 53.7,
    price: 0.0906,
};

describe("balance fetch failures", () => {
    it("classifies timeout, rate limit, and other errors", () => {
        expect(failedBalanceFetch(new Error("BlockDAG request timeout")).reason).toBe("timeout");
        expect(failedBalanceFetch({ status: 429, message: "slow down" }).reason).toBe("rate_limited");
        expect(failedBalanceFetch(new Error("network down")).reason).toBe("error");
        expect(isBalanceFetchFailure(balanceFetchFailure("timeout"))).toBeTrue();
    });

    it("does not turn a timeout or error into a 0 card or replace a known balance", () => {
        for (const reason of ["timeout", "error", "rate_limited"] as const) {
            const failure = balanceFetchFailure(reason);
            const next = applyResponseEnvelopes([polygon], { polygon: failure });

            expect(balancePayloadFailed({ polygon: failure }, "polygon")).toBeTrue();
            expect(next.length).toBe(1);
            expect(next[0].amount).toBe(592.7198);
            expect(next[0].fiatBalance).toBe(53.7);
        }
    });

    it("still records an API balance of 0 when the chain actually returned 0", () => {
        const created = applyResponseEnvelopes<Record<string, any>>([], {
            blockdag: { data: { balance: "0", fiatBalance: "0", account: { price: "0.05" }, tokenHoldings: { tokens: [] } } },
        });

        expect(balancePayloadFailed({ blockdag: { data: { balance: "0" } } }, "blockdag")).toBeFalse();
        expect(created.length).toBe(1);
        expect(created[0].amount).toBe(0);
    });

    it("retries a missing payload and does not retry a real zero", () => {
        expect(balancePayloadFailed(null, "polygon")).toBeTrue();
        expect(balancePayloadFailed({ polygon: null }, "polygon")).toBeTrue();
        expect(balancePayloadFailed({ polygon: { data: { balance: "0", tokenHoldings: { tokens: [] } } } }, "polygon")).toBeFalse();
    });
});
