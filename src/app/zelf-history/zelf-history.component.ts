import { CurrencyPipe, DatePipe, DecimalPipe, NgClass, NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { Component, Input, OnDestroy, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatRippleModule } from "@angular/material/core";
import { Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { readPublicDataAptosAddress, readPublicDataTonAddress } from "@shared/types/tag.types";
import { AddressMaskPipe } from "app/pipes/address-mask.pipe";
import { BlockchainTransactionsService, TransactionHistoryResult } from "app/services/blockchain-transactions.service";
import { Transaction } from "@shared/types/wallet.types";
import { WalletService } from "app/wallet.service";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { SettingsService } from "app/services/settings.service";
import { SUPPORTED_NETWORK_IDS } from "app/core/network-settings.util";
import { isDisplayableTransaction, transactionTime } from "app/core/utils/transaction-history.util";
import {
    ChainHistoryState,
    HistoryPageRequest,
    advanceChainHistoryState,
    anyChainHasNextPage,
    createChainHistoryState,
    dedupeTransactionsByHash,
    hasNextPageAfterDedupe,
    historyNetworkForToken,
    historyRequestFor,
    readHistoryPageSignals,
    supportsTransactionHistory,
} from "app/core/utils/transaction-history-pagination.util";
import { Subscription } from "rxjs";
import { DisplayAmountPipe, DisplayFiatPipe } from "../pipes/display-number.pipe";

type TransactionType = "send" | "receive" | "swap" | "approve" | "";

type Signee = {
    address: string;
    amount: number;
    image: string;
    symbol: string;
    token: string;
};

type ProcessedTransaction = {
    fiatAmount: number;
    hash: string;
    network: string;
    from: Signee;
    to: Signee;
    type: TransactionType;
};

@Component({
    imports: [DisplayAmountPipe, DisplayFiatPipe, 
        AddressMaskPipe,
        CurrencyPipe,
        DatePipe,
        DecimalPipe,
        MatRippleModule,
        MatButtonModule,
        NgClass,
        NgFor,
        NgIf,
        NgTemplateOutlet,
        TranslocoModule,
        ZelfLoaderComponent,
    ],
    selector: "zelf-history",
    styleUrls: ["./zelf-history.component.scss"],
    templateUrl: "./zelf-history.component.html",
})
export class ZelfHistoryComponent implements OnInit, OnDestroy {
    @Input("token") token?: string = "";

    /** Per-chain page or cursor. The page size stays on the state so "Load more" cannot change it. */
    private _chainState: Record<string, ChainHistoryState> = {};

    public history: Record<string, ProcessedTransaction[]> | null = null;
    public loading = false;
    /** True while some networks are still answering after the first transactions are on screen. */
    public syncing = false;
    public noMoreTransactions = false;
    public transactionHashMap: Record<string, boolean> = {};

    constructor(
        private _blockchainTransactions: BlockchainTransactionsService,
        private _router: Router,
        private _settingsService: SettingsService,
        private _walletService: WalletService
    ) {}

    private _subscriptions = new Subscription();

    async ngOnInit(): Promise<void> {
        this._loadFirstTransactions();
    }

    ngOnDestroy(): void {
        this._subscriptions.unsubscribe();
    }

    get orderedHistory(): { date: string; transactions: ProcessedTransaction[] }[] {
        if (!this.history) return [];

        return Object.entries(this.history)
            .map(([date, transactions]) => ({
                date,
                transactions,
            }))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    private _historyNetworks(enabled: string[]): string[] {
        const pageable = (ids: string[]) => ids.filter((id) => supportsTransactionHistory(id));

        if (!this.token) return pageable(enabled);

        const network = historyNetworkForToken(this.token);

        if (!network) return pageable(enabled);

        return supportsTransactionHistory(network) ? [network] : [];
    }

    private async _loadFirstTransactions(): Promise<void> {
        this.loading = true;

        const wallet = await this._walletService.getCurrentWallet();
        // v3 #270: query each license network on its own and show transactions as they arrive,
        // so one slow network (e.g. BSC ~20s) no longer keeps the whole list on the skeleton.
        const enabled = (await this._settingsService.getEnabledNetworkIdsFromLicense()) ?? [...SUPPORTED_NETWORK_IDS];
        const networks = this._historyNetworks(enabled);

        this._chainState = {};

        for (const network of networks) this._chainState[network] = createChainHistoryState(network);

        let pending = networks.length;

        this.syncing = pending > 0;

        // Serialise processing so a network's "complete" never runs before its transactions were merged.
        let queue: Promise<void> = Promise.resolve();

        const settle = (): void => {
            pending -= 1;

            if (pending > 0) return;

            this.syncing = false;
            this.loading = false;
            this.noMoreTransactions = !this.history || !anyChainHasNextPage(Object.values(this._chainState));
        };

        if (!pending) {
            this.loading = false;
            this.syncing = false;
            this.noMoreTransactions = true;

            return;
        }

        for (const network of networks) {
            const request = historyRequestFor(this._chainState[network]);

            this._subscriptions.add(
                this._blockchainTransactions.getTransactionHistory(wallet, { [network]: request }, [network]).subscribe({
                    next: (result) => {
                        queue = queue.then(() => this._absorbHistory(result, [network])).catch((error) => {
                            console.error(`Error processing ${network} transactions:`, error);
                            this._chainState[network] = { ...this._chainState[network], hasNextPage: false, loaded: true };
                        });
                    },
                    error: (error) => {
                        console.error(`Error loading ${network} transactions:`, error);
                        this._chainState[network] = { ...this._chainState[network], hasNextPage: false, loaded: true };
                        queue = queue.then(settle);
                    },
                    complete: () => {
                        queue = queue.then(settle);
                    },
                })
            );
        }
    }

    private async _absorbHistory(result: TransactionHistoryResult | null | undefined, networks: string[]): Promise<void> {
        const byNetwork = result?.byNetwork || {};
        const responses = result?.responses || {};

        for (const network of networks) {
            const current = this._chainState[network] || createChainHistoryState(network);
            const signals = readHistoryPageSignals(responses[network]);
            const txs = byNetwork[network] || [];
            const seen = new Set(Object.keys(this.transactionHashMap));
            const fresh = dedupeTransactionsByHash(seen, txs);
            const previousCursor = current.cursor;

            if (txs.length) await this._processTransactions(txs, !!this.history);

            const advanced = advanceChainHistoryState(current, {
                data: {
                    transactions: signals.transactions.length ? signals.transactions : txs,
                    nextCursor: signals.nextCursor,
                    hasNextPage: signals.hasNextPage,
                },
            });

            this._chainState[network] = {
                ...advanced,
                hasNextPage: advanced.hasNextPage && hasNextPageAfterDedupe(advanced, fresh.length, signals.hasNextPage, previousCursor),
            };
        }

        this.noMoreTransactions = !anyChainHasNextPage(Object.values(this._chainState));

        if (this.history) this.loading = false;
    }

    private _determineTransactionTraffic(tx: Transaction, wallet: any): void {
        if (tx.traffic) return;

        const fromAddr = Array.isArray(tx.from) ? tx.from[0] : tx.from || "";
        const publicData = wallet?.publicData;
        const walletEth = (publicData?.ethAddress || "").toLowerCase();
        const walletSol = (publicData?.solanaAddress || "").toLowerCase();
        const walletBtc = (publicData?.btcAddress || "").toLowerCase();
        const walletSui = (publicData?.suiAddress || "").toLowerCase();
        const walletTon = readPublicDataTonAddress(publicData as Record<string, unknown> | undefined);
        const walletAptos = readPublicDataAptosAddress(publicData as Record<string, unknown> | undefined).toLowerCase();
        const walletBDAG = (publicData?.blockDAGAddress || "").toLowerCase();
        const walletXlm = publicData?.xlmAddress || "";

        const fromAddrLower = fromAddr.toLowerCase();
        const isStellarTx = tx.network === "stellar" || (walletXlm && fromAddr.startsWith("G"));
        const isTonTx = tx.network === "ton" || (walletTon && (fromAddr.startsWith("EQ") || fromAddr.startsWith("UQ") || fromAddr.startsWith("0:")));

        if (isStellarTx && walletXlm && fromAddr === walletXlm) {
            tx.traffic = "OUT";
        } else if (isTonTx && walletTon && (fromAddr === walletTon || fromAddrLower === walletTon.toLowerCase())) {
            tx.traffic = "OUT";
        } else if (
            (walletEth && fromAddrLower === walletEth) ||
            (walletSol && fromAddrLower === walletSol) ||
            (walletBtc && fromAddrLower === walletBtc) ||
            (walletSui && fromAddrLower === walletSui) ||
            (walletAptos && fromAddrLower === walletAptos) ||
            (walletBDAG && fromAddrLower === walletBDAG)
        ) {
            tx.traffic = "OUT";
        } else {
            tx.traffic = "IN";
        }
    }

    private async _processTransactions(transactions: Transaction[], isPagination = false): Promise<void> {
        if (!transactions || !transactions.length) return;

        // Drop backend error placeholders / rows without a usable date (they crashed the date pipe).
        transactions = transactions.filter((tx) => isDisplayableTransaction(tx as any));
        transactions.sort((a, b) => (transactionTime(b as any) ?? 0) - (transactionTime(a as any) ?? 0));

        const groupedByDate: Record<string, any[]> = isPagination ? { ...this.history } : {};
        const wallet = await this._walletService.getCurrentWallet();

        transactions.forEach((tx) => {
            if (this.transactionHashMap[tx.hash] || !wallet) return;

            if (this.token && tx.asset !== this.token) return;

            const dateStr = new Date(transactionTime(tx as any) as number).toLocaleDateString("en-US");

            if (!groupedByDate[dateStr]) groupedByDate[dateStr] = [];

            this._determineTransactionTraffic(tx, wallet);

            const type = tx.method?.toLowerCase().includes("swap") ? "swap" : tx.traffic === "OUT" ? "send" : "receive";
            const tokenImage = tx.image || this._walletService.getAssetImage(tx.asset);
            const toAddress = tx.to != null ? (Array.isArray(tx.to) ? tx.to[0] : tx.to) : "";
            const toAmount = tx.amount ?? 0;

            const processedTx = {
                fiatAmount: tx.fiatAmount ?? 0,
                hash: tx.hash,
                network: tx.network,
                type,
                from: {
                    address: Array.isArray(tx.from) ? tx.from[0] : tx.from,
                    amount: tx.amount ?? 0,
                    symbol: tx.asset,
                    image: tokenImage,
                    token: tx.asset,
                },
                to: {
                    address: toAddress,
                    amount: toAmount,
                    symbol: tx.asset,
                    image: tokenImage,
                    token: tx.asset,
                },
            };

            groupedByDate[dateStr].push(processedTx);

            this.transactionHashMap[tx.hash] = true;
        });

        this.history = Object.keys(groupedByDate).length ? groupedByDate : null;
    }

    async loadMoreTransactions(): Promise<void> {
        const pending = Object.values(this._chainState).filter((state) => state.hasNextPage);

        if (!pending.length) {
            this.noMoreTransactions = true;

            return;
        }

        this.loading = true;

        const wallet = await this._walletService.getCurrentWallet();
        const queries: Record<string, HistoryPageRequest> = {};

        for (const state of pending) queries[state.network] = historyRequestFor(state);

        this._subscriptions.add(
            this._blockchainTransactions
                .getTransactionHistory(
                    wallet,
                    queries,
                    pending.map((state) => state.network)
                )
                .subscribe({
                    next: (result) => {
                        void this._absorbHistory(
                            result,
                            pending.map((state) => state.network)
                        ).finally(() => {
                            this.loading = false;
                        });
                    },
                    error: (error) => {
                        console.error("Error loading transactions:", error);
                        this.loading = false;
                    },
                })
        );
    }

    async navigateToTransaction(transaction: ProcessedTransaction): Promise<void> {
        this._router.navigate(["/transaction", transaction.hash], { queryParams: { symbol: transaction.from.symbol, network: transaction.network } });
    }
}
