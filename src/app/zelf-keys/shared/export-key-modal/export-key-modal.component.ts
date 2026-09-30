import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, Inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { HttpWrapperService } from "../../../http-wrapper.service";
import {
    DecryptBatchProgress,
    ExportFormat,
    ExportFormatOption,
    ExportableCredential,
    VaultExportService,
} from "../../../services/vault-export.service";
import { BiometricsBottomSheetComponent, BiometricsBottomSheetData } from "../biometrics-bottom-sheet/biometrics-bottom-sheet.component";

export interface ExportKeyModalData {
    mode: "single" | "vault";
    title?: string;
    items: any[];
    alreadyDecrypted?: ExportableCredential[];
    hasMasterPassword?: boolean;
}

@Component({
    standalone: true,
    selector: "export-key-modal",
    imports: [CommonModule, FormsModule, MatDialogModule, TranslocoModule],
    templateUrl: "./export-key-modal.component.html",
    styleUrls: ["./export-key-modal.component.scss"],
})
export class ExportKeyModalComponent implements OnInit {
    mode: "single" | "vault" = "vault";
    items: any[] = [];
    hasMasterPassword: boolean = false;
    masterPassword: string = "";

    // States: 'locked' | 'decrypting' | 'ready'
    state: "locked" | "decrypting" | "ready" = "locked";

    // Progress
    progressText: string = "";
    progressPercent: number = 0;

    // Decrypted credentials
    decryptedCredentials: ExportableCredential[] = [];
    failedCount: number = 0;

    // Selected format
    selectedFormat: ExportFormat = "lastpass";
    formats: ExportFormatOption[] = [];

    // Formatted preview
    previewContent: string = "";
    copied: boolean = false;

    constructor(
        @Inject(MAT_DIALOG_DATA) public data: ExportKeyModalData,
        public dialogRef: MatDialogRef<ExportKeyModalComponent>,
        private _bottomSheet: MatBottomSheet,
        private _changeDetectorRef: ChangeDetectorRef,
        private _httpWrapperService: HttpWrapperService,
        private _translocoService: TranslocoService,
        private _vaultExportService: VaultExportService
    ) {
        this.mode = data.mode || "vault";
        this.items = data.items || [];
        this.hasMasterPassword = !!data.hasMasterPassword;
        this.formats = this._vaultExportService.formatOptions;
    }

    ngOnInit(): void {
        if (this.data.alreadyDecrypted && this.data.alreadyDecrypted.length > 0) {
            this.decryptedCredentials = this.data.alreadyDecrypted;
            this.state = "ready";
            this._updatePreview();
        } else if (this.items.length === 0) {
            this.state = "ready";
        }
    }

    get selectedFormatOption(): ExportFormatOption {
        return this.formats.find((f) => f.id === this.selectedFormat) || this.formats[0];
    }

    onFormatChange(format: ExportFormat): void {
        this.selectedFormat = format;
        this._updatePreview();
    }

    private _updatePreview(): void {
        if (this.decryptedCredentials.length === 0) {
            this.previewContent = "";
            return;
        }

        const fullExport = this._vaultExportService.exportToString(
            this.selectedFormat,
            this.decryptedCredentials
        );
        // Show first 15 lines in preview
        const lines = fullExport.split(/\r?\n/);
        if (lines.length > 15) {
            this.previewContent = lines.slice(0, 15).join("\n") + `\n... (+${lines.length - 15} more lines)`;
        } else {
            this.previewContent = fullExport;
        }
        this._changeDetectorRef.detectChanges();
    }

    /**
     * Trigger face biometrics bottom sheet to capture faceBase64 once for the entire batch.
     */
    async onStartUnlock(): Promise<void> {
        if (this.hasMasterPassword && !this.masterPassword.trim()) {
            return;
        }

        const encryptedMasterPassword =
            this.hasMasterPassword && this.masterPassword.trim()
                ? await this._httpWrapperService.encryptMessage(this.masterPassword.trim())
                : "";

        const data: BiometricsBottomSheetData = {
            itemData: {
                title: this._translocoService.translate("zelf_keys.vault.export_title"),
                instructions: this._translocoService.translate("zelf_keys.vault.export_face_instructions"),
                subtitle: `${this.items.length} ${this._translocoService.translate("zelf_keys.vault.stat_passwords")}`,
            },
            itemType: "password",
            mode: "capture",
        };

        const bottomSheetRef = this._bottomSheet.open(BiometricsBottomSheetComponent, {
            data,
            backdropClass: "zelf-backdrop",
            panelClass: "zelf-bottom-sheet-biometrics",
        });

        bottomSheetRef.afterDismissed().subscribe(async (result) => {
            if (!result?.faceBase64) {
                return;
            }

            await this._runDecryptionBatch(result.faceBase64, encryptedMasterPassword);
        });
    }

    private async _runDecryptionBatch(faceBase64: string, masterPasswordEncrypted: string): Promise<void> {
        this.state = "decrypting";
        this.progressPercent = 0;
        this.progressText = "Starting decryption...";
        this._changeDetectorRef.detectChanges();

        try {
            const { succeeded, failed } = await this._vaultExportService.decryptBatch(
                this.items,
                faceBase64,
                masterPasswordEncrypted,
                (progress: DecryptBatchProgress) => {
                    this.progressPercent = Math.round((progress.current / progress.total) * 100);
                    this.progressText = `Decrypting ${progress.current} of ${progress.total}: ${progress.title}`;
                    this._changeDetectorRef.detectChanges();
                }
            );

            this.decryptedCredentials = succeeded;
            this.failedCount = failed.length;
            this.state = "ready";
            this._updatePreview();
        } catch (err: any) {
            console.error("Batch decryption failed:", err);
            this.state = "locked";
        } finally {
            // Immediate zeroing of master password
            this.masterPassword = "";
            this._changeDetectorRef.detectChanges();
        }
    }

    onDownload(): void {
        if (this.decryptedCredentials.length === 0) return;

        const opt = this.selectedFormatOption;
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `zelfkeys-export-${this.selectedFormat}-${dateStr}.${opt.extension}`;
        const content = this._vaultExportService.exportToString(this.selectedFormat, this.decryptedCredentials);

        this._vaultExportService.downloadFile(content, filename, opt.mimeType);
    }

    async onCopy(): Promise<void> {
        if (this.decryptedCredentials.length === 0) return;

        const content = this._vaultExportService.exportToString(this.selectedFormat, this.decryptedCredentials);
        const ok = await this._vaultExportService.copyToClipboard(content);
        if (ok) {
            this.copied = true;
            this._changeDetectorRef.detectChanges();
            setTimeout(() => {
                this.copied = false;
                this._changeDetectorRef.detectChanges();
            }, 2500);
        }
    }

    onClose(): void {
        this.dialogRef.close();
    }
}
