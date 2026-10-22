import { Injectable } from "@angular/core";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

import {
    isNativeSuiCoinType,
    mistGasBudget,
    NATIVE_SUI_COIN_TYPE,
    resolveSuiTransferTarget,
    SuiGasSummary,
    suiGraphqlUrlFromLicenseNetwork,
} from "app/core/utils/sui-coin.util";
import { TransactionFeeEstimate, TransactionParams, TransactionResult } from "../core/models/transaction-fee.model";
import { HttpWrapperService } from "app/http-wrapper.service";
import { environment } from "environments/environment";
import { LicenseNetworksService } from "./license-networks.service";
import { SuiChainTransport, SuiCoinRef } from "./sui-chain.transport";
import { GraphqlSuiTransport } from "./sui-graphql.transport";

interface TransactionCostEstimate {
    estimatedFee: number;
    estimatedFeeUsd: number;
}

const PROVISIONAL_GAS_BUDGET = 50_000_000n;
const SUI_DECIMALS = 9;
const FALLBACK_SUI_PRICE_USD = 2;

@Injectable({
    providedIn: "root",
})
export class SuiService {
    private _baseUrl: string = environment.apiUrl;
    /** Set by unit tests. Production builds the GraphQL transport from the license or environment URL. */
    private _boundTransport: SuiChainTransport | null = null;
    private _graphql: { url: string; transport: SuiChainTransport } | null = null;

    constructor(
        private _httpWrapper: HttpWrapperService,
        private _licenseNetworks: LicenseNetworksService
    ) {}

    /** Unit tests inject a fake transport so no mainnet call is made. */
    bindTransport(transport: SuiChainTransport): void {
        this._boundTransport = transport;
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

    private async _resolveGraphqlUrl(): Promise<string> {
        try {
            await this._licenseNetworks.ensureLoaded();
            const fromLicense = suiGraphqlUrlFromLicenseNetwork(this._licenseNetworks.getNetworkEntry("sui"));
            if (fromLicense) return fromLicense;
        } catch (error) {
            console.warn("Sui GraphQL URL from domain license unavailable:", error);
        }

        return environment.suiRpc.mainnet;
    }

    private async _chain(): Promise<SuiChainTransport> {
        if (this._boundTransport) return this._boundTransport;

        const url = await this._resolveGraphqlUrl();
        if (!this._graphql || this._graphql.url !== url) {
            this._graphql = { url, transport: new GraphqlSuiTransport(url) };
        }

        return this._graphql.transport;
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

    private async _attachGas(tx: Transaction, sender: string, transport: SuiChainTransport): Promise<void> {
        tx.setSender(sender);
        tx.setGasPrice(await transport.referenceGasPrice());

        const gasCoins = await transport.listCoins(sender, NATIVE_SUI_COIN_TYPE);
        if (!gasCoins.length) throw new Error("No SUI coins available to pay gas");

        tx.setGasPayment(
            gasCoins.map((coin) => ({
                objectId: coin.objectId,
                version: coin.version,
                digest: coin.digest,
            }))
        );
        tx.setGasBudget(PROVISIONAL_GAS_BUDGET);
    }

    private _nativeTransaction(recipient: string, amount: number): Transaction {
        const tx = new Transaction();
        const [coin] = tx.splitCoins(tx.gas, [this._toSmallest(amount, SUI_DECIMALS)]);

        tx.transferObjects([coin], recipient);

        return tx;
    }

    private _coinTransaction(recipient: string, amount: number, decimals: number, coins: SuiCoinRef[]): Transaction {
        const amountSmall = this._toSmallest(amount, decimals);
        let total = 0n;

        for (const coin of coins) total += BigInt(coin.balance || "0");

        if (total < amountSmall) {
            const available = Number(total) / 10 ** decimals;

            throw new Error(`Insufficient total balance. Available: ${available}, Required: ${amount}`);
        }

        const tx = new Transaction();
        const refs = coins.map((coin) =>
            tx.objectRef({
                objectId: coin.objectId,
                version: coin.version,
                digest: coin.digest,
            })
        );
        const primary = refs[0];

        if (refs.length > 1) tx.mergeCoins(primary, refs.slice(1));

        const [sendCoin] = tx.splitCoins(primary, [amountSmall]);

        tx.transferObjects([sendCoin], recipient);

        return tx;
    }

    private async _dryRun(tx: Transaction, transport: SuiChainTransport): Promise<SuiGasSummary> {
        return transport.simulate(await tx.build());
    }

    /**
     * Signs on this device, then asks the transport to execute the signed bytes.
     * The mnemonic and keypair never leave this method.
     */
    private async _signAndExecute(tx: Transaction, keypair: Ed25519Keypair, transport: SuiChainTransport): Promise<string> {
        const simulated = await this._dryRun(tx, transport);

        tx.setGasBudget(mistGasBudget(simulated));

        const bytes = await tx.build();
        const { signature } = await keypair.signTransaction(bytes);
        const { digest } = await transport.execute(bytes, [signature]);

        return digest;
    }

    private async _transferSui(mnemonic: string, recipientAddress: string, amount?: number): Promise<string> {
        try {
            const keypair = this._keypair(mnemonic);
            const sender = keypair.getPublicKey().toSuiAddress();
            const transport = await this._chain();
            const tx = this._nativeTransaction(recipientAddress, amount || 0);

            await this._attachGas(tx, sender, transport);

            return await this._signAndExecute(tx, keypair, transport);
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

            const transport = await this._chain();
            const coins = await transport.listCoins(sender, coinType);

            if (!coins.length) throw new Error(`No coins found in wallet for type: ${coinType}`);

            const tx = this._coinTransaction(recipientAddress, amount, decimals, coins);

            await this._attachGas(tx, sender, transport);

            return await this._signAndExecute(tx, keypair, transport);
        } catch (error: any) {
            console.error("Error in token transfer:", error);

            throw error;
        }
    }

    async calculateTransactionFees(
        receiverAddress: string,
        amount: number,
        tokenType: string,
        tokenAddress: string | undefined,
        tokenDecimals: number | undefined,
        tokenPrice: number,
        senderAddress?: string
    ): Promise<TransactionFeeEstimate> {
        const native = tokenType === "SUI" || (tokenType !== "SUI_TOKEN" && (isNativeSuiCoinType(tokenType) || isNativeSuiCoinType(tokenAddress)));
        const feeEstimate = native
            ? await this.estimateSuiTransactionFee(receiverAddress, amount, senderAddress)
            : await this.estimateTokenTransactionFee(receiverAddress, tokenAddress || "", amount, tokenDecimals || 9, senderAddress);
        const amountInUsd = amount * tokenPrice;

        return {
            fee: feeEstimate.estimatedFee,
            fiatFee: feeEstimate.estimatedFeeUsd,
            total: amountInUsd + feeEstimate.estimatedFeeUsd,
        };
    }

    async estimateSuiTransactionFee(receiverAddress: string, amount: number, senderAddress?: string): Promise<TransactionCostEstimate> {
        try {
            if (!senderAddress) throw new Error("Sender address is required to estimate a Sui fee");

            const transport = await this._chain();
            const tx = this._nativeTransaction(receiverAddress, amount);

            await this._attachGas(tx, senderAddress, transport);

            return this._feeFromGas(await this._dryRun(tx, transport));
        } catch (error) {
            console.error("Error estimating SUI transaction fee:", error);

            return {
                estimatedFee: 0.001,
                estimatedFeeUsd: 0.002,
            };
        }
    }

    async estimateTokenTransactionFee(
        receiverAddress: string,
        contractAddress: string,
        amount: number,
        decimals: number = 9,
        senderAddress?: string
    ): Promise<TransactionCostEstimate> {
        try {
            const target = resolveSuiTransferTarget(contractAddress);
            if (target.kind === "native") return this.estimateSuiTransactionFee(receiverAddress, amount, senderAddress);
            if (!senderAddress) throw new Error("Sender address is required to estimate a Sui token fee");

            const transport = await this._chain();
            const coins = await transport.listCoins(senderAddress, target.coinType);
            if (!coins.length) throw new Error(`No coins found in wallet for type: ${target.coinType}`);

            const tx = this._coinTransaction(receiverAddress, amount, decimals, coins);

            await this._attachGas(tx, senderAddress, transport);

            return this._feeFromGas(await this._dryRun(tx, transport));
        } catch (error) {
            console.error("Error estimating token transaction fee:", error);

            return {
                estimatedFee: 0.002,
                estimatedFeeUsd: 0.004,
            };
        }
    }

    async getSuiBalance(address: string): Promise<number> {
        try {
            const transport = await this._chain();
            const balance = await transport.getBalance(address, NATIVE_SUI_COIN_TYPE);

            return Number(balance) / 1_000_000_000;
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
                ? await this._transferSui(params.mnemonic, params.to, parseFloat(params.value))
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
