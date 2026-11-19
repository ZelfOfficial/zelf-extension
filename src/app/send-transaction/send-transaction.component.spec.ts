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

    it("allows max when the balance covers a positive fee and stores balance minus fee", async () => {
        const t = setup(2, "2");
        (t.component as any)._sendAll = true;
        t.calculateTransactionFees.and.resolveTo({ fee: 0.0001, fiatFee: 0, total: 0 });

        await t.component.continueToConfirmation();

        expect(t.navigate).toHaveBeenCalledWith(["/send/confirmation"]);
        const saved = t.setCurrentTransactionData.calls.mostRecent().args[0];
        expect(saved.sendAll).toBeTrue();
        expect(saved.amountInput).toBe("2");
        expect(saved.amount).toBe("1.9999");
    });

    it("blocks max when the balance is not above the fee", async () => {
        const t = setup(0.0001, "0.0001");
        (t.component as any)._sendAll = true;
        t.calculateTransactionFees.and.resolveTo({ fee: 0.0002, fiatFee: 0, total: 0 });

        await t.component.continueToConfirmation();

        expect(t.navigate).not.toHaveBeenCalled();
        expect(t.component.aptosSendErrorKey).toBe("send.aptos_amount_plus_fee");
    });

    it("does not treat a zero fee quote as free", async () => {
        const t = setup(2);
        t.calculateTransactionFees.and.resolveTo({ fee: 0, fiatFee: 0, total: 0 });

        await t.component.continueToConfirmation();

        expect(t.navigate).not.toHaveBeenCalled();
        expect(t.component.aptosSendErrorKey).toBe("errors.send_transaction_network_error");
        expect(t.component.isConfirmationDisabled()).toBeTrue();
    });

    it("keeps continue disabled when the fee quote throws, and a later quote can proceed", async () => {
        const t = setup(2);
        t.calculateTransactionFees.and.rejectWith(new Error("network"));

        await t.component.continueToConfirmation();

        expect(t.navigate).not.toHaveBeenCalled();
        expect(t.component.isConfirmationDisabled()).toBeTrue();

        t.calculateTransactionFees.and.resolveTo({ fee: 0.0001, fiatFee: 0, total: 0 });
        await t.component.continueToConfirmation();

        expect(t.navigate).toHaveBeenCalledWith(["/send/confirmation"]);
    });
});

describe("SendTransactionComponent Aptos Zelf ID lookup (#186)", () => {
    const aptosAddress = "0x8d086543389b6eefb431f07f54ea5625b2f8e4ba1d7848ee4b3051fbeeea6a77";

    function setup() {
        const searchTag = jasmine.createSpy("searchTag");
        const refreshAfterUnauthorized = jasmine.createSpy("refreshAfterUnauthorized").and.resolveTo("next");
        const setCurrentTransactionData = jasmine.createSpy("setCurrentTransactionData").and.resolveTo();
        const component = new SendTransactionComponent(
            {} as any,
            {} as any,
            { isValidAddress: () => false } as any,
            {} as any,
            {} as any,
            { markForCheck: () => undefined, detectChanges: () => undefined } as any,
            {} as any,
            new FormBuilder(),
            {} as any,
            { open: jasmine.createSpy("open") } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {
                searchTag,
                parseTagName: (tagName: string) => {
                    const parts = tagName.split(".");
                    if (parts.length < 2) return { name: tagName, domain: "" };
                    const domain = parts.pop() || "";
                    return { name: parts.join("."), domain };
                },
            } as any,
            { setCurrentTransactionData } as any,
            { translate: (key: string) => key } as any,
            {} as any,
            {
                TagRegex: /^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z0-9-]+$/i,
                TagRegexNoPostfix: /^[a-zA-Z][a-zA-Z0-9]*$/i,
            } as any,
            { refreshAfterUnauthorized } as any
        );

        component.transactionData = new TransactionData({
            token: {
                symbol: "APT",
                tokenType: "APT",
                network: "Aptos",
                name: "Aptos",
                amount: 1,
                balance: 1,
                price: 1,
                fiatBalance: 0,
                image: "",
            },
            sender: { address: "0xabc", tagName: "sender", domain: "zelf" },
            receiver: {},
        });
        component.withdrawStep = false;
        component.form = new FormBuilder().group({
            amount: ["0.1"],
            toAddress: ["qa"],
            fromAddress: ["0xabc"],
        });

        return { component, searchTag, refreshAfterUnauthorized, setCurrentTransactionData };
    }

    async function lookUpQa(component: SendTransactionComponent): Promise<void> {
        await (component as unknown as { _handleToAddressChange(text: string): Promise<void> })._handleToAddressChange("qa");
    }

    it("resolves qa.zelf after a 401 and a successful retry", async () => {
        const t = setup();
        let calls = 0;

        t.searchTag.and.callFake(async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error("unauthorized"), { status: 401 });

            return {
                data: {
                    available: false,
                    tagName: "qa.zelf",
                    tagObject: {
                        tagName: "qa.zelf",
                        publicData: { aptosAddress, domain: "zelf", tagName: "qa.zelf" },
                    },
                },
            };
        });

        await lookUpQa(t.component);

        expect(t.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
        expect(t.searchTag).toHaveBeenCalledTimes(2);
        expect(t.searchTag.calls.argsFor(0)[0]).toEqual({ tagName: "qa", domain: "zelf", os: "DESKTOP" });
        expect(t.searchTag.calls.argsFor(1)[0]).toEqual({ tagName: "qa", domain: "zelf", os: "DESKTOP" });
        expect(t.component.foundAddress?.publicData.aptosAddress).toBe(aptosAddress);
        expect(t.component.isZelfNameNotFound).toBeFalse();
        expect(t.setCurrentTransactionData.calls.mostRecent().args[0].receiver.address).toBe(aptosAddress);
    });

    it("resolves a packed aptos short key", async () => {
        const t = setup();

        t.searchTag.and.resolveTo({
            data: {
                available: false,
                tagObject: {
                    publicData: { addresses2: JSON.stringify({ aptos: aptosAddress }), domain: "zelf", tagName: "qa.zelf" },
                },
            },
        });

        await lookUpQa(t.component);

        expect(t.component.foundAddress?.publicData.aptosAddress).toBe(aptosAddress);
        expect(t.component.isZelfNameNotFound).toBeFalse();
        expect(t.component.tagLookupMessageKey).not.toBe("send.zelf_name_no_network_address");
    });

    it("shows that the Zelf ID has no address on this network", async () => {
        const t = setup();

        t.searchTag.and.resolveTo({
            data: {
                available: false,
                tagObject: {
                    publicData: { ethAddress: "0x1111111111111111111111111111111111111111", domain: "zelf", tagName: "qa.zelf" },
                },
            },
        });

        await lookUpQa(t.component);

        expect(t.refreshAfterUnauthorized).not.toHaveBeenCalled();
        expect(t.component.foundAddress).toBeUndefined();
        expect(t.component.isZelfNameNotFound).toBeTrue();
        expect(t.component.tagLookupMessageKey).toBe("send.zelf_name_no_network_address");
    });

    it("shows not registered only when the name is available or missing", async () => {
        const available = setup();

        available.searchTag.and.resolveTo({ data: { available: true, tagName: "qa", ipfs: [], arweave: [] } });
        await lookUpQa(available.component);
        expect(available.component.tagLookupMessageKey).toBe("send.zelf_name_not_registered");
        expect(available.component.isZelfNameNotFound).toBeTrue();

        const missing = setup();

        missing.searchTag.and.resolveTo({ data: { available: false, tagName: "qa" } });
        await lookUpQa(missing.component);
        expect(missing.component.tagLookupMessageKey).toBe("send.zelf_name_not_registered");
        expect(missing.component.isZelfNameNotFound).toBeTrue();
    });

    it("shows lookup failed when the search errors, including a second 401", async () => {
        const network = setup();

        network.searchTag.and.rejectWith(new Error("network"));
        await lookUpQa(network.component);

        expect(network.refreshAfterUnauthorized).not.toHaveBeenCalled();
        expect(network.component.foundAddress).toBeUndefined();
        expect(network.component.isZelfNameNotFound).toBeTrue();
        expect(network.component.tagLookupMessageKey).toBe("send.zelf_name_lookup_failed");

        const unauthorized = setup();

        unauthorized.searchTag.and.rejectWith(Object.assign(new Error("unauthorized"), { status: 401 }));
        await lookUpQa(unauthorized.component);

        expect(unauthorized.searchTag).toHaveBeenCalledTimes(2);
        expect(unauthorized.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
        expect(unauthorized.component.tagLookupMessageKey).toBe("send.zelf_name_lookup_failed");
        expect(unauthorized.component.tagLookupMessageKey).not.toBe("send.zelf_name_not_registered");
    });
});
