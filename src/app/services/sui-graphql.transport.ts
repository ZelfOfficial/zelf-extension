import { SuiGraphQLClient } from "@mysten/sui/graphql";

import { NATIVE_SUI_COIN_TYPE, SuiGasSummary, suiNetworkFromGraphqlUrl } from "app/core/utils/sui-coin.util";
import { SuiChainTransport, SuiCoinRef } from "./sui-chain.transport";

const COIN_PAGE_LIMIT = 50;
const MAX_COIN_PAGES = 20;

type ExecutionStatus = { success?: boolean; error?: { message?: string } | null };
type ExecutedTransaction = { digest?: string; status?: ExecutionStatus; effects?: { gasUsed?: SuiGasSummary } };
type ExecutionResult = {
    $kind?: string;
    Transaction?: ExecutedTransaction;
    FailedTransaction?: ExecutedTransaction;
};

function executionOf(result: ExecutionResult): ExecutedTransaction | undefined {
    return result.$kind === "FailedTransaction" ? result.FailedTransaction : result.Transaction;
}

function assertExecuted(result: ExecutionResult, fallback: string): ExecutedTransaction {
    const tx = executionOf(result);
    if (!tx || result.$kind === "FailedTransaction" || tx.status?.success === false) {
        throw new Error(tx?.status?.error?.message || fallback);
    }

    return tx;
}

/**
 * Official Sui GraphQL transport (`SuiGraphQLClient`).
 * Used for coin selection, gas price, dry-run, and executing an already-signed transaction.
 */
export class GraphqlSuiTransport implements SuiChainTransport {
    private readonly _client: SuiGraphQLClient;

    constructor(url: string) {
        this._client = new SuiGraphQLClient({
            url,
            network: suiNetworkFromGraphqlUrl(url),
        });
    }

    async listCoins(owner: string, coinType: string): Promise<SuiCoinRef[]> {
        const coins: SuiCoinRef[] = [];
        let cursor: string | null = null;

        for (let page = 0; page < MAX_COIN_PAGES; page++) {
            const result = await this._client.listCoins({
                owner,
                coinType,
                cursor,
                limit: COIN_PAGE_LIMIT,
            });

            for (const coin of result.objects || []) {
                coins.push({
                    objectId: coin.objectId,
                    version: String(coin.version),
                    digest: coin.digest,
                    balance: String(coin.balance ?? "0"),
                });
            }

            if (!result.hasNextPage || !result.cursor || result.cursor === cursor) break;

            cursor = result.cursor;
        }

        return coins;
    }

    async referenceGasPrice(): Promise<bigint> {
        const { referenceGasPrice } = await this._client.getReferenceGasPrice();

        return BigInt(referenceGasPrice);
    }

    async simulate(transaction: Uint8Array): Promise<SuiGasSummary> {
        const result = await this._client.simulateTransaction({
            transaction,
            include: { effects: true },
        });
        const tx = assertExecuted(result, "Sui simulation failed");
        const gas = tx.effects?.gasUsed;

        if (!gas) throw new Error("Sui simulation did not return gas usage");

        return {
            computationCost: String(gas.computationCost ?? "0"),
            storageCost: String(gas.storageCost ?? "0"),
            storageRebate: String(gas.storageRebate ?? "0"),
        };
    }

    async execute(transaction: Uint8Array, signatures: string[]): Promise<{ digest: string }> {
        const result = await this._client.executeTransaction({
            transaction,
            signatures,
            include: { effects: true },
        });
        const tx = assertExecuted(result, "Transaction failed");

        if (!tx.digest) throw new Error("Transaction failed");

        return { digest: tx.digest };
    }

    async getBalance(owner: string, coinType: string = NATIVE_SUI_COIN_TYPE): Promise<bigint> {
        const { balance } = await this._client.getBalance({ owner, coinType });

        return BigInt(balance?.balance || "0");
    }
}
