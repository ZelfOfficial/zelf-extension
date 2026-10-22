import { Injectable } from "@angular/core";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

import {
    formatMistAsSui,
    insufficientSuiMessage,
    isNativeSuiCoinType,
    NATIVE_SUI_COIN_TYPE,
    netSuiFeeMist,
    resolveSuiTransferTarget,
    shouldSendEntireSuiBalance,
    SuiGasSummary,
    suiGasReserveMessage,
    suiGraphqlUrlFromLicenseNetwork,
} from "app/core/utils/sui-coin.util";
import { TransactionFeeEstimate, TransactionParams, TransactionResult } from "../core/models/transaction-fee.model";
import { HttpWrapperService } from "app/http-wrapper.service";
import { environment } from "environments/environment";
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

    private _toSmallest(amount: number, decimals: number): bigint {
        const factor = 10 ** decimals;
        const whole = Math.floor(Math.max(0, amount) * factor);

        return BigInt(Number.isFinite(whole) ? whole : 0);
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
     * Native SUI. An exact `coinWithBalance` is used unless the user chose Max/ALL,
     * or the typed amount is at least the balance minus the estimated fee.
     * The amount paid out is never higher than the amount this plan was given.
     */
    private async _planNativeTransfer(
        sender: string,
        recipient: string,
        amount: number,
        client: SuiSendClient,
        sendAll: boolean,
        reportActualAmount: boolean
    ): Promise<{ bytes: Uint8Array; gas: SuiGasSummary; sentMist: bigint; sendEntireBalance: boolean }> {
        const totals = await client.getBalance(sender, NATIVE_SUI_COIN_TYPE);
        const balance = BigInt(totals.balance || "0");
        const amountMist = this._toSmallest(amount, SUI_DECIMALS);

        if (amountMist <= 0n) throw new Error("Amount must be greater than 0");
        if (amountMist > balance) throw new Error(insufficientSuiMessage(balance, amountMist));

        const exact = new Transaction();
        exact.setSender(sender);
        exact.transferObjects([coinWithBalance({ balance: amountMist })], recipient);

        let exactError: unknown;

        try {
            const bytes = await this._build(exact, client);
            const gas = await client.simulate(bytes);
            const fee = netSuiFeeMist(gas);

            if (amountMist + fee <= balance) return { bytes, gas, sentMist: amountMist, sendEntireBalance: false };
        } catch (error) {
            exactError = error;
            const feeWouldFit = await this._feeFits(sender, recipient, balance, amountMist, client);

            if (feeWouldFit) throw error;
        }

        const entire = new Transaction();
        entire.setSender(sender);
        entire.transferObjects([entire.gas], recipient);

        let entireBytes: Uint8Array;
        let entireGas: SuiGasSummary;

        try {
            entireBytes = await this._build(entire, client);
            entireGas = await client.simulate(entireBytes);
        } catch {
            if (exactError) throw exactError;

            throw new Error(suiGasReserveMessage(balance));
        }

        const fee = netSuiFeeMist(entireGas);
        const delivered = balance > fee ? balance - fee : 0n;
        const sendEntire = shouldSendEntireSuiBalance(amountMist, delivered, sendAll);
        const withinShownAmount = delivered <= amountMist || (sendAll && reportActualAmount);

        if (sendEntire && delivered > 0n && withinShownAmount) {
            return { bytes: entireBytes, gas: entireGas, sentMist: delivered, sendEntireBalance: true };
        }

        throw new Error(suiGasReserveMessage(balance));
    }

    /** Dry-run the max transfer only to learn whether `amount + fee` still fits in the balance. */
    private async _feeFits(sender: string, recipient: string, balance: bigint, amountMist: bigint, client: SuiSendClient): Promise<boolean> {
        try {
            const probe = new Transaction();
            probe.setSender(sender);
            probe.transferObjects([probe.gas], recipient);
            const gas = await client.simulate(await this._build(probe, client));

            return amountMist + netSuiFeeMist(gas) <= balance;
        } catch {
            return false;
        }
    }

    private _coinTransaction(sender: string, recipient: string, coinType: string, amount: number, decimals: number): Transaction {
        const tx = new Transaction();

        tx.setSender(sender);
        tx.transferObjects([coinWithBalance({ type: coinType, balance: this._toSmallest(amount, decimals), useGasCoin: false })], recipient);

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

    private async _transferSui(mnemonic: string, recipientAddress: string, amount?: number, sendAll = false): Promise<string> {
        try {
            const keypair = this._keypair(mnemonic);
            const sender = keypair.getPublicKey().toSuiAddress();
            const client = await this._chain();
            const plan = await this._planNativeTransfer(sender, recipientAddress, amount || 0, client, sendAll, false);

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
        amount: number,
        decimalsHint?: number
    ): Promise<string> {
        try {
            const keypair = this._keypair(mnemonic);
            const sender = keypair.getPublicKey().toSuiAddress();
            const walletDetails = await this.getWalletDetails(sender);
            const tokenInfo = walletDetails?.data?.tokenHoldings?.tokens?.find((token: any) => token.address_token === addressToken);
            const decimals = Number(tokenInfo?.decimals ?? decimalsHint ?? 6);

            if (tokenInfo && Number(tokenInfo.amount || 0) < amount) {
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
        sendAll = false
    ): Promise<TransactionFeeEstimate> {
        const native = tokenType === "SUI" || (tokenType !== "SUI_TOKEN" && (isNativeSuiCoinType(tokenType) || isNativeSuiCoinType(tokenAddress)));
        const feeEstimate = native
            ? await this.estimateSuiTransactionFee(receiverAddress, amount, senderAddress, sendAll)
            : await this.estimateTokenTransactionFee(receiverAddress, tokenAddress || "", amount, tokenDecimals || 9, senderAddress);
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
        amount: number,
        senderAddress?: string,
        sendAll = false
    ): Promise<TransactionCostEstimate> {
        if (!senderAddress) throw new Error("Sender address is required to estimate a Sui fee");

        const client = await this._chain();
        const plan = await this._planNativeTransfer(senderAddress, receiverAddress, amount, client, sendAll, true);

        return this._quote(plan);
    }

    async estimateTokenTransactionFee(
        receiverAddress: string,
        contractAddress: string,
        amount: number,
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
                .catch(() => this._defaultResponse());
        } catch (error) {
            console.error("Exception in SUI getWalletDetails:", error);

            return Promise.resolve(this._defaultResponse());
        }
    }

    isValidSuiAddress(address: string): boolean {
        return /^0x[a-fA-F0-9]{64}$/.test(address);
    }

    async requestTransactionDetails(transactionHash: string): Promise<{ data: any }> {
        return this._httpWrapper.sendRequest("get", `${this._baseUrl}/api/sui/transaction/${transactionHash}`);
    }

    async requestTransactionHistory(address: string, pagination: { page: number; show?: number }): Promise<any> {
        const url = `${this._baseUrl}/api/sui/address/${address}/transactions`;

        const params = {
            page: pagination.page,
            show: pagination.show || 25,
        };

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
        const hash =
            target.kind === "native"
                ? await this._transferSui(params.mnemonic, params.to, parseFloat(params.value), !!params.sendAll)
                : await this._transferCoin(
                      params.mnemonic,
                      params.to,
                      `${params.tokenAddress || ""}`.trim(),
                      target.coinType,
                      parseFloat(params.value),
                      params.tokenDecimals
                  );

        return {
            hash,
            status: "pending",
        };
    }
}
