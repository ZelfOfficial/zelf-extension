import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterModule } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import { previewProofSecurity, type ProofPreview } from "app/onboarding-stack";
import { BiometricsGeneralComponent } from "app/biometrics-general/biometrics.component";
import { releaseAllCameraStreams } from "app/services/media-stream.service";
import { ZelfIdsService } from "app/zelf-ids.service";

import { WalletService } from "../../wallet.service";
import { RewardsService } from "../../services/rewards.service";
import { ChromeService } from "../../chrome.service";
import { HttpWrapperService } from "../../http-wrapper.service";
import { TagsService } from "../../tags.service";
import { VaultService } from "../../vault.service";
import { encryptWalletMasterPassword } from "../../zelf-authenticator/zotp-master-password.util";
import { resolveRequiresMasterPassword } from "../daily-reward-identity";
import {
    FIRST_TRANSACTION_ERROR_FALLBACK_KEY,
    FIRST_TRANSACTION_ERROR_KEYS,
    FirstTransactionClaimRequest,
    resolveFirstTransactionErrorCode,
    rewardUserFacingMessage,
} from "../first-transaction-identity";

type ComponentState = "loading" | "verify" | "success" | "not_eligible" | "already_claimed" | "error";

@Component({
    imports: [BiometricsGeneralComponent, CommonModule, FormsModule, MatButtonModule, RouterModule, TranslocoModule],
    selector: "app-first-transaction",
    styleUrls: ["./first-transaction.component.scss", "../../main.scss"],
    templateUrl: "./first-transaction.component.html",
})
export class FirstTransactionComponent implements OnInit, OnDestroy {
    state: ComponentState = "loading";
    tagName: string = "";
    domain: string = "";
    rewardAmount: number = 0;
    errorMessage: string = "";
    verificationStep: "none" | "face" | "password" = "none";
    requiresMasterPassword = false;
    isPinUnlock = false;
    masterPassword = "";
    showMasterPassword = false;
    confettiParticles: { x: number; delay: number; duration: number; color: string }[] = [];
    instructions = {
        action: "Send ZNS tokens",
        description: "Make your first ZNS token transaction to unlock this reward",
    };

    /** Held only until the claim request finishes. Never logged or stored. */
    private _secrets: { faceBase64: string; masterPassword: string } = { faceBase64: "", masterPassword: "" };
    private _submitting = false;

    constructor(
        private _router: Router,
        private _walletService: WalletService,
        private _rewardsService: RewardsService,
        private _chromeService: ChromeService,
        private _translocoService: TranslocoService,
        private _tagsService: TagsService,
        private _zelfIdsService: ZelfIdsService,
        private _vaultService: VaultService,
        private _httpWrapper: HttpWrapperService,
        private _changeDetectorRef: ChangeDetectorRef
    ) {}

    ngOnInit(): void {
        this._loadWalletAndCheck();
    }

    ngOnDestroy(): void {
        releaseAllCameraStreams();
        this._wipeSecrets();
    }

    private async _loadWalletAndCheck(): Promise<void> {
        this.state = "loading";
        this.verificationStep = "none";
        this.errorMessage = "";
        this._wipeSecrets();

        try {
            const cachedStatus = await this._chromeService.getItem("zns_first_transaction_status");
            if (cachedStatus && (cachedStatus.status === "success" || cachedStatus.status === "already_claimed")) {
                this.state = cachedStatus.status;
                this.rewardAmount = cachedStatus.amount || 0;
                if (this.state === "success") {
                    this._triggerConfetti();
                }
                return;
            }

            const wallet = await this._walletService.getCurrentWallet();

            if (!wallet) {
                this.errorMessage = this._translocoService.translate("rewards.first_transaction.error_no_wallet");
                this.state = "error";
                return;
            }

            if (wallet.fullTagName) {
                const lastDot = wallet.fullTagName.lastIndexOf(".");
                this.tagName = lastDot >= 0 ? wallet.fullTagName.slice(0, lastDot) : wallet.fullTagName;
                this.domain = lastDot >= 0 ? wallet.fullTagName.slice(lastDot + 1) : "";
            } else if (wallet.publicData?.tagName && wallet.publicData?.domain) {
                this.tagName = wallet.publicData.tagName;
                this.domain = wallet.publicData.domain;
            }

            if (!this.tagName || !this.domain) {
                this.errorMessage = this._translocoService.translate("rewards.first_transaction.error_invalid_config");
                this.state = "error";
                return;
            }

            this.isPinUnlock = (wallet.publicData as { st?: string } | undefined)?.st === "pin";
            this.requiresMasterPassword = await resolveRequiresMasterPassword(
                wallet.publicData,
                wallet.zelfProof || (await this._tagsService.getZelfProof()),
                (proof) => this._previewPasswordLayer(proof)
            );

            await this._checkAndClaim();
        } catch (error: unknown) {
            console.error("Error loading wallet:", this._errorLogLabel(error));
            this._showFailure(error);
        }
    }

    private async _checkAndClaim(): Promise<void> {
        try {
            const result = await this._rewardsService.claimFirstTransaction({
                tagName: this.tagName,
                domain: this.domain,
            });

            if (this._applyClaimResult(result)) return;

            const code = resolveFirstTransactionErrorCode({ error: { message: result?.message, code: result?.code } });
            if (code === "ERR_IDENTITY_VERIFICATION_REQUIRED") {
                this._beginFaceVerification();
                return;
            }

            this.errorMessage = this._messageFor(code);
            this.state = "error";
        } catch (error: unknown) {
            console.error("Error checking first transaction:", this._errorLogLabel(error));

            const errorData = (
                error as {
                    error?: {
                        alreadyClaimed?: boolean;
                        eligible?: boolean;
                        reward?: { amount?: number };
                        requirements?: { action: string; description: string };
                    };
                }
            )?.error;
            if (errorData?.alreadyClaimed) {
                this.rewardAmount = errorData.reward?.amount || 0;
                this.state = "already_claimed";
                return;
            }
            if (errorData?.eligible === false) {
                this.instructions = errorData.requirements || this.instructions;
                this.state = "not_eligible";
                return;
            }

            if (resolveFirstTransactionErrorCode(error) === "ERR_IDENTITY_VERIFICATION_REQUIRED") {
                this._beginFaceVerification();
                return;
            }

            this._showFailure(error);
        }
    }

    async onFaceCaptured(faceBase64: string): Promise<void> {
        if (this.verificationStep !== "face" || !faceBase64) return;

        this._secrets.faceBase64 = faceBase64;

        if (this.requiresMasterPassword) {
            this.masterPassword = "";
            this.showMasterPassword = false;
            this.verificationStep = "password";
            this._changeDetectorRef.markForCheck();
            return;
        }

        await this._submitVerifiedClaim();
    }

    async submitMasterPassword(): Promise<void> {
        if (this.verificationStep !== "password") return;

        const password = this.masterPassword.trim();
        this.masterPassword = "";
        this.showMasterPassword = false;

        if (!password) {
            this._changeDetectorRef.markForCheck();
            return;
        }

        this._secrets.masterPassword = password;
        await this._submitVerifiedClaim();
    }

    cancelVerification(): void {
        releaseAllCameraStreams();
        this._wipeSecrets();
        this._submitting = false;
        this.verificationStep = "none";
        this.state = "error";
        this.errorMessage = this._messageFor("ERR_IDENTITY_VERIFICATION_REQUIRED");
        this._changeDetectorRef.markForCheck();
    }

    /**
     * The probe request came back without a verified face. Ask for one, then retry.
     * The photo stays in memory only until that retry finishes.
     */
    private _beginFaceVerification(): void {
        this._wipeSecrets();
        this._submitting = false;
        this.errorMessage = "";
        this.masterPassword = "";
        this.showMasterPassword = false;
        this.verificationStep = "face";
        this.state = "verify";
        this._changeDetectorRef.markForCheck();
    }

    /**
     * Face is captured. Password wallets have also collected the Zelf ID secret.
     * Decrypt stamps the current session, then the same capture is sent with the reward request.
     */
    private async _submitVerifiedClaim(): Promise<void> {
        if (this._submitting) return;
        this._submitting = true;

        const payload: FirstTransactionClaimRequest = {
            tagName: this.tagName,
            domain: this.domain,
            faceBase64: this._secrets.faceBase64,
        };
        let plainPassword = "";

        if (this.requiresMasterPassword && this._secrets.masterPassword) {
            plainPassword = this._secrets.masterPassword;
            payload.masterPassword = plainPassword;
        }

        this._wipeSecrets();

        if (!payload.faceBase64) {
            this._submitting = false;
            this.cancelVerification();
            return;
        }

        this.verificationStep = "none";
        this.state = "loading";
        this.errorMessage = "";
        this._changeDetectorRef.markForCheck();

        let encryptedPassword = "";

        try {
            if (plainPassword) {
                encryptedPassword = (await encryptWalletMasterPassword(this._httpWrapper, plainPassword)) || "";
                plainPassword = "";
            }

            await this._tagsService.decryptTag({
                faceBase64: payload.faceBase64,
                tagName: this.tagName,
                domain: this.domain,
                os: "DESKTOP",
                ...(encryptedPassword ? { password: encryptedPassword } : {}),
            });

            try {
                await this._vaultService.setLastVerified();
            } catch {
                // The decrypt already stamped this session. Continue on the same token.
            }

            const result = await this._rewardsService.claimFirstTransaction(payload);
            if (!this._applyClaimResult(result)) {
                const code = resolveFirstTransactionErrorCode({ error: { message: result?.message, code: result?.code } });
                this._showFailure(code ? { error: { code, message: code } } : {});
            }
        } catch (error: unknown) {
            console.error("Error checking first transaction:", this._errorLogLabel(error));
            const code = resolveFirstTransactionErrorCode(error);
            if (code === "ERR_MISSING_PASSWORD" || code === "ERR_PASSWORD_REQUIRED") {
                this.requiresMasterPassword = true;
            }
            this._showFailure(error);
        } finally {
            plainPassword = "";
            encryptedPassword = "";
            payload.faceBase64 = "";
            payload.masterPassword = undefined;
            this._submitting = false;
            this._changeDetectorRef.markForCheck();
        }
    }

    /** @returns true when the screen already shows the claim outcome. */
    private _applyClaimResult(result: {
        success?: boolean;
        alreadyClaimed?: boolean;
        eligible?: boolean;
        reward?: { amount?: number };
        requirements?: { action: string; description: string };
        message?: string;
        code?: string;
    }): boolean {
        if (result?.success) {
            this.rewardAmount = result.reward?.amount || 0;
            this._triggerConfetti();
            this.state = "success";
            this.verificationStep = "none";
            void this._chromeService.setItem("zns_first_transaction_status", {
                status: "success",
                amount: this.rewardAmount,
            });
            return true;
        }

        if (result?.alreadyClaimed) {
            this.rewardAmount = result.reward?.amount || 0;
            this.state = "already_claimed";
            this.verificationStep = "none";
            void this._chromeService.setItem("zns_first_transaction_status", {
                status: "already_claimed",
                amount: this.rewardAmount,
            });
            return true;
        }

        if (result?.eligible === false) {
            this.instructions = result.requirements || this.instructions;
            this.state = "not_eligible";
            this.verificationStep = "none";
            return true;
        }

        return false;
    }

    private _showFailure(error: unknown): void {
        const code = typeof error === "string" ? error : resolveFirstTransactionErrorCode(error);
        this.verificationStep = "none";
        this.errorMessage = this._messageFor(code);
        this.state = "error";
        this._changeDetectorRef.markForCheck();
    }

    private _messageFor(code: string | null): string {
        return rewardUserFacingMessage(
            code,
            (key) => this._translocoService.translate(key),
            FIRST_TRANSACTION_ERROR_KEYS,
            FIRST_TRANSACTION_ERROR_FALLBACK_KEY
        );
    }

    private _errorLogLabel(error: unknown): string {
        return resolveFirstTransactionErrorCode(error) || String((error as { status?: number })?.status || "failed");
    }

    private async _previewPasswordLayer(zelfProof: string): Promise<ProofPreview | null> {
        return previewProofSecurity(
            zelfProof,
            (proof) => this._zelfIdsService.previewZelfProof({ zelfProof: proof, os: "DESKTOP" }),
            (proof) => this._tagsService.previewZelfProof({ zelfProof: proof, os: "DESKTOP" })
        );
    }

    private _wipeSecrets(): void {
        this._secrets.faceBase64 = "";
        this._secrets.masterPassword = "";
        this.masterPassword = "";
    }

    /** Generate confetti particles for celebration */
    private _triggerConfetti(): void {
        const colors = ["#ff6b35", "#ffb347", "#34c759", "#007aff", "#ff2d55", "#af52de", "#ffcc00"];
        this.confettiParticles = [];

        for (let i = 0; i < 60; i++) {
            this.confettiParticles.push({
                x: Math.random() * 100,
                delay: Math.random() * 0.8,
                duration: 2 + Math.random() * 2.5,
                color: colors[Math.floor(Math.random() * colors.length)],
            });
        }
    }

    /** Navigate to send page to make a transaction */
    goToSend(): void {
        this._router.navigate(["/send"]);
    }

    /** Navigate back to rewards */
    goBack(): void {
        this._router.navigate(["/rewards"]);
    }

    /** Retry the check */
    retry(): void {
        this._loadWalletAndCheck();
    }
}
