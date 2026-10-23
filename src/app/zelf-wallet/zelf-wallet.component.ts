import { NgClass, NgFor, NgIf } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FlexLayoutModule } from "@angular/flex-layout";
import { MatButtonModule } from "@angular/material/button";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { Subject, takeUntil } from "rxjs";

import { AssetService } from "app/asset.service";
import { BlockchainNetworksService } from "app/blockchain-networks.service";
import { ChromeService } from "app/chrome.service";
import { BlockchainTransactionsService } from "app/services/blockchain-transactions.service";
import { AuthService } from "app/services/auth.service";
import { SettingsService } from "app/services/settings.service";
import { TagModel, TagsService } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import {
    zelfWalletLoadPerfLog,
    zelfWalletLoadPerfMark,
    zelfWalletLoadPerfMeasure,
    zelfWalletLoadPerfStart,
} from "@shared/utils/zelf-wallet-load-perf";
import { ZelfFooterComponent } from "app/zelf-footer/zelf-footer.component";
import { ZelfNameService } from "app/zelf-name-service.service";
import { HomeCollectiblesComponent } from "./home-collectibles/home-collectibles.component";
import { HomeHubHeaderComponent } from "app/home/home-hub-header/home-hub-header.component";
import { HomeProfilePanelComponent } from "app/home/home-profile-panel/home-profile-panel.component";
import {
    NetworkBalanceStatus,
    displayTotalFiatBalance,
    loadWalletBalances,
} from "app/core/utils/wallet-balance-loader";
import { dedupeBalanceTokens } from "app/core/utils/balance-tokens.util";
import { projectHomeNetworkTokens, uniqueChainIds } from "app/core/utils/home-network-list.util";
import { nextAccountToLoad, walletAccountIdentity } from "app/core/utils/wallet-session.util";
import { WalletBalanceCacheService } from "app/services/wallet-balance-cache.service";
import { TokenCardComponent } from "./token-card/token-card.component";
import { WalletBalanceTopCardComponent } from "./wallet-balance-top-card/wallet-balance-top-card.component";

@Component({
    imports: [
        FlexLayoutModule,
        HomeCollectiblesComponent,
        HomeHubHeaderComponent,
        HomeProfilePanelComponent,
        MatButtonModule,
        NgClass,
        NgFor,
        NgIf,
        RouterLink,
        TokenCardComponent,
        TranslocoModule,
        WalletBalanceTopCardComponent,
        ZelfFooterComponent,
    ],
    selector: "zelf-wallet",
    styleUrls: ["./zelf-wallet.component.scss", "../main.scss"],
    templateUrl: "./zelf-wallet.component.html",
})
export class ZelfWalletComponent implements OnInit, OnDestroy {
    private unsubscriber$: Subject<void> = new Subject<void>();
    private unsubscriberForBalances$: Subject<void> = new Subject<void>();

    balances: any;
    balancesLoading: boolean = false;
    balancesSyncing: boolean = false;
    networkStatus: Record<string, NetworkBalanceStatus> = {};
    collectiblesReloadKey = 0;
    hideBalances: boolean = false;
    selectedNetwork!: string;
    shareables: any;
    tokens!: Array<any>;
    totalFiatBalance: number = 0;
    wallet!: TagModel;
    private _lastKnownTotalFiat: number | null = null;
    private _enabledKey = "";
    private _balanceLoadGen = 0;
    private _portfolioAccountId = "";

    // New hub header state (consistent with Home / zAuth / etc.)
    showProfilePanel = false;
    allWallets: TagModel[] = [];
    showName = false;

    constructor(
        private _assetService: AssetService,
        private _authService: AuthService,
        private _blockchainNetworkService: BlockchainNetworksService,
        private _blockchainTransactionsService: BlockchainTransactionsService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _route: ActivatedRoute,
        private _router: Router,
        private _settingsService: SettingsService,
        private _tagsService: TagsService,
        private _walletService: WalletService,
        private _zelfNameService: ZelfNameService,
        private _walletBalanceCache: WalletBalanceCacheService
    ) {
        this.balances = {};
        this.balancesLoading = false;

        this.shareables = {
            selectedTab: "assets",
            wallet: {},
        };

        this.tokens = [];
    }

    async ngOnInit(): Promise<any> {
        zelfWalletLoadPerfStart();

        const storedHide = await this._chromeService.getItem("hideWalletBalances");

        this.hideBalances = storedHide === true || storedHide === "true";

        this._chromeService.onHideWalletBalancesChanged$.pipe(takeUntil(this.unsubscriber$)).subscribe((hidden) => {
            this.hideBalances = hidden;
            this._changeDetectorRef.detectChanges();
        });

        zelfWalletLoadPerfMark("initNetwork:start");
        this.selectedNetwork = await this._blockchainNetworkService._initNetwork();
        zelfWalletLoadPerfMark("initNetwork:end");

        this._chromeService.onWalletChanged$.pipe(takeUntil(this.unsubscriber$)).subscribe(this._onWalletChanged);
        await this._loadStoredWalletIfNeeded();

        this._settingsService.settings$.pipe(takeUntil(this.unsubscriber$)).subscribe(() => {
            void this._onNetworkSettingsChanged();
        });

        this._route.queryParams.pipe(takeUntil(this.unsubscriber$)).subscribe((q) => {
            if (q["tab"] === "nfts") {
                this.shareables.selectedTab = "nfts";
                this.collectiblesReloadKey += 1;
                this._changeDetectorRef.detectChanges();
            }
        });

        this._cleanSessionItems();
    }

    private _cleanSessionItems(): void {
        this._chromeService.removeItem("transactionData");
        this._chromeService.removeItem("newTagName");
        this._chromeService.removeItem("flow");
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();

        this.unsubscriberForBalances$.next();
        this.unsubscriberForBalances$.complete();
    }

    /** Prefer `this.wallet`: `shareables.wallet` can be overwritten by child header sync before `this.wallet` is reassigned. */
    private _tagNameForPerfLog(): string {
        const w = this.wallet ?? this.shareables?.wallet;
        if (!w) return "";

        return (w.fullTagName || w.publicData?.tagName || w.name || "") as string;
    }

    get displayTotalFiatBalance(): number | null {
        return displayTotalFiatBalance(this.totalFiatBalance, this.networkStatus, this._lastKnownTotalFiat);
    }

    private async _onNetworkSettingsChanged(): Promise<void> {
        if (!this.wallet?.tagName) return;

        const enabledNetworks = await this._settingsService.getEnabledNetworkIdsFromLicense();
        const ids = uniqueChainIds(enabledNetworks ?? []);
        const key = ids.join("|");
        const changed = key !== this._enabledKey;

        this._enabledKey = key;
        this._updateTokenState(projectHomeNetworkTokens(this.tokens, enabledNetworks));

        if (changed) {
            this._abortBalanceLoad();
            await this._runBalanceLoad(false);
        }
    }

    private _abortBalanceLoad(): void {
        this.unsubscriberForBalances$.next();
        this.unsubscriberForBalances$.complete();
        this.unsubscriberForBalances$ = new Subject<void>();
    }

    private async _getBalances(): Promise<void> {
        zelfWalletLoadPerfMark("getBalances:start");
        await this._runBalanceLoad(false);
        zelfWalletLoadPerfMark("getBalances:end");
    }

    private async _runBalanceLoad(forceNetworkRefresh: boolean): Promise<void> {
        const enabledNetworks = await this._settingsService.getEnabledNetworkIdsFromLicense();
        this._enabledKey = uniqueChainIds(enabledNetworks ?? []).join("|");
        const loadGen = ++this._balanceLoadGen;
        const walletTag = (this.wallet?.tagName || this.wallet?.name) as string;
        const persistedCache = walletTag ? await this._walletBalanceCache.load(walletTag) : null;

        if (persistedCache?.totalFiatBalance) {
            this._lastKnownTotalFiat = persistedCache.totalFiatBalance;
        }

        await loadWalletBalances({
            wallet: this.wallet,
            accountId: this._portfolioAccountId,
            loadedAccountId: this._portfolioAccountId,
            enabledNetworkIds: enabledNetworks,
            assetService: this._assetService,
            blockchainTransactionsService: this._blockchainTransactionsService,
            getLoadedTokens: () => this.tokens,
            forceNetworkRefresh,
            persistedCache,
            abort$: this.unsubscriberForBalances$,
            shouldContinue: () => this._balanceLoadGen === loadGen && ((this.wallet?.tagName || this.wallet?.name) as string) === walletTag,
            onPersistCache: (snapshot) => this._walletBalanceCache.save(snapshot),
            callbacks: {
                onTokensUpdated: (tokens) => {
                    this._updateTokenState(tokens);
                    if (this.totalFiatBalance > 0) this._lastKnownTotalFiat = this.totalFiatBalance;
                    this._changeDetectorRef.detectChanges();
                },
                onNetworkStatus: (status) => {
                    this.networkStatus = status;
                    this._changeDetectorRef.detectChanges();
                },
                onLoadingFlags: (priorityLoading, backgroundSyncing) => {
                    this.balancesLoading = priorityLoading;
                    this.balancesSyncing = backgroundSyncing;

                    if (!priorityLoading) {
                        zelfWalletLoadPerfMark("balancesIdle:end");
                        zelfWalletLoadPerfLog("balances_loading_false", {
                            source: "network",
                            fullTagName: this._tagNameForPerfLog(),
                            balancesLoading: false,
                        });
                        zelfWalletLoadPerfMeasure("walletSet_to_balancesIdle", "walletSet:end", "balancesIdle:end");
                    }

                    this._changeDetectorRef.detectChanges();
                },
            },
        });
    }

    private _updateTokenState(tokens: any[]): void {
        this.tokens = tokens;
        this.totalFiatBalance = this.tokens.reduce((total, token) => {
            return total + (parseFloat(token.fiatBalance) || 0);
        }, 0);
    }

    /**
     * First call to initialize wallet, balances and refresh wallet if needed
     */
    /** The wallet subject starts as `{}`. That is "not yet known", so cold open reads storage itself. */
    private async _loadStoredWalletIfNeeded(): Promise<void> {
        if (this._portfolioAccountId) return;

        const stored = await this._walletService.getFirstWalletFromStorage();

        if (this._portfolioAccountId) return;

        if (nextAccountToLoad(stored, this._portfolioAccountId)) {
            await this._onWalletChanged(stored as TagModel);

            return;
        }

        await this._setWallet();
    }

    private _onWalletChanged = async (wallet: TagModel): Promise<void> => {
        const nextId = nextAccountToLoad(wallet, this._portfolioAccountId);

        if (!nextId) return;

        const switchingAccount = !!this._portfolioAccountId;
        this._portfolioAccountId = nextId;
        this._abortBalanceLoad();
        this._balanceLoadGen++;
        this.tokens = [];
        this.totalFiatBalance = 0;
        this._lastKnownTotalFiat = null;
        this.networkStatus = {};
        this._enabledKey = "";
        this._assetService.claimSessionAccount(nextId);
        this.balancesLoading = true;

        await this._setWallet();

        if (walletAccountIdentity(this.wallet) !== nextId) return;

        if (switchingAccount) {
            await this._walletBalanceCache.clear((this.wallet?.tagName || this.wallet?.name || "") as string);
        }

        await this._getBalances();
        await this._refreshWallets();

        zelfWalletLoadPerfLog("initialize_wallet_pipeline_done", {
            fullTagName: this._tagNameForPerfLog(),
            balancesLoading: this.balancesLoading,
        });
        zelfWalletLoadPerfMeasure("initNetwork_to_refreshWallets", "initNetwork:end", "refreshWallets:end");
        this.collectiblesReloadKey += 1;
    };

    /**
     * Use with caution.
     * This updates the wallet in local storage and could trigger an endless update cycle with out subscription to onWalletChanged$.
     */
    private _refreshWallets = async (forceRefresh = false): Promise<void> => {
        zelfWalletLoadPerfMark("refreshWallets:start");
        await this._tagsService.refreshAllTagsPublicData([this.wallet] as TagModel[], forceRefresh);
        zelfWalletLoadPerfMark("refreshWallets:end");
    };

    private async _setWallet(): Promise<any> {
        const wallet = await this._walletService.getFirstWalletFromStorage();

        if (!wallet?.name) {
            this._router.navigate(["/welcome-zelfid"]);

            return;
        }

        this.shareables.wallet = wallet;
        this.wallet = this.shareables.wallet;

        this._changeDetectorRef.detectChanges();

        zelfWalletLoadPerfMark("walletSet:end");
        zelfWalletLoadPerfLog("wallet_ready", {
            fullTagName: wallet.fullTagName ?? "",
            balancesLoading: this.balancesLoading,
        });
    }

    async toggleHideBalances(): Promise<void> {
        await this._chromeService.setHideWalletBalances(!this.hideBalances);
    }

    async refreshTokens(): Promise<any> {
        if (this.balancesLoading) return;

        await this._authService.reauthenticateSession();

        await this._runBalanceLoad(true);

        await this._refreshWallets(true);
        this.collectiblesReloadKey += 1;
        this._changeDetectorRef.detectChanges();
    }

    private _dedupeTokens(tokens: Array<any>): Array<any> {
        return dedupeBalanceTokens(tokens);
    }

    selectTab(tab: string): void {
        this.shareables.selectedTab = tab;
    }

    sendTransaction(): void {
        this._router.navigate(["/send-transaction"]);
    }

    async setSelectedAsset(asset: any): Promise<any> {
        await this._assetService.setSourceAsset(asset);

        this._router.navigate(["/asset"]);
    }

    async onTokenPinToggled(token: any): Promise<void> {
        const isPinned = await this._assetService.togglePinToken(token);

        // Update the token in the list
        const tokenIndex = this.tokens.findIndex((t) => t.symbol === token.symbol && t.network === token.network && t.tokenType === token.tokenType);

        if (tokenIndex !== -1) {
            this.tokens[tokenIndex].isPinned = isPinned;

            // Re-sort the tokens: pinned first, then by fiat balance
            this.tokens.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return b.fiatBalance - a.fiatBalance;
            });

            // Save updated tokens to session
            await this._assetService.saveTokensToSession(this.tokens);

            this._changeDetectorRef.detectChanges();
        }
    }

    // === New Hub Header + Profile Panel (consistent with Home/zAuth/etc.) ===

    get walletName(): string {
        return (this.wallet?.fullTagName || this.wallet?.publicData?.tagName || this.shareables?.wallet?.fullTagName || "") as string;
    }

    toggleName(): void {
        this.showName = !this.showName;
    }

    async openProfilePanel(): Promise<void> {
        const { wallets } = await this._walletService.getAllWalletsFromStorage();
        this.allWallets = wallets || [];
        this.showProfilePanel = true;
        this._changeDetectorRef.detectChanges();
    }

    closeProfilePanel(): void {
        this.showProfilePanel = false;
    }

    async onPanelWalletSelected(selected: TagModel): Promise<void> {
        this.closeProfilePanel();
        await this._walletService.switchWallet(selected);
    }

    onPanelSettings(): void {
        this.closeProfilePanel();
        void this._router.navigate(["/settings"]);
    }

    onPanelAddAccount(): void {
        this.closeProfilePanel();
        void this._router.navigate(["/wallet-manage"]);
    }
}
