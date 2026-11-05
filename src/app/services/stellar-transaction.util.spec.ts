import { mapTransactionErrorToTranslationKey } from "../core/utils/user-facing-transaction-error.util";
import {
    formatTokenAmount,
    minimumAccountReserveXlm,
    minimumNewAccountBalanceXlm,
    STELLAR_DEFAULT_BASE_FEE_XLM,
    STELLAR_DEFAULT_MIN_RESERVE_XLM,
} from "./stellar-transaction.util";

describe("stellar-transaction.util & Stellar error mapping (#160)", () => {
    const BASE_RESERVE_STROOPS = 5_000_000; // 0.5 XLM

    it("computes minimumNewAccountBalanceXlm for 0 subentries as 1 XLM", () => {
        expect(minimumNewAccountBalanceXlm(BASE_RESERVE_STROOPS)).toBe(1);
    });

    it("computes minimumAccountReserveXlm including subentries, sponsoring, sponsored, and selling liabilities", () => {
        expect(minimumAccountReserveXlm(BASE_RESERVE_STROOPS, 0, 0, 0, 0)).toBe(1);
        expect(minimumAccountReserveXlm(BASE_RESERVE_STROOPS, 2, 0, 0, 0)).toBe(2);
        expect(minimumAccountReserveXlm(BASE_RESERVE_STROOPS, 1, 1, 0, 0.25)).toBe(2.25);
        expect(minimumAccountReserveXlm(BASE_RESERVE_STROOPS, 0, 0, 5, 0)).toBe(1);
    });

    it("exports default Stellar reserve and base fee constants", () => {
        expect(STELLAR_DEFAULT_MIN_RESERVE_XLM).toBe(1);
        expect(STELLAR_DEFAULT_BASE_FEE_XLM).toBe(0.00001);
    });

    it("formats Stellar token amounts up to 7 decimals without trailing zeros", () => {
        expect(formatTokenAmount(1.99997, 7)).toBe("1.99997");
        expect(formatTokenAmount(0.01, 7)).toBe("0.01");
    });

    it("maps Stellar translation keys and Horizon result codes in mapTransactionErrorToTranslationKey", () => {
        expect(mapTransactionErrorToTranslationKey(new Error("errors.stellar_sender_reserve_exceeded"))).toBe(
            "errors.stellar_sender_reserve_exceeded"
        );
        expect(mapTransactionErrorToTranslationKey(new Error("op_underfunded"))).toBe("errors.stellar_sender_reserve_exceeded");
        expect(mapTransactionErrorToTranslationKey(new Error("tx_insufficient_balance"))).toBe("errors.stellar_sender_reserve_exceeded");
        expect(mapTransactionErrorToTranslationKey(new Error("op_low_reserve"))).toBe("errors.stellar_amount_below_reserve");
        expect(mapTransactionErrorToTranslationKey(new Error("op_no_destination"))).toBe("errors.stellar_classic_fund_xlm_first");
        expect(mapTransactionErrorToTranslationKey(new Error("op_no_trust"))).toBe("errors.stellar_classic_trustline_required");
        expect(mapTransactionErrorToTranslationKey(new Error("op_line_full"))).toBe("errors.stellar_recipient_line_full");
        expect(mapTransactionErrorToTranslationKey(new Error("Destination account requires memo"))).toBe("errors.stellar_memo_required");
        expect(mapTransactionErrorToTranslationKey(new Error("tx_bad_seq"))).toBe("errors.stellar_bad_sequence");
    });
});

