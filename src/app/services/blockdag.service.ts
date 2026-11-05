import { ethers } from "ethers";
import { isAddress } from "web3-validator";

import { Injectable } from "@angular/core";

import { HttpWrapperService } from "app/http-wrapper.service";
import { RpcProviderService } from "app/services/rpc-provider.service";
import { environment } from "environments/environment";
import { TransactionFeeEstimate, TransactionParams, TransactionResult } from "../core/models/transaction-fee.model";
import { BLOCKDAG_DEPRECATION_CODE } from "app/core/blockdag-support";
import { failedBalanceFetch } from "app/core/utils/balance-fetch-result.util";
import { protectedRpcUrl } from "@shared/utils/rpc-proxy-http";
import { historyQueryParams } from "../core/utils/transaction-history-pagination.util";
import {
    BLOCKDAG_BLOCKSCOUT_EXPLORERS,
    blockdagHistoryNeedsExplorerFallback,
    blockscoutHistoryPage,
} from "../core/utils/blockdag-blockscout-history.util";

@Injectable({
    providedIn: "root",
})
export class BlockDAGService {
    private _baseUrl: string = environment.apiUrl;

    private readonly _chainConfigs = {
        mainnet: {
            blockExplorerUrls: ["https://explorer.east.bdag-us.org"],
            chainId: 1404,
            chainName: "BlockDAG Mainnet",
            rpcUrls: [protectedRpcUrl(environment.apiUrl, "blockdag")],
            nativeCurrency: {
                decimals: 18,
                name: "BDAG",
                symbol: "BDAG",
            },
        },
    };

    constructor(
        private _httpWrapper: HttpWrapperService,
        private _rpcProvider: RpcProviderService
    ) {}

    async getCurrentPrice(): Promise<number> {
        try {
            const response = await this._httpWrapper.sendRequest("get", `${this._baseUrl}/api/blockdag/price`);
            return response.data?.price || 0.05;
        } catch (error) {
            console.error("Error fetching BlockDAG price:", error);
            return 0.05;
        }
    }

    private _defaultResponse(): any {
        return {
            data: {
                _balance: 0,
                balance: "0",
                fiatBalance: "0",
                account: {
                    asset: "BDAG",
                    price: "0",
                },
                tokenHoldings: {
                    tokens: [],
                },
            },
        };
    }

    async calculateTransactionFees(
        receiverAddress: string,
        amount: string,
        tokenAddress?: string,
        tokenDecimals: number = 18,
        senderAddress?: string
    ): Promise<TransactionFeeEstimate> {
        try {
            if (!isAddress(receiverAddress)) {
                throw new Error("Invalid receiver address");
            }

            const provider = await this._rpcProvider.getEthersProvider("blockdag");

            let estimatedGas: bigint;

            if (tokenAddress) {
                // ERC20 token transfer
                const amountInWei = ethers.parseUnits(amount, tokenDecimals);

                estimatedGas = await provider.estimateGas({
                    to: tokenAddress,
                    from: senderAddress,
                    data: ethers.concat([
                        ethers.id("transfer(address,uint256)").slice(0, 10),
                        ethers.zeroPadValue(receiverAddress, 32),
                        ethers.zeroPadValue(ethers.toBeHex(amountInWei), 32),
                    ]),
                });
            } else {
                // Native BDAG transfer
                const amountInWei = ethers.parseEther(amount);

                estimatedGas = await provider.estimateGas({
                    to: receiverAddress,
                    from: senderAddress,
                    value: amountInWei,
                });
            }

            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
            const totalCost = estimatedGas * gasPrice;

            const feeInBDAG = parseFloat(ethers.formatEther(totalCost));
            const amountInBDAG = parseFloat(amount);

            // Get BDAG price
            const bdagPrice = await this.getCurrentPrice();

            return {
                fee: feeInBDAG,
                fiatFee: feeInBDAG * bdagPrice,
                total: (amountInBDAG + feeInBDAG) * bdagPrice,
                networkPrice: bdagPrice,
            };
        } catch (error) {
            console.error("Error calculating transaction fees:", error);

            return {
                fee: 0,
                fiatFee: 0,
                total: 0,
                networkPrice: 0,
            };
        }
    }

    async getWalletDetails(address: string): Promise<any> {
        try {
            if (!isAddress(address)) {
                return this._defaultResponse();
            }

            // The address API often takes ~5s. A 3s cutoff fell through to a zero envelope
            // before any token row existed, so Home showed a blank card instead of 0 or the balance.
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("BlockDAG request timeout")), 10_000));

            const response: any = await Promise.race([
                this._httpWrapper.sendRequest("get", `${this._baseUrl}/api/blockdag/address/${address}`),
                timeoutPromise,
            ]);

            if (!response || !response.data) {
                return failedBalanceFetch(new Error("BlockDAG address response missing"));
            }

            return response;
        } catch (error) {
            console.warn("BlockDAG getWalletDetails failed or timed out:", error);

            return failedBalanceFetch(error);
        }
    }

    async requestTransactionDetails(hash: string): Promise<any> {
        try {
            const response = await this._httpWrapper.sendRequest("get", `${this._baseUrl}/api/blockdag/address/0x0/transaction/${hash}`);

            return response;
        } catch (error) {
            console.error("Error getting BlockDAG transaction details:", error);

            throw error;
        }
    }

    private _historyUnavailable(): { data: { transactions: unknown[]; transactionsUnavailable: true; error: "HISTORY_UNAVAILABLE" } } {
        return { data: { transactions: [], transactionsUnavailable: true, error: "HISTORY_UNAVAILABLE" } };
    }

    /**
     * The Zelf history route depends on BlockDAGScan. When that explorer is blocked, the API
     * returns an empty list. A synced public Blockscout still has the transfers.
     */
    private async _historyFromBlockscout(
        address: string,
        pagination: { page: number; show?: number }
    ): Promise<ReturnType<typeof blockscoutHistoryPage> | null> {
        const page = typeof pagination.page === "number" && pagination.page >= 0 ? pagination.page : 0;
        const show = pagination.show && pagination.show > 0 ? pagination.show : 20;
        const needed = (page + 1) * show;

        for (const base of BLOCKDAG_BLOCKSCOUT_EXPLORERS) {
            try {
                const response = await fetch(`${base}/api/v2/addresses/${address}/transactions`, {
                    headers: { Accept: "application/json" },
                });
                if (!response.ok) continue;

                const body = await response.json();
                const items = Array.isArray(body?.items) ? body.items : null;
                if (!items) continue;

                return blockscoutHistoryPage(items, address, page, show, items.length > needed || Boolean(body?.next_page_params));
            } catch (error) {
                console.warn("BlockDAG Blockscout history failed:", error);
            }
        }

        return null;
    }

    async requestTransactionHistory(address: string, pagination: { page: number; show?: number; cursor?: string }): Promise<any> {
        if (!isAddress(address)) {
            return { data: { transactions: [] } };
        }

        try {
            const response = await this._httpWrapper.sendRequest(
                "get",
                `${this._baseUrl}/api/blockdag/address/${address}/transactions`,
                historyQueryParams(pagination)
            );

            if (!blockdagHistoryNeedsExplorerFallback(response)) return response;

            const fallback = await this._historyFromBlockscout(address, pagination);
            return fallback || this._historyUnavailable();
        } catch (error) {
            console.error("Error getting BlockDAG transaction history:", error);

            const fallback = await this._historyFromBlockscout(address, pagination);
            return fallback || this._historyUnavailable();
        }
    }

    async sendTransaction(_params: TransactionParams): Promise<TransactionResult> {
        throw Object.assign(new Error(BLOCKDAG_DEPRECATION_CODE), { code: BLOCKDAG_DEPRECATION_CODE });
    }

    getChainConfig() {
        return this._chainConfigs.mainnet;
    }

    isValidAddress(address: string): boolean {
        return isAddress(address);
    }
}
