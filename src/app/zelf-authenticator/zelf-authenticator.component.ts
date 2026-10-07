import { CommonModule, NgFor, NgIf } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { debounceTime, distinctUntilChanged, filter, map, skip, Subject, takeUntil } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { AuthService } from "app/services/auth.service";
import { ZOTP } from "app/models/zotp.model";
import { ZotpDataService } from "app/services/zotp-data.service";
import { ZOTPService } from "app/services/zotp.service";

@Component({
    imports: [CommonModule, NgFor, NgIf, ReactiveFormsModule, TranslocoModule],
    selector: "zelf-authenticator",
    styleUrls: ["./zelf-authenticator.component.scss"],
    templateUrl: "./zelf-authenticator.component.html",
})
export class ZelfAuthenticatorComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();

    error: string | null = null;
    filteredZotps: ZOTP[] = [];
    loading = false;
    searchControl = new FormControl("", { nonNullable: true });
    zotps: ZOTP[] = [];

    constructor(
        private _authService: AuthService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _router: Router,
        private _walletService: WalletService,
        private _zotpDataService: ZotpDataService,
        private _zotpService: ZOTPService
    ) {}

    async ngOnInit(): Promise<void> {
        this.searchControl.valueChanges.pipe(debounceTime(200), takeUntil(this.unsubscriber$)).subscribe(() => {
            this._applyFilters();
        });

        this._initSubscriptions();
        await this._reloadZotps(false);
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    get zotpCount(): number {
        return this.zotps.length;
    }

    onAddZotp(): void {
        void this._router.navigate(["/zelf-authenticator/new"]);
    }

    onZotpClick(zotp: ZOTP): void {
        this._zotpDataService.setCurrentZotp(zotp);
        void this._router.navigate(["/zelf-authenticator/detail"]);
    }

    onRefresh(): void {
        void this._reloadZotps(true);
    }

    getItemMark(zotp: ZOTP): string {
        return (zotp.name || "?").charAt(0).toUpperCase();
    }

    trackByZotp(_index: number, zotp: ZOTP): string {
        return zotp.id;
    }

    private _initSubscriptions(): void {
        this._chromeService.onWalletChanged$
            .pipe(
                map((w) => w?.fullTagName ?? ""),
                distinctUntilChanged(),
                filter((tag) => !!tag),
                skip(1),
                takeUntil(this.unsubscriber$)
            )
            .subscribe(() => {
                void this._reloadZotpsForWalletSwitch();
            });
    }

    private async _reloadZotpsForWalletSwitch(): Promise<void> {
        this._zotpService.clearCache();

        try {
            await this._authService.reauthenticateSession();
        } catch (error) {
            console.error("[zAuth] session reauth failed:", error);
        }

        await this._reloadZotps(true);
    }

    private async _reloadZotps(forceRefresh: boolean): Promise<void> {
        this.loading = true;
        this.error = null;

        try {
            this.zotps = forceRefresh
                ? await this._zotpService.loadZOTPsFromBackend(true)
                : await this._zotpService.loadZOTPsFromBackend(false);

            this._applyFilters();
        } catch (error) {
            console.error("Error loading ZOTPs:", error);
            this.error = "load_failed";
        } finally {
            this.loading = false;
            this._changeDetectorRef.detectChanges();
        }
    }

    private _applyFilters(): void {
        const query = this.searchControl.value.trim().toLowerCase();

        if (!query) {
            this.filteredZotps = this.zotps;
            return;
        }

        this.filteredZotps = this.zotps.filter((zotp) => {
            const nameMatch = zotp.name.toLowerCase().includes(query);
            const issuerMatch = zotp.issuer?.toLowerCase().includes(query);
            return nameMatch || issuerMatch;
        });
    }
}
