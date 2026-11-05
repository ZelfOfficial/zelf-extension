import { Injectable } from "@angular/core";
import StellarHDWallet from "stellar-hd-wallet";
import { Asset, Horizon, Keypair, Memo, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";

import { failedBalanceFetch } from "app/core/utils/balance-fetch-result.util";
import { environment } from "environments/environment";
import { TransactionFeeEstimate, TransactionParams, TransactionResult } from "../core/models/transaction-fee.model";
import { HttpWrapperService } from "../http-wrapper.service";
import { AuthService } from "./auth.service";
import { retryAfterDelayMs, stellarProxyBase } from "@shared/utils/rpc-proxy-http";
import { StellarSorobanService } from "./stellar-soroban.service";
import { StellarFeeBreakdown, StellarSendPreview } from "./stellar-send.types";
import {
    formatTokenAmount,
    isClassicAssetRef,
    minimumAccountReserveXlm,
    minimumNewAccountBalanceXlm,
    parseClassicAsset,
} from "./stellar-transaction.util";
import { stellarHistoryQueryParams } from "../core/utils/transaction-history-pagination.util";

@Injectable({
    providedIn: "root",
})
export class StellarService {
    private _baseUrl: string = environment.apiUrl;
    private _horizon: Horizon.Server | null = null;
    /** The Stellar HTTP client applies request interceptors synchronously, so the token is cached here. */
    private _horizonToken = "";

    constructor(
        private _httpWrapper: HttpWrapperService,
        private _stellarSoroban: StellarSorobanService,
        private _auth: AuthService
    ) {}

    private async _horizonServer(): Promise<Horizon.Server> {
        this._horizonToken = await this._auth.checkAccessToken();

        if (this._horizon) return this._horizon;

        const url = stellarProxyBase(this._baseUrl);
        const server = new Horizon.Server(url, { allowHttp: url.startsWith("http://") });

        const retryHttpRequest = (config: Record<string, any>): Promise<any> => {
            const client = server.httpClient as unknown as {
                request?: (cfg: Record<string, any>) => Promise<any>;
                makeRequest?: (cfg: Record<string, any>) => Promise<any>;
            };

            if (typeof client.request === "function") {
                return client.request(config);
            }

            if (typeof client.makeRequest === "function") {
                return client.makeRequest(config);
            }

            throw new Error("Stellar HTTP client does not support retrying requests");
        };

        server.httpClient.interceptors.request.use((config) => {
            const authValue = `Bearer ${this._horizonToken}`;
            const rawHeaders = config.headers as { set?: (k: string, v: string) => void } | Record<string, string> | undefined;

            if (rawHeaders && typeof rawHeaders.set === "function") {
                rawHeaders.set("Authorization", authValue);
            } else {
                const headers = new Headers((config.headers as HeadersInit | undefined) || undefined);

                headers.set("Authorization", authValue);
                config.headers = headers;
            }

            return config;
        });

        server.httpClient.interceptors.response.use(
            (response) => response,
            async (error: { response?: { status?: number; headers?: Record<string, unknown> }; config?: Record<string, any> }) => {
                const status = error?.response?.status;
                const config = error?.config;

                if (!config) throw error;

                if (status === 401 && !config["__zelfAuthRetried"]) {
                    config["__zelfAuthRetried"] = true;
                    this._horizonToken = await this._auth.refreshAfterUnauthorized();

                    return retryHttpRequest(config);
                }

                if (status === 429 && !config["__zelfRateRetried"]) {
                    config["__zelfRateRetried"] = true;
                    const headers = error.response?.headers as unknown;
                    const retryAfter =
                        headers && typeof (headers as Headers).get === "function"
                            ? (headers as Headers).get("retry-after")
                            : (headers as Record<string, string> | undefined)?.["retry-after"] || null;

                    await new Promise((resolve) => setTimeout(resolve, retryAfterDelayMs(retryAfter)));

                    return retryHttpRequest(config);
                }

                throw error;
            }
        );

        this._horizon = server;

        return server;
    }

    private _networkPassphrase(): string {
        return Networks.PUBLIC;
    }

    isValidStellarAddress(address: string): boolean {
        if (!address || typeof address !== "string") return false;

        const trimmed = address.trim();

        return StrKey.isValidEd25519PublicKey(trimmed);
    }

    /** Matches Zelf `Repositories/Wallet/modules/stellar.js`: `StellarHDWallet.fromMnemonic`, index `0`. */
    getSecretKeyFromMnemonic(mnemonic: string): string {
        const normalized = mnemonic.trim().toLowerCase();

        return StellarHDWallet.fromMnemonic(normalized).getSecret(0);
    }

    getPublicKeyFromMnemonic(mnemonic: string): string {
        const normalized = mnemonic.trim().toLowerCase();

        return StellarHDWallet.fromMnemonic(normalized).getPublicKey(0);
    }

    private async _fetchLatestBaseReserveStroops(server: Horizon.Server): Promise<number> {
        const res = await server.ledgers().order("desc").limit(1).call();
        const stroops = res.records[0]?.base_reserve_in_stroops;

        if (!stroops || stroops <= 0) {
            throw new Error("Could not read Stellar base reserve from Horizon");
        }

        return stroops;
    }

    async destinationAccountExists(destination: string): Promise<boolean> {
        const server = await this._horizonServer();

        try {
            await server.accounts().accountId(destination.trim()).call();

            return true;
        } catch (err: unknown) {
            const e = err as { response?: { status?: number }; constructor?: { name?: string } };
            const status = e?.response?.status;
            const name = e?.constructor?.name;

            if (status === 404 || name === "NotFoundError") {
                return false;
            }

            throw err;
        }
    }

    /**
     * Native XLM preview: payment vs createAccount vs createAccount+payment (merged ops).
     */
    async getNativeSendPreview(destination: string, amountXlm: number): Promise<StellarSendPreview> {
        const server = await this._horizonServer();
        const baseReserveStroops = await this._fetchLatestBaseReserveStroops(server);
        const minReserveXlm = minimumNewAccountBalanceXlm(baseReserveStroops);
        const exists = await this.destinationAccountExists(destination);

        if (!Number.isFinite(amountXlm) || amountXlm <= 0) {
            return {
                mode: "payment",
                destinationAccountMissing: !exists,
                minReserveXlm,
                userAmount: amountXlm,
                amountBelowMinimum: true,
                warningKeys: ["invalid_amount"],
            };
        }

        if (exists) {
            return {
                mode: "payment",
                destinationAccountMissing: false,
                minReserveXlm,
                userAmount: amountXlm,
                amountBelowMinimum: false,
                warningKeys: [],
            };
        }

        if (amountXlm + 1e-12 < minReserveXlm) {
            return {
                mode: "create_only",
                destinationAccountMissing: true,
                minReserveXlm,
                userAmount: amountXlm,
                amountBelowMinimum: true,
                warningKeys: ["below_min"],
            };
        }

        const eps = 1e-10;

        if (amountXlm <= minReserveXlm + eps) {
            return {
                mode: "create_only",
                destinationAccountMissing: true,
                minReserveXlm,
                reservePortionXlm: minReserveXlm,
                userAmount: amountXlm,
                amountBelowMinimum: false,
                warningKeys: ["new_account_explainer"],
            };
        }

        return {
            mode: "create_and_pay",
            destinationAccountMissing: true,
            minReserveXlm,
            reservePortionXlm: minReserveXlm,
            transferPortionXlm: amountXlm - minReserveXlm,
            userAmount: amountXlm,
            amountBelowMinimum: false,
            warningKeys: ["new_account_explainer"],
        };
    }

    private async _destinationHasTrustlineForAsset(destination: string, asset: Asset): Promise<boolean> {
        if (asset.isNative()) return true;

        const server = await this._horizonServer();
        const acc = await server.accounts().accountId(destination.trim()).call();

        return acc.balances.some(
            (b: { asset_type?: string; asset_code?: string; asset_issuer?: string }) =>
                b.asset_type !== "native" && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
        );
    }

    /**
     * Classic (non-native) asset: requires funded destination + recipient trustline.
     */
    async getClassicSendPreview(destination: string, amount: number, tokenAddress: string | undefined): Promise<StellarSendPreview> {
        this._stellarSoroban.assertClassicOrNativeOnly(tokenAddress);

        const server = await this._horizonServer();
        const baseReserveStroops = await this._fetchLatestBaseReserveStroops(server);
        const minReserveXlm = minimumNewAccountBalanceXlm(baseReserveStroops);
        const asset = parseClassicAsset(tokenAddress);
        const exists = await this.destinationAccountExists(destination);

        if (!Number.isFinite(amount) || amount <= 0) {
            return {
                mode: "payment",
                destinationAccountMissing: !exists,
                minReserveXlm,
                userAmount: amount,
                amountBelowMinimum: true,
                warningKeys: ["invalid_amount"],
            };
        }

        if (!exists) {
            return {
                mode: "payment",
                destinationAccountMissing: true,
                minReserveXlm,
                userAmount: amount,
                amountBelowMinimum: false,
                warningKeys: ["classic_fund_first"],
            };
        }

        const hasLine = await this._destinationHasTrustlineForAsset(destination, asset);

        if (!hasLine) {
            return {
                mode: "payment",
                destinationAccountMissing: false,
                minReserveXlm,
                userAmount: amount,
                amountBelowMinimum: false,
                warningKeys: ["classic_trustline"],
            };
        }

        return {
            mode: "payment",
            destinationAccountMissing: false,
            minReserveXlm,
            userAmount: amount,
            amountBelowMinimum: false,
            warningKeys: [],
        };
    }

    private async _getSenderAccountReserveInfo(
        server: Horizon.Server,
        senderAddress: string,
        baseReserveStroops: number,
        feeXlm: number
    ): Promise<{
        nativeBalanceXlm: number;
        minReserveXlm: number;
        spendableXlm: number;
    } | null> {
        const trimmed = senderAddress?.trim();

        if (!trimmed || !this.isValidStellarAddress(trimmed)) return null;

        try {
            const acc = (await server.accounts().accountId(trimmed).call()) as unknown as {
                subentry_count?: number;
                num_sponsoring?: number;
                num_sponsored?: number;
                balances?: Array<{
                    asset_type?: string;
                    balance?: string;
                    selling_liabilities?: string;
                }>;
            };

            const nativeEntry = acc.balances?.find((b) => b.asset_type === "native");
            const nativeBalanceXlm = parseFloat(nativeEntry?.balance || "0") || 0;
            const sellingLiabilitiesXlm = parseFloat(nativeEntry?.selling_liabilities || "0") || 0;
            const minReserveXlm = minimumAccountReserveXlm(
                baseReserveStroops,
                acc.subentry_count || 0,
                acc.num_sponsoring || 0,
                acc.num_sponsored || 0,
                sellingLiabilitiesXlm
            );
            const spendableXlm = Math.max(0, Number((nativeBalanceXlm - minReserveXlm - feeXlm).toFixed(7)));

            return {
                nativeBalanceXlm,
                minReserveXlm,
                spendableXlm,
            };
        } catch (err: unknown) {
            const e = err as { response?: { status?: number }; constructor?: { name?: string } };

            if (e?.response?.status === 404 || e?.constructor?.name === "NotFoundError") {
                const minReserveXlm = minimumNewAccountBalanceXlm(baseReserveStroops);

                return {
                    nativeBalanceXlm: 0,
                    minReserveXlm,
                    spendableXlm: 0,
                };
            }

            return null;
        }
    }

    async getSenderSpendableInfo(senderAddress: string): Promise<{
        nativeBalanceXlm: number;
        minReserveXlm: number;
        feeXlm: number;
        spendableXlm: number;
    } | null> {
        try {
            const server = await this._horizonServer();
            const [baseFeeStroops, baseReserveStroops] = await Promise.all([
                server.fetchBaseFee(),
                this._fetchLatestBaseReserveStroops(server),
            ]);
            const feeXlm = baseFeeStroops / 1e7;
            const info = await this._getSenderAccountReserveInfo(server, senderAddress, baseReserveStroops, feeXlm);

            if (!info) return null;

            return {
                ...info,
                feeXlm,
            };
        } catch {
            return null;
        }
    }

    async calculateTransactionFees(
        receiverAddress: string,
        amount: number,
        tokenPrice: number,
        tokenAddress?: string,
        tokenDecimals?: number,
        senderAddress?: string,
        sendAll?: boolean
    ): Promise<TransactionFeeEstimate> {
        const server = await this._horizonServer();
        const baseFeeStroops = await server.fetchBaseFee();
        const feeXlm = baseFeeStroops / 1e7;
        const price = tokenPrice || 0;
        const fiatFee = feeXlm * price;

        this._stellarSoroban.assertClassicOrNativeOnly(tokenAddress);

        const isNative = !tokenAddress?.trim() || !isClassicAssetRef(tokenAddress);
        const baseReserveStroops = await this._fetchLatestBaseReserveStroops(server);
        const senderReserve = senderAddress
            ? await this._getSenderAccountReserveInfo(server, senderAddress, baseReserveStroops, feeXlm)
            : null;

        let effectiveAmount = amount;
        let adjustedAmount: string | undefined;

        if (isNative && sendAll && senderReserve && senderReserve.spendableXlm > 0) {
            effectiveAmount = senderReserve.spendableXlm;
            adjustedAmount = this._formatNativeAmount(senderReserve.spendableXlm);
        }

        const amountInUsd = effectiveAmount * price;
        let preview: StellarSendPreview;

        if (isNative) {
            preview = await this.getNativeSendPreview(receiverAddress?.trim() || "", effectiveAmount);
        } else {
            preview = await this.getClassicSendPreview(receiverAddress?.trim() || "", effectiveAmount, tokenAddress);
        }

        if (senderReserve) {
            preview.senderMinReserveXlm = senderReserve.minReserveXlm;
            preview.senderSpendableXlm = senderReserve.spendableXlm;

            const eps = 1e-8;
            const exceedsReserve = isNative
                ? effectiveAmount > senderReserve.spendableXlm + eps
                : senderReserve.nativeBalanceXlm + eps < senderReserve.minReserveXlm + feeXlm;

            if (exceedsReserve) {
                preview.senderReserveExceeded = true;
                if (!preview.warningKeys.includes("sender_reserve_exceeded")) {
                    preview.warningKeys.push("sender_reserve_exceeded");
                }
            }
        }

        const xlmOut = isNative ? preview.userAmount : 0;

        const stellar: StellarFeeBreakdown = {
            preview,
            xlmDebitedExcludingNetworkFee: xlmOut,
        };

        return {
            fee: feeXlm,
            fiatFee,
            total: amountInUsd + fiatFee,
            networkPrice: price,
            adjustedAmount,
            stellar,
        };
    }

    private _formatNativeAmount(amount: number): string {
        return formatTokenAmount(amount, 7);
    }

    private _extractResultCodes(err: unknown): { transaction?: string; operations?: string[] } | undefined {
        const e = err as {
            response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } };
            data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
        };

        return e?.response?.data?.extras?.result_codes || e?.data?.extras?.result_codes;
    }

    private _isCreateAccountRaceError(err: unknown): boolean {
        const ops = this._extractResultCodes(err)?.operations;

        if (!ops?.length) return false;

        const joined = ops.join(" ").toLowerCase();

        return joined.includes("account_exists") || joined.includes("already_exists") || joined.includes("op_already_exists");
    }

    private _isBadSequenceError(err: unknown): boolean {
        const codes = this._extractResultCodes(err);
        const txCode = (codes?.transaction || "").toLowerCase();
        const msg = ((err as Error)?.message || "").toLowerCase();

        return txCode.includes("tx_bad_seq") || msg.includes("tx_bad_seq");
    }

    private _mapHorizonSubmitError(err: unknown): string {
        const e = err as { name?: string; constructor?: { name?: string }; message?: string };
        const errName = (e?.name || e?.constructor?.name || "").toLowerCase();
        const rawMsg = (e?.message || "").trim();
        const rawLower = rawMsg.toLowerCase();

        if (rawMsg.startsWith("errors.")) {
            return rawMsg;
        }

        if (errName.includes("accountrequiresmemo") || rawLower.includes("account requires memo") || rawLower.includes("memo_required")) {
            return "errors.stellar_memo_required";
        }

        const codes = this._extractResultCodes(err);
        const opCode = (codes?.operations?.find((op) => op && op !== "op_success") || codes?.operations?.[0] || "").toLowerCase();
        const txCode = (codes?.transaction || "").toLowerCase();
        const combined = `${opCode} ${txCode} ${rawLower}`;

        if (combined.includes("op_underfunded") || combined.includes("tx_insufficient_balance")) {
            return "errors.stellar_sender_reserve_exceeded";
        }

        if (combined.includes("op_low_reserve")) {
            return "errors.stellar_amount_below_reserve";
        }

        if (combined.includes("op_no_destination")) {
            return "errors.stellar_classic_fund_xlm_first";
        }

        if (combined.includes("op_no_trust") || combined.includes("op_not_authorized")) {
            return "errors.stellar_classic_trustline_required";
        }

        if (combined.includes("op_line_full")) {
            return "errors.stellar_recipient_line_full";
        }

        if (combined.includes("tx_bad_seq")) {
            return "errors.stellar_bad_sequence";
        }

        const fallback = opCode || txCode || rawMsg || "Stellar transaction failed";

        return typeof fallback === "string" ? fallback : JSON.stringify(fallback);
    }

    private async _submitBuilt(server: Horizon.Server, keypair: Keypair, builder: TransactionBuilder): Promise<TransactionResult> {
        const transaction = builder.setTimeout(180).build();

        transaction.sign(keypair);

        try {
            const response = await server.submitTransaction(transaction);

            return {
                hash: response.hash,
                status: "pending",
            };
        } catch (err: unknown) {
            throw new Error(this._mapHorizonSubmitError(err));
        }
    }

    async sendTransaction(params: TransactionParams): Promise<TransactionResult> {
        if (!params.mnemonic?.trim()) {
            throw new Error("Mnemonic is required for Stellar transactions");
        }

        this._stellarSoroban.assertClassicOrNativeOnly(params.tokenAddress);

        const destination = params.to?.trim();

        if (!destination || !this.isValidStellarAddress(destination)) {
            throw new Error("Invalid Stellar address");
        }

        const secret = this.getSecretKeyFromMnemonic(params.mnemonic);
        const keypair = Keypair.fromSecret(secret);
        const server = await this._horizonServer();
        const amountNum = parseFloat(params.value);

        if (!Number.isFinite(amountNum) || amountNum <= 0) {
            throw new Error("Invalid amount");
        }

        const account = await server.loadAccount(keypair.publicKey());
        const baseFee = await server.fetchBaseFee();
        const feeXlm = baseFee / 1e7;
        const baseReserveStroops = await this._fetchLatestBaseReserveStroops(server);
        const minReserveXlm = minimumNewAccountBalanceXlm(baseReserveStroops);

        const rawAccount = account as unknown as {
            subentry_count?: number;
            num_sponsoring?: number;
            num_sponsored?: number;
            balances?: Array<{ asset_type?: string; balance?: string; selling_liabilities?: string }>;
        };
        const nativeEntry = rawAccount.balances?.find((b) => b.asset_type === "native");
        const senderNativeBalanceXlm = parseFloat(nativeEntry?.balance || "0") || 0;
        const senderSellingLiabilitiesXlm = parseFloat(nativeEntry?.selling_liabilities || "0") || 0;
        const senderMinReserveXlm = minimumAccountReserveXlm(
            baseReserveStroops,
            rawAccount.subentry_count || 0,
            rawAccount.num_sponsoring || 0,
            rawAccount.num_sponsored || 0,
            senderSellingLiabilitiesXlm
        );
        const senderSpendableXlm = Math.max(0, Number((senderNativeBalanceXlm - senderMinReserveXlm - feeXlm).toFixed(7)));

        const memoText = params.memo?.trim();
        const passphrase = this._networkPassphrase();

        const appendMemo = (b: TransactionBuilder): TransactionBuilder => {
            if (!memoText) return b;

            return b.addMemo(Memo.text(memoText));
        };

        const submitWithSeqRetry = async (buildForAccount: (acc: Horizon.AccountResponse) => TransactionBuilder): Promise<TransactionResult> => {
            try {
                return await this._submitBuilt(server, keypair, buildForAccount(account));
            } catch (err: unknown) {
                if (this._isBadSequenceError(err)) {
                    const refreshed = await server.loadAccount(keypair.publicKey());

                    return this._submitBuilt(server, keypair, buildForAccount(refreshed));
                }

                throw err;
            }
        };

        const tokenAddress = params.tokenAddress?.trim();

        if (tokenAddress && isClassicAssetRef(tokenAddress)) {
            if (senderNativeBalanceXlm + 1e-8 < senderMinReserveXlm + feeXlm) {
                throw new Error("errors.stellar_sender_reserve_exceeded");
            }

            const exists = await this.destinationAccountExists(destination);

            if (!exists) {
                throw new Error("errors.stellar_classic_fund_xlm_first");
            }

            const asset = parseClassicAsset(tokenAddress);
            const hasLine = await this._destinationHasTrustlineForAsset(destination, asset);

            if (!hasLine) {
                throw new Error("errors.stellar_classic_trustline_required");
            }

            const dec = params.tokenDecimals !== undefined ? Math.min(7, Math.max(0, params.tokenDecimals)) : 7;
            const amountStr = formatTokenAmount(amountNum, dec);

            return submitWithSeqRetry((acc) => {
                let builder = new TransactionBuilder(acc, {
                    fee: baseFee.toString(),
                    networkPassphrase: passphrase,
                }).addOperation(
                    Operation.payment({
                        destination,
                        asset,
                        amount: amountStr,
                    })
                );

                builder = appendMemo(builder);

                return builder;
            });
        }

        if (amountNum > senderSpendableXlm + 1e-8) {
            throw new Error("errors.stellar_sender_reserve_exceeded");
        }

        const destExists = await this.destinationAccountExists(destination);

        if (destExists) {
            return submitWithSeqRetry((acc) => {
                let builder = new TransactionBuilder(acc, {
                    fee: baseFee.toString(),
                    networkPassphrase: passphrase,
                }).addOperation(
                    Operation.payment({
                        destination,
                        asset: Asset.native(),
                        amount: this._formatNativeAmount(amountNum),
                    })
                );

                builder = appendMemo(builder);

                return builder;
            });
        }

        if (amountNum + 1e-12 < minReserveXlm) {
            throw new Error("errors.stellar_amount_below_reserve");
        }

        const buildCreateTx = (acc: Horizon.AccountResponse): TransactionBuilder => {
            let builder = new TransactionBuilder(acc, {
                fee: baseFee.toString(),
                networkPassphrase: passphrase,
            });

            const remainderXlm = amountNum - minReserveXlm;

            if (remainderXlm <= 1e-8) {
                builder = builder.addOperation(
                    Operation.createAccount({
                        destination,
                        startingBalance: this._formatNativeAmount(amountNum),
                    })
                );
            } else {
                const reserveStr = this._formatNativeAmount(minReserveXlm);
                const remainderStr = this._formatNativeAmount(remainderXlm);

                builder = builder
                    .addOperation(
                        Operation.createAccount({
                            destination,
                            startingBalance: reserveStr,
                        })
                    )
                    .addOperation(
                        Operation.payment({
                            destination,
                            asset: Asset.native(),
                            amount: remainderStr,
                        })
                    );
            }

            return appendMemo(builder);
        };

        try {
            return await submitWithSeqRetry(buildCreateTx);
        } catch (err: unknown) {
            if (this._isCreateAccountRaceError(err)) {
                const refreshed = await server.loadAccount(keypair.publicKey());
                let retry = new TransactionBuilder(refreshed, {
                    fee: baseFee.toString(),
                    networkPassphrase: passphrase,
                }).addOperation(
                    Operation.payment({
                        destination,
                        asset: Asset.native(),
                        amount: this._formatNativeAmount(amountNum),
                    })
                );

                retry = appendMemo(retry);

                return this._submitBuilt(server, keypair, retry);
            }

            throw err;
        }
    }

    private _defaultResponse(): any {
        return {
            data: {
                address: "",
                balance: 0,
                fiatBalance: 0,
                type: "account",
                account: {
                    asset: "XLM",
                    fiatValue: "0",
                    price: "0",
                },
                tokenHoldings: {
                    total: 0,
                    balance: 0,
                    fiatBalance: 0,
                    tokens: [],
                },
                transactions: [],
                transactionsNext: false,
            },
        };
    }

    async getWalletDetails(address: string): Promise<any> {
        try {
            const url = `${this._baseUrl}/api/stellar/address/${address}`;

            return await this._httpWrapper
                .sendRequest("get", url, {})
                .then((response) => response)
                .catch((error) => failedBalanceFetch(error));
        } catch (error) {
            console.error("Exception in Stellar getWalletDetails:", error);

            return Promise.resolve(failedBalanceFetch(error));
        }
    }

    async requestTransactionHistory(address: string, pagination: { page: number; show?: number; cursor?: string }): Promise<any> {
        try {
            const url = `${this._baseUrl}/api/stellar/address/${address}/transactions`;

            const params = stellarHistoryQueryParams(pagination);

            return await this._httpWrapper
                .sendRequest("get", url, params)
                .then((response) => response)
                .catch(() => ({ data: { transactions: [], next: false } }));
        } catch (error) {
            console.error("Exception in Stellar requestTransactionHistory:", error);

            return Promise.resolve({ data: { transactions: [], next: false } });
        }
    }

    async requestTransactionDetails(transactionHash: string): Promise<any> {
        return this._httpWrapper.sendRequest("get", `${this._baseUrl}/api/stellar/transaction/${transactionHash}`);
    }
}
