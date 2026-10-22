import { SuiGasSummary } from "app/core/utils/sui-coin.util";

export interface SuiBalanceBreakdown {
    balance: string;
    coinBalance: string;
    addressBalance: string;
}

/**
 * What a Sui send needs from the chain. `buildClient` is passed to `Transaction.build`
 * so the SDK can resolve `coinWithBalance` (coin objects and address balances) and gas.
 * Signing stays outside this type.
 */
export interface SuiSendClient {
    readonly buildClient: object;
    getBalance(owner: string, coinType: string): Promise<SuiBalanceBreakdown>;
    simulate(transaction: Uint8Array): Promise<SuiGasSummary>;
    execute(transaction: Uint8Array, signatures: string[]): Promise<{ digest: string }>;
}
