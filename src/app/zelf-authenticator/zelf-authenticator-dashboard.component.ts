import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { NavigationEnd, Router, RouterModule } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { Observable, Subject, distinctUntilChanged, filter, map, skip, takeUntil } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { HomeHubHeaderComponent } from "app/home/home-hub-header/home-hub-header.component";
import { HomeProfilePanelComponent } from "app/home/home-profile-panel/home-profile-panel.component";
import { ShellLayoutService } from "app/services/shell-layout.service";
import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { ZelfFooterComponent } from "app/zelf-footer/zelf-footer.component";

@Component({
    imports: [
        CommonModule,
        TranslocoModule,
        RouterModule,
        HomeHubHeaderComponent,
        HomeProfilePanelComponent,
        ZelfFooterComponent,
    ],
    selector: "zelf-authenticator-dashboard",
    styleUrls: ["./zelf-authenticator-dashboard.component.scss"],
    templateUrl: "./zelf-authenticator-dashboard.component.html",
})
export class ZelfAuthenticatorDashboardComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();

    isDeepShell$: Observable<boolean>;
    wallet: Partial<TagModel> = {};
    showProfilePanel = false;
    showName = false;
    allWallets: TagModel[] = [];

    constructor(
        private _chromeService: ChromeService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _router: Router,
        private _shellLayout: ShellLayoutService,
        private _walletService: WalletService
    ) {
        this.isDeepShell$ = this._shellLayout.isDeepShell$;
    }

    async ngOnInit(): Promise<void> {
        await this._initWallet();
        this._initSubscriptions();
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    get walletName(): string {
        return (this.wallet?.fullTagName || this.wallet?.publicData?.tagName || "") as string;
    }

    toggleName(): void {
        this.showName = !this.showName;
    }

    private _initSubscriptions(): void {
        this._router.events.pipe(takeUntil(this.unsubscriber$)).subscribe((event) => {
            if (!(event instanceof NavigationEnd)) return;

            const contentElement = document.querySelector(".authenticator-dashboard__content");
            if (contentElement) contentElement.scrollTop = 0;
        });

        this._chromeService.onWalletChanged$
            .pipe(
                map((w) => w?.fullTagName ?? ""),
                distinctUntilChanged(),
                filter((tag) => !!tag),
                skip(1),
                takeUntil(this.unsubscriber$)
            )
            .subscribe(async () => {
                const wallet = await this._walletService.getCurrentWallet();
                if (wallet) this.wallet = wallet;
                this._changeDetectorRef.detectChanges();
            });
    }

    private async _initWallet(): Promise<void> {
        const wallet = await this._walletService.getCurrentWallet();
        if (wallet) this.wallet = wallet;
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
        void this._router.navigate(["/settings"], { state: { fromZAuthScreen: true } });
    }

    onPanelAddAccount(): void {
        this.closeProfilePanel();
        void this._router.navigate(["/wallet-manage"], { state: { fromZAuthScreen: true } });
    }
}
