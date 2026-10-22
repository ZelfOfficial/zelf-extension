import { SuiGraphQLClient } from "@mysten/sui/graphql";

import { NATIVE_SUI_COIN_TYPE, SuiGasSummary, suiNetworkFromGraphqlUrl } from "app/core/utils/sui-coin.util";
import { SuiBalanceBreakdown, SuiSendClient } from "./sui-chain.transport";
import { createCheckpointRetryFetch } from "./sui-graphql-fetch";

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
 * Official Sui GraphQL client. Transaction building uses this client so the SDK
 * selects coins, address balances, and gas. Checkpoint races retry, then fail over.
 */
export class GraphqlSuiTransport implements SuiSendClient {
    readonly buildClient: SuiGraphQLClient;

    constructor(url: string, fallbackUrl?: string) {
        this.buildClient = new SuiGraphQLClient({
            url,
            network: suiNetworkFromGraphqlUrl(url),
            fetch: createCheckpointRetryFetch({ fallbackUrl }),
        });
    }

    async getBalance(owner: string, coinType: string = NATIVE_SUI_COIN_TYPE): Promise<SuiBalanceBreakdown> {
        const { balance } = await this.buildClient.getBalance({ owner, coinType });

        return {
            balance: balance?.balance || "0",
            coinBalance: balance?.coinBalance || "0",
            addressBalance: balance?.addressBalance || "0",
        };
    }

    async simulate(transaction: Uint8Array): Promise<SuiGasSummary> {
        const result = await this.buildClient.simulateTransaction({
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
        const result = await this.buildClient.executeTransaction({
            transaction,
            signatures,
            include: { effects: true },
        });
        const tx = assertExecuted(result, "Transaction failed");

        if (!tx.digest) throw new Error("Transaction failed");

        return { digest: tx.digest };
    }
}
