import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import { NATIVE_SUI_COIN_TYPE } from "app/core/utils/sui-coin.util";
import { TransactionParams } from "app/core/models/transaction-fee.model";
import { SuiBalanceBreakdown, SuiSendClient } from "./sui-chain.transport";
import { SuiService } from "./sui.service";

const MNEMONIC = "test test test test test test test test test test test junk";
const RECIPIENT = `0x${"11".repeat(32)}`;
const DIGEST = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";

class MockSuiClient implements SuiSendClient {
    calls: Array<Record<string, unknown>> = [];
    balance = "0";
    coinBalance = "0";
    addressBalance = "0";
    coins: Array<{ objectId: string; version: string; digest: string; balance: string }> = [];
    /** Pages after the first. The SDK stops once the requested balance is covered. */
    extraPages = 0;
    dryRunError: string | null = null;
    readonly buildClient: { core: object };

    constructor() {
        const self = this;

        this.buildClient = {
            core: {
                getBalance: async ({ owner, coinType }: { owner: string; coinType: string }) => {
                    const breakdown = await self.getBalance(owner, coinType);

                    return { balance: breakdown };
                },
                listCoins: async ({ owner, coinType, cursor }: { owner: string; coinType: string; cursor?: string | null }) => {
                    const page = self.calls.filter((entry) => entry.method === "listCoins").length;

                    self.calls.push({ method: "listCoins", owner, coinType, cursor: cursor ?? null });

                    return {
                        objects: page === 0 ? self.coins : [],
                        hasNextPage: page < self.extraPages,
                        cursor: page < self.extraPages ? `cursor-${page + 1}` : null,
                    };
                },
                resolveTransactionPlugin: () => async (transactionData: any, _options: unknown, next: () => Promise<void>) => {
                    self.calls.push({ method: "resolve" });
                    if (self.dryRunError) throw new Error(self.dryRunError);

                    transactionData.gasData.budget ??= "2000000";
                    transactionData.gasData.price ??= "1000";
                    transactionData.gasData.owner ??= transactionData.sender;
                    transactionData.gasData.payment ??= [{ objectId: `0x${"aa".repeat(32)}`, version: "1", digest: DIGEST }];
                    await next();
                },
            },
        };
    }

    getBalance(owner: string, coinType: string): Promise<SuiBalanceBreakdown> {
        this.calls.push({ method: "getBalance", owner, coinType });

        return Promise.resolve({
            balance: this.balance,
            coinBalance: this.coinBalance,
            addressBalance: this.addressBalance,
        });
    }

    simulate(transaction: Uint8Array) {
        this.calls.push({ method: "simulate", transaction });

        return Promise.resolve({ computationCost: "1000000", storageCost: "2000000", storageRebate: "500000" });
    }

    execute(transaction: Uint8Array, signatures: string[]) {
        this.calls.push({ method: "execute", transaction, signatures });

        return Promise.resolve({ digest: "mocked-digest" });
    }
}

function serviceWith(client: MockSuiClient, holdings?: { address_token: string; decimals: number; amount: number }): SuiService {
    const http = {
        sendRequest: () =>
            Promise.resolve({
                data: { tokenHoldings: { tokens: holdings ? [holdings] : [] } },
            }),
    };
    const license = { ensureLoaded: () => Promise.resolve(null), getNetworkEntry: () => null };
    const service = new SuiService(http as any, license as any);

    service.bindClient(client);

    return service;
}

function send(partial: Partial<TransactionParams>): TransactionParams {
    return { from: "", to: RECIPIENT, value: "1", network: "sui", mnemonic: MNEMONIC, ...partial };
}

function commandsOf(client: MockSuiClient): string[] {
    const call = client.calls.find((entry) => entry.method === "execute") as { transaction: Uint8Array };

    return Transaction.from(call.transaction)
        .getData()
        .commands.map((command) => (command.$kind === "MoveCall" ? `MoveCall:${command.MoveCall.function}` : command.$kind));
}

describe("SuiService GraphQL sends", () => {
    it("spends an address balance for native SUI instead of only coin objects", async () => {
        const client = new MockSuiClient();
        client.addressBalance = `${11_287n * 1_000_000_000n}`;
        client.coinBalance = `${1_000_000_000n}`;
        client.balance = `${11_288n * 1_000_000_000n}`;
        const owner = Ed25519Keypair.deriveKeypair(MNEMONIC).getPublicKey().toSuiAddress();

        const result = await serviceWith(client).sendTransaction(send({ value: "5" }));

        expect(result).toEqual({ hash: "mocked-digest", status: "pending" });
        expect(client.calls.some((entry) => entry.method === "listCoins")).toBeFalse();
        expect(client.calls.find((entry) => entry.method === "getBalance")?.["owner"]).toBe(owner);
        expect(commandsOf(client)).toContain("MoveCall:redeem_funds");
        expect(commandsOf(client)).not.toContain("MergeCoins");
        expect(JSON.stringify(client.calls)).not.toContain(MNEMONIC);
    });

    it("spends a non-native coin that exists only as an address balance", async () => {
        const client = new MockSuiClient();
        const coinType = "0xabc::spam::SUI";
        client.addressBalance = "5000000";
        client.coinBalance = "0";
        client.balance = "5000000";
        client.extraPages = 20;

        const result = await serviceWith(client, { address_token: coinType, decimals: 6, amount: 10 }).sendTransaction(
            send({ value: "1.5", tokenAddress: coinType, tokenDecimals: 6 })
        );

        expect(result.hash).toBe("mocked-digest");
        expect(client.calls.filter((entry) => entry.method === "listCoins").length).toBe(1);
        expect(String(client.calls.find((entry) => entry.method === "listCoins")?.["coinType"]).toLowerCase()).toContain("::spam::sui");
        expect(commandsOf(client)).toContain("MoveCall:redeem_funds");
        expect(commandsOf(client)).not.toContain("MergeCoins");
        expect(JSON.stringify(client.calls)).not.toContain(MNEMONIC);
    });

    it("does not page in every coin object when the first page covers the amount", async () => {
        const client = new MockSuiClient();
        const coinType = "0xabc::usdc::USDC";
        client.addressBalance = "0";
        client.coinBalance = "10000000000";
        client.balance = "10000000000";
        client.extraPages = 20;
        client.coins = [
            { objectId: `0x${"bb".repeat(32)}`, version: "1", digest: DIGEST, balance: "4000000" },
            { objectId: `0x${"cc".repeat(32)}`, version: "1", digest: DIGEST, balance: "4000000" },
        ];

        await serviceWith(client, { address_token: coinType, decimals: 6, amount: 10 }).sendTransaction(
            send({ value: "1", tokenAddress: coinType, tokenDecimals: 6 })
        );

        expect(client.calls.filter((entry) => entry.method === "listCoins").length).toBe(1);
        expect(commandsOf(client).filter((kind) => kind === "MergeCoins").length).toBe(1);
    });

    it("keeps the legacy ::coin::COIN suffix", async () => {
        const client = new MockSuiClient();
        client.addressBalance = "5000000";
        client.balance = "5000000";

        await serviceWith(client, { address_token: "0xabc", decimals: 6, amount: 10 }).sendTransaction(
            send({ tokenAddress: "0xabc", tokenDecimals: 6 })
        );

        const coinType = String(client.calls.find((entry) => entry.method === "getBalance")?.["coinType"]);

        expect(coinType.endsWith("::coin::COIN")).toBeTrue();
        expect(coinType).not.toBe("0xabc");
    });

    it("sends near-max SUI as the gas coin so the fee stays reserved", async () => {
        const client = new MockSuiClient();
        const balance = 797_281_600_000n;
        client.balance = balance.toString();
        client.addressBalance = balance.toString();

        const result = await serviceWith(client).sendTransaction(send({ value: "797.27" }));

        expect(result.hash).toBe("mocked-digest");
        expect(commandsOf(client)).toEqual(["TransferObjects"]);
    });

    it("surfaces a dry-run failure instead of a fallback fee", async () => {
        const client = new MockSuiClient();
        client.balance = `${11_288n * 1_000_000_000n}`;
        client.addressBalance = client.balance;
        client.dryRunError = "Insufficient coin balance";
        const service = serviceWith(client);

        await expectAsync(service.estimateSuiTransactionFee(RECIPIENT, 5, `0x${"22".repeat(32)}`)).toBeRejectedWithError(/Insufficient coin balance/);
        await expectAsync(service.sendTransaction(send({ value: "5" }))).toBeRejectedWithError(/Insufficient coin balance/);
        expect(client.calls.some((entry) => entry.method === "execute")).toBeFalse();
        expect(client.calls.some((entry) => entry.method === "simulate")).toBeFalse();
    });
});
