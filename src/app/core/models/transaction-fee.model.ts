import type { StellarFeeBreakdown } from "../../services/stellar-send.types";

export interface TransactionFeeEstimate {
    fee: number;
    fiatFee: number;
    total: number;
    networkPrice?: number;
    /** Populated for Stellar fee estimates (native + classic preview). */
    stellar?: StellarFeeBreakdown;
    /** Native SUI max send: amount the recipient actually receives (balance minus fee). */
    adjustedAmount?: string;
}

export interface FeeCalculationParams {
    network: string;
    receiverAddress: string;
    amount: number;
    tokenType: string;
    tokenAddress?: string;
    tokenDecimals?: number;
    tokenPrice?: number;
    selectedFeeRate?: number;
    senderAddress?: string;
    /** Native SUI Max/ALL. The confirm amount becomes balance minus the fee. */
    sendAll?: boolean;
    /** Exact decimal text. Sui must not convert this through a float. */
    amountText?: string;
}

export interface TransactionParams {
    from: string;
    to: string;
    value: string;
    network: string;
    data?: string;
    chainId?: number;
    privateKey?: string;
    mnemonic?: string;
    tokenAddress?: string;
    tokenDecimals?: number;
    /** Stellar `Memo.text` (max 28 bytes); native XLM only. */
    memo?: string;
    /** Native SUI Max/ALL. Sends the balance minus the fee. */
    sendAll?: boolean;
}

export interface TransactionResult {
    hash: string;
    status?: string;
}
