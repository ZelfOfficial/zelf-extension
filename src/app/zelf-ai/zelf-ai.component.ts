import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { Subject, distinctUntilChanged, filter, map, skip, takeUntil } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { HomeHubHeaderComponent } from "app/home/home-hub-header/home-hub-header.component";
import { HomeProfilePanelComponent } from "app/home/home-profile-panel/home-profile-panel.component";
import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { ZelfFooterComponent } from "app/zelf-footer/zelf-footer.component";

@Component({
    selector: "zelf-ai",
    standalone: true,
    imports: [
        CommonModule,
        TranslocoModule,
        HomeHubHeaderComponent,
        HomeProfilePanelComponent,
        ZelfFooterComponent,
    ],
    styleUrls: ["./zelf-ai.component.scss"],
    template: `
        <div class="zelf-card home-hub" *transloco="let t">
            <home-hub-header
                [walletName]="walletName"
                [showName]="showName"
                (profileClick)="openProfilePanel()"
                (toggleNameClick)="toggleName()"
            />

            <div class="home-hub__body">
                <div class="ai-coming-soon">
                    <!-- Squircle Hero Icon Tile with official Zelf AI icon -->
                    <div class="ai-coming-soon__hero-tile">
                        <svg width="34" height="34" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <g clip-path="url(#clip0_ai_sparkle)">
                                <path d="M10 2.97656C8.5537 6.06572 6.06572 8.55371 2.97656 10C6.06519 11.446 8.55359 13.9331 10 17.0215C11.4462 13.9336 13.9336 11.4462 17.0215 10C13.9331 8.55359 11.446 6.06519 10 2.97656ZM20.1504 10.8857L20.0371 10.915C15.563 12.0693 12.0693 15.563 10.915 20.0371L10.8857 20.1504L9.11426 20.1504L9.08496 20.0371C7.93068 15.563 4.43698 12.0693 -0.0371097 10.915L-0.150391 10.8857L-0.150391 9.11426L-0.0371096 9.08496C4.43698 7.93068 7.93068 4.43698 9.08496 -0.0371091L9.11426 -0.15039L10.8857 -0.15039L10.915 -0.0371091C12.0693 4.43698 15.563 7.93068 20.0371 9.08496L20.1504 9.11426L20.1504 10.8857Z" fill="#FD6337" stroke="#FD6337" stroke-width="0.3" stroke-linecap="round"/>
                                <path d="M17.8091 0.349609C17.8604 0.706834 18.0875 1.14234 18.4663 1.52441C18.8464 1.90764 19.2834 2.13924 19.6509 2.19043L19.6509 3.50098C19.2615 3.54977 18.8229 3.78268 18.4507 4.16113C18.0801 4.53789 17.858 4.9752 17.8091 5.34375L16.4976 5.34375C16.4458 4.9809 16.2146 4.54478 15.8306 4.16309C15.4473 3.78223 15.012 3.55385 14.6567 3.50195L14.6567 2.19043C15.0292 2.13965 15.466 1.90788 15.8442 1.52539C16.2213 1.14406 16.4477 0.708212 16.4985 0.349609L17.8091 0.349609ZM17.0386 2.12109C16.9497 2.23127 16.8568 2.33596 16.7612 2.43262C16.6578 2.5372 16.5453 2.63894 16.4263 2.73535L16.2827 2.85156L16.4263 2.96777C16.537 3.0576 16.6425 3.15139 16.7397 3.24805C16.8384 3.34605 16.9341 3.45232 17.0259 3.56445L17.1431 3.70801L17.2593 3.56348C17.3459 3.45522 17.4374 3.35272 17.5317 3.25684C17.6357 3.15114 17.7476 3.04852 17.8667 2.95215L18.0103 2.83691L17.8677 2.71973C17.7556 2.62791 17.6494 2.53159 17.5513 2.43262C17.4549 2.33548 17.3613 2.23059 17.272 2.12012L17.1548 1.97656L17.0386 2.12109Z" fill="#FD6337" stroke="#FD6337" stroke-width="0.3" stroke-linecap="round"/>
                            </g>
                            <defs>
                                <clipPath id="clip0_ai_sparkle">
                                    <rect width="20" height="20" fill="white"/>
                                </clipPath>
                            </defs>
                        </svg>
                    </div>

                    <!-- Glowing Status Pill -->
                    <div class="ai-coming-soon__pill">
                        <span class="ai-coming-soon__pill-dot" aria-hidden="true"></span>
                        <span>{{ t('common.coming_soon') }}</span>
                    </div>

                    <!-- Typography -->
                    <h2 class="ai-coming-soon__heading">{{ t('home_hub.ai_heading') }}</h2>
                    <p class="ai-coming-soon__description">{{ t('home_hub.ai_subtitle') }}</p>

                    <!-- Privy Inset Feature Preview Card -->
                    <div class="ai-coming-soon__preview">
                        <div class="ai-coming-soon__preview-row">
                            <div class="ai-coming-soon__preview-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                            </div>
                            <div class="ai-coming-soon__preview-text">
                                <p class="ai-coming-soon__preview-title">{{ t('home_hub.ai_assistant_title') }}</p>
                                <p class="ai-coming-soon__preview-subtitle">{{ t('home_hub.ai_assistant_desc') }}</p>
                            </div>
                        </div>

                        <div class="ai-coming-soon__preview-row">
                            <div class="ai-coming-soon__preview-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                </svg>
                            </div>
                            <div class="ai-coming-soon__preview-text">
                                <p class="ai-coming-soon__preview-title">{{ t('home_hub.ai_security_title') }}</p>
                                <p class="ai-coming-soon__preview-subtitle">{{ t('home_hub.ai_security_desc') }}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <zelf-footer [shareables]="{ wallet: wallet }"></zelf-footer>

            <home-profile-panel
                *ngIf="showProfilePanel"
                [wallets]="allWallets"
                [currentWallet]="wallet"
                [visible]="showProfilePanel"
                (closed)="closeProfilePanel()"
                (walletSelected)="onPanelWalletSelected($event)"
                (openSettings)="onPanelSettings()"
                (addAccount)="onPanelAddAccount()"
            />
        </div>
    `,
})
export class ZelfAiComponent implements OnInit, OnDestroy {
    private readonly _destroy$ = new Subject<void>();

    wallet: Partial<TagModel> = {};
    showProfilePanel = false;
    allWallets: TagModel[] = [];
    showName = false;

    constructor(
        private readonly _changeDetectorRef: ChangeDetectorRef,
        private readonly _chromeService: ChromeService,
        private readonly _router: Router,
        private readonly _walletService: WalletService,
    ) {}

    async ngOnInit(): Promise<void> {
        await this._initWallet();
        this._initSubscriptions();
    }

    ngOnDestroy(): void {
        this._destroy$.next();
        this._destroy$.complete();
    }

    get walletName(): string {
        return (this.wallet?.fullTagName || this.wallet?.publicData?.tagName || "") as string;
    }

    private async _initWallet(): Promise<void> {
        const { wallet } = await this._walletService.getAllWalletsFromStorage();
        this.wallet = wallet || ({} as Partial<TagModel>);
    }

    private _initSubscriptions(): void {
        this._chromeService.onWalletChanged$
            .pipe(
                map((w) => w?.fullTagName ?? ""),
                distinctUntilChanged(),
                filter((tag) => !!tag),
                skip(1),
                takeUntil(this._destroy$)
            )
            .subscribe(() => {
                void this._refreshWallet();
            });
    }

    private async _refreshWallet(): Promise<void> {
        const { wallet } = await this._walletService.getAllWalletsFromStorage();
        if (wallet) {
            this.wallet = wallet;
            this._changeDetectorRef.detectChanges();
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
        void this._router.navigate(["/wallet-manage"]);
    }
}
