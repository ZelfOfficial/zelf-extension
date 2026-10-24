import { CommonModule, NgClass, NgIf, NgTemplateOutlet } from "@angular/common";
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import jsQR from "jsqr";
import { Subject, takeUntil } from "rxjs";

import { BiometricsGeneralComponent } from "app/biometrics-general/biometrics.component";
import { DragAndDropDirective } from "app/directives/drag-and-drop.directive";
import { HttpWrapperService } from "app/http-wrapper.service";
import { protectionFromDecryptToggle, ZelfKeysProtection } from "app/models/zelf-keys-protection";
import { ZOTP } from "app/models/zotp.model";
import { ZOTPService } from "app/services/zotp.service";
import { TagModel, TagsService } from "app/tags.service";
import { ZelfKeysPlanLimitCoordinator } from "app/zelf-keys/plan-limits/zelf-keys-plan-limit.coordinator";
import { PlanLimitPurchaseContext } from "app/zelf-keys/plan-limits/zelf-keys-plan-limits.model";
import { ZelfKeysPlanUsageComponent } from "app/zelf-keys/plan-limits/zelf-keys-plan-usage.component";
import { VaultService } from "app/vault.service";
import { WalletService } from "app/wallet.service";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { extractZotpApiErrorMessage, resolveZotpServerErrorCode } from "../zotp-error.util";
import { encryptWalletMasterPassword, normalizeWalletMasterPassword } from "../zotp-master-password.util";
import {
    migrationAlgorithmFromEnum,
    migrationDigitsFromEnum,
    parseOtpAuthTotpUri,
    ParsedTotpSetup,
} from "../zotp-otpauth.util";
import {
    formatInvalidSetupKeyCharactersList,
    getSetupKeyValidationState,
    sanitizeSetupKey,
    setupKeyValidator,
} from "../zotp-setup-key.util";
import { scrollableAncestor, scrollDeltaToRevealAboveBar, snackbarMarginBottom, topmostObstacle } from "./add-zotp-layout.util";

@Component({
    imports: [
        BiometricsGeneralComponent,
        CommonModule,
        DragAndDropDirective,
        MatButtonModule,
        MatSnackBarModule,
        NgClass,
        NgIf,
        NgTemplateOutlet,
        ReactiveFormsModule,
        TranslocoModule,
        ZelfKeysPlanUsageComponent,
        ZelfLoaderComponent,
    ],
    selector: "add-zotp",
    styleUrls: [
        "../../zelf-keys/zelf-keys-passwords/zelf-keys-password-form/zelf-keys-password-form.component.scss",
        "./add-zotp.component.scss",
    ],
    templateUrl: "./add-zotp.component.html",
})
export class AddZotpComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();
    private _setupKeyHintScroll?: ReturnType<typeof setTimeout>;
    private _snackbarPlace?: ReturnType<typeof setTimeout>;

    @ViewChild("setupKeyFeedback") private _setupKeyFeedback?: ElementRef<HTMLElement>;
    @ViewChild("formActions") private _formActions?: ElementRef<HTMLElement>;

    currentWallet: TagModel | null = null;
    form!: FormGroup;
    hasMasterPassword = false;
    loading: boolean = false;
    mode: "setup-key" | "qr-upload" = "setup-key";
    pendingProtection: ZelfKeysProtection = "face";
    pendingZOTP: ZOTP | null = null; // ZOTP waiting to be created/stored after biometrics verification
    qrError: string = "";
    showBiometrics: boolean = false;
    showMasterPassword: boolean = false; // Toggle to show/hide master password
    submitted: boolean = false; // Track if form has been submitted
    totpAlgorithm = "SHA1";
    totpDigits = 6;
    totpPeriod = 30;

    constructor(
        private _formBuilder: FormBuilder,
        private _httpWrapperService: HttpWrapperService,
        private _router: Router,
        private _snackBar: MatSnackBar,
        private _tagsService: TagsService,
        private _translocoService: TranslocoService,
        private _planLimits: ZelfKeysPlanLimitCoordinator,
        private _vaultService: VaultService,
        private _walletService: WalletService,
        private _zotpService: ZOTPService
    ) {
        this._initForm();
    }

    async ngOnInit(): Promise<void> {
        // Load current wallet
        await this._loadCurrentWallet();

        this.form
            .get("setupKey")
            ?.valueChanges.pipe(takeUntil(this.unsubscriber$))
            .subscribe((value) => {
                const sanitized = sanitizeSetupKey(value ?? "");

                if (sanitized !== value) {
                    this.form.get("setupKey")?.setValue(sanitized, { emitEvent: false });
                }

                this.form.get("setupKey")?.updateValueAndValidity({ emitEvent: false });
                this._scheduleSetupKeyHintScroll();
            });
    }

    private async _loadCurrentWallet(): Promise<void> {
        try {
            const wallet = await this._walletService.getCurrentWallet();
            this.currentWallet = wallet ? new TagModel(wallet) : null;
            this.hasMasterPassword = !!wallet?.hasPassword;
            this._updateMasterPasswordValidators();
        } catch (error) {
            console.error("Error loading current wallet:", error);
        }
    }

    private _updateMasterPasswordValidators(): void {
        const control = this.form.get("masterPassword");
        if (!control) return;

        if (this.hasMasterPassword) {
            control.setValidators([Validators.required]);
        } else {
            control.clearValidators();
        }

        control.updateValueAndValidity();
    }

    toggleMasterPasswordVisibility(): void {
        this.showMasterPassword = !this.showMasterPassword;
    }

    ngOnDestroy(): void {
        clearTimeout(this._setupKeyHintScroll);
        clearTimeout(this._snackbarPlace);
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    private _initForm(): void {
        this.form = this._formBuilder.group({
            name: ["", [Validators.required, Validators.maxLength(128)]],
            issuer: ["", [Validators.maxLength(128)]],
            setupKey: ["", [setupKeyValidator()]],
            masterPassword: [""],
            requireMasterPasswordOnDecrypt: [false],
        });
    }

    get canShowProtectionOption(): boolean {
        return this.mode === "setup-key" || !!this.form.get("setupKey")?.value?.trim();
    }

    get isFormReadyToSave(): boolean {
        if (this.mode === "qr-upload") {
            return false;
        }

        if (!this.setupKeyFieldState.valid) {
            return false;
        }

        if (this.hasMasterPassword && !normalizeWalletMasterPassword(this.form.get("masterPassword")?.value)) {
            return false;
        }

        return this.form.valid;
    }

    get setupKeyFieldState() {
        return getSetupKeyValidationState(this.form.get("setupKey")?.value ?? "");
    }

    get setupKeyInvalidCharsMessage(): string | null {
        const chars = this.setupKeyFieldState.invalidChars;

        if (!chars.length) return null;

        return formatInvalidSetupKeyCharactersList(chars);
    }

    get showSetupKeyTooShortHint(): boolean {
        const state = this.setupKeyFieldState;

        return state.tooShort && state.invalidChars.length === 0;
    }

    toggleRequireMasterPasswordOnDecrypt(): void {
        if (!this.hasMasterPassword) return;

        const control = this.form.get("requireMasterPasswordOnDecrypt");
        control?.setValue(!control?.value);
    }

    switchMode(mode: "setup-key" | "qr-upload"): void {
        this.mode = mode;
        this.qrError = "";
        this.submitted = false; // Reset submitted state when switching modes
        this.form.get("setupKey")?.setValue("");
        this._resetTotpParameters();
    }

    private _resetTotpParameters(): void {
        this.totpAlgorithm = "SHA1";
        this.totpDigits = 6;
        this.totpPeriod = 30;
    }

    private _applyParsedSetup(setup: ParsedTotpSetup): void {
        this.form.patchValue({
            name: setup.name || "",
            issuer: setup.issuer || "",
            setupKey: sanitizeSetupKey(setup.secret),
        });
        this.totpAlgorithm = setup.algorithm || "SHA1";
        this.totpDigits = setup.digits ?? 6;
        this.totpPeriod = setup.period ?? 30;
        this.form.get("setupKey")?.updateValueAndValidity();
    }

    async onDrop(files: FileList): Promise<void> {
        if (files.length === 0) return;

        await this._processQRCode(files[0]);
    }

    async fileBrowseHandler(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement;

        if (target.files && target.files.length > 0) {
            await this._processQRCode(target.files[0]);
        }
    }

    private async _processQRCode(file: File): Promise<void> {
        this.loading = true;
        this.qrError = "";

        try {
            const base64 = await this._fileToBase64(file);
            const qrData = await this._decodeQRCode(base64);

            if (!qrData) {
                this.qrError = "Invalid QR code";
                this.loading = false;

                return;
            }

            // Check if it's a Google Authenticator migration format
            if (qrData.startsWith("otpauth-migration://")) {
                const migrationData = this._parseMigrationURI(qrData);

                if (migrationData && migrationData.length > 0) {
                    // If multiple accounts, use the first one (we can enhance this later to show a selection)
                    const firstAccount = migrationData[0];

                    this._applyParsedSetup(firstAccount);

                    this.mode = "setup-key";
                    this.loading = false;

                    return;
                } else {
                    this.qrError = "Could not extract TOTP data from migration QR code";
                    this.loading = false;

                    return;
                }
            }

            // Try standard otpauth:// format
            const parsed = parseOtpAuthTotpUri(qrData);

            if (!parsed) {
                this.qrError = "QR code is not a valid TOTP setup";
                this.loading = false;

                return;
            }

            this._applyParsedSetup(parsed);

            this.mode = "setup-key";
        } catch (error) {
            console.error("Error processing QR code:", error);
            this.qrError = "Failed to process QR code";
        } finally {
            this.loading = false;
        }
    }

    private _fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const result = reader.result as string;

                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    private _decodeQRCode(base64: string): Promise<string | null> {
        return new Promise((resolve) => {
            const img = new Image();

            img.src = base64;

            img.onload = () => {
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");

                if (!context) {
                    resolve(null);

                    return;
                }

                canvas.width = img.width;
                canvas.height = img.height;

                context.drawImage(img, 0, 0, img.width, img.height);

                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const extractedQRData = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });

                resolve(extractedQRData?.data || null);
            };

            img.onerror = () => resolve(null);
        });
    }

    private _parseMigrationURI(uri: string): ParsedTotpSetup[] | null {
        // Parse otpauth-migration://offline?data=BASE64_ENCODED_PROTOBUF
        if (!uri.startsWith("otpauth-migration://")) return null;

        try {
            const url = new URL(uri);
            const dataParam = url.searchParams.get("data");

            if (!dataParam) return null;

            // URL decode the data parameter
            const urlDecoded = decodeURIComponent(dataParam);

            // Base64 decode
            const binaryString = atob(urlDecoded);

            // Parse the protobuf data
            // Google Authenticator migration format structure:
            // Outer message (MigrationPayload) contains:
            //   Field 1 (repeated, wire type 2): OTPParameters messages
            const accounts: ParsedTotpSetup[] = [];
            let offset = 0;

            // Parse the outer message to find field 1 (repeated OTPParameters)
            while (offset < binaryString.length) {
                const tag = binaryString.charCodeAt(offset++);
                const fieldNumber = tag >> 3;
                const wireType = tag & 0x7;

                if (wireType === 2 && fieldNumber === 1) {
                    // Field 1: repeated OTPParameters (length-delimited)
                    let length = 0;
                    let shift = 0;
                    let byte;

                    do {
                        byte = binaryString.charCodeAt(offset++);
                        length |= (byte & 0x7f) << shift;
                        shift += 7;
                    } while (byte & 0x80 && offset < binaryString.length);

                    if (offset + length > binaryString.length) break;

                    // Extract the OTPParameters message
                    const payload = binaryString.substring(offset, offset + length);
                    offset += length;

                    // Parse the OTPParameters message
                    const account = this._parseMigrationPayload(payload);

                    if (account) {
                        accounts.push(account);
                    }
                } else {
                    // Skip unknown fields
                    if (wireType === 0) {
                        // Varint - skip it
                        let byte;

                        do {
                            byte = binaryString.charCodeAt(offset++);
                        } while (byte & 0x80 && offset < binaryString.length);
                    } else if (wireType === 2) {
                        // Length-delimited - skip it
                        let length = 0;
                        let shift = 0;
                        let byte;

                        do {
                            byte = binaryString.charCodeAt(offset++);
                            length |= (byte & 0x7f) << shift;
                            shift += 7;
                        } while (byte & 0x80 && offset < binaryString.length);

                        offset += length;
                    } else {
                        // Unknown wire type, break
                        break;
                    }
                }
            }

            return accounts.length > 0 ? accounts : null;
        } catch (error) {
            console.error("Error parsing migration URI:", error);

            return null;
        }
    }

    private _parseMigrationPayload(payload: string): ParsedTotpSetup | null {
        // Parse the nested protobuf structure
        // Field 1: secret (bytes)
        // Field 2: name (string)
        // Field 3: issuer (string)
        // Field 4: algorithm (enum)
        // Field 5: digits (enum)
        // Field 6: type (enum)
        // Field 7: counter (uint64) - for HOTP

        let secret = "";
        let name = "";
        let issuer = "";
        let algorithm: string | undefined;
        let digits: number | undefined;

        let offset = 0;

        while (offset < payload.length) {
            const tag = payload.charCodeAt(offset++);
            const fieldNumber = tag >> 3;
            const wireType = tag & 0x7;

            if (wireType === 0) {
                // Varint
                let value = 0;
                let shift = 0;
                let byte;

                do {
                    byte = payload.charCodeAt(offset++);
                    value |= (byte & 0x7f) << shift;
                    shift += 7;
                } while (byte & 0x80 && offset < payload.length);

                if (fieldNumber === 4) {
                    algorithm = migrationAlgorithmFromEnum(value);
                } else if (fieldNumber === 5) {
                    digits = migrationDigitsFromEnum(value);
                }
            } else if (wireType === 2) {
                // Length-delimited (string or bytes)
                let length = 0;
                let shift = 0;
                let byte;

                do {
                    byte = payload.charCodeAt(offset++);
                    length |= (byte & 0x7f) << shift;
                    shift += 7;
                } while (byte & 0x80 && offset < payload.length);

                if (offset + length > payload.length) break;

                const data = payload.substring(offset, offset + length);
                offset += length;

                if (fieldNumber === 1) {
                    // Secret (bytes) - convert to base32
                    secret = this._bytesToBase32(data);
                } else if (fieldNumber === 2) {
                    // Name (string)
                    name = this._decodeUTF8(data);
                } else if (fieldNumber === 3) {
                    // Issuer (string)
                    issuer = this._decodeUTF8(data);
                }
            } else {
                // Skip unknown wire types
                break;
            }
        }

        if (!secret) return null;

        return {
            name: name || "Unknown",
            issuer: issuer || "",
            secret,
            algorithm,
            digits,
        };
    }

    private _bytesToBase32(bytes: string): string {
        // Convert bytes to base32
        // Google Authenticator uses base32 encoding for secrets
        const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let result = "";
        let bits = 0;
        let value = 0;

        for (let i = 0; i < bytes.length; i++) {
            value = (value << 8) | bytes.charCodeAt(i);
            bits += 8;

            while (bits >= 5) {
                result += base32Chars.charAt((value >>> (bits - 5)) & 31);
                bits -= 5;
            }
        }

        if (bits > 0) {
            result += base32Chars.charAt((value << (5 - bits)) & 31);
        }

        return result;
    }

    private _decodeUTF8(str: string): string {
        // Simple UTF-8 decoder
        let result = "";
        let i = 0;

        while (i < str.length) {
            const c = str.charCodeAt(i++);

            if (c < 0x80) {
                result += String.fromCharCode(c);
            } else if (c < 0xe0) {
                result += String.fromCharCode(((c & 0x1f) << 6) | (str.charCodeAt(i++) & 0x3f));
            } else if (c < 0xf0) {
                const c2 = str.charCodeAt(i++);
                result += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (str.charCodeAt(i++) & 0x3f));
            } else {
                const c2 = str.charCodeAt(i++);
                const c3 = str.charCodeAt(i++);
                result += String.fromCharCode(((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (str.charCodeAt(i++) & 0x3f));
            }
        }

        return result;
    }

    /**
     * Start the ZOTP creation flow with biometrics
     * This is the main entry point for creating a new ZOTP
     */
    async save(): Promise<void> {
        this.submitted = true;

        if (!this.isFormReadyToSave) {
            if (!this.setupKeyFieldState.valid) {
                this._notify(this._translocoService.translate("zotp.errors.invalid_setup_key"));
                this._scheduleSetupKeyHintScroll();
            }

            return;
        }

        // Validate form and prepare ZOTP data
        const formValue = this.form.value;
        const secret = this.setupKeyFieldState.sanitized;

        if (!secret || !getSetupKeyValidationState(secret).valid) {
            this._notify(this._translocoService.translate("zotp.errors.invalid_setup_key"));

            return;
        }

        const allowed = await this._planLimits.ensureCanAdd("zotp", this._limitContext());

        if (!allowed) return;

        try {
            // Get zelfProof from current wallet
            const zelfProof = await this._tagsService.getZelfProof();

            if (!zelfProof) throw new Error("No wallet found. Please create or unlock a wallet first.");

            // Create ZOTP object (secret will be encrypted by ZelfKeys API during storage)
            const protection = protectionFromDecryptToggle(!!formValue.requireMasterPasswordOnDecrypt);

            const zotp: ZOTP = {
                id: this._zotpService.generateId(),
                name: formValue.name.trim(),
                secret: secret, // Plain secret - will be encrypted by ZelfKeys API
                issuer: formValue.issuer?.trim() || undefined,
                algorithm: this.totpAlgorithm,
                digits: this.totpDigits,
                period: this.totpPeriod,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDecrypted: false,
                protection,
                zelfProof: zelfProof,
            };

            this.pendingProtection = protection;

            // Store pending ZOTP and show biometrics for creation
            // Biometrics are required as part of the creation flow
            this.pendingZOTP = zotp;
            this.showBiometrics = true;
        } catch (error) {
            this._logZotpError("Error preparing ZOTP", error);
            this._notify(extractZotpApiErrorMessage(error, this._translocoService));
        }
    }

    /**
     * Handle biometrics capture during ZOTP creation
     * This completes the creation flow by storing the ZOTP to ZelfKeys
     */
    async onBiometricsScanned(encryptedImage: string): Promise<void> {
        if (!this.pendingZOTP) {
            console.error("No pending ZOTP to store");
            return;
        }

        this.loading = true;

        try {
            const plainPassword = this.hasMasterPassword
                ? normalizeWalletMasterPassword(this.form.get("masterPassword")?.value)
                : "";

            if (this.hasMasterPassword && !plainPassword) {
                this._notify(this._translocoService.translate("zotp.protection.errors.password_required"));
                this._keepFormForRetry();

                return;
            }

            const masterPassword = plainPassword
                ? (await encryptWalletMasterPassword(this._httpWrapperService, plainPassword)) || ""
                : "";

            if (this.hasMasterPassword && !masterPassword) {
                this._notify(this._translocoService.translate("zotp.protection.errors.password_required"));
                this._keepFormForRetry();

                return;
            }

            // Store ZOTP to ZelfKeys API (this is the creation step).
            // Face-only wallets send no password. Face+password wallets always send the
            // encrypted master password; the item protection flag is separate.
            await this._zotpService.storeZOTPToZelfKeys(
                this.pendingZOTP,
                encryptedImage,
                masterPassword,
                this.pendingProtection
            );

            // Successfully created - return to list
            void this._router.navigate(["/zelf-authenticator"]);
        } catch (error) {
            const outcome = await this._planLimits.recoverFromSaveError(error, "zotp", this._limitContext());

            if (outcome !== "not-limit") {
                this._keepFormForRetry();

                if (outcome === "retry") this.showBiometrics = true;

                return;
            }

            this._logZotpError("Error creating ZOTP", error);
            this._notify(extractZotpApiErrorMessage(error, this._translocoService));
            this._keepFormForRetry();
        } finally {
            this.loading = false;
        }
    }

    onBiometricsFailed(error: any): void {
        this._logZotpError("Biometrics failed", error);
        this._notify(extractZotpApiErrorMessage(error, this._translocoService));
        // Face capture failed before store. Keep the form and let them scan again.
        this.showBiometrics = false;
        this.loading = false;
    }

    private _notify(message: string): void {
        this._snackBar.open(message, this._translocoService.translate("common.close"), {
            duration: 5000,
            horizontalPosition: "center",
            verticalPosition: "bottom",
            panelClass: ["zelf-snackbar", "zelf-snackbar--above-footer"],
        });
        clearTimeout(this._snackbarPlace);
        this._snackbarPlace = setTimeout(() => this._placeSnackbarAboveBar());
    }

    /** Scroll the real container by the overlap with the sticky bar, not scrollIntoView. */
    private _scheduleSetupKeyHintScroll(): void {
        if (!this.setupKeyInvalidCharsMessage && !this.showSetupKeyTooShortHint) return;

        clearTimeout(this._setupKeyHintScroll);
        this._setupKeyHintScroll = setTimeout(() => this._revealSetupKeyHint());
    }

    private _revealSetupKeyHint(attempt = 0): void {
        const hint = this._setupKeyFeedback?.nativeElement;
        const bar = this._formActions?.nativeElement;

        if (!hint || !bar || attempt > 4) return;

        const delta = scrollDeltaToRevealAboveBar(hint.getBoundingClientRect().bottom, bar.getBoundingClientRect().top);

        if (delta <= 0) return;

        const scroller = scrollableAncestor(hint);

        if (!scroller) return;

        const before = scroller.scrollTop;

        scroller.scrollTop = before + delta;

        if (scroller.scrollTop === before) return;

        this._setupKeyHintScroll = setTimeout(() => this._revealSetupKeyHint(attempt + 1));
    }

    /** Sit the toast fully above the action bar and the footer pill. */
    private _placeSnackbarAboveBar(): void {
        const container = document.querySelector(".mat-mdc-snack-bar-container.zelf-snackbar--above-footer") as HTMLElement | null;

        if (!container) return;

        const barTop = this._formActions?.nativeElement.getBoundingClientRect().top;
        const footer = document.querySelector(".footer") as HTMLElement | null;
        const obstacle = topmostObstacle([barTop, footer?.getBoundingClientRect().top], window.innerHeight);

        container.style.setProperty("margin-bottom", `${snackbarMarginBottom(window.innerHeight, obstacle)}px`, "important");
    }

    /** Log status and code only. Store errors can echo the setup key in validationError. */
    private _logZotpError(label: string, error: unknown): void {
        const err = error as { status?: number };

        console.error(label, { status: err?.status, code: resolveZotpServerErrorCode(error) || undefined });
    }

    private _limitContext(): PlanLimitPurchaseContext {
        return {
            hasMasterPassword: this.hasMasterPassword,
            masterPassword: normalizeWalletMasterPassword(this.form.get("masterPassword")?.value),
        };
    }

    /** Leave the camera, keep typed fields and the prepared ZOTP so Confirm scans again. */
    private _keepFormForRetry(): void {
        this.showBiometrics = false;
        this.loading = false;
    }

    canNavigateAwayHandler(canNavigate: boolean): void {
        // Handle navigation away from biometrics if needed
    }

    onCancel(): void {
        void this._router.navigate(["/zelf-authenticator"]);
    }
}
