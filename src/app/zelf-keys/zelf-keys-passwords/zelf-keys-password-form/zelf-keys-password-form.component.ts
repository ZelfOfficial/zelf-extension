import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, DestroyRef, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";

import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { AutofillDataService, AutofillUrlInfo } from "../../../services/autofill-data.service";
import { DataPassingService } from "../../../services/data-passing.service";
import { ZelfKeysPlanLimitCoordinator } from "../../plan-limits/zelf-keys-plan-limit.coordinator";
import { ZelfKeysPlanUsageComponent } from "../../plan-limits/zelf-keys-plan-usage.component";
import { PlanLimitPurchaseContext } from "../../plan-limits/zelf-keys-plan-limits.model";
import {
    BiometricResult,
    BiometricsBottomSheetComponent,
    BiometricsBottomSheetData,
} from "../../shared/biometrics-bottom-sheet/biometrics-bottom-sheet.component";
import { HttpWrapperService } from "app/http-wrapper.service";
import { PasswordGeneratorService, PasswordAlgorithm } from "../../../services/password-generator.service";
import { environment } from "../../../../environments/environment";

@Component({
    imports: [CommonModule, TranslocoModule, RouterModule, ReactiveFormsModule, ZelfKeysPlanUsageComponent],
    selector: "zelf-keys-password-form",
    styleUrls: ["./zelf-keys-password-form.component.scss"],
    templateUrl: "./zelf-keys-password-form.component.html",
})
export class PasswordFormComponent implements OnInit {
    currentAlgorithm: PasswordAlgorithm = "strong";
    formValid = false;
    hasMasterPassword = false;
    isNewPassword = true;
    passwordForm!: FormGroup;
    shareables: any;
    showMasterPassword = false;
    showPassword = false;
    showPasswordGenerator = false;
    transformedPasswordData: any = null;
    view?: string;
    wallet!: TagModel;

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _autofillDataService: AutofillDataService,
        private _bottomSheet: MatBottomSheet,
        private _changeDetectorRef: ChangeDetectorRef,
        private _dataPassingService: DataPassingService,
        private _destroyRef: DestroyRef,
        private _formBuilder: FormBuilder,
        private _httpWrapperService: HttpWrapperService,
        private _passwordGeneratorService: PasswordGeneratorService,
        private _planLimits: ZelfKeysPlanLimitCoordinator,
        private _router: Router,
        private _walletService: WalletService
    ) {
        this.view = this._activatedRoute.snapshot.queryParamMap.get("view") || "home";

        this.shareables = {
            selectedTab: "assets",
            view: this.view,
            wallet: {},
        };

        this._initializeForm();
        this._setupAutofillSubscription();
    }

    async ngOnInit(): Promise<void> {
        const id = this._activatedRoute.snapshot.paramMap.get("id");

        this.isNewPassword = id === "new";

        await this._setWallet();

        this.checkFormValidity();
    }

    private _initializeForm(): void {
        const useSampleDefaults = !environment.production;

        this.passwordForm = this._formBuilder.group({
            alias: [""],
            email: [useSampleDefaults ? "a@a.com" : "", [Validators.required]],
            folder: [""],
            masterPassword: [""],
            insideFolder: [false],
            password: [useSampleDefaults ? "password_field" : "", [Validators.required]],
            url: [useSampleDefaults ? "https://www.google.com" : "", [Validators.required]],
        });

        this.passwordForm.valueChanges.subscribe(() => {
            this.checkFormValidity();
        });
    }

    private async _setWallet(): Promise<any> {
        const wallet = await this._walletService.getFirstWalletFromStorage();

        if (!wallet?.name) {
            this._router.navigate(["/welcome-zelfid"]);

            return;
        }

        this.shareables.wallet = wallet;
        this.wallet = wallet as TagModel;
        this.hasMasterPassword = wallet.hasPassword || false;

        this._changeDetectorRef.detectChanges();

        this.checkFormValidity();
    }

    private _setupAutofillSubscription(): void {
        this._autofillDataService.urlInfo$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((urlInfo: AutofillUrlInfo | null) => {
            if (!urlInfo) return;

            this._populateFormFromAutofill(urlInfo);

            this._autofillDataService.clearUrlInfo();
        });
    }

    private _populateFormFromAutofill(urlInfo: AutofillUrlInfo): void {
        this.passwordForm.patchValue({
            url: urlInfo.href,
        });

        if (this.wallet) this._changeDetectorRef.detectChanges();

        this.checkFormValidity();
    }

    private _onBiometricsSuccess(): void {
        this._router.navigate(["/zelf-keys/passwords/result"]);
    }

    private _limitContext(): PlanLimitPurchaseContext {
        return {
            hasMasterPassword: this.hasMasterPassword,
            masterPassword: this.passwordForm.get("masterPassword")?.value || "",
        };
    }

    private _openBiometricsBottomSheet(): void {
        const data: BiometricsBottomSheetData = {
            itemData: this.transformedPasswordData,
            itemType: "password",
            mode: "encrypt",
        };

        const bottomSheetRef = this._bottomSheet.open(BiometricsBottomSheetComponent, {
            data,
            backdropClass: "zelf-backdrop",
            panelClass: "zelf-bottom-sheet-biometrics",
        });

        bottomSheetRef.afterDismissed().subscribe((result: (BiometricResult & { planLimitReached?: unknown }) | undefined) => {
            if (result?.planLimitReached) {
                void this._recoverFromPlanLimit(result.planLimitReached);

                return;
            }

            if (!result) return;

            this._onBiometricsSuccess();
        });
    }

    togglePasswordVisibility(): void {
        this.showPassword = !this.showPassword;
    }

    toggleMasterPasswordVisibility(): void {
        this.showMasterPassword = !this.showMasterPassword;
    }

    toggleFolder(): void {
        const currentValue = this.passwordForm.get("insideFolder")?.value;

        this.passwordForm.patchValue({ insideFolder: !currentValue });
    }

    generatePassword(): void {
        const password = this._passwordGeneratorService.generatePassword({
            algorithm: this.currentAlgorithm,
        });

        this.passwordForm.patchValue({ password });
        this.checkFormValidity();
    }

    regeneratePassword(): void {
        this.generatePassword();
    }

    switchAlgorithm(algorithm: PasswordAlgorithm): void {
        this.currentAlgorithm = algorithm;
        this.generatePassword();
    }

    getAvailableAlgorithms(): PasswordAlgorithm[] {
        return this._passwordGeneratorService.getAvailableAlgorithms();
    }

    getAlgorithmName(algorithm: PasswordAlgorithm): string {
        return this._passwordGeneratorService.getAlgorithmName(algorithm);
    }

    getAlgorithmDescription(algorithm: PasswordAlgorithm): string {
        return this._passwordGeneratorService.getAlgorithmDescription(algorithm);
    }

    togglePasswordGenerator(): void {
        this.showPasswordGenerator = !this.showPasswordGenerator;
    }

    checkFormValidity(): void {
        const formValue = this.passwordForm.value;
        const hasUrl = !!formValue.url;
        const hasEmail = !!formValue.email;
        const hasPassword = !!formValue.password;
        const hasMasterPassword = !!formValue.masterPassword;

        // Master password is only required if the wallet has a password
        const masterPasswordValid = this.hasMasterPassword ? hasMasterPassword : true;

        this.formValid = !!(hasUrl && hasEmail && hasPassword && masterPasswordValid);
    }

    onCancel(): void {
        this._router.navigate(["/zelf-keys/vault"]);
    }

    async onSave(): Promise<void> {
        if (!this.formValid) return;

        const allowed = await this._planLimits.ensureCanAdd("password", this._limitContext());

        if (!allowed) return;

        await this._storePreparedPassword();
    }

    private async _recoverFromPlanLimit(error: unknown): Promise<void> {
        const outcome = await this._planLimits.recoverFromSaveError(error, "password", this._limitContext());

        if (outcome === "retry") this._openBiometricsBottomSheet();
    }

    private async _storePreparedPassword(): Promise<void> {
        const formValue = this.passwordForm.value;

        this.transformedPasswordData = {
            alias: formValue.alias?.trim() || "",
            email: formValue.email,
            folder: formValue.folder,
            insideFolder: formValue.insideFolder,
            masterPassword: await this._httpWrapperService.encryptMessage(formValue.masterPassword),
            password: await this._httpWrapperService.encryptMessage(formValue.password),
            type: "passwords",
            url: formValue.url,
        };

        await this._dataPassingService.storeData("passwords", this.transformedPasswordData);

        this._openBiometricsBottomSheet();
    }
}
