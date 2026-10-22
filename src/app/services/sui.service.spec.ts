import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import { NATIVE_SUI_COIN_TYPE } from "app/core/utils/sui-coin.util";
import { TransactionParams } from "app/core/models/transaction-fee.model";
import { SuiChainTransport, SuiCoinRef } from "./sui-chain.transport";
import { SuiService } from "./sui.service";

const MNEMONIC = "test test test test test test test test test test test junk";
const RECIPIENT = `0x${"11".repeat(32)}`;
const DIGEST = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";

function coin(byte: string, balance: string): SuiCoinRef {
    return {
        objectId: `0x${byte.repeat(32)}`,
        version: "1",
        digest: DIGEST,
        balance,
    };
}

class MockSuiTransport implements SuiChainTransport {
    calls: Array<Record<string, unknown>> = [];
    readonly coins = new Map<string, SuiCoinRef[]>();

    listCoins(owner: string, coinType: string): Promise<SuiCoinRef[]> {
        this.calls.push({ method: "listCoins", owner, coinType });

        return Promise.resolve(this.coins.get(coinType) || []);
    }

    referenceGasPrice(): Promise<bigint> {
        this.calls.push({ method: "referenceGasPrice" });

        return Promise.resolve(1000n);
    }

    simulate(transaction: Uint8Array) {
        this.calls.push({ method: "simulate", transaction });

        return Promise.resolve({ computationCost: "1000000", storageCost: "2000000", storageRebate: "500000" });
    }

    execute(transaction: Uint8Array, signatures: string[]) {
        this.calls.push({ method: "execute", transaction, signatures });

        return Promise.resolve({ digest: "mocked-digest" });
    }

    getBalance(): Promise<bigint> {
        return Promise.resolve(0n);
    }
}

function serviceWith(transport: MockSuiTransport, holdings?: { address_token: string; decimals: number; amount: number }): SuiService {
    const http = {
        sendRequest: () =>
            Promise.resolve({
                data: {
                    tokenHoldings: {
                        tokens: holdings ? [holdings] : [],
                    },
                },
            }),
    };
    const license = {
        ensureLoaded: () => Promise.resolve(null),
        getNetworkEntry: () => null,
    };
    const service = new SuiService(http as any, license as any);

    service.bindTransport(transport);

    return service;
}

function send(partial: Partial<TransactionParams>): TransactionParams {
    return {
        from: "",
        to: RECIPIENT,
        value: "1",
        network: "sui",
        mnemonic: MNEMONIC,
        ...partial,
    };
}

function executed(transport: MockSuiTransport): { transaction: Uint8Array; signatures: string[] } {
    const call = transport.calls.find((entry) => entry.method === "execute") as { transaction: Uint8Array; signatures: string[] };

    return call;
}

describe("SuiService GraphQL sends", () => {
    it("sends native SUI by splitting the gas coin and executing a locally signed transaction", async () => {
        const transport = new MockSuiTransport();
        transport.coins.set(NATIVE_SUI_COIN_TYPE, [coin("aa", "5000000000")]);
        const owner = Ed25519Keypair.deriveKeypair(MNEMONIC).getPublicKey().toSuiAddress();

        const result = await serviceWith(transport).sendTransaction(send({}));

        expect(result).toEqual({ hash: "mocked-digest", status: "pending" });

        const coinTypes = transport.calls.filter((entry) => entry.method === "listCoins").map((entry) => entry.coinType);
        expect(coinTypes).toEqual([NATIVE_SUI_COIN_TYPE]);
        expect(transport.calls.find((entry) => entry.method === "listCoins")?.["owner"]).toBe(owner);

        const exec = executed(transport);
        expect(exec.signatures.length).toBe(1);
        expect(exec.signatures[0].length).toBeGreaterThan(20);
        expect(Transaction.from(exec.transaction).getData().commands.map((command) => command.$kind)).toEqual(["SplitCoins", "TransferObjects"]);
        expect(JSON.stringify(transport.calls)).not.toContain(MNEMONIC);
        expect(transport.calls.some((entry) => entry.method === "simulate")).toBeTrue();
        expect(transport.calls.some((entry) => entry.method === "referenceGasPrice")).toBeTrue();
    });

    it("sends a non-native coin by merging and splitting that coin type", async () => {
        const transport = new MockSuiTransport();
        const coinType = "0xabc::usdc::USDC";
        transport.coins.set(coinType, [coin("bb", "1000000"), coin("cc", "2000000")]);
        transport.coins.set(NATIVE_SUI_COIN_TYPE, [coin("aa", "5000000000")]);

        const result = await serviceWith(transport, { address_token: coinType, decimals: 6, amount: 10 }).sendTransaction(
            send({ value: "1.5", tokenAddress: coinType, tokenDecimals: 6 })
        );

        expect(result.hash).toBe("mocked-digest");

        const coinTypes = transport.calls.filter((entry) => entry.method === "listCoins").map((entry) => entry.coinType);
        expect(coinTypes).toEqual([coinType, NATIVE_SUI_COIN_TYPE]);
        expect(coinTypes.some((type) => `${type}`.endsWith("::coin::COIN"))).toBeFalse();
        expect(Transaction.from(executed(transport).transaction).getData().commands.map((command) => command.$kind)).toEqual([
            "MergeCoins",
            "SplitCoins",
            "TransferObjects",
        ]);
        expect(JSON.stringify(transport.calls)).not.toContain(MNEMONIC);
    });

    it("appends ::coin::COIN for a legacy address_token that is not a coin type", async () => {
        const transport = new MockSuiTransport();
        const legacy = "0xabc";
        transport.coins.set("0xabc::coin::COIN", [coin("dd", "5000000")]);
        transport.coins.set(NATIVE_SUI_COIN_TYPE, [coin("aa", "5000000000")]);

        const result = await serviceWith(transport, { address_token: legacy, decimals: 6, amount: 10 }).sendTransaction(
            send({ tokenAddress: legacy, tokenDecimals: 6 })
        );

        expect(result.hash).toBe("mocked-digest");

        const coinTypes = transport.calls.filter((entry) => entry.method === "listCoins").map((entry) => entry.coinType);
        expect(coinTypes[0]).toBe("0xabc::coin::COIN");
        expect(Transaction.from(executed(transport).transaction).getData().commands.map((command) => command.$kind)).toEqual([
            "SplitCoins",
            "TransferObjects",
        ]);
    });
});
