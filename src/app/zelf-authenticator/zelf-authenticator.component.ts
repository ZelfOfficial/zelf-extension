import { CommonModule, NgFor, NgIf } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit, Optional } from "@angular/core";
import { FormControl, FormsModule, ReactiveFormsModule } from "@angular/forms";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatMenuModule } from "@angular/material/menu";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { debounceTime, distinctUntilChanged, filter, interval, map, skip, Subject, takeUntil } from "rxjs";

import { BiometricsGeneralComponent } from "app/biometrics-general/biometrics.component";
import { ChromeService } from "app/chrome.service";
import { HttpWrapperService } from "app/http-wrapper.service";
import {
    resolveZotpProtection,
    ZELF_KEYS_PROTECTION_FACE_PASSWORD,
    zelfKeysRequiresDecryptPassword,
} from "app/models/zelf-keys-protection";
import { ZOTP } from "app/models/zotp.model";
import { AuthService } from "app/services/auth.service";
import { TOTPService } from "app/services/totp.service";
import { ZotpDataService } from "app/services/zotp-data.service";
import { ZOTPService } from "app/services/zotp.service";
import { getDevFaceBypassRouterExtras, syncDevFaceBypassFromQueryParams } from "app/utils/dev-biometrics-bypass.util";
import { ZelfKeysPlanUsageComponent } from "app/zelf-keys/plan-limits/zelf-keys-plan-usage.component";
import { DeleteZotpComponent, DeleteZOTPData } from "./delete-zotp/delete-zotp.component";
import { ExportZotpComponent, ExportZOTPData } from "./export-zotp/export-zotp.component";
import { RecoverZotpComponent, RecoverZOTPData } from "./recover-zotp/recover-zotp.component";
import { ShareZotpComponent, ShareZOTPData } from "./share-zotp/share-zotp.component";
import { extractZotpApiErrorMessage, isZotpPasswordRequiredError } from "./zotp-error.util";
import { encryptWalletMasterPassword } from "./zotp-master-password.util";

@Component({
    imports: [
        BiometricsGeneralComponent,
        CommonModule,
        FormsModule,
        MatDialogModule,
        MatMenuModule,
        MatSnackBarModule,
        NgFor,
        NgIf,
        ReactiveFormsModule,
        TranslocoModule,
        ZelfKeysPlanUsageComponent,
    ],
    selector: "zelf-authenticator",
    styleUrls: ["./zelf-authenticator.component.scss"],
    templateUrl: "./zelf-authenticator.component.html",
})
export class ZelfAuthenticatorComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();
    private _decryptedSecrets = new Map<string, string>();
    private _generatedCodes = new Map<string, string>();
    private _unlockingIds = new Set<string>();
    private _pendingUnlockTargets: ZOTP[] = [];
    private _pendingPostUnlockAction: "reveal" | "share" = "reveal";

    readonly RING_RADIUS = 14;
    readonly RING_CIRCUMFERENCE = 2 * Math.PI * 14;
    readonly HIDDEN_CODE = "••••••••";

    awaitingUnlockPassword = false;
    currentTime = Math.floor(Date.now() / 1000);
    encryptedUnlockMasterPassword = "";
    error: string | null = null;
    filteredZotps: ZOTP[] = [];
    /** True only while the first list for this visit has not arrived and there is nothing to paint. */
    loading = true;
    /** A completed list (including a real empty vault) has been published. */
    private _sawList = false;
    readonly skeletonRows = [0, 1, 2];
    searchControl = new FormControl("", { nonNullable: true });
    showAddMenuSheet = false;
    showBiometrics = false;
    showUnlockMasterPassword = false;
    unlockError: string | null = null;
    unlockMasterPassword = "";
    zotps: ZOTP[] = [];

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _authService: AuthService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _router: Router,
        private _zotpDataService: ZotpDataService,
        private _zotpService: ZOTPService,
        @Optional() private _dialog?: MatDialog,
        @Optional() private _httpWrapperService?: HttpWrapperService,
        @Optional() private _snackBar?: MatSnackBar,
        @Optional() private _totpService?: TOTPService,
        @Optional() private _translocoService?: TranslocoService
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

        interval(1000)
            .pipe(takeUntil(this.unsubscriber$))
            .subscribe(() => {
                this.currentTime = Math.floor(Date.now() / 1000);
                void this._refreshUnlockedCodes();
                this._changeDetectorRef.detectChanges();
            });

        this._initSubscriptions();
        await this._reloadZotps(false);
    }

    ngOnDestroy(): void {
        this._clearAllSecrets();
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

    get allShownCodesRevealed(): boolean {
        return this.filteredZotps.length > 0 && this.filteredZotps.every((z) => this.isUnlocked(z));
    }

    get isAnyUnlocking(): boolean {
        return this._unlockingIds.size > 0;
    }

    get showFab(): boolean {
        return !this.showLoadingState && !this.error && this._sawList;
    }

    getDisplayTitle(zotp: ZOTP): string {
        const issuer = (zotp.issuer || "").trim();
        return issuer || zotp.name || "?";
    }

    hasIssuer(zotp: ZOTP): boolean {
        return Boolean((zotp.issuer || "").trim());
    }

    getItemMark(zotp: ZOTP): string {
        return (this.getDisplayTitle(zotp) || "?").charAt(0).toUpperCase();
    }

    isUnlocked(zotp: ZOTP): boolean {
        return this._decryptedSecrets.has(zotp.id) && Boolean(this._generatedCodes.get(zotp.id));
    }

    isUnlocking(zotp: ZOTP): boolean {
        return this._unlockingIds.has(zotp.id);
    }

    getDisplayCode(zotp: ZOTP): string {
        if (this.isUnlocked(zotp)) {
            return this._generatedCodes.get(zotp.id) || this.HIDDEN_CODE;
        }
        return this.HIDDEN_CODE;
    }

    getRemainingSeconds(zotp: ZOTP): number {
        const period = zotp.period && zotp.period > 0 ? zotp.period : 30;
        return period - (this.currentTime % period);
    }

    getRingDashOffset(zotp: ZOTP): number {
        const period = zotp.period && zotp.period > 0 ? zotp.period : 30;
        const remaining = this.getRemainingSeconds(zotp);
        const progress = Math.max(0, Math.min(1, remaining / period));
        return this.RING_CIRCUMFERENCE * (1 - progress);
    }

    onAddZotp(): void {
        this.showAddMenuSheet = false;
        void this._router.navigate(["/zelf-authenticator/new"], getDevFaceBypassRouterExtras() ?? {});
    }

    onOpenAddMenu(): void {
        this.showAddMenuSheet = true;
    }

    onCloseAddMenu(): void {
        this.showAddMenuSheet = false;
    }

    onRecoverZotpShares(): void {
        this.showAddMenuSheet = false;
        if (!this._dialog) return;

        const dialogRef = this._dialog.open(RecoverZotpComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            width: "90vw",
            maxWidth: "600px",
            minWidth: "320px",
            disableClose: true,
            data: {} as RecoverZOTPData,
        });

        dialogRef.afterClosed().subscribe(async (recoveredZOTP: Partial<ZOTP> | null) => {
            if (!recoveredZOTP) return;
            await this._reloadZotps(true);
        });
    }

    onRecoverVault(): void {
        this.onRefresh();
    }

    onZotpClick(zotp: ZOTP): void {
        this._zotpDataService.setCurrentZotp(zotp);
        void this._router.navigate(["/zelf-authenticator/detail"], getDevFaceBypassRouterExtras() ?? {});
    }

    async onRowMainClick(zotp: ZOTP, event?: Event): Promise<void> {
        event?.stopPropagation();
        if (this.isUnlocking(zotp)) return;

        if (this.isUnlocked(zotp)) {
            await this.onCopyCode(zotp, event);
            return;
        }

        await this._startUnlockFlow([zotp], "reveal");
    }

    async onCopyCode(zotp: ZOTP, event?: Event): Promise<void> {
        event?.stopPropagation();
        if (!this.isUnlocked(zotp)) {
            await this._startUnlockFlow([zotp], "reveal");
            return;
        }

        const code = (this._generatedCodes.get(zotp.id) || "").replace(/\s/g, "");
        if (!code) return;

        try {
            await navigator.clipboard.writeText(code);
            const msg = this._translocoService?.translate("zotp.code_copied") || "Code copied to clipboard";
            this._snackBar?.open(msg, "", { duration: 2500 });
        } catch (error) {
            console.error("Error copying 2FA code:", error);
        }
    }

    async onToggleAllCodes(): Promise<void> {
        if (this.isAnyUnlocking) return;

        if (this.allShownCodesRevealed) {
            for (const zotp of this.filteredZotps) {
                this.onHideSecret(zotp);
            }
            return;
        }

        const lockedTargets = this.filteredZotps.filter((z) => !this.isUnlocked(z));
        if (lockedTargets.length === 0) return;

        await this._startUnlockFlow(lockedTargets, "reveal");
    }

    onHideSecret(zotp: ZOTP): void {
        this._decryptedSecrets.delete(zotp.id);
        this._generatedCodes.delete(zotp.id);
        zotp.isDecrypted = false;
        zotp.decryptedSecret = undefined;
        this._changeDetectorRef.detectChanges();
    }

    onSeeDetails(zotp: ZOTP): void {
        this.onZotpClick(zotp);
    }

    async onExportZotp(zotp: ZOTP): Promise<void> {
        if (!this._dialog) {
            this.onZotpClick(zotp);
            return;
        }

        const hydrated = await this._ensureProof(zotp);
        if (!hydrated) return;

        this._dialog.open(ExportZotpComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            width: "90vw",
            maxWidth: "90vw",
            minWidth: "320px",
            disableClose: true,
            data: { zotp: hydrated } as ExportZOTPData,
        });
    }

    async onShareZotp(zotp: ZOTP): Promise<void> {
        if (!this._dialog) {
            this.onZotpClick(zotp);
            return;
        }

        const existingSecret = this._decryptedSecrets.get(zotp.id);
        if (existingSecret) {
            this._openShareDialog(zotp, existingSecret);
            return;
        }

        await this._startUnlockFlow([zotp], "share");
    }

    onDeleteZotp(zotp: ZOTP): void {
        if (!this._dialog) {
            this.onZotpClick(zotp);
            return;
        }

        const dialogRef = this._dialog.open(DeleteZotpComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            width: "90vw",
            maxWidth: "500px",
            disableClose: true,
            data: { zotp } as DeleteZOTPData,
        });

        dialogRef.afterClosed().subscribe(async (deleted) => {
            if (!deleted) return;
            this.onHideSecret(zotp);
            await this._zotpService.clearCacheAndRefresh();
            await this._reloadZotps(true);
        });
    }

    onRefresh(): void {
        void this._reloadZotps(true);
    }

    trackByZotp(_index: number, zotp: ZOTP): string {
        return zotp.id;
    }

    toggleUnlockMasterPasswordVisibility(): void {
        this.showUnlockMasterPassword = !this.showUnlockMasterPassword;
    }

    onCancelUnlock(): void {
        this.awaitingUnlockPassword = false;
        this.showBiometrics = false;
        this.unlockMasterPassword = "";
        this.encryptedUnlockMasterPassword = "";
        this.unlockError = null;
        this._pendingUnlockTargets = [];
        this._unlockingIds.clear();
        this._changeDetectorRef.detectChanges();
    }

    async onContinueUnlockPassword(): Promise<void> {
        if (!this.unlockMasterPassword.trim() || !this._httpWrapperService) return;

        try {
            this.encryptedUnlockMasterPassword =
                (await encryptWalletMasterPassword(this._httpWrapperService, this.unlockMasterPassword)) || "";
            if (!this.encryptedUnlockMasterPassword) return;

            this.unlockError = null;
            this.awaitingUnlockPassword = false;
            this.showBiometrics = true;
            this._changeDetectorRef.detectChanges();
        } catch (error) {
            console.error("Error encrypting master password:", error);
            if (this._translocoService) {
                this.unlockError = extractZotpApiErrorMessage(error, this._translocoService);
            }
            this._changeDetectorRef.detectChanges();
        }
    }

    async onBiometricsScanned(encryptedImage: string): Promise<void> {
        const targets = [...this._pendingUnlockTargets];
        const postAction = this._pendingPostUnlockAction;
        this.showBiometrics = false;

        if (targets.length === 0) return;

        for (const t of targets) {
            this._unlockingIds.add(t.id);
        }
        this._changeDetectorRef.detectChanges();

        try {
            for (const target of targets) {
                const requiresPwd = zelfKeysRequiresDecryptPassword(resolveZotpProtection(target));
                const encryptedPwd = requiresPwd ? this.encryptedUnlockMasterPassword || undefined : undefined;
                const { secret, zotp: updated } = await this._zotpService.retrieveZOTPSecretWithParams(
                    target,
                    encryptedImage,
                    encryptedPwd
                );

                if (secret) {
                    Object.assign(target, updated);
                    this._decryptedSecrets.set(target.id, secret);
                    target.isDecrypted = true;
                    target.decryptedSecret = secret;
                    await this._generateCodeForZotp(target, secret);

                    if (postAction === "share" && targets.length === 1) {
                        this._openShareDialog(target, secret);
                    }
                }
            }

            this.unlockMasterPassword = "";
            this.encryptedUnlockMasterPassword = "";
            this.unlockError = null;
            this._pendingUnlockTargets = [];
        } catch (error) {
            console.error("Error unlocking 2FA:", error);
            if (this._translocoService) {
                const msg = extractZotpApiErrorMessage(error, this._translocoService);
                this.unlockError = msg;
                this._snackBar?.open(msg, this._translocoService.translate("common.close"), { duration: 5000 });
            }

            if (isZotpPasswordRequiredError(error)) {
                for (const target of targets) {
                    target.protection = ZELF_KEYS_PROTECTION_FACE_PASSWORD;
                }
                this.awaitingUnlockPassword = true;
                this.unlockMasterPassword = "";
                this.encryptedUnlockMasterPassword = "";
            } else {
                this._pendingUnlockTargets = [];
            }
        } finally {
            this._unlockingIds.clear();
            this._changeDetectorRef.detectChanges();
        }
    }

    onBiometricsFailed(error: unknown): void {
        console.error("Biometrics failed:", error);
        if (this._translocoService) {
            const msg = extractZotpApiErrorMessage(error, this._translocoService);
            this._snackBar?.open(msg, this._translocoService.translate("common.close"), { duration: 4000 });
        }
        this.onCancelUnlock();
    }

    private async _startUnlockFlow(targets: ZOTP[], postAction: "reveal" | "share"): Promise<void> {
        if (targets.length === 0) return;

        for (const t of targets) {
            this._unlockingIds.add(t.id);
        }
        this._changeDetectorRef.detectChanges();

        const hydratedTargets: ZOTP[] = [];
        try {
            for (const t of targets) {
                const hydrated = await this._ensureProof(t);
                if (hydrated) {
                    Object.assign(t, hydrated);
                    hydratedTargets.push(t);
                }
            }
        } finally {
            this._unlockingIds.clear();
            this._changeDetectorRef.detectChanges();
        }

        if (hydratedTargets.length === 0) return;

        this._pendingUnlockTargets = hydratedTargets;
        this._pendingPostUnlockAction = postAction;
        this.unlockMasterPassword = "";
        this.encryptedUnlockMasterPassword = "";
        this.unlockError = null;

        const anyRequiresPassword = hydratedTargets.some((t) =>
            zelfKeysRequiresDecryptPassword(resolveZotpProtection(t))
        );

        if (anyRequiresPassword) {
            this.awaitingUnlockPassword = true;
            this.showBiometrics = false;
        } else {
            this.awaitingUnlockPassword = false;
            this.showBiometrics = true;
        }
        this._changeDetectorRef.detectChanges();
    }

    private async _ensureProof(zotp: ZOTP): Promise<ZOTP | null> {
        if (zotp.zelfProof?.trim()) return zotp;
        if (!this._zotpService.ensureZotpProof) return zotp;

        try {
            return await this._zotpService.ensureZotpProof(zotp);
        } catch (error) {
            console.error("Error hydrating 2FA proof:", error);
            if (this._translocoService) {
                const msg = extractZotpApiErrorMessage(error, this._translocoService);
                this._snackBar?.open(msg, this._translocoService.translate("common.close"), { duration: 4000 });
            }
            return null;
        }
    }

    private _openShareDialog(zotp: ZOTP, setupKey: string): void {
        if (!this._dialog) return;

        this._dialog.open(ShareZotpComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            width: "90vw",
            maxWidth: "600px",
            minWidth: "320px",
            disableClose: true,
            data: { zotp, setupKey } as ShareZOTPData,
        });
    }

    private async _refreshUnlockedCodes(): Promise<void> {
        if (this._decryptedSecrets.size === 0 || !this._totpService) return;

        const tasks: Promise<void>[] = [];
        for (const zotp of this.zotps) {
            const secret = this._decryptedSecrets.get(zotp.id);
            if (secret) {
                tasks.push(this._generateCodeForZotp(zotp, secret));
            }
        }
        await Promise.all(tasks);
    }

    private async _generateCodeForZotp(zotp: ZOTP, secret: string): Promise<void> {
        if (!this._totpService) {
            this._generatedCodes.set(zotp.id, "123 456");
            return;
        }

        const period = zotp.period || 30;
        const digits = zotp.digits || 6;
        const algorithm = zotp.algorithm || "SHA1";

        try {
            const raw = await this._totpService.generate(secret, period, digits, algorithm);
            const mid = Math.ceil(raw.length / 2);
            const formatted = raw.length > 4 ? `${raw.substring(0, mid)} ${raw.substring(mid)}` : raw;
            this._generatedCodes.set(zotp.id, formatted);
        } catch (error) {
            console.error("Error generating TOTP code:", error);
            this._generatedCodes.set(zotp.id, "ERROR");
        }
    }

    private _clearAllSecrets(): void {
        this._decryptedSecrets.clear();
        this._generatedCodes.clear();
        this._unlockingIds.clear();
        this._pendingUnlockTargets = [];
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
        this._clearAllSecrets();
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
