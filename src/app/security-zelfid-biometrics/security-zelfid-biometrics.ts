import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { Subject, takeUntil } from "rxjs";

import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, UntypedFormGroup } from "@angular/forms";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { MatButtonModule } from "@angular/material/button";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";

import { ChromeService } from "app/chrome.service";
import { HttpWrapperService } from "app/http-wrapper.service";
import { ReserveDoneSheetComponent } from "app/reserve-done-sheet/reserve-done-sheet.component";
import { ErrorService } from "app/services/error.service";
import { FaceApiService } from "app/services/face-api/face-api.service";
import {
    extractFaceClientMessage,
    FaceLockedError,
    isFaceLockedError,
    isFaceReplayDetectedError,
    parseRetryAfterSeconds,
} from "app/services/face-api/face-api.errors";
import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { FACE_ONLY_PASSPHRASE } from "app/core/security/signing-gate.util";
import { TagFlow, TagModel } from "app/tags.service";
import { ZelfIdsService } from "app/zelf-ids.service";
import { VaultService } from "app/vault.service";
import { WalletService } from "app/wallet.service";
import { WelcomeErrorComponent } from "app/welcome-error/welcome-error.component";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { syncDevFaceBypassFromQueryParams } from "app/utils/dev-biometrics-bypass.util";
import { BiometricsGeneralComponent } from "../biometrics-general/biometrics.component";

@Component({
    imports: [
        BiometricsGeneralComponent,
        CommonModule,
        MatButtonModule,
        ReactiveFormsModule,
        RouterModule,
        TranslocoModule,
        WelcomeErrorComponent,
        ZelfLoaderComponent,
    ],
    selector: "security-zelfid-biometrics",
    styleUrls: ["./security-zelfid-biometrics.scss"],
    templateUrl: "./security-zelfid-biometrics.html",
})
export class SecurityZelfidBiometricsComponent implements OnInit, OnDestroy {
    private unsubscriber$: Subject<void> = new Subject<void>();
    private _canNavigate: boolean = true;

    errorMessage: string = "";
    errorTitle: string = "";
    flow: TagFlow = "";
    form!: UntypedFormGroup;
    isNew: boolean = false;
    loading: boolean = true;
    apiLoading: boolean = false;
    apiSuccess: boolean = false;
    newTagName: string = "";
    returnState: string = "";
    showBiometrics: boolean = true;
    tagObject: TagModel = new TagModel();
    zelfProof: string = "";
    facePowVerifying = false;
    faceLockCountdown = 0;
    captureNotice = "";

    private _faceLockTimer?: ReturnType<typeof setInterval>;

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _bottomSheet: MatBottomSheet,
        private _chromeService: ChromeService,
        private _errorService: ErrorService,
        private _formBuilder: FormBuilder,
        private _httpWrapperService: HttpWrapperService,
        private _router: Router,
        private _zelfIdsService: ZelfIdsService,
        private _translocoService: TranslocoService,
        private _vaultService: VaultService,
        private _walletService: WalletService,
        private _faceApi: FaceApiService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _signingAuthorization: SigningAuthorizationService
    ) {
        this.form = this._formBuilder.group({
            hideBiometricsCheckbox: [false],
        });

        syncDevFaceBypassFromQueryParams(this._activatedRoute.snapshot.queryParams);

        this._activatedRoute.snapshot.queryParams?.return && (this.returnState = this._activatedRoute.snapshot.queryParams.return);

        this._activatedRoute.queryParams.pipe(takeUntil(this.unsubscriber$)).subscribe(async (params) => {
            syncDevFaceBypassFromQueryParams(params);
            params?.return && (this.returnState = params.return);
        });
    }

    async ngOnInit(): Promise<void> {
        let savedFlow = await this._zelfIdsService.getFlow();

        if (!savedFlow) {
            const { wallet, wallets } = await this._walletService.getAllWalletsFromStorage();
            savedFlow = !!wallet?.name || wallets?.length ? "unlock" : "create";
        }

        this.flow = savedFlow;

        this.newTagName = await this._zelfIdsService.getNewTagName();

        this.showBiometrics = (await this._chromeService.getItem("hideBiometricsMessage")) || false;

        this.zelfProof = await this._zelfIdsService.getZelfProof();

        const tagObject = await this._zelfIdsService.getTagNameObject();

        if (tagObject) this.tagObject = new TagModel(tagObject);

        // Same rule as the password step: recover unlocks the old proof.
        this.isNew = this.flow === "create" || this.flow === "import";

        this.loading = false;

        this._faceApi.verifying$.pipe(takeUntil(this.unsubscriber$)).subscribe((verifying) => {
            this.facePowVerifying = verifying;
            this._changeDetectorRef.markForCheck();
        });
    }

    ngOnDestroy(): void {
        this._clearFaceLockTimer();
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    private async _showSuccessAndContinue(callback: () => Promise<void> | void): Promise<void> {
        this.apiLoading = false;
        this.apiSuccess = true;

        await new Promise((resolve) => setTimeout(resolve, 1200));

        await callback();
    }

    get apiLoadingTextKey(): string {
        if (this.facePowVerifying || this._faceApi.verifying) {
            return "security.face_verifying";
        }

        switch (this.flow) {
            case "create":
                return "security.creating_wallet";
            case "import":
                return "security.importing_wallet";
            case "recover":
                return "security.recovering_wallet";
            default:
                return "security.retrieving_vault";
        }
    }

    get apiSuccessTextKey(): string {
        switch (this.flow) {
            case "create":
            case "import":
            case "recover":
                return "security.wallet_created";
            default:
                return "security.vault_unlocked";
        }
    }

    async _createTag(payload: any): Promise<void> {
        const mnemonicCount = (await this._zelfIdsService.getMnemonicCount()) || 12;

        this._zelfIdsService
            .leaseTag({
                ...payload,
                type: "create",
                wordsCount: mnemonicCount,
            })
            .then(async (response) => {
                const tagObject = response.data?.tagObject;
                const pgp = response.data?.pgp;

                await this._chromeService.removeItem("zelfIdFlow");
                await this._chromeService.removeItem("newZelfIdName");

                const newWallet = new TagModel({ ...tagObject, pgp });
                await this._walletService.switchWallet(newWallet);
                await this._showSuccessAndContinue(() => this._redirect());
            })
            .catch(this.onBiometricsFailed);
    }

    private async _decryptTag(payload: any): Promise<void> {
        const zelfProof = await this._zelfIdsService.getZelfProof();
        const userFingerprint = this._walletService.getUserFingerprint();
        const usedRealPassword = Boolean(this._vaultService.password && this._vaultService.password !== FACE_ONLY_PASSPHRASE);

        this._zelfIdsService
            .decryptTag({
                ...payload,
                zelfProof,
                identifier: userFingerprint.hash,
            })
            .then(async (response) => {
                // Older APIs answer 200 { available: true } for a name that doesn't exist; never store that as a wallet.
                if (!response?.data || response.data.available) {
                    this.onBiometricsFailed({ status: 404, error: { message: "tag_not_found", code: "NotFound" } });
                    return;
                }

                await this._chromeService.removeItem("zelfIdFlow");
                await this._chromeService.removeItem("newZelfIdName");

                const currentWallet = await this._walletService.getCurrentWallet?.();
                const newWallet = new TagModel(response.data);

                if (usedRealPassword || currentWallet?.publicData?.hasPassword === "true") {
                    newWallet.updatePublicData({ hasPassword: "true" });
                    newWallet.hasPassword = true;
                }

                await this._walletService.switchWallet(newWallet);

                // #88: only a face decrypt that succeeded on this screen, started from a signing screen, approves it.
                if (this._isSigningReturn()) this._signingAuthorization?.approvePending();
                else this._signingAuthorization?.revoke();

                await this._showSuccessAndContinue(() => this._redirect());
            })
            .catch(this.onBiometricsFailed);
    }

    private async _importTag(payload: any): Promise<void> {
        this._zelfIdsService
            .leaseTag({
                ...payload,
                mnemonic: await this._httpWrapperService.encryptMessage(this._vaultService.mnemonic),
                type: "import",
            })
            .then(async (response) => {
                this._vaultService.mnemonic = "";

                const tagObject = response.data?.tagObject;
                const pgp = response.data?.pgp;

                await this._chromeService.removeItem("zelfIdFlow");
                await this._chromeService.removeItem("newZelfIdName");

                const newWallet = new TagModel({ ...tagObject, pgp });
                await this._walletService.switchWallet(newWallet);
                await this._showSuccessAndContinue(() => this._redirect());
            })
            .catch(this.onBiometricsFailed);
    }

    private async _tagLeaseRecovery(payload: any): Promise<void> {
        this._zelfIdsService
            .leaseRecovery({
                ...payload,
                zelfProof: this.zelfProof,
                newTagName: this.newTagName,
            })
            .then(async (response) => {
                const tagObject = response.data?.tagObject;
                const pgp = response.data?.pgp;

                await this._chromeService.removeItem("zelfIdFlow");
                await this._chromeService.removeItem("zelfIdName");
                await this._chromeService.removeItem("newZelfIdName");

                const newWallet = new TagModel({ ...tagObject, pgp });
                await this._walletService.switchWallet(newWallet);
                await this._showSuccessAndContinue(() => {
                    this._bottomSheet.open(ReserveDoneSheetComponent, {
                        backdropClass: "zelf-backdrop",
                        panelClass: "zelf-bottom-sheet",
                        data: { zelfName: newWallet.fullTagName, domain: newWallet.domain },
                    });
                });
            })
            .catch(this.onBiometricsFailed);
    }

    /** #88: screens whose pending signature this face step may approve (one-time, per request). */
    private _isSigningReturn(): boolean {
        return ["/send/confirmation", "/swap", "/dapp/sign"].includes((this.returnState || "").split("?")[0]);
    }

    private async _healWalletRequiresPassword(): Promise<void> {
        try {
            const wallet = (await this._walletService.getCurrentWallet?.()) as TagModel | null;
            if (wallet && wallet.publicData) {
                wallet.updatePublicData({ hasPassword: "true" });
                wallet.hasPassword = true;
                await this._walletService.updateWallet?.(wallet);
            }
        } catch {
            // Non-blocking heal
        }
    }

    private async _redirect(): Promise<void> {
        if (this.returnState) {
            let cleanReturn = this.returnState;
            if (cleanReturn.includes("?")) {
                cleanReturn = cleanReturn.split("?")[0];
            }

            const left = await this._router.navigate([cleanReturn], { replaceUrl: true });

            if (!left) {
                await this._router.navigate(["/home"], { replaceUrl: true });
            }

            return;
        }

        const left = await this._router.navigate(["/welcome-zelfid/complete"]);

        if (!left) {
            await this._router.navigate(["/home"], { replaceUrl: true });
        }
    }

    canNavigateAway(): boolean {
        return this.apiSuccess || this._canNavigate;
    }

    canNavigateAwayHandler(canNavigate: boolean = false): void {
        this._canNavigate = canNavigate;
    }

    goBack(): void {
        this._canNavigate = true;
        this._signingAuthorization?.revoke();
        this.errorTitle = "";
        this.errorMessage = "";

        if (this._vaultService.securityType !== "withoutPassword") {
            this._vaultService.password = "";
        }

        if (this.returnState) {
            let cleanReturn = this.returnState;
            if (cleanReturn.includes("?")) {
                cleanReturn = cleanReturn.split("?")[0];
            }
            this._router.navigate([cleanReturn]);
        } else this._router.navigate(["/security-zelfid/password"]);
    }

    onBiometricsFailed = (exception: any): void => {
        this._signingAuthorization?.revoke();
        this.apiLoading = false;
        this.apiSuccess = false;

        if (exception instanceof FaceLockedError || isFaceLockedError(exception)) {
            const retryAfter =
                exception instanceof FaceLockedError ? exception.retryAfterSeconds : parseRetryAfterSeconds(exception);
            this._startFaceLockCountdown(retryAfter);
            return;
        }

        if (isFaceReplayDetectedError(exception)) {
            this._returnToFaceCapture(this._errorService.translateFaceReplay(extractFaceClientMessage(exception)));
            return;
        }

        const errorKey = this._errorService.resolveErrorKey(exception);

        if (errorKey === "face_locked") {
            this._startFaceLockCountdown(parseRetryAfterSeconds(exception));
            return;
        }

        if (this._errorService.isLivenessError(errorKey)) {
            this.errorTitle = this._translocoService.translate("errors.liveness_failed");
            this.errorMessage = this._translocoService.translate("errors.liveness_failed_help");
            return;
        }

        if (
            this._isSigningReturn() &&
            (errorKey === "ERR_PASSWORD_REQUIRED" ||
                errorKey === "ERR_INVALID_PASSWORD" ||
                errorKey === "incorrect_passphrase" ||
                errorKey === "ERR_MISSING_PASSWORD")
        ) {
            if (this._vaultService.securityType === "withoutPassword") {
                this._vaultService.securityType = "password";
            }
            void this._healWalletRequiresPassword();
            this.goBack();
            return;
        }

        this.errorTitle = this._translocoService.translate("errors.generic_title");
        this.errorMessage = this._errorService.translateErrorMessage(errorKey, "errors.generic_identity");
    };

    onBiometricsScanned = async (encryptedImage: string): Promise<void> => {
        this.captureNotice = "";
        this.apiLoading = true;
        this.apiSuccess = false;

        const referralTagName = await this._zelfIdsService.getReferral();

        const domain = await this._zelfIdsService.getDomain();

        const tagName =
            this.flow === "create" || this.flow === "import" ? await this._zelfIdsService.getNewTagName() : await this._zelfIdsService.getTagName();

        const payload: any = {
            faceBase64: encryptedImage,
            os: "DESKTOP",
            password: await this._httpWrapperService.encryptMessage(this._vaultService.password),
            referralTagName,
            domain,
            tagName,
        };

        if (this.flow === "create") {
            this._createTag(payload);
        } else if (this.flow === "import") {
            this._importTag(payload);
        } else if (this.flow === "recover") {
            this._tagLeaseRecovery(payload);
        } else {
            this._decryptTag(payload);
        }
    };

    async startBiometrics(): Promise<void> {
        this._chromeService.setItem("hideBiometricsMessage", this.form.controls.hideBiometricsCheckbox.value);

        this.showBiometrics = true;
    }

    private _startFaceLockCountdown(retryAfterSeconds: number): void {
        this._clearFaceLockTimer();
        this.faceLockCountdown = Math.max(0, Math.floor(retryAfterSeconds));
        this._applyFaceLockMessage();
        if (this.faceLockCountdown <= 0) return;

        this._faceLockTimer = setInterval(() => {
            this.faceLockCountdown = Math.max(0, this.faceLockCountdown - 1);
            this._applyFaceLockMessage();
            if (this.faceLockCountdown <= 0) {
                this._clearFaceLockTimer();
            }
        }, 1000);
    }

    private _applyFaceLockMessage(): void {
        const { title, message } = this._errorService.translateFaceLocked(this.faceLockCountdown);
        this.errorTitle = title;
        this.errorMessage = message;
    }

    private _clearFaceLockTimer(): void {
        if (this._faceLockTimer) {
            clearInterval(this._faceLockTimer);
            this._faceLockTimer = undefined;
        }
    }

    private _returnToFaceCapture(message: string): void {
        this.apiLoading = false;
        this.apiSuccess = false;
        this.errorTitle = "";
        this.errorMessage = "";
        this.captureNotice = message;
        this.showBiometrics = true;
        this._changeDetectorRef.markForCheck();
    }
}
