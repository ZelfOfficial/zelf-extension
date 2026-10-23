import { Injectable } from "@angular/core";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

import {
    decimalToMist,
    formatMistAsSui,
    insufficientSuiMessage,
    isInsufficientCoinBalanceError,
    isNativeSuiCoinType,
    NATIVE_SUI_COIN_TYPE,
    netSuiFeeMist,
    resolveSuiTransferTarget,
    SUI_EXACT_GAS_BUDGET_CEILING_MIST,
    SuiGasSummary,
    suiAmountFitsGasBudget,
    suiGasReserveMessage,
    suiGraphqlUrlFromLicenseNetwork,
    typedAmountMatchesDisplayedMax,
} from "app/core/utils/sui-coin.util";
import { TransactionFeeEstimate, TransactionParams, TransactionResult } from "../core/models/transaction-fee.model";
import { failedBalanceFetch } from "app/core/utils/balance-fetch-result.util";
import { HttpWrapperService } from "app/http-wrapper.service";
import { environment } from "environments/environment";
import { historyQueryParams } from "../core/utils/transaction-history-pagination.util";
import { LicenseNetworksService } from "./license-networks.service";
import { SuiSendClient } from "./sui-chain.transport";
import { GraphqlSuiTransport } from "./sui-graphql.transport";

interface TransactionCostEstimate {
    estimatedFee: number;
    estimatedFeeUsd: number;
    /** Set when a max SUI send pays balance minus the fee, so the confirm screen can show that amount. */
    adjustedAmount?: string;
}

const SUI_DECIMALS = 9;
const FALLBACK_SUI_PRICE_USD = 2;

@Injectable({
    providedIn: "root",
})
export class SuiService {
    private _baseUrl: string = environment.apiUrl;
    /** Set by unit tests. Production uses SuiGraphQLClient. */
    private _boundClient: SuiSendClient | null = null;
    private _graphql: { url: string; client: SuiSendClient } | null = null;

    constructor(
        private _httpWrapper: HttpWrapperService,
        private _licenseNetworks: LicenseNetworksService
    ) {}

    /** Unit tests inject a fake client so no mainnet call is made. */
    bindClient(client: SuiSendClient): void {
        this._boundClient = client;
    }

    private _defaultResponse(): any {
        return {
            data: {
                _balance: 0,
                balance: "0",
                fiatBalance: "0",
                account: {
                    asset: "SUI",
                    price: "0",
                },
                tokenHoldings: {
                    tokens: [],
                },
            },
        };
    }

    private async _endpoints(): Promise<{ primary: string; fallback: string }> {
        const pub = environment.suiRpc.mainnet;
        let fromLicense = "";

        try {
            await this._licenseNetworks.ensureLoaded();
            fromLicense = suiGraphqlUrlFromLicenseNetwork(this._licenseNetworks.getNetworkEntry("sui")) || "";
        } catch (error) {
            console.warn("Sui GraphQL URL from domain license unavailable:", error);
        }

        if (fromLicense && fromLicense !== pub) return { primary: fromLicense, fallback: pub };

        return { primary: pub, fallback: fromLicense && fromLicense !== pub ? fromLicense : "" };
    }

    private async _chain(): Promise<SuiSendClient> {
        if (this._boundClient) return this._boundClient;

        const { primary, fallback } = await this._endpoints();
        if (!this._graphql || this._graphql.url !== primary) {
            this._graphql = { url: primary, client: new GraphqlSuiTransport(primary, fallback) };
        }

        return this._graphql.client;
    }

    private _keypair(mnemonic: string): Ed25519Keypair {
        return Ed25519Keypair.deriveKeypair(mnemonic.trim().toLowerCase());
    }

    private _amountMist(amount: string | number, decimals: number): bigint {
        return decimalToMist(amount, decimals);
    }

    private _gasBudgetMist(bytes: Uint8Array): bigint {
        const budget = Transaction.from(bytes).getData().gasData.budget;

        return BigInt(budget ?? 0);
    }

    private _feeFromGas(gas: SuiGasSummary): TransactionCostEstimate {
        const estimatedFee = Number(gas.computationCost) / 1_000_000_000;

        return {
            estimatedFee,
            estimatedFeeUsd: estimatedFee * FALLBACK_SUI_PRICE_USD,
        };
    }

    private async _build(tx: Transaction, client: SuiSendClient): Promise<Uint8Array> {
        return tx.build({ client: client.buildClient as never });
    }

    /**
     * Native SUI. Normal amounts build only `coinWithBalance`. The whole-balance
     * gas-coin transfer is built for Max/ALL, or after an exact build shows the
     * amount sits inside that transfer's gas budget (including a floored Max value).
     */
    private async _planNativeTransfer(
        sender: string,
        recipient: string,
        amount: string,
        client: SuiSendClient,
        sendAll: boolean,
        reportActualAmount: boolean
    ): Promise<{ bytes: Uint8Array; gas: SuiGasSummary; sentMist: bigint; sendEntireBalance: boolean }> {
        const totals = await client.getBalance(sender, NATIVE_SUI_COIN_TYPE);
        const balance = BigInt(totals.balance || "0");
        const amountMist = this._amountMist(amount, SUI_DECIMALS);

        if (amountMist <= 0n) throw new Error("Amount must be greater than 0");
        if (amountMist > balance) throw new Error(insufficientSuiMessage(balance, amountMist));

        if (sendAll) return this._entireBalance(sender, recipient, balance, amountMist, client, reportActualAmount);

        const exact = new Transaction();
        exact.setSender(sender);
        exact.transferObjects([coinWithBalance({ balance: amountMist })], recipient);

        try {
            const built = await this._measure(exact, client);

            if (!suiAmountFitsGasBudget(amountMist, balance, built.gasBudget)) {
                return this._afterExactBudgetMiss(sender, recipient, balance, amountMist, client, built.gasBudget);
            }

            return { bytes: built.bytes, gas: built.gas, sentMist: amountMist, sendEntireBalance: false };
        } catch (error) {
            if (error instanceof Error && error.message === suiGasReserveMessage(balance)) throw error;
            if (isInsufficientCoinBalanceError(error) && amountMist <= balance) {
                return this._afterExactBudgetMiss(sender, recipient, balance, amountMist, client, SUI_EXACT_GAS_BUDGET_CEILING_MIST);
            }

            throw error;
        }
    }

    private async _measure(
        tx: Transaction,
        client: SuiSendClient
    ): Promise<{ bytes: Uint8Array; gas: SuiGasSummary; gasBudget: bigint }> {
        const bytes = await this._build(tx, client);

        return { bytes, gas: await client.simulate(bytes), gasBudget: this._gasBudgetMist(bytes) };
    }

    /**
     * Exact `coinWithBalance` could not reserve its gas budget. Use the whole balance
     * only when the typed amount is the floored Max; otherwise show the fee message.
     */
    private async _afterExactBudgetMiss(
        sender: string,
        recipient: string,
        balance: bigint,
        amountMist: bigint,
        client: SuiSendClient,
        gasBudget: bigint
    ): Promise<{ bytes: Uint8Array; gas: SuiGasSummary; sentMist: bigint; sendEntireBalance: boolean }> {
        if (balance - amountMist <= gasBudget) {
            try {
                const entire = await this._entireBalance(sender, recipient, balance, amountMist, client, true);
                if (typedAmountMatchesDisplayedMax(amountMist, entire.sentMist)) return entire;
            } catch (error) {
                if (error instanceof Error && error.message === suiGasReserveMessage(balance)) throw error;
            }
        }

        throw new Error(suiGasReserveMessage(balance));
    }

    private async _entireBalance(
        sender: string,
        recipient: string,
        balance: bigint,
        amountMist: bigint,
        client: SuiSendClient,
        reportActualAmount: boolean
    ): Promise<{ bytes: Uint8Array; gas: SuiGasSummary; sentMist: bigint; sendEntireBalance: boolean }> {
        const tx = new Transaction();
        tx.setSender(sender);
        tx.transferObjects([tx.gas], recipient);

        const built = await this._measure(tx, client);
        const netFee = netSuiFeeMist(built.gas);
        const delivered = balance > netFee ? balance - netFee : 0n;

        if (delivered <= 0n) throw new Error(suiGasReserveMessage(balance));
        if (!reportActualAmount && delivered > amountMist) throw new Error(suiGasReserveMessage(balance));

        return { bytes: built.bytes, gas: built.gas, sentMist: delivered, sendEntireBalance: true };
    }

    private _coinTransaction(sender: string, recipient: string, coinType: string, amount: string | number, decimals: number): Transaction {
        const tx = new Transaction();

        tx.setSender(sender);
        tx.transferObjects([coinWithBalance({ type: coinType, balance: this._amountMist(amount, decimals), useGasCoin: false })], recipient);

        return tx;
    }

    /**
     * Signs on this device, then submits the signed bytes.
     * The mnemonic and keypair never leave this method.
     */
    private async _signBuilt(bytes: Uint8Array, keypair: Ed25519Keypair, client: SuiSendClient): Promise<string> {
        const { signature } = await keypair.signTransaction(bytes);
        const { digest } = await client.execute(bytes, [signature]);

        return digest;
    }

    private async _signAndExecute(tx: Transaction, keypair: Ed25519Keypair, client: SuiSendClient): Promise<string> {
        return this._signBuilt(await this._build(tx, client), keypair, client);
    }

    private async _transferSui(mnemonic: string, recipientAddress: string, amount: string, sendAll = false): Promise<string> {
        try {
            const keypair = this._keypair(mnemonic);
            const sender = keypair.getPublicKey().toSuiAddress();
            const client = await this._chain();
            const plan = await this._planNativeTransfer(sender, recipientAddress, amount, client, sendAll, false);

            return await this._signBuilt(plan.bytes, keypair, client);
        } catch (error: any) {
            console.error("Detailed error in SUI transfer:", {
                error,
                errorMessage: error.message,
                errorStack: error.stack,
            });

            throw error;
        }
    }

    private async _transferCoin(
        mnemonic: string,
        recipientAddress: string,
        addressToken: string,
        coinType: string,
        amount: string,
        decimalsHint?: number
    ): Promise<string> {
        try {
            const keypair = this._keypair(mnemonic);
            const sender = keypair.getPublicKey().toSuiAddress();
            const walletDetails = await this.getWalletDetails(sender);
            const tokenInfo = walletDetails?.data?.tokenHoldings?.tokens?.find((token: any) => token.address_token === addressToken);
            const decimals = Number(tokenInfo?.decimals ?? decimalsHint ?? 6);

            if (tokenInfo && this._amountMist(tokenInfo.amount || 0, decimals) < this._amountMist(amount, decimals)) {
                throw new Error(`Insufficient token balance. Available: ${tokenInfo.amount || 0}, Required: ${amount}`);
            }

            const client = await this._chain();
            const tx = this._coinTransaction(sender, recipientAddress, coinType, amount, decimals);

            return await this._signAndExecute(tx, keypair, client);
        } catch (error: any) {
            console.error("Error in token transfer:", error);

            throw error;
        }
    }

    private _quote(plan: { gas: SuiGasSummary; sentMist: bigint; sendEntireBalance: boolean }): TransactionCostEstimate {
        const quote = this._feeFromGas(plan.gas);

        if (plan.sendEntireBalance) quote.adjustedAmount = formatMistAsSui(plan.sentMist);

        return quote;
    }

    async calculateTransactionFees(
        receiverAddress: string,
        amount: number,
        tokenType: string,
        tokenAddress: string | undefined,
        tokenDecimals: number | undefined,
        tokenPrice: number,
        senderAddress?: string,
        sendAll = false,
        amountText?: string
    ): Promise<TransactionFeeEstimate> {
        const native = tokenType === "SUI" || (tokenType !== "SUI_TOKEN" && (isNativeSuiCoinType(tokenType) || isNativeSuiCoinType(tokenAddress)));
        const amountExact = amountText && amountText.trim() ? amountText.trim() : String(amount);
        const feeEstimate = native
            ? await this.estimateSuiTransactionFee(receiverAddress, amountExact, senderAddress, sendAll)
            : await this.estimateTokenTransactionFee(receiverAddress, tokenAddress || "", amountExact, tokenDecimals || 9, senderAddress);
        const amountInUsd = amount * tokenPrice;

        return {
            fee: feeEstimate.estimatedFee,
            fiatFee: feeEstimate.estimatedFeeUsd,
            total: amountInUsd + feeEstimate.estimatedFeeUsd,
            adjustedAmount: feeEstimate.adjustedAmount,
        };
    }

    async estimateSuiTransactionFee(
        receiverAddress: string,
        amount: string | number,
        senderAddress?: string,
        sendAll = false
    ): Promise<TransactionCostEstimate> {
        if (!senderAddress) throw new Error("Sender address is required to estimate a Sui fee");

        const client = await this._chain();
        const plan = await this._planNativeTransfer(senderAddress, receiverAddress, String(amount), client, sendAll, true);

        return this._quote(plan);
    }

    async estimateTokenTransactionFee(
        receiverAddress: string,
        contractAddress: string,
        amount: string | number,
        decimals: number = 9,
        senderAddress?: string
    ): Promise<TransactionCostEstimate> {
        const target = resolveSuiTransferTarget(contractAddress);
        if (target.kind === "native") return this.estimateSuiTransactionFee(receiverAddress, amount, senderAddress);
        if (!senderAddress) throw new Error("Sender address is required to estimate a Sui token fee");

        const client = await this._chain();
        const tx = this._coinTransaction(senderAddress, receiverAddress, target.coinType, amount, decimals);
        const bytes = await this._build(tx, client);

        return this._feeFromGas(await client.simulate(bytes));
    }

    async getSuiBalance(address: string): Promise<number> {
        try {
            const client = await this._chain();
            const balance = await client.getBalance(address, NATIVE_SUI_COIN_TYPE);

            return Number(balance.balance) / 1_000_000_000;
        } catch (error) {
            console.error("Error getting SUI balance:", error);

            throw new Error(`Error getting SUI balance: ${(error as Error).message}`);
        }
    }

    async getWalletDetails(address: string): Promise<any> {
        const url = `${this._baseUrl}/api/sui/address/${address}`;

        try {
            return this._httpWrapper
                .sendRequest("get", url)
                .then((response) => response)
                .catch((error) => failedBalanceFetch(error));
        } catch (error) {
            console.error("Exception in SUI getWalletDetails:", error);

            return Promise.resolve(failedBalanceFetch(error));
        }
    }

    isValidSuiAddress(address: string): boolean {
        return /^0x[a-fA-F0-9]{64}$/.test(address);
    }

    async requestTransactionDetails(transactionHash: string): Promise<{ data: any }> {
        return this._httpWrapper.sendRequest("get", `${this._baseUrl}/api/sui/transaction/${transactionHash}`);
    }

    async requestTransactionHistory(address: string, pagination: { page: number; show?: number; cursor?: string }): Promise<any> {
        const url = `${this._baseUrl}/api/sui/address/${address}/transactions`;

        const params = historyQueryParams(pagination);

        try {
            return this._httpWrapper
                .sendRequest("get", url, params)
                .then((response) => response)
                .catch(() => ({ data: [] }));
        } catch (error) {
            console.error("Exception in SUI requestTransactionHistory:", error);

            return Promise.resolve({ data: [] });
        }
    }

    async sendTransaction(params: TransactionParams): Promise<TransactionResult> {
        if (!params.mnemonic) throw new Error("Mnemonic is required for SUI transactions");

        const target = resolveSuiTransferTarget(params.tokenAddress);
        const amountText = String(params.value ?? "").replace(/,/g, "").trim();
        const hash =
            target.kind === "native"
                ? await this._transferSui(params.mnemonic, params.to, amountText, !!params.sendAll)
                : await this._transferCoin(
                      params.mnemonic,
                      params.to,
                      `${params.tokenAddress || ""}`.trim(),
                      target.coinType,
                      amountText,
                      params.tokenDecimals
                  );

        return {
            hash,
            status: "pending",
        };
    }
}
