import { CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf } from "@angular/common";
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, Renderer2, ViewChild } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { Router, RouterLink } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { AssetService, NetworkPermissions } from "app/asset.service";
import { AssetChart, AssetDetails, AssetIntervalOptions, AssetRange } from "app/models/asset.model";
import { SafeHtmlPipe } from "app/pipes/safe-html.pipe";
import { TruncateNumberPipe } from "app/pipes/truncate-number.pipe";
import { BlockchainTransactionsService } from "app/services/blockchain-transactions.service";
import { NetworkName, NetworkService } from "app/services/network.service";
import { TagModel, TagsService } from "app/tags.service";
import { TransactionService } from "app/transaction.service";
import { TokenData, TransactionData } from "@shared/types/wallet.types";
import { WalletService } from "app/wallet.service";
import { ZelfHistoryComponent } from "app/zelf-history/zelf-history.component";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { AreaData, AreaSeries, AreaSeriesOptions, ChartOptionsBase, ColorType, createChart, IChartApi, ISeriesApi } from "lightweight-charts";
import { firstValueFrom, Subject, takeUntil } from "rxjs";
import { DisplayAmountPipe, DisplayFiatPipe } from "../pipes/display-number.pipe";
import { formatDisplayAmount } from "../core/utils/display-number.util";
import { isNativeChainToken } from "../core/utils/token-balance.util";
import { tokenNetworkToLicenseId } from "../core/utils/token-network-id.util";

@Component({
    imports: [DisplayAmountPipe, DisplayFiatPipe, 
        CurrencyPipe,
        DecimalPipe,
        MatButtonModule,
        NgClass,
        NgFor,
        NgIf,
        RouterLink,
        SafeHtmlPipe,
        TranslocoModule,
        TruncateNumberPipe,
        ZelfHistoryComponent,
        ZelfLoaderComponent,
    ],
    selector: "token-detail",
    styleUrls: ["./token-detail.component.scss"],
    templateUrl: "./token-detail.component.html",
})
export class TokenDetailComponent implements AfterViewInit, OnDestroy {
    @ViewChild("chartContainer", { static: false }) chartContainer!: ElementRef<HTMLDivElement>;

    private areaSeries!: ISeriesApi<"Area">;
    private CAN_SEND: NetworkPermissions = {};
    private CAN_SWAP: NetworkPermissions = {};
    private chart!: IChartApi;
    private unsubscriber$: Subject<void> = new Subject<void>();
    private windowResizeListener: () => void = () => {};

    asset: Partial<TokenData> = {};
    chartData: AssetChart[] | null = null;
    details: AssetDetails = new AssetDetails({} as AssetDetails);
    intervals: AssetIntervalOptions = [];
    loading: boolean = true;
    loadingBalance: boolean = false;
    loadingChart: boolean = true;
    loadingDetails: boolean = true;
    readMore: boolean = false;
    selectedRange: AssetRange = "1d";
    selectedTab: string = "about";

    constructor(
        private _assetService: AssetService,
        private _blockchainTransactionsService: BlockchainTransactionsService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _networkService: NetworkService,
        private _renderer: Renderer2,
        private _router: Router,
        private _tagsService: TagsService,
        private _transactionService: TransactionService,
        private _walletService: WalletService
    ) {
        this.CAN_SEND = this._assetService.canSend;
        this.CAN_SWAP = this._assetService.canSwap;
        this.intervals = this._assetService.intervals;
    }

    ngAfterViewInit(): void {
        this.asset = this._assetService.sourceAsset;
        this._ensureAssetIcon();
        this.loading = !Object.keys(this.asset).length;

        if (!this.loading) {
            this._changeDetectorRef.detectChanges();
            setTimeout(() => this._setChart(), 100);
        } else {
            void this._assetService.reloadSourceAssetFromStorage();
        }

        this._assetService.sourceAsset$.pipe(takeUntil(this.unsubscriber$)).subscribe((asset) => {
            if (!asset || !Object.keys(asset).length) return;
            this.asset = asset;
            this._ensureAssetIcon();

            if (!this.loading) return;

            setTimeout(() => {
                this.loading = false;
                this._changeDetectorRef.detectChanges();
                this._setChart();
            }, 0);
        });

        this.windowResizeListener = this._renderer.listen("window", "resize", () => {
            this._resizeChart();
        });
    }

    ngOnDestroy(): void {
        if (this.chart) this.chart.remove();

        this.windowResizeListener();
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    private _ensureAssetIcon(): void {
        const symbol = (this.asset?.symbol || "").toUpperCase();
        const walletServiceIcon = this._walletService.getAssetImage(symbol, this.asset?.image);

        this.asset.image = walletServiceIcon || this.asset.image || "";
    }

    onIconError(): void {
        const symbol = (this.asset?.symbol || "").toUpperCase();
        const fallback = this._walletService.getAssetImage(symbol);

        if (fallback && this.asset.image !== fallback) {
            this.asset.image = fallback;
            this._changeDetectorRef.detectChanges();
        }
    }

    get circulatingSupplyInFiat(): string {
        const circulatingSupply = this.details.about.information.circulatingSupply;
        const price = this.details.price.price;

        const circulatingSupplyInFiat = circulatingSupply * price;

        return `$ ${new TruncateNumberPipe().transform(circulatingSupplyInFiat)}`;
    }

    get formattedBalance(): string {
        if (this.asset.amount == null && this.asset.balance == null) {
            return this.loadingBalance ? "..." : "0";
        }
        return formatDisplayAmount(this.asset.amount ?? this.asset.balance ?? 0) || "0";
    }

    get displayPrice(): number | string | null {
        return this.asset.price ?? this.details?.price?.price ?? null;
    }

    get networkSymbol(): string {
        return this._networkService.getNetworkSymbol(this.asset.network?.toLowerCase() as NetworkName);
    }

    get hasValidChartData(): boolean {
        return !!this.chartData && this.chartData.length >= 2;
    }

    get hasValidPriceChangeData(): boolean {
        if (this.hasValidChartData) return true;

        const symbol = (this.asset?.symbol || "").toUpperCase();
        if (symbol === "BDAG") return false;

        const pct = this.details?.price?.priceChangePercentage24h;
        return typeof pct === "number" && pct > -100 && pct < 1000;
    }

    get priceChangePercentage(): number {
        if (!this.hasValidChartData) {
            return this.details.price.priceChangePercentage24h || 0;
        }

        const firstValue = this.chartData![0].open;
        const lastValue = this.chartData![this.chartData!.length - 1].close;

        if (!firstValue) return 0;
        return ((lastValue - firstValue) / firstValue) * 100;
    }

    get priceChangeUsd(): number {
        if (!this.hasValidChartData) return 0;

        const firstValue = this.chartData![0].open;
        const lastValue = this.chartData![this.chartData!.length - 1].close;

        return lastValue - firstValue;
    }

    private async _fetchAssetChart(): Promise<any> {
        if (!this.asset.symbol) return;

        try {
            const response = await this._assetService.fetchAssetChart(this.asset.symbol, this.selectedRange);

            this.chartData = response.data?.length > 0 ? response.data : null;

            this._changeDetectorRef.markForCheck();
        } catch (error) {
            console.error(` TokenDetailComponent ~ this._assetService.fetchAssetChart ~ error:`, error);

            this.chartData = null;
        } finally {
            this.loadingChart = false;
        }
    }

    private async _fetchAssetDetails(): Promise<any> {
        if (!this.asset.symbol) return;

        try {
            const response = await this._assetService.fetchAssetDetails(this.asset.symbol, "1h", 10);

            this.details = new AssetDetails(response.data);
            this.details.about.description = this.cleanMarkdown(this.details.about.description);

            this._changeDetectorRef.markForCheck();
        } catch (error) {
            console.error(` TokenDetailComponent ~ this._assetService.fetchAssetDetails ~ error:`, error);
        } finally {
            this.loadingDetails = false;
        }
    }

    private _findMatchingToken(tokens: any[]): any | null {
        if (!Array.isArray(tokens) || !tokens.length) return null;

        const targetContract = String(
            (this.asset as any)?.address_token || (this.asset as any)?.tokenAddress || (this.asset as any)?.contractAddress || ""
        )
            .trim()
            .toLowerCase();

        if (targetContract && targetContract !== "apt" && !isNativeChainToken(this.asset)) {
            const byContract = tokens.find((token) => {
                const candidate = String(token?.address_token || token?.tokenAddress || token?.contractAddress || "")
                    .trim()
                    .toLowerCase();
                return candidate && candidate === targetContract;
            });
            if (byContract) return byContract;
        }

        const targetSymbol = String(this.asset?.symbol || "")
            .trim()
            .toUpperCase();
        const bySymbol = tokens.find(
            (token) =>
                String(token?.symbol || "")
                    .trim()
                    .toUpperCase() === targetSymbol
        );
        if (bySymbol) return bySymbol;

        if (isNativeChainToken(this.asset)) {
            return tokens.find((token) => isNativeChainToken(token)) || null;
        }

        return null;
    }

    private async _refreshAssetBalance(): Promise<void> {
        const networkId = tokenNetworkToLicenseId(this.asset?.network || this.asset?.symbol);
        if (!networkId) return;

        this.loadingBalance = true;
        this._changeDetectorRef.markForCheck();

        try {
            let wallet = await this._walletService.getCurrentWallet();
            if (!wallet) return;

            if (
                (networkId === "aptos" && !wallet.publicData?.aptosAddress) ||
                (networkId === "polkadot" && !wallet.publicData?.dotAddress) ||
                (networkId === "kusama" && !wallet.publicData?.ksmAddress)
            ) {
                try {
                    const refreshed = await this._tagsService.refreshTagPublicData(new TagModel(wallet));
                    if (refreshed) wallet = refreshed;
                } catch {
                    /* ignore refresh failure and proceed with current wallet */
                }
            }

            const response = await firstValueFrom(this._blockchainTransactionsService.getAddressData(wallet, [networkId]));
            if (!response || typeof response !== "object") return;

            const { tokens } = await this._assetService.processTokensFromResponse(response);
            const matched = this._findMatchingToken(tokens);
            if (!matched) return;

            this.asset = {
                ...this.asset,
                amount: matched.amount ?? matched.balance ?? this.asset.amount,
                balance: matched.balance ?? matched.amount ?? this.asset.balance,
                fiatBalance: matched.fiatBalance ?? this.asset.fiatBalance,
                price: matched.price || this.asset.price || this.details?.price?.price || undefined,
                image: this.asset.image || matched.image,
            };
            this._ensureAssetIcon();
            await this._assetService.setSourceAsset(this.asset);
            this._changeDetectorRef.markForCheck();
        } catch (error) {
            console.error(` TokenDetailComponent ~ _refreshAssetBalance ~ error:`, error);
        } finally {
            this.loadingBalance = false;
            this._changeDetectorRef.markForCheck();
        }
    }

    async _requestData(): Promise<void> {
        await Promise.all([this._fetchAssetDetails(), this._fetchAssetChart(), this._refreshAssetBalance()]);

        this._setChartData();
    }

    async _requestChartData(): Promise<void> {
        await this._fetchAssetChart();

        this._setChartData();
    }

    private _resizeChart() {
        if (!this.chart) return;

        const isSmallerScreen = window.innerWidth <= 468;
        const chartHeight = isSmallerScreen ? 100 : 50;

        this.chart.resize(0, chartHeight);

        const chartWidth = isSmallerScreen ? this.chartContainer.nativeElement.clientWidth * 0.8 : this.chartContainer.nativeElement.clientWidth;

        this.chart.resize(chartWidth, chartHeight);
    }

    private _setChart(): void {
        if (!this.chartContainer) return;

        const isSmallerScreen = window.innerWidth <= 468;
        const chartContainer = this.chartContainer.nativeElement;

        const chartOptions = {
            handleScale: false,
            handleScroll: false,
            height: 50,
            width: chartContainer.clientWidth,
            crosshair: { mode: 2, horzLine: { visible: false } },
            grid: {
                horzLines: { visible: false },
                vertLines: { visible: false },
            },
            kineticScroll: { touch: false, mouse: false },
            layout: {
                background: {
                    color: "transparent",
                    type: ColorType.Solid,
                },
            },
            rightPriceScale: {
                borderVisible: false,
                visible: false,
            },
            timeScale: {
                visible: false,
            },
            overlayPriceScales: { ticksVisible: false },
        } as ChartOptionsBase;

        chartOptions.height = isSmallerScreen ? 100 : 50;
        chartOptions.width = isSmallerScreen ? this.chartContainer.nativeElement.clientWidth * 0.6 : this.chartContainer.nativeElement.clientWidth;

        this.chart = createChart(chartContainer, chartOptions);

        this._requestData();
    }

    private _setChartData() {
        if (!this.chartData?.length) return;
        if (this.areaSeries) this.chart.removeSeries(this.areaSeries);

        const postiveTrend = this.priceChangePercentage > 0;

        const areaSeriesOptions = {
            bottomColor: postiveTrend ? "rgba(30, 164, 70, 0)" : "rgba(220, 54, 46, 0)",
            crosshairMarkerVisible: false,
            lineColor: postiveTrend ? "#1ea446" : "#dc362e",
            lineWidth: 1,
            priceLineVisible: false,
            topColor: postiveTrend ? "rgba(30, 164, 70, 0.3)" : "rgba(220, 54, 46, 0.3)",
        } as AreaSeriesOptions;

        this.areaSeries = this.chart.addSeries(AreaSeries, areaSeriesOptions);

        this.areaSeries.setData(this.chartData.map((item) => ({ time: item.time, value: item.close })) as AreaData[]);

        this._resizeChart();
    }

    async changeRange(range: AssetRange): Promise<void> {
        if (!this.chartData?.length) return;

        this.selectedRange = range;

        await this._requestChartData();
    }

    checkCanSend(): boolean {
        return this.CAN_SEND[this.networkSymbol as keyof NetworkPermissions] || false;
    }

    checkCanSwap(): boolean {
        return this.CAN_SWAP[this.networkSymbol as keyof NetworkPermissions] || false;
    }

    cleanMarkdown(input: string): string {
        return input
            .replace(/^#+\s.*$/gm, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/\*(.*?)\*/g, "$1")
            .replace(/\n{2,}/g, "\n")
            .replace(/\n/g, "\n\n")
            .trim();
    }

    async prepareSend(): Promise<void> {
        const address = await this._walletService.getWalletAddressByTokenType(this.asset.tokenType as string);

        if (!address) throw new Error("No address found");

        const currentWallet = await this._walletService.getCurrentWallet();

        await this._transactionService.setCurrentTransactionData(
            new TransactionData({
                sender: {
                    address,
                    tagName: currentWallet?.tagName || "",
                    domain: currentWallet?.domain || "",
                    fullTagName: currentWallet?.fullTagName || "",
                },
                token: this.asset,
            })
        );

        this._router.navigate(["/send", "transaction"]);
    }

    removeAsset() {
        this._assetService.removeSourceAsset();
    }

    selectTab(tab: string) {
        this.selectedTab = tab;

        this._changeDetectorRef.detectChanges();
    }
}
