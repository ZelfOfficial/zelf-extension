import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, Inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { HttpWrapperService } from "../../../http-wrapper.service";
import {
    ImportBatchProgress,
    ImportParseResult,
    ImportProvider,
    ImportProviderOption,
    ImportableCredential,
    VaultImportService,
} from "../../../services/vault-import.service";
import { ZelfKeysDataService } from "../../../services/zelf-keys-data.service";
import { BiometricsBottomSheetComponent, BiometricsBottomSheetData } from "../biometrics-bottom-sheet/biometrics-bottom-sheet.component";

export interface ImportVaultModalData {
    hasMasterPassword?: boolean;
}

@Component({
    standalone: true,
    selector: "import-vault-modal",
    imports: [CommonModule, FormsModule, MatDialogModule, TranslocoModule],
    templateUrl: "./import-vault-modal.component.html",
    styleUrls: ["./import-vault-modal.component.scss"],
})
export class ImportVaultModalComponent implements OnInit {
    hasMasterPassword: boolean = false;
    masterPassword: string = "";

    // States: 'select_file' | 'preview' | 'importing' | 'complete'
    state: "select_file" | "preview" | "importing" | "complete" = "select_file";

    // File / content input
    isDragging: boolean = false;
    fileName: string = "";
    rawFileContent: string = "";
    pasteMode: boolean = false;
    pastedText: string = "";

    // Provider options & detected format
    providers: ImportProviderOption[] = [];
    selectedProvider: ImportProvider = "auto";
    detectedProvider: ImportProvider = "auto";

    // Parsed credentials
    credentials: ImportableCredential[] = [];
    parseErrors: string[] = [];
    showPasswords: boolean = false;

    // Importing progress
    progressText: string = "";
    progressPercent: number = 0;
    importSucceededCount: number = 0;
    importFailedItems: { credential: ImportableCredential; error: string }[] = [];

    constructor(
        @Inject(MAT_DIALOG_DATA) public data: ImportVaultModalData,
        public dialogRef: MatDialogRef<ImportVaultModalComponent>,
        private _bottomSheet: MatBottomSheet,
        private _changeDetectorRef: ChangeDetectorRef,
        private _httpWrapperService: HttpWrapperService,
        private _translocoService: TranslocoService,
        private _vaultImportService: VaultImportService,
        private _zelfKeysDataService: ZelfKeysDataService
    ) {
        this.hasMasterPassword = !!data?.hasMasterPassword;
        this.providers = this._vaultImportService.providerOptions;
    }

    ngOnInit(): void {}

    get selectedCount(): number {
        return this.credentials.filter((c) => c.selected).length;
    }

    get allSelected(): boolean {
        return this.credentials.length > 0 && this.credentials.every((c) => c.selected);
    }

    toggleSelectAll(): void {
        const target = !this.allSelected;
        this.credentials.forEach((c) => (c.selected = target));
    }

    get detectedProviderName(): string {
        const p = this.providers.find((item) => item.id === this.detectedProvider);
        return p?.name || this.detectedProvider;
    }

    onDragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging = true;
    }

    onDragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging = false;
    }

    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging = false;

        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            this._handleFile(files[0]);
        }
    }

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            this._handleFile(input.files[0]);
        }
    }

    private _handleFile(file: File): void {
        this.fileName = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (content) {
                this.rawFileContent = content;
                this._parseAndPreview(content);
            }
        };
        reader.readAsText(file);
    }

    onParsePastedText(): void {
        if (!this.pastedText.trim()) return;
        this.fileName = "Pasted text";
        this.rawFileContent = this.pastedText;
        this._parseAndPreview(this.pastedText);
    }

    private _parseAndPreview(content: string): void {
        const result: ImportParseResult = this._vaultImportService.parseContent(
            content,
            this.selectedProvider !== "auto" ? this.selectedProvider : undefined
        );

        this.detectedProvider = result.detectedProvider;
        if (this.selectedProvider === "auto") {
            this.selectedProvider = result.detectedProvider;
        }
        this.credentials = result.credentials;
        this.parseErrors = result.errors;

        if (this.credentials.length > 0) {
            this.state = "preview";
        }
        this._changeDetectorRef.detectChanges();
    }

    onProviderChange(provider: ImportProvider): void {
        this.selectedProvider = provider;
        if (this.rawFileContent) {
            this._parseAndPreview(this.rawFileContent);
        }
    }

    togglePasswordVisibility(): void {
        this.showPasswords = !this.showPasswords;
    }

    onBackToFileSelect(): void {
        this.state = "select_file";
        this.credentials = [];
        this.parseErrors = [];
    }

    /**
     * Trigger face biometric scan to authorize batch storage with a single selfie.
     */
    async onStartImport(): Promise<void> {
        if (this.selectedCount === 0) return;
        if (this.hasMasterPassword && !this.masterPassword.trim()) return;

        const encryptedMasterPassword =
            this.hasMasterPassword && this.masterPassword.trim()
                ? await this._httpWrapperService.encryptMessage(this.masterPassword.trim())
                : "";

        const data: BiometricsBottomSheetData = {
            itemData: {
                title: this._translocoService.translate("zelf_keys.vault.import_title"),
                instructions: this._translocoService.translate("zelf_keys.vault.import_face_instructions"),
                subtitle: `${this.selectedCount} ${this._translocoService.translate("zelf_keys.vault.stat_passwords")}`,
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
            if (!result?.faceBase64) return;

            await this._runImportBatch(result.faceBase64, encryptedMasterPassword);
        });
    }

    private async _runImportBatch(faceBase64: string, masterPasswordEncrypted: string): Promise<void> {
        this.state = "importing";
        this.progressPercent = 0;
        this.progressText = "Encrypting and storing credentials...";
        this._changeDetectorRef.detectChanges();

        try {
            const { succeeded, failed } = await this._vaultImportService.importBatch(
                this.credentials,
                faceBase64,
                masterPasswordEncrypted,
                (progress: ImportBatchProgress) => {
                    this.progressPercent = Math.round((progress.current / progress.total) * 100);
                    this.progressText = `Storing ${progress.current} of ${progress.total}: ${progress.title}`;
                    this._changeDetectorRef.detectChanges();
                }
            );

            this.importSucceededCount = succeeded;
            this.importFailedItems = failed;
            this.state = "complete";

            // Trigger vault data refresh
            if (succeeded > 0) {
                await this._zelfKeysDataService.refresh("native-import-passwords");
            }
        } catch (err: any) {
            console.error("Batch import failed:", err);
            this.state = "preview";
        } finally {
            this.masterPassword = "";
            this._changeDetectorRef.detectChanges();
        }
    }

    onDone(): void {
        this.dialogRef.close({ imported: this.importSucceededCount });
    }

    onClose(): void {
        this.dialogRef.close();
    }
}
