import { ValidityYearsPipe } from "app/pipes/validity-years.pipe";
import { parseTagExpiry } from "@shared/utils/tag-expiry";
import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FlexLayoutModule } from "@angular/flex-layout";
import { MatButtonModule } from "@angular/material/button";
import { Router, RouterLink } from "@angular/router";
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
import { HomeHubHeaderComponent } from "./home-hub-header/home-hub-header.component";
import { HomeProfilePanelComponent } from "./home-profile-panel/home-profile-panel.component";
import { WalletBalanceTopCardComponent } from "app/zelf-wallet/wallet-balance-top-card/wallet-balance-top-card.component";
import { FooterNavDestination, FooterNavigationService } from "app/zelf-footer/footer-navigation.service";
import { ZelfFooterComponent } from "app/zelf-footer/zelf-footer.component";
import {
    NetworkBalanceStatus,
    displayTotalFiatBalance,
    loadWalletBalances,
} from "app/core/utils/wallet-balance-loader";
import { dedupeBalanceTokens } from "app/core/utils/balance-tokens.util";
import { filterTokensByEnabledNetworkIds } from "app/core/utils/token-network-id.util";
import { WalletBalanceCacheService } from "app/services/wallet-balance-cache.service";
import { HomeEnabledNetworksComponent } from "./home-enabled-networks/home-enabled-networks.component";

/** Home quick-access row (#29): Pass, 2FA, Legacy, ID, then "More". */
const QUICK_HUB_IDS = ["zelf-keys", "zelf-authenticator", "legacy", "manage-domains"] as const;

@Component({
    imports: [ValidityYearsPipe, 
        FlexLayoutModule,
        HomeHubHeaderComponent,
        HomeProfilePanelComponent,
        MatButtonModule,
        NgFor,
        NgIf,
        NgSwitch,
        NgSwitchCase,
        NgSwitchDefault,
        RouterLink,
        TranslocoModule,
        WalletBalanceTopCardComponent,
        HomeEnabledNetworksComponent,
        ZelfFooterComponent,
    ],
    selector: "home",
    styleUrls: ["./home.component.scss", "../main.scss"],
    templateUrl: "./home.component.html",
})
export class HomeComponent implements OnInit, OnDestroy {
    private readonly _destroy$ = new Subject<void>();
    private _unsubscriberForBalances$ = new Subject<void>();
    private _subscriptionCountdownInterval: ReturnType<typeof setInterval> | null = null;

    /** Live days + hours when `expiresAt` is in the future; updates periodically. */
    subscriptionDhms: { days: number; hours: number } | null = null;

    readonly quickDestinations: FooterNavDestination[];

    /** Same shape as Zelf wallet: footer only renders when `shareables.wallet` is set. */
    shareables: { wallet: Partial<TagModel>; selectedTab?: string } = { wallet: {} };

    balancesLoading: boolean = false;
    balancesSyncing: boolean = false;
    hideBalances: boolean = false;
    enabledNetworkIds: string[] = [];
    networkStatus: Record<string, NetworkBalanceStatus> = {};
    showName: boolean = false;
    showProfilePanel: boolean = false;
    allWallets: TagModel[] = [];
    totalFiatBalance: number = 0;

    /** Tokens loaded in this view; the running total is computed from these (session storage is only a cache). */
    private _tokens: any[] = [];
    private _lastKnownTotalFiat: number | null = null;
    private _wallet!: Partial<TagModel>;

    /** Checklist steps (placeholder until wired to rewards/onboarding API). */
    readonly startHereTotal = 4;
    readonly startHereCurrent = 0;

    /** Hidden until onboarding/rewards wiring; flip for follow-up ticket. */
    readonly showStartHere = false;

    constructor(
        public readonly navService: FooterNavigationService,
        private readonly _router: Router,
        private readonly _walletService: WalletService,
        private readonly _chromeService: ChromeService,
        private readonly _changeDetectorRef: ChangeDetectorRef,
        private readonly _assetService: AssetService,
        private readonly _authService: AuthService,
        private readonly _blockchainNetworkService: BlockchainNetworksService,
        private readonly _blockchainTransactionsService: BlockchainTransactionsService,
        private readonly _settingsService: SettingsService,
        private readonly _tagsService: TagsService,
        private readonly _walletBalanceCache: WalletBalanceCacheService
    ) {
        const hub = this.navService.getHubDestinations();
        this.quickDestinations = QUICK_HUB_IDS.map((id) => hub.find((d) => d.id === id)).filter((d): d is FooterNavDestination => !!d);
    }

    /** Short hub row labels (reference UI); falls back to footer `hubLabelKey`. */
    homeQuickLabelKey(dest: FooterNavDestination): string {
        switch (dest.id) {
            case "zelf-keys":
                return "home_hub.quick_label_keys";
            case "zelf-authenticator":
                return "home_hub.quick_label_auth";
            case "legacy":
                return "home_hub.quick_label_legacy";
            case "manage-domains":
                return "home_hub.quick_label_id";
            default:
                return this.navService.hubLabelKey(dest);
        }
    }

    async ngOnInit(): Promise<void> {
        const storedHide = await this._chromeService.getItem("hideWalletBalances");

        this.hideBalances = storedHide === true || storedHide === "true";

        this._chromeService.onHideWalletBalancesChanged$.pipe(takeUntil(this._destroy$)).subscribe((hidden) => {
            this.hideBalances = hidden;
            this._changeDetectorRef.detectChanges();
        });

        await this._blockchainNetworkService._initNetwork();

        this._chromeService.onWalletChanged$.pipe(takeUntil(this._destroy$)).subscribe(this._initializeWallet);

        this._settingsService.settings$.pipe(takeUntil(this._destroy$)).subscribe(() => {
            void this._onNetworkSettingsChanged();
        });
    }

    get displayTotalFiatBalance(): number | null {
        const display = displayTotalFiatBalance(this.totalFiatBalance, this.networkStatus, this._lastKnownTotalFiat);

        return display;
    }

    private async _onNetworkSettingsChanged(): Promise<void> {
        if (!this._wallet?.tagName) return;

        const enabledNetworks = await this._settingsService.getEnabledNetworkIdsFromLicense();
        this.enabledNetworkIds = enabledNetworks ?? [];

        const filtered = filterTokensByEnabledNetworkIds(this._tokens, enabledNetworks);
        this._updateTokenState(filtered);

        if (!this.balancesLoading && !this.balancesSyncing) {
            await this._runBalanceLoad(false);
        }
    }

    ngOnDestroy(): void {
        this._stopSubscriptionCountdown();
        this._destroy$.next();
        this._destroy$.complete();
        this._unsubscriberForBalances$.next();
        this._unsubscriberForBalances$.complete();
    }

    private async _getBalances(): Promise<void> {
        const enabledNetworks = await this._settingsService.getEnabledNetworkIdsFromLicense();
        this.enabledNetworkIds = enabledNetworks ?? [];

        await this._runBalanceLoad(false);
    }

    private async _runBalanceLoad(forceNetworkRefresh: boolean): Promise<void> {
        const enabledNetworks = await this._settingsService.getEnabledNetworkIdsFromLicense();
        this.enabledNetworkIds = enabledNetworks ?? [];

        const tagName = this._wallet?.tagName || this._wallet?.name || "";
        const persistedCache = tagName ? await this._walletBalanceCache.load(tagName) : null;

        if (persistedCache?.totalFiatBalance) {
            this._lastKnownTotalFiat = persistedCache.totalFiatBalance;
        }

        await loadWalletBalances({
            wallet: this._wallet,
            enabledNetworkIds: enabledNetworks,
            assetService: this._assetService,
            blockchainTransactionsService: this._blockchainTransactionsService,
            getLoadedTokens: () => this._tokens,
            forceNetworkRefresh,
            persistedCache,
            abort$: this._unsubscriberForBalances$,
            shouldContinue: () => (this._wallet?.tagName || this._wallet?.name) === tagName,
            onPersistCache: (snapshot) => this._walletBalanceCache.save(snapshot),
            callbacks: {
                onTokensUpdated: (tokens, total) => {
                    this._tokens = tokens;
                    this.totalFiatBalance = total;
                    if (total > 0) this._lastKnownTotalFiat = total;
                    this._changeDetectorRef.detectChanges();
                },
                onNetworkStatus: (status) => {
                    this.networkStatus = status;
                    this._changeDetectorRef.detectChanges();
                },
                onLoadingFlags: (priorityLoading, backgroundSyncing) => {
                    this.balancesLoading = priorityLoading;
                    this.balancesSyncing = backgroundSyncing;
                    this._changeDetectorRef.detectChanges();
                },
            },
        });
    }

    private _updateTokenState(tokens: any[]): void {
        this._tokens = tokens;
        this.totalFiatBalance = tokens.reduce((total, token) => total + (parseFloat(token.fiatBalance) || 0), 0);
        if (this.totalFiatBalance > 0) this._lastKnownTotalFiat = this.totalFiatBalance;
    }

    private _initializeWallet = async (wallet: TagModel): Promise<void> => {
        if (this._wallet && this._wallet.tagName === wallet.tagName) return;

        if (this.balancesLoading) {
            this._unsubscriberForBalances$.next();
            this._unsubscriberForBalances$.complete();
            this._unsubscriberForBalances$ = new Subject<void>();
        }

        this.balancesLoading = true;

        await this._setWallet();
        await this._getBalances();
        await this._refreshWallets();

        this._syncSubscriptionDhms();
        this._startSubscriptionCountdown();

        this._changeDetectorRef.detectChanges();

        this._chromeService.onWalletChanged$.pipe(takeUntil(this._destroy$)).subscribe(this._listenForWalletUpdates);
    };

    private _listenForWalletUpdates = async (): Promise<void> => {
        const currentWallet = this._wallet;

        await this._setWallet();

        const nextWallet = this._wallet;

        if (currentWallet.tagName === nextWallet.tagName) return;

        await this.refreshTokens();
    };

    private _refreshWallets = async (forceRefresh = false): Promise<void> => {
        await this._tagsService.refreshAllTagsPublicData([this._wallet] as TagModel[], forceRefresh);
    };

    private async _setWallet(): Promise<void> {
        const wallet = await this._walletService.getFirstWalletFromStorage();

        if (!wallet?.name) {
            this._router.navigate(["/welcome-zelfid"]);
            return;
        }

        this.shareables = { ...this.shareables, wallet };
        this._wallet = this.shareables.wallet;
        this._syncSubscriptionDhms();
        this._startSubscriptionCountdown();
        this._changeDetectorRef.detectChanges();
    }

    async toggleHideBalances(): Promise<void> {
        await this._chromeService.setHideWalletBalances(!this.hideBalances);
    }

    async refreshTokens(): Promise<void> {
        if (this.balancesLoading) return;

        await this._authService.reauthenticateSession();

        await this._runBalanceLoad(true);

        await this._refreshWallets(true);
        this._syncSubscriptionDhms();
        this._startSubscriptionCountdown();
        this._changeDetectorRef.detectChanges();
    }

    private _dedupeTokens(tokens: Array<any>): Array<any> {
        return dedupeBalanceTokens(tokens);
    }

    get walletName(): string {
        const w = this.shareables.wallet;
        return (w?.fullTagName || (w?.publicData as any)?.tagName || "") as string;
    }

    private get _subscriptionWallet(): TagModel | null {
        const w = this.shareables.wallet;
        if (!w?.publicData) return null;
        return w as TagModel;
    }

    get isPremium(): boolean {
        return this._subscriptionWallet?.isMainnet === true;
    }

    get isFreeHold(): boolean {
        return this._subscriptionWallet?.isHold === true;
    }

    /** Same day math as `home-banners` (ceil, floor at 0). */
    get subscriptionDaysRemaining(): number {
        const exp = this.shareables.wallet?.publicData?.expiresAt;
        if (!exp) return 0;
        const expiresAt = parseTagExpiry(exp);
        const diffTime = expiresAt.getTime() - Date.now();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return Math.max(0, diffDays);
    }

    get subscriptionZelfIdDisplay(): string {
        const w = this._subscriptionWallet;
        if (!w) return this.walletName || "";
        const local = w.tagName;
        const domain = w.domain;
        if (w.isHold) return `${local}.${domain}.hold`;
        if (w.isMainnet) return `${local}.${domain}`;
        return w.fullTagName || local || this.walletName;
    }

    get subscriptionHasExpiry(): boolean {
        return !!this.shareables.wallet?.publicData?.expiresAt;
    }

    get subscriptionIsExpired(): boolean {
        const exp = this.shareables.wallet?.publicData?.expiresAt;
        if (!exp) return false;
        return parseTagExpiry(exp).getTime() <= Date.now();
    }

    private _syncSubscriptionDhms(): void {
        const exp = this.shareables.wallet?.publicData?.expiresAt;
        if (!exp) {
            this.subscriptionDhms = null;
            return;
        }
        const endMs = parseTagExpiry(exp).getTime();
        const diff = endMs - Date.now();
        if (diff <= 0) {
            this.subscriptionDhms = null;
            return;
        }
        const totalSec = Math.floor(diff / 1000);
        this.subscriptionDhms = {
            days: Math.floor(totalSec / 86400),
            hours: Math.floor((totalSec % 86400) / 3600),
        };
    }

    private _startSubscriptionCountdown(): void {
        this._stopSubscriptionCountdown();
        const exp = this.shareables.wallet?.publicData?.expiresAt;
        if (!exp) return;
        this._syncSubscriptionDhms();
        this._subscriptionCountdownInterval = setInterval(() => {
            this._syncSubscriptionDhms();
            this._changeDetectorRef.markForCheck();
        }, 60_000);
    }

    private _stopSubscriptionCountdown(): void {
        if (this._subscriptionCountdownInterval) {
            clearInterval(this._subscriptionCountdownInterval);
            this._subscriptionCountdownInterval = null;
        }
    }

    toggleName(): void {
        this.showName = !this.showName;
    }

    async openProfilePanel(): Promise<void> {
        const { wallets } = await this._walletService.getAllWalletsFromStorage();
        this.allWallets = wallets;
        this.showProfilePanel = true;
        this._changeDetectorRef.detectChanges();
    }

    closeProfilePanel(): void {
        this.showProfilePanel = false;
    }

    async onPanelWalletSelected(wallet: TagModel): Promise<void> {
        this.closeProfilePanel();
        await this._walletService.switchWallet(wallet);
    }

    onPanelSettings(): void {
        this.closeProfilePanel();
        void this._router.navigate(["/settings"]);
    }

    onPanelAddAccount(): void {
        this.closeProfilePanel();
        void this._router.navigate(["/manage-domains"]);
    }

    openAppsHub(): void {
        void this._router.navigate(["/apps"]);
    }
}
