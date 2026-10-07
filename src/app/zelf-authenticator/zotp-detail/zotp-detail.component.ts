import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { interval, Subject, takeUntil } from "rxjs";

import { CopyToClipboardBase } from "app/base/copy-to-clipboard/copy-to-clipboard.base";
import { BiometricsGeneralComponent } from "app/biometrics-general/biometrics.component";
import { ChromeService } from "app/chrome.service";
import { HttpWrapperService } from "app/http-wrapper.service";
import { zelfKeysRequiresDecryptPassword } from "app/models/zelf-keys-protection";
import { ZOTP } from "app/models/zotp.model";
import { TOTPService } from "app/services/totp.service";
import { ZelfKeysService } from "app/services/zelf-keys.service";
import { ZotpDataService } from "app/services/zotp-data.service";
import { ZOTPService } from "app/services/zotp.service";
import { WalletService } from "app/wallet.service";
import { ExportZotpComponent, ExportZOTPData } from "../export-zotp/export-zotp.component";

@Component({
    imports: [CommonModule, FormsModule, TranslocoModule, RouterModule, MatDialogModule, BiometricsGeneralComponent],
    selector: "zotp-detail",
    styleUrls: ["./zotp-detail.component.scss"],
    templateUrl: "./zotp-detail.component.html",
})
export class ZotpDetailComponent extends CopyToClipboardBase implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();

    awaitingUnlockPassword = false;
    confirmingDelete = false;
    currentCode = "";
    currentTime = Math.floor(Date.now() / 1000);
    decryptedSecret: string | null = null;
    deleteMasterPassword = "";
    deleting = false;
    error: string | null = null;
    hasMasterPassword = false;
    loading = false;
    showBiometrics = false;
    showCode = false;
    showUnlockMasterPassword = false;
    timeRemaining = 0;
    unlockMasterPassword = "";
    unlockMode = false;
    zotp: ZOTP | null = null;

    constructor(
        private _changeDetectorRef: ChangeDetectorRef,
        private _dialog: MatDialog,
        private _httpWrapperService: HttpWrapperService,
        private _router: Router,
        private _totpService: TOTPService,
        private _walletService: WalletService,
        private _zelfKeysService: ZelfKeysService,
        private _zotpDataService: ZotpDataService,
        private _zotpService: ZOTPService,
        protected _chromeService: ChromeService,
        protected _snackBar: MatSnackBar,
        protected _translocoService: TranslocoService
    ) {
        super(_chromeService, _snackBar, _translocoService);
    }

    async ngOnInit(): Promise<void> {
        const wallet = await this._walletService.getCurrentWallet();
        this.hasMasterPassword = wallet?.hasPassword || false;
        this._loadZotp();

        interval(1000)
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => {
                this.currentTime = Math.floor(Date.now() / 1000);
                void this._refreshCode();
            });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    get initial(): string {
        return (this.zotp?.name || "?").charAt(0).toUpperCase();
    }

    get displayTitle(): string {
        return this.zotp?.name || "";
    }

    get ipfsId(): string {
        return this.zotp?.ipfs?.id || this.zotp?.zelfKeysId || "";
    }

    get requiresDecryptPassword(): boolean {
        return zelfKeysRequiresDecryptPassword(this.zotp?.protection);
    }

    get protectionLabelKey(): string {
        return this.requiresDecryptPassword ? "zotp.protection.face_password" : "zotp.protection.face";
    }

    private _loadZotp(): void {
        this.loading = true;
        this.error = null;

        const zotp = this._zotpDataService.getCurrentZotp();
        if (!zotp) {
            this.error = this._translocoService.translate("billing.passwords.detail.error.not_found");
            this.loading = false;
            return;
        }

        this.zotp = zotp;
        this.loading = false;
    }

    onBackToList(): void {
        this._zotpDataService.clearCurrentZotp();
        void this._router.navigate(["/zelf-authenticator"]);
    }

    onUnlockClick(): void {
        if (!this.zotp?.zelfProof) {
            this._snackBar.open(
                this._translocoService.translate("errors.cannot_decrypt_zotp_missing_zelfProof"),
                this._translocoService.translate("common.close"),
                { duration: 3000 }
            );
            return;
        }

        if (this.decryptedSecret) {
            this._scrollToCode();
            return;
        }

        this.unlockMode = true;
        this.unlockMasterPassword = "";

        if (this.requiresDecryptPassword) {
            this.awaitingUnlockPassword = true;
            this.showBiometrics = false;
            return;
        }

        this.showBiometrics = true;
    }

    toggleUnlockMasterPasswordVisibility(): void {
        this.showUnlockMasterPassword = !this.showUnlockMasterPassword;
    }

    onCancelUnlockPassword(): void {
        this.awaitingUnlockPassword = false;
        this.unlockMode = false;
        this.unlockMasterPassword = "";
    }

    onContinueUnlockPassword(): void {
        if (!this.unlockMasterPassword.trim()) return;

        this.awaitingUnlockPassword = false;
        this.showBiometrics = true;
    }

    async onCopyCode(): Promise<void> {
        if (!this.currentCode) return;
        await this._copyToClipboard(this.currentCode.replace(/\s/g, ""));
    }

    onToggleCodeVisibility(): void {
        this.showCode = !this.showCode;
    }

    onHideCode(): void {
        this.decryptedSecret = null;
        this.currentCode = "";
        this.showCode = false;
    }

    onExportItem(): void {
        if (!this.zotp?.zelfProof) {
            this._snackBar.open(
                this._translocoService.translate("errors.cannot_decrypt_zotp_missing_zelfProof"),
                this._translocoService.translate("common.close"),
                { duration: 3000 }
            );
            return;
        }

        this._dialog.open(ExportZotpComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            width: "90vw",
            maxWidth: "90vw",
            minWidth: "320px",
            disableClose: true,
            data: { zotp: this.zotp } as ExportZOTPData,
        });
    }

    onDeleteClick(): void {
        this.confirmingDelete = true;
        this.deleteMasterPassword = "";
    }

    onCancelDelete(): void {
        this.confirmingDelete = false;
        this.deleteMasterPassword = "";
    }

    async onConfirmDelete(): Promise<void> {
        if (!this.zotp || this.deleting) return;
        if (this.hasMasterPassword && !this.deleteMasterPassword.trim()) return;
        if (!this.ipfsId) return;

        this.deleting = true;
        this.unlockMode = false;
        this.showBiometrics = true;
    }

    async onBiometricsScanned(encryptedImage: string): Promise<void> {
        if (!this.zotp) return;

        if (this.deleting) {
            await this._handleDelete(encryptedImage);
            return;
        }

        if (this.unlockMode) {
            await this._handleUnlock(encryptedImage);
        }
    }

    onBiometricsFailed(error: unknown): void {
        console.error("Biometrics failed:", error);
        this.showBiometrics = false;
        this.unlockMode = false;
        this.awaitingUnlockPassword = false;
        this.unlockMasterPassword = "";
        this.deleting = false;
        this._changeDetectorRef.detectChanges();
    }

    canNavigateAwayHandler(_canNavigate: boolean): void {
        // no-op
    }

    private async _handleUnlock(encryptedImage: string): Promise<void> {
        if (!this.zotp) return;

        this.loading = true;

        try {
            const encryptedMasterPassword =
                this.requiresDecryptPassword && this.unlockMasterPassword.trim()
                    ? await this._httpWrapperService.encryptMessage(this.unlockMasterPassword.trim())
                    : undefined;

            const secret = await this._zotpService.retrieveZOTPSecret(this.zotp, encryptedImage, encryptedMasterPassword);
            if (!secret) throw new Error("Failed to retrieve ZOTP secret");

            this.decryptedSecret = secret;
            this.showBiometrics = false;
            this.unlockMode = false;
            this.unlockMasterPassword = "";
            await this._refreshCode();
            this._scrollToCode();
        } catch (error) {
            console.error("Error decrypting ZOTP:", error);
            this.showBiometrics = false;
            this.unlockMode = false;
            this.unlockMasterPassword = "";
        } finally {
            this.loading = false;
            this._changeDetectorRef.detectChanges();
        }
    }

    private async _handleDelete(encryptedImage: string): Promise<void> {
        if (!this.zotp) return;

        try {
            const masterPassword = this.hasMasterPassword
                ? await this._httpWrapperService.encryptMessage(this.deleteMasterPassword)
                : "";

            await this._zelfKeysService.delete(this.ipfsId, encryptedImage, masterPassword);

            this._zotpDataService.clearCurrentZotp();
            await this._zotpService.clearCacheAndRefresh();
            void this._router.navigate(["/zelf-authenticator"]);
        } catch (error) {
            console.error("Error deleting ZOTP:", error);
            this.showBiometrics = false;
            this.deleting = false;
            this.confirmingDelete = false;
        } finally {
            this.deleting = false;
            this._changeDetectorRef.detectChanges();
        }
    }

    private async _refreshCode(): Promise<void> {
        if (!this.zotp || !this.decryptedSecret) return;

        const period = this.zotp.period || 30;
        const digits = this.zotp.digits || 6;
        const algorithm = this.zotp.algorithm || "SHA1";

        try {
            const code = await this._totpService.generate(this.decryptedSecret, period, digits, algorithm);
            this.currentCode = code.length === 6 ? `${code.substring(0, 3)} ${code.substring(3)}` : code;
            this.timeRemaining = period - (this.currentTime % period);
        } catch (error) {
            console.error("Error generating TOTP code:", error);
            this.currentCode = "ERROR";
        }

        this._changeDetectorRef.detectChanges();
    }

    private _scrollToCode(): void {
        setTimeout(() => {
            document.getElementById("zotp-decrypted-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 200);
    }

    formatDate(timestamp?: number): string {
        if (!timestamp) return "—";
        return new Date(timestamp).toLocaleString();
    }
}
