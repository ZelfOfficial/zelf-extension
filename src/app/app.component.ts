import { Component, Injector, OnDestroy, OnInit, ViewEncapsulation } from "@angular/core";
import { Router } from "@angular/router";
import { Subject, takeUntil } from "rxjs";

import { DEFAULT_WEB_APP_NAME, PENDING_CONNECT_KEY, SuperappPendingConnect } from "@shared/utils/superapp-connect";
import { SuperappPendingKeysOperation } from "@shared/types/superapp.types";
import { ChromeService } from "./chrome.service";
import { AutofillDataService } from "./services/autofill-data.service";
import { AutofillIntegrationService } from "./services/autofill-integration.service";
import { PopoutCommunicationService } from "./services/popout-communication.service";
import { AppLoadingService } from "./services/app-loading.service";
import { WalletService } from "./wallet.service";

@Component({
    encapsulation: ViewEncapsulation.None,
    selector: "app-root",
    standalone: false,
    styleUrls: ["./app.component.scss", "./main.scss"],
    template: `<div class="flex flex-col flex-auto main-div" [ngClass]="{ 'main-div--popout': isPopout, 'main-div--fullscreen': !isPopout }">
        <div class="app-loading-overlay" *ngIf="isLoading$ | async">
            <zelf-loader [diameter]="120" [absolute]="false"></zelf-loader>
        </div>
        <div class="superapp-connect-banner" *ngIf="connectingAppName">
            {{ (isKeysOperation ? "superapp.working_with" : "superapp.connecting_with") | transloco: { appName: connectingAppName } }}
        </div>
        <div class="flex flex-col flex-auto">
            <router-outlet></router-outlet>
        </div>
    </div>`,
})
export class AppComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();

    isPopout: boolean = false;
    isLoading$!: any;
    connectingAppName: string | null = null;
    isKeysOperation = false;

    constructor(
        private _appLoadingService: AppLoadingService,
        private _chromeService: ChromeService,
        private _injector: Injector,
        private _popoutCommunicationService: PopoutCommunicationService,
        private _router: Router,
        private _walletService: WalletService
    ) {
        this.isLoading$ = this._appLoadingService.isLoading$;
        this._initializeRequiredServices();

        this.isPopout = this._chromeService.isPopout;

        this._chromeService.isPopout$.pipe(takeUntil(this.unsubscriber$)).subscribe((isPopout) => {
            this.isPopout = isPopout;
        });
    }

    ngOnInit(): void {
        this.checkForPendingDecryption();
        this.notifyPopupReady();
        this.setupNavigationListener();
        void this.loadSuperappConnectBanner();
        void this.checkForPendingKeysOperation();
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    private checkForPendingDecryption(): void {
        if (!this.isPopout) return;

        const decryptionData = this._popoutCommunicationService.getDecryptionData();

        if (!decryptionData) return;
    }

    private async checkForPendingKeysOperation(): Promise<void> {
        if (typeof chrome === "undefined" || !chrome.storage?.session) return;
        const stored = await chrome.storage.session.get("superapp_pending_keys_operation");
        const pending = stored?.superapp_pending_keys_operation as SuperappPendingKeysOperation | undefined;
        if (!pending || pending.expiresAt < Date.now()) return;

        this.isKeysOperation = true;
        this.connectingAppName = pending.appName || pending.draft?.appName || DEFAULT_WEB_APP_NAME;

        if (window.location.hash.includes("popout-decryptor")) return;

        await this._router.navigate(["/popout-decryptor"], {
            queryParams: { from: "superapp", action: pending.action },
        });
    }

    private async loadSuperappConnectBanner(): Promise<void> {
        const pending = await this.readPendingConnect();
        if (!pending) {
            return;
        }

        this.connectingAppName = pending.appName || DEFAULT_WEB_APP_NAME;

        if (!this.isPopout) {
            return;
        }

        const { wallet, wallets } = await this._walletService.getAllWalletsFromStorage();
        const hasWallet = Boolean(
            wallet?._id || wallet?.fullTagName || wallet?.name || wallet?.publicData?.tagName || wallets?.length
        );
        if (hasWallet) {
            return;
        }

        await this.openWelcomeFullscreen();
    }

    private async readPendingConnect(): Promise<SuperappPendingConnect | null> {
        if (typeof chrome === "undefined" || !chrome.storage) {
            return null;
        }

        const sessionItems = await chrome.storage.session.get(PENDING_CONNECT_KEY);
        const localItems = await chrome.storage.local.get(PENDING_CONNECT_KEY);
        return (sessionItems?.[PENDING_CONNECT_KEY] || localItems?.[PENDING_CONNECT_KEY] || null) as SuperappPendingConnect | null;
    }

    private async openWelcomeFullscreen(): Promise<void> {
        if (typeof chrome === "undefined" || !chrome.runtime || !chrome.tabs) {
            return;
        }

        const url = chrome.runtime.getURL("index.html#/welcome-zelfid?from=superapp");
        await chrome.tabs.create({ url, active: true });
        window.close();
    }

    private notifyPopupReady(): void {
        if (this.isPopout && typeof chrome !== "undefined" && chrome.runtime) {
            chrome.runtime.sendMessage({
                type: "POPUP_READY",
            });
        }
    }

    private setupNavigationListener(): void {
        if (typeof chrome === "undefined" || !chrome.runtime) return;
    }

    /**
     * These services are required and must be initialized along with the application.
     */
    private _initializeRequiredServices(): void {
        this._injector.get(AutofillIntegrationService);
        this._injector.get(AutofillDataService);
    }
}
