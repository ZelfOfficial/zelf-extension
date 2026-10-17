import { isDisplayableTransaction, transactionTime, transactionTimestampMs } from "./transaction-history.util";

describe("transaction-history.util", () => {
    it("parses the date shapes returned by the network APIs", () => {
        expect(transactionTimestampMs("2026-09-30 19:15:09")).toBe(Date.parse("2026-09-30T19:15:09"));
        expect(transactionTimestampMs("2026-09-30T19:15:09.000Z")).toBe(Date.parse("2026-09-30T19:15:09.000Z"));
        expect(transactionTimestampMs(1759259709)).toBe(1759259709000); // unix seconds (TON / Aptos)
        expect(transactionTimestampMs("1759259709")).toBe(1759259709000);
        expect(transactionTimestampMs(1759259709000)).toBe(1759259709000); // already ms
    });

    it("rejects missing or unparsable dates", () => {
        expect(transactionTimestampMs("N/A")).toBeNull();
        expect(transactionTimestampMs("")).toBeNull();
        expect(transactionTimestampMs(undefined)).toBeNull();
        expect(transactionTimestampMs(0)).toBeNull();
    });

    it("falls back to timestamp when date is not usable", () => {
        expect(transactionTime({ date: "N/A", timestamp: 1759259709 })).toBe(1759259709000);
    });

    it("drops backend error placeholders and rows without a usable date", () => {
        const placeholder = { hash: "0x" + "0".repeat(64), method: "Transfer", date: "N/A", from: "0xabc", traffic: "OUT" };
        const errorRow = { hash: "0x12", method: "Error", date: "2026-09-30 19:15:09", from: "0xabc", traffic: "ERROR" };

        expect(isDisplayableTransaction(placeholder)).toBeFalse();
        expect(isDisplayableTransaction(errorRow)).toBeFalse();
        expect(isDisplayableTransaction({ hash: "0x12", date: "2026-09-30 19:15:09" })).toBeFalse(); // no sender
        expect(isDisplayableTransaction(null)).toBeFalse();
    });

    it("keeps real transactions", () => {
        expect(isDisplayableTransaction({ hash: "0x12ab", from: "0xabc", date: "2026-09-30 19:15:09", traffic: "IN" })).toBeTrue();
        expect(isDisplayableTransaction({ hash: "abc=", from: ["EQabc"], date: 1759259709 })).toBeTrue();
    });
});
