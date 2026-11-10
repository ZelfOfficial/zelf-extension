import * as ar from "../../../assets/i18n/ar.json";
import * as br from "../../../assets/i18n/br.json";
import * as cn from "../../../assets/i18n/cn.json";
import * as en from "../../../assets/i18n/en.json";
import * as es from "../../../assets/i18n/es.json";
import * as fr from "../../../assets/i18n/fr.json";
import * as hindi from "../../../assets/i18n/in.json";
import * as ja from "../../../assets/i18n/ja.json";
import * as kr from "../../../assets/i18n/kr.json";
import * as ph from "../../../assets/i18n/ph.json";
import * as ru from "../../../assets/i18n/ru.json";
import * as th from "../../../assets/i18n/th.json";
import * as ur from "../../../assets/i18n/ur.json";

import { aptosFeeQuoteFailed, aptosSendBlockReason, aptosSendErrorKey, aptRemainder, readAptBalance, readAptSendAmount, reviewSendAmountLabel } from "./aptos-send.util";

const LOCALES: Record<string, unknown> = { ar, br, cn, en, es, fr, in: hindi, ja, kr, ph, ru, th, ur };

function localeSend(mod: any): { zero?: string; fee?: string } {
    const root = mod?.send ? mod : mod?.default;

    return {
        zero: root?.send?.aptos_zero_balance,
        fee: root?.send?.aptos_amount_plus_fee,
    };
}

describe("Aptos send affordability (#166)", () => {
    const recipientCase = { balance: 0, amount: 0.001, fee: 0.0001 };

    it("blocks a typed 0.001 APT send when the balance is 0", () => {
        expect(aptosSendBlockReason(recipientCase.balance, recipientCase.amount, recipientCase.fee)).toBe("zero_balance");
        expect(aptosSendErrorKey("zero_balance")).toBe("send.aptos_zero_balance");
    });

    it("blocks when the amount plus the estimated fee is above the balance", () => {
        expect(aptosSendBlockReason(0.001, 0.001, 0.0002)).toBe("exceeds_balance");
        expect(aptosSendErrorKey("exceeds_balance")).toBe("send.aptos_amount_plus_fee");
    });

    it("allows a typed amount that fits with the fee", () => {
        expect(aptosSendBlockReason(1, 0.001, 0.0002)).toBeNull();
        expect(aptosSendErrorKey(null)).toBeNull();
    });

    it("allows max when the balance covers the fee and sends balance minus fee", () => {
        expect(aptosSendBlockReason(2, 2, 0.0001, true)).toBeNull();
        expect(aptRemainder(2, 0.0001)).toBe("1.9999");
    });

    it("blocks max when the balance is not above the fee", () => {
        expect(aptosSendBlockReason(0.0001, 0.0001, 0.0002, true)).toBe("exceeds_balance");
        expect(aptosSendBlockReason(0.0002, 0.0002, 0.0002, true)).toBe("exceeds_balance");
        expect(aptRemainder(0.0002, 0.0002)).toBeNull();
    });

    it("allows an exact cover, including 0.1 + 0.2 against a 0.3 balance", () => {
        expect(aptosSendBlockReason(0.3, 0.1, 0.2)).toBeNull();
        expect(aptosSendBlockReason("1.25", "1.00", "0.25")).toBeNull();
        expect(0.1 + 0.2 > 0.3).toBeTrue();
    });

    it("still blocks max when the balance is 0", () => {
        expect(aptosSendBlockReason(0, 0, 0.0001, true)).toBe("zero_balance");
    });

    it("treats a zero fee quote as unusable", () => {
        expect(aptosFeeQuoteFailed(0)).toBeTrue();
        expect(aptosFeeQuoteFailed(Number.NaN)).toBeTrue();
        expect(aptosFeeQuoteFailed(0.0001)).toBeFalse();
    });

    it("reads an explicit 0 amount and does not fall through to another balance field", () => {
        expect(readAptBalance({ amount: 0, balance: 100000000 })).toBe(0);
        expect(readAptBalance({ amount: "0", balance: "5" })).toBe(0);
        expect(readAptBalance({ amount: "1.25", balance: "0" })).toBe(1.25);
        expect(readAptSendAmount("0.001", "ALL")).toBe(0.001);
    });

    it("shows the typed amount on review and ALL only when the user picked max", () => {
        expect(
            reviewSendAmountLabel({
                amount: "ALL",
                amountInput: "0.001",
                sendAll: false,
                allLabel: "ALL",
            })
        ).toBe("0.001");

        expect(
            reviewSendAmountLabel({
                amount: "0.001",
                amountInput: "0.001",
                sendAll: false,
                allLabel: "ALL",
            })
        ).toBe("0.001");

        expect(
            reviewSendAmountLabel({
                amount: "0",
                amountInput: "0",
                sendAll: true,
                allLabel: "ALL",
            })
        ).toBe("ALL");
    });

    it("has the Aptos balance messages in every locale", () => {
        for (const [name, mod] of Object.entries(LOCALES)) {
            const messages = localeSend(mod);

            expect(messages.zero && messages.zero.trim().length > 0).withContext(name).toBeTrue();
            expect(messages.fee && messages.fee.trim().length > 0).withContext(name).toBeTrue();
        }
    });
});
