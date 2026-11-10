import { FormBuilder } from "@angular/forms";

import { TransactionData } from "@shared/types/wallet.types";

import { SendTransactionComponent } from "./send-transaction.component";

describe("SendTransactionComponent Aptos amount step (#166)", () => {
    function setup(balance: number, amount = "0.001") {
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const calculateTransactionFees = jasmine.createSpy("calculateTransactionFees").and.resolveTo({
            fee: 0.0002,
            fiatFee: 0,
            total: 0,
        });
        const setCurrentTransactionData = jasmine.createSpy("setCurrentTransactionData").and.resolveTo();
        const component = new SendTransactionComponent(
            {} as any,
            {} as any,
            { calculateTransactionFees, isValidAddress: () => true } as any,
            {} as any,
            {} as any,
            { markForCheck: () => undefined, detectChanges: () => undefined } as any,
            {} as any,
            new FormBuilder(),
            { navigate } as any,
            { open: jasmine.createSpy("open") } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { setCurrentTransactionData } as any,
            { translate: (key: string) => key } as any,
            {} as any,
            {} as any
        );

        component.transactionData = new TransactionData({
            token: {
                symbol: "APT",
                tokenType: "APT",
                network: "Aptos",
                name: "Aptos",
                amount: balance,
                balance,
                price: 1,
                fiatBalance: 0,
                image: "",
            },
            sender: { address: "0xabc", tagName: "qa", domain: "zelf" },
            receiver: { address: "0x1" },
        });
        component.withdrawStep = true;
        component.foundAddress = { publicData: { aptosAddress: "0x1" } } as any;
        component.form = new FormBuilder().group({
            amount: [amount],
            toAddress: ["0x1"],
            fromAddress: ["0xabc"],
        });

        return { component, navigate, calculateTransactionFees, setCurrentTransactionData };
    }

    it("blocks review for 0 APT, amount 0.001, and recipient 0x1", async () => {
        const t = setup(0);

        expect(t.component.aptosSendErrorKey).toBe("send.aptos_zero_balance");
        expect(t.component.isConfirmationDisabled()).toBeTrue();

        await t.component.continueToConfirmation();

        expect(t.navigate).not.toHaveBeenCalled();
        expect(t.calculateTransactionFees).not.toHaveBeenCalled();
    });

    it("blocks review when the amount plus the estimated fee is above the balance", async () => {
        const t = setup(0.001);

        await t.component.continueToConfirmation();

        expect(t.calculateTransactionFees).toHaveBeenCalled();
        expect(t.navigate).not.toHaveBeenCalled();
        expect(t.component.aptosSendErrorKey).toBe("send.aptos_amount_plus_fee");
    });

    it("keeps the typed amount and does not mark max when the user did not pick ALL", async () => {
        const t = setup(2);
        t.calculateTransactionFees.and.resolveTo({ fee: 0.0001, fiatFee: 0, total: 0 });

        await t.component.continueToConfirmation();

        expect(t.navigate).toHaveBeenCalledWith(["/send/confirmation"]);
        const saved = t.setCurrentTransactionData.calls.mostRecent().args[0];
        expect(saved.amountInput).toBe("0.001");
        expect(saved.amount).toBe(0.001);
        expect(saved.sendAll).not.toBeTrue();
    });

    it("records max only when the user picked ALL", async () => {
        const t = setup(3, "2");
        (t.component as any)._sendAll = true;
        t.calculateTransactionFees.and.resolveTo({ fee: 0.0001, fiatFee: 0, total: 0 });

        await t.component.continueToConfirmation();

        const saved = t.setCurrentTransactionData.calls.mostRecent().args[0];
        expect(saved.sendAll).toBeTrue();
        expect(saved.amountInput).toBe("2");
    });
});
