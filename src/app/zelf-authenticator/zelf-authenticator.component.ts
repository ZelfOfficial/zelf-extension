import { CommonModule, NgFor, NgIf } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { debounceTime, distinctUntilChanged, filter, map, skip, Subject, takeUntil } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { getDevFaceBypassRouterExtras, syncDevFaceBypassFromQueryParams } from "app/utils/dev-biometrics-bypass.util";
import { AuthService } from "app/services/auth.service";
import { ZOTP } from "app/models/zotp.model";
import { ZotpDataService } from "app/services/zotp-data.service";
import { ZOTPService } from "app/services/zotp.service";
import { ZelfKeysPlanUsageComponent } from "app/zelf-keys/plan-limits/zelf-keys-plan-usage.component";

@Component({
    imports: [CommonModule, NgFor, NgIf, ReactiveFormsModule, TranslocoModule, ZelfKeysPlanUsageComponent],
    selector: "zelf-authenticator",
    styleUrls: ["./zelf-authenticator.component.scss"],
    templateUrl: "./zelf-authenticator.component.html",
})
export class ZelfAuthenticatorComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();

    error: string | null = null;
    filteredZotps: ZOTP[] = [];
    /** True only while the first list for this visit has not arrived and there is nothing to paint. */
    loading = true;
    /** A completed list (including a real empty vault) has been published. */
    private _sawList = false;
    readonly skeletonRows = [0, 1, 2];
    searchControl = new FormControl("", { nonNullable: true });
    zotps: ZOTP[] = [];

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _authService: AuthService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _router: Router,
        private _zotpDataService: ZotpDataService,
        private _zotpService: ZOTPService
    ) {}

    async ngOnInit(): Promise<void> {
        syncDevFaceBypassFromQueryParams(this._activatedRoute.snapshot.queryParams);
        this._activatedRoute.queryParams.pipe(takeUntil(this.unsubscriber$)).subscribe((params) => {
            syncDevFaceBypassFromQueryParams(params);
        });

        this.searchControl.valueChanges.pipe(debounceTime(200), takeUntil(this.unsubscriber$)).subscribe(() => {
            this._applyFilters();
        });

        this._zotpService.zotps$.pipe(takeUntil(this.unsubscriber$)).subscribe((items) => {
            if (!items) {
                this.zotps = [];
                this._applyFilters();
                this._syncLoadingFlag(this._zotpService.listLoading);
                return;
            }

            this._sawList = true;
            this.zotps = items;
            this._applyFilters();
            this._syncLoadingFlag(false);
        });

        this._zotpService.listLoading$.pipe(takeUntil(this.unsubscriber$)).subscribe((loading) => {
            this._syncLoadingFlag(loading);
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

    /** Empty copy only after a finished load that returned zero 2FAs. */
    get showEmptyState(): boolean {
        return !this.loading && !this.error && this._sawList && this.zotps.length === 0;
    }

    get showLoadingState(): boolean {
        return this.loading && this.zotps.length === 0 && !this.error;
    }

    onAddZotp(): void {
        void this._router.navigate(["/zelf-authenticator/new"], getDevFaceBypassRouterExtras() ?? {});
    }

    onZotpClick(zotp: ZOTP): void {
        this._zotpDataService.setCurrentZotp(zotp);
        void this._router.navigate(["/zelf-authenticator/detail"], getDevFaceBypassRouterExtras() ?? {});
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
        this._sawList = false;
        this.zotps = [];
        this.filteredZotps = [];
        this.loading = true;
        this._zotpService.clearCache();

        try {
            await this._authService.reauthenticateSession();
        } catch (error) {
            console.error("[zAuth] session reauth failed:", error);
        }

        await this._reloadZotps(true);
    }

    private async _reloadZotps(forceRefresh: boolean): Promise<void> {
        if (this.zotps.length === 0) this.loading = true;
        this.error = null;
        this._changeDetectorRef.detectChanges();

        try {
            const zotps = await this._zotpService.loadZOTPsFromBackend(forceRefresh);
            this._sawList = true;
            this.zotps = zotps;
            this._applyFilters();
        } catch (error) {
            console.error("Error loading ZOTPs:", error);
            this.error = "load_failed";
            this._sawList = true;
        } finally {
            this.loading = false;
            this._changeDetectorRef.detectChanges();
        }
    }

    private _syncLoadingFlag(listLoading: boolean): void {
        this.loading = this.zotps.length === 0 && !this.error && (listLoading || !this._sawList);
        this._changeDetectorRef.detectChanges();
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
