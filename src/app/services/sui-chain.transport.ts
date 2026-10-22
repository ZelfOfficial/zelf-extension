import { SuiGasSummary } from "app/core/utils/sui-coin.util";

export interface SuiCoinRef {
    objectId: string;
    version: string;
    digest: string;
    balance: string;
}

/**
 * Chain reads and signed-transaction submission. Signing stays outside this type:
 * the transport never receives a mnemonic or private key.
 */
export interface SuiChainTransport {
    listCoins(owner: string, coinType: string): Promise<SuiCoinRef[]>;
    referenceGasPrice(): Promise<bigint>;
    simulate(transaction: Uint8Array): Promise<SuiGasSummary>;
    execute(transaction: Uint8Array, signatures: string[]): Promise<{ digest: string }>;
    getBalance(owner: string, coinType: string): Promise<bigint>;
}
