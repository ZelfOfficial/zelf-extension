import { aptosAccountFromMnemonic } from "@shared/utils/aptos-derivation.util";
import { AptosService } from "./aptos.service";

describe("AptosService send & fee estimation (#152)", () => {
    const testMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    it("validates Aptos destination addresses", () => {
        const service = new AptosService({} as any);
        const derived = aptosAccountFromMnemonic(testMnemonic);
        expect(service.isValidAddress(derived.accountAddress.toStringLong())).toBeTrue();
        expect(service.isValidAddress("invalid-aptos-address")).toBeFalse();
    });

    it("estimates Aptos transfer fees via /api/aptos/transfer/estimate", async () => {
        const sendRequestSpy = jasmine.createSpy("sendRequest").and.resolveTo({
            data: {
                estimatedFeeApt: "0.0005",
                maxFeeApt: "0.001",
            },
        });
        const service = new AptosService({ sendRequest: sendRequestSpy } as any);

        const estimate = await service.calculateTransactionFees("0x1", "0x2", 2.5, 10);
        expect(sendRequestSpy).toHaveBeenCalledWith(
            "post",
            jasmine.stringMatching(/\/api\/aptos\/transfer\/estimate$/),
            {
                fromAddress: "0x1",
                toAddress: "0x2",
                amountApt: "2.5",
            }
        );
        expect(estimate.fee).toBeCloseTo(0.0005, 6);
        expect(estimate.fiatFee).toBeCloseTo(0.005, 6);
        expect(estimate.total).toBeCloseTo(25.005, 6);
        expect(estimate.networkPrice).toBe(10);
    });

    it("rejects sendTransaction when mnemonic is missing or recipient is invalid", async () => {
        const service = new AptosService({} as any);
        const derived = aptosAccountFromMnemonic(testMnemonic);

        await expectAsync(
            service.sendTransaction({
                from: derived.accountAddress.toStringLong(),
                to: derived.accountAddress.toStringLong(),
                value: "1",
                network: "aptos",
                mnemonic: "",
            })
        ).toBeRejectedWithError(/Mnemonic is required/);

        await expectAsync(
            service.sendTransaction({
                from: derived.accountAddress.toStringLong(),
                to: "not-an-aptos-address",
                value: "1",
                network: "aptos",
                mnemonic: testMnemonic,
            })
        ).toBeRejectedWithError(/Invalid Aptos recipient address/);
    });

    it("builds, signs, and submits native APT transfer locally when signer matches", async () => {
        const service = new AptosService({} as any);
        const derived = aptosAccountFromMnemonic(testMnemonic);
        const recipient = "0x0000000000000000000000000000000000000000000000000000000000000001";

        const transferCoinSpy = jasmine.createSpy("transferCoinTransaction").and.resolveTo({ raw: "tx" });
        const signAndSubmitSpy = jasmine.createSpy("signAndSubmitTransaction").and.resolveTo({ hash: "0xaptostxhash123" });
        (service as any)._client = {
            transferCoinTransaction: transferCoinSpy,
            signAndSubmitTransaction: signAndSubmitSpy,
        };

        const result = await service.sendTransaction({
            from: derived.accountAddress.toStringLong(),
            to: recipient,
            value: "1.25",
            network: "aptos",
            mnemonic: testMnemonic,
        });

        expect(transferCoinSpy).toHaveBeenCalledWith({
            sender: derived.accountAddress,
            recipient,
            amount: 125_000_000n,
        });
        expect(signAndSubmitSpy).toHaveBeenCalled();
        expect(result).toEqual({
            hash: "0xaptostxhash123",
            status: "pending",
        });
    });
});
