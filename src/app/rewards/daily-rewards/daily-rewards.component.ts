import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import { previewProofSecurity, type ProofPreview } from "app/onboarding-stack";
import { BiometricsGeneralComponent } from "app/biometrics-general/biometrics.component";
import { ZelfIdsService } from "app/zelf-ids.service";

import { RewardsService, WheelSegment, RouletteWheelResponse, DailyRewardResponse } from "../../services/rewards.service";
import { WalletService } from "../../wallet.service";
import { TagsService } from "../../tags.service";
import {
    dailyRewardErrorTranslationKey,
    DailyRewardClaimRequest,
    resolveDailyRewardErrorCode,
    resolveRequiresMasterPassword,
} from "../daily-reward-identity";

@Component({
    imports: [BiometricsGeneralComponent, CommonModule, FormsModule, MatButtonModule, RouterModule, TranslocoModule],
    selector: "daily-rewards",
    styleUrls: ["./daily-rewards.component.scss", "../../main.scss"],
    templateUrl: "./daily-rewards.component.html",
})
export class DailyRewardsComponent implements OnInit, OnDestroy {
    isLoading: boolean = true;
    isSpinning: boolean = false;
    hasSpunToday: boolean = false;
    isAccountActive: boolean = true;
    currentRotation: number = 0;
    wonAmount: number | null = null;
    errorMessage: string | null = null;
    nextClaimAvailable: string | null = null;
    verificationStep: "none" | "face" | "password" = "none";
    requiresMasterPassword = false;
    isPinUnlock = false;
    canRetryClaim = false;
    masterPassword = "";
    showMasterPassword = false;

    // Countdown timer
    countdownHours: number = 0;
    countdownMinutes: number = 0;
    countdownSeconds: number = 0;
    private countdownInterval: any = null;

    // Wheel configuration from backend
    segments: WheelSegment[] = [];
    tagType: "hold" | "mainnet" = "hold";

    // Current tag info
    private tagName: string = "";
    private domain: string = "zelf";
    /** Held only until the claim request finishes. Never logged or stored. */
    private _secrets: { faceBase64: string; masterPassword: string } = { faceBase64: "", masterPassword: "" };
    private _submitting = false;
    private _claimOutcome: "pending" | "already-claimed" | "failed" = "pending";
    private _finalizeInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        private _rewardsService: RewardsService,
        private _walletService: WalletService,
        private _tagsService: TagsService,
        private _zelfIdsService: ZelfIdsService,
        private _translocoService: TranslocoService,
        private _router: Router,
        private _changeDetectorRef: ChangeDetectorRef
    ) {}

    async ngOnInit(): Promise<void> {
        await this.loadWheelConfiguration();
    }

    ngOnDestroy(): void {
        this.stopCountdown();
        this.stopContinuousSpin();
        this._clearFinalizeInterval();
        this._wipeSecrets();
    }

    /**
     * Start countdown timer to next claim
     */
    private startCountdown(): void {
        if (!this.nextClaimAvailable) return;

        this.updateCountdown();
        this.countdownInterval = setInterval(() => {
            this.updateCountdown();
        }, 1000);
    }

    /**
     * Update countdown values
     */
    private updateCountdown(): void {
        if (!this.nextClaimAvailable) return;

        const now = new Date().getTime();
        const target = new Date(this.nextClaimAvailable).getTime();
        const diff = target - now;

        if (diff <= 0) {
            // Countdown finished - wait for backend to explicitly enable reward
            this.stopCountdown();
            this.countdownHours = 0;
            this.countdownMinutes = 0;
            this.countdownSeconds = 0;
            return;
        }

        this.countdownHours = Math.floor(diff / (1000 * 60 * 60));
        this.countdownMinutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        this.countdownSeconds = Math.floor((diff % (1000 * 60)) / 1000);
    }

    /**
     * Stop countdown timer
     */
    private stopCountdown(): void {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    }

    /**
     * Load the wheel configuration from the backend
     * This determines the segments based on the user's tag type (hold vs mainnet)
     */
    private async loadWheelConfiguration(): Promise<void> {
        this.isLoading = true;
        this.errorMessage = null;

        try {
            // Get current wallet to determine tag info
            const currentWallet = await this._walletService.getCurrentWallet();

            if (!currentWallet) {
                this.errorMessage = this._translocoService.translate("rewards.error.no_wallet");
                this.isLoading = false;
                return;
            }

            this.tagName = currentWallet.tagName || currentWallet.name || "";
            this.domain = currentWallet.publicData?.domain || (await this._tagsService.getDomain()) || "zelf";
            this.isPinUnlock = (currentWallet.publicData as { st?: string } | undefined)?.st === "pin";
            this.requiresMasterPassword = await resolveRequiresMasterPassword(
                currentWallet.publicData,
                currentWallet.zelfProof || (await this._tagsService.getZelfProof()),
                (proof) => this._previewPasswordLayer(proof)
            );

            // Pre-populate wheel segments immediately based on wallet type
            // This provides instant visual feedback while backend loads
            const walletType = currentWallet.publicData?.type || "hold";
            this.tagType = walletType === "mainnet" ? "mainnet" : "hold";
            this.segments = this._getSegmentsForType(this.tagType);

            // Fetch wheel configuration from backend (may update segments if different)
            const wheelConfig: RouletteWheelResponse = await this._rewardsService.getRouletteWheel(this.tagName, this.domain);

            if (!wheelConfig.success) {
                this.errorMessage = this._translocoService.translate("rewards.error.load_failed");
                this.isLoading = false;
                return;
            }

            // Update with backend data (in case it differs)
            this.tagType = wheelConfig.type;
            this.segments = this._rewardsService.convertToWheelSegments(wheelConfig.segments, wheelConfig.type);
            this.nextClaimAvailable = wheelConfig.nextClaimAvailable;
            this.isAccountActive = wheelConfig.isAccountActive !== false;

            if (!this.isAccountActive) {
                this.errorMessage = this._translocoService.translate("rewards.error.account_not_active", {
                    default: "Your Solana account is not activated yet. Please deposit some SOL to activate your wallet before spinning the wheel.",
                });
            } else if (wheelConfig.alreadyClaimedToday) {
                this.hasSpunToday = true;

                if (wheelConfig.todayReward) {
                    this.wonAmount = wheelConfig.todayReward.amount;
                }

                // Start countdown to next claim
                this.startCountdown();
            }

            this.isLoading = false;
        } catch (error: any) {
            console.error("Error loading wheel configuration:", error);

            // Handle 400 Bad Request which often means "Already Claimed" or business logic restriction
            // In this case, we show the claimed state instead of an error
            if (error.status === 400 || (error.error && error.error.statusCode === 400)) {
                this.hasSpunToday = true;
                this.errorMessage = null; // Clear error to show the claimed state

                // If we have a message from backend that looks like "already claimed",
                // we could be more specific, but generally 400 here means we can't spin
            } else {
                this.errorMessage = error.message || this._translocoService.translate("rewards.error.load_failed");
            }

            this.isLoading = false;
        }
    }

    /**
     * Get segments for a specific type (for pre-population)
     */
    private _getSegmentsForType(type: "hold" | "mainnet"): WheelSegment[] {
        if (type === "mainnet") {
            // Purchased domains: 2, 4, 6, ... 24
            return Array.from({ length: 12 }, (_, i) => ({
                value: (i + 1) * 2,
                label: ((i + 1) * 2).toString(),
                color: i === 0 ? "#FF8622" : "#FF5721",
            }));
        }
        // .hold domains: 1-12
        return Array.from({ length: 12 }, (_, i) => ({
            value: i + 1,
            label: (i + 1).toString(),
            color: i === 0 ? "#FF8622" : "#FF5721",
        }));
    }

    // Pending reward data from backend
    private pendingWinningIndex: number | null = null;
    private pendingWinningAmount: number | null = null;
    private pendingNextClaimAvailable: string | null = null;
    private backendResponseReceived: boolean = false;
    private spinStartTime: number = 0;

    /**
     * Start a claim. Face is captured first; password wallets then enter the Zelf ID secret.
     * The wheel animation starts only after that, once the claim request is sent.
     * If the Solana account is not active, redirect to the deposit page instead.
     */
    async spinWheel(): Promise<void> {
        if (!this.isAccountActive) {
            this._router.navigate(["/receive/qr/Solana"]);
            return;
        }

        if (this.isSpinning || this.hasSpunToday || this.verificationStep !== "none" || this._submitting) return;

        this.wonAmount = null;
        this.errorMessage = null;
        this.canRetryClaim = false;
        this._wipeSecrets();
        this.verificationStep = "face";
        this._changeDetectorRef.markForCheck();
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

        await this._submitClaim();
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
        await this._submitClaim();
    }

    cancelVerification(): void {
        this._wipeSecrets();
        this._submitting = false;
        this.verificationStep = "none";
        this.isSpinning = false;
        this.wonAmount = null;
        this.canRetryClaim = false;
        this._changeDetectorRef.markForCheck();
    }

    /**
     * Start continuous spinning animation while waiting for backend
     */
    private startContinuousSpin(): void {
        this.animationPhase = "spinning";

        // Add initial rotations to start the wheel spinning fast
        // This creates the visual effect of spinning while we wait for backend
        const initialRotations = 3;
        this.currentRotation += initialRotations * 360;

        // Keep adding rotations while waiting
        this.continuousSpinInterval = setInterval(() => {
            if (this.animationPhase === "spinning") {
                this.currentRotation += 360; // Add one full rotation per second
            }
        }, 1000);

        // Check periodically if backend has responded
        this.checkAndFinalizeSpintrue();
    }

    private continuousSpinInterval: any = null;

    /**
     * Face is already captured. Password wallets have also collected the Zelf ID secret.
     * The wheel starts only after that, and a rejected verification never lands a prize.
     */
    private async _submitClaim(): Promise<void> {
        if (this._submitting || this.isSpinning || this.hasSpunToday) return;

        const payload: DailyRewardClaimRequest = {
            tagName: this.tagName,
            domain: this.domain,
            faceBase64: this._secrets.faceBase64,
        };

        if (this.requiresMasterPassword && this._secrets.masterPassword) {
            payload.masterPassword = this._secrets.masterPassword;
        }

        this._wipeSecrets();

        if (!payload.faceBase64) {
            this.verificationStep = "none";
            this.canRetryClaim = true;
            this.errorMessage = this._translocoService.translate("rewards.error.identity_required");
            this._changeDetectorRef.markForCheck();
            return;
        }

        this._submitting = true;
        this.verificationStep = "none";
        this.isSpinning = true;
        this.wonAmount = null;
        this.errorMessage = null;
        this.canRetryClaim = false;
        this.backendResponseReceived = false;
        this.pendingWinningIndex = null;
        this.pendingWinningAmount = null;
        this.pendingNextClaimAvailable = null;
        this._claimOutcome = "pending";
        this.spinStartTime = Date.now();
        this._changeDetectorRef.markForCheck();

        this.startContinuousSpin();

        try {
            await this.fetchRewardFromBackend(payload);
        } finally {
            payload.faceBase64 = "";
            payload.masterPassword = undefined;
            this._submitting = false;
            this._changeDetectorRef.markForCheck();
        }
    }

    /**
     * Fetch the reward from the backend
     */
    private async fetchRewardFromBackend(payload: DailyRewardClaimRequest): Promise<void> {
        try {
            const response: DailyRewardResponse = await this._rewardsService.claimDailyReward(payload);

            if (!response.success) {
                this.backendResponseReceived = true;

                if (this._textSaysAlreadyClaimed(response?.message)) {
                    this._markAlreadyClaimed();
                    return;
                }

                this._claimOutcome = "failed";
                this.pendingWinningIndex = null;
                this.canRetryClaim = true;
                this.errorMessage = response.message || this._translocoService.translate("rewards.error.claim_failed");
                this._stopSpinWithoutReward();
                return;
            }

            // Store the winning data
            this.pendingWinningIndex = response.reward.winningIndex;
            this.pendingWinningAmount = response.reward.amount;
            this.pendingNextClaimAvailable = response.reward.nextClaimAvailable;
            this.backendResponseReceived = true;
        } catch (error: unknown) {
            const code = resolveDailyRewardErrorCode(error);
            console.error("Error claiming reward:", code || (error as { status?: number })?.status || "failed");
            this.backendResponseReceived = true;
            this.pendingWinningIndex = null;

            if (this._textSaysAlreadyClaimed(this._errorText(error))) {
                this._markAlreadyClaimed();
                return;
            }

            this._claimOutcome = "failed";
            this.canRetryClaim = true;

            if (code === "ERR_MISSING_PASSWORD" || code === "ERR_PASSWORD_REQUIRED") {
                this.requiresMasterPassword = true;
            }

            const key = dailyRewardErrorTranslationKey(code);
            this.errorMessage = key
                ? this._translocoService.translate(key)
                : this._translocoService.translate("rewards.error.spin_failed");
            this._stopSpinWithoutReward();
        }
    }

    /** A rejected claim never lands on a segment or counts as today's reward. */
    private _stopSpinWithoutReward(): void {
        this._clearFinalizeInterval();
        this.stopContinuousSpin();
        this.animationPhase = "idle";
        this.isSpinning = false;
        this.pendingWinningIndex = null;
        this.pendingWinningAmount = null;
    }

    /**
     * Check if backend responded and finalize the spin
     */
    private checkAndFinalizeSpintrue(): void {
        this._clearFinalizeInterval();
        this._finalizeInterval = setInterval(() => {
            const elapsedTime = Date.now() - this.spinStartTime;
            const minimumSpinTime = 2000; // Minimum 2 seconds of spinning before we can land

            if (this.backendResponseReceived && elapsedTime >= minimumSpinTime) {
                this._clearFinalizeInterval();
                this.stopContinuousSpin();

                if (this.pendingWinningIndex !== null && this.pendingWinningIndex >= 0) {
                    // Backend returned a valid winning index - land on it
                    this.landOnSegment(this.pendingWinningIndex, this.pendingWinningAmount!);
                } else {
                    // Error occurred - stop spinning without treating the day as claimed
                    this.animationPhase = "idle";
                    this.isSpinning = false;
                    if (this._claimOutcome === "already-claimed") {
                        this.hasSpunToday = true;
                    }
                    this._changeDetectorRef.markForCheck();
                }
            } else if (elapsedTime >= 10000) {
                // Timeout - backend took too long
                this._clearFinalizeInterval();
                this.stopContinuousSpin();
                this.animationPhase = "idle";
                this.isSpinning = false;
                this._claimOutcome = "failed";
                this.canRetryClaim = true;
                this.errorMessage = this._translocoService.translate("rewards.error.timeout");
                this._changeDetectorRef.markForCheck();
            }
        }, 100);
    }

    private _clearFinalizeInterval(): void {
        if (this._finalizeInterval) {
            clearInterval(this._finalizeInterval);
            this._finalizeInterval = null;
        }
    }

    /**
     * Stop the continuous spin interval
     */
    private stopContinuousSpin(): void {
        if (this.continuousSpinInterval) {
            clearInterval(this.continuousSpinInterval);
            this.continuousSpinInterval = null;
        }
    }

    /**
     * Land the wheel on the winning segment
     */
    private landOnSegment(winningIndex: number, winningAmount: number): void {
        // Switch to landing animation (smooth deceleration)
        this.animationPhase = "landing";

        const segmentAngle = 360 / this.segments.length;

        // Calculate the final rotation to land on the winning segment
        // Add more full rotations for dramatic effect, then land precisely
        const additionalRotations = 2 + Math.floor(Math.random() * 2);
        const extraRotation = 360 - winningIndex * segmentAngle - segmentAngle / 2;

        // Normalize current rotation to find where we are
        const currentAngle = this.currentRotation % 360;

        // Calculate how much more we need to rotate to land on the target
        let targetAngle = extraRotation;
        if (targetAngle < currentAngle) {
            targetAngle += 360;
        }
        const angleToTarget = targetAngle - currentAngle;

        // Use setTimeout to allow the animation phase change to take effect
        setTimeout(() => {
            this.currentRotation += additionalRotations * 360 + angleToTarget;
        }, 50);

        // After final spin animation completes (3 seconds for the landing)
        setTimeout(() => {
            this.animationPhase = "idle";
            this.isSpinning = false;
            this.hasSpunToday = true;
            this.wonAmount = winningAmount;

            // Set next claim time and start countdown
            if (this.pendingNextClaimAvailable) {
                this.nextClaimAvailable = this.pendingNextClaimAvailable;
                this.startCountdown();
            }
        }, 3100);
    }

    // Track animation phase: 'idle' | 'spinning' | 'landing'
    private animationPhase: "idle" | "spinning" | "landing" = "idle";

    get wheelStyle(): Record<string, string> {
        if (this.animationPhase === "spinning") {
            // Fast continuous spin while waiting for backend
            return {
                transform: `rotate(${this.currentRotation}deg)`,
                transition: "transform 1s linear",
            };
        } else if (this.animationPhase === "landing") {
            // Smooth deceleration when landing on final segment
            return {
                transform: `rotate(${this.currentRotation}deg)`,
                transition: "transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)",
            };
        }
        return {
            transform: `rotate(${this.currentRotation}deg)`,
            transition: "none",
        };
    }

    /**
     * Get fill (gradient URL) for a segment based on its value.
     * Higher values use more appealing gradients (golden/warm).
     */
    getSegmentFill(index: number): string {
        const tier = this.getSegmentTier(index);
        return `url(#segment-grad-${tier})`;
    }

    /**
     * Map segment value to a tier 0–3 (0 = lowest, 3 = highest / most appealing).
     */
    private getSegmentTier(index: number): number {
        const seg = this.segments[index];
        if (!seg) return 0;
        const v = seg.value;
        if (this.tagType === "hold") {
            // 1–12: tier 0 = 1–3, 1 = 4–6, 2 = 7–9, 3 = 10–12
            if (v <= 3) return 0;
            if (v <= 6) return 1;
            if (v <= 9) return 2;
            return 3;
        }
        // Mainnet 2–24: tier 0 = 2–8, 1 = 10–14, 2 = 16–20, 3 = 22–24
        if (v <= 8) return 0;
        if (v <= 14) return 1;
        if (v <= 20) return 2;
        return 3;
    }

    getSegmentPath(index: number): string {
        const centerX = 200;
        const centerY = 200;
        const radius = 190;
        const segmentAngle = 360 / this.segments.length;
        const startAngle = index * segmentAngle - 90;
        const endAngle = startAngle + segmentAngle;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = centerX + radius * Math.cos(startRad);
        const y1 = centerY + radius * Math.sin(startRad);
        const x2 = centerX + radius * Math.cos(endRad);
        const y2 = centerY + radius * Math.sin(endRad);

        const largeArc = segmentAngle > 180 ? 1 : 0;

        return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }

    getTextTransform(index: number): string {
        const segmentAngle = 360 / this.segments.length;
        const angle = index * segmentAngle + segmentAngle / 2 - 90;
        const radius = 130;
        const rad = (angle * Math.PI) / 180;
        const x = 200 + radius * Math.cos(rad);
        const y = 200 + radius * Math.sin(rad);
        return `translate(${x}, ${y}) rotate(${angle + 90})`;
    }

    getZnsTransform(index: number): string {
        const segmentAngle = 360 / this.segments.length;
        const angle = index * segmentAngle + segmentAngle / 2 - 90;
        const radius = 155;
        const rad = (angle * Math.PI) / 180;
        const x = 200 + radius * Math.cos(rad);
        const y = 200 + radius * Math.sin(rad);
        return `translate(${x}, ${y}) rotate(${angle + 90})`;
    }

    /**
     * Get the spin button text based on current state
     */
    get spinButtonText(): string {
        if (this.isLoading) return this._translocoService.translate("rewards.loading");
        if (!this.isAccountActive) return this._translocoService.translate("rewards.activate_account", { default: "Activate Account" });
        if (this.isSpinning) return this._translocoService.translate("rewards.spinning");
        if (this.hasSpunToday) return this._translocoService.translate("rewards.come_back_tomorrow");
        return this._translocoService.translate("rewards.spin_now");
    }

    /**
     * Check if the spin button should be disabled
     */
    get isSpinDisabled(): boolean {
        return this.isLoading || this.isSpinning || this.hasSpunToday || this.segments.length === 0 || this.verificationStep !== "none";
    }

    private async _previewPasswordLayer(zelfProof: string): Promise<ProofPreview | null> {
        return previewProofSecurity(
            zelfProof,
            (proof) => this._zelfIdsService.previewZelfProof({ zelfProof: proof, os: "DESKTOP" }),
            (proof) => this._tagsService.previewZelfProof({ zelfProof: proof, os: "DESKTOP" })
        );
    }

    private _markAlreadyClaimed(): void {
        this._claimOutcome = "already-claimed";
        this.pendingWinningIndex = null;
        this.canRetryClaim = false;
        this.hasSpunToday = true;
        this.errorMessage = this._translocoService.translate("rewards.error.already_claimed");
    }

    private _textSaysAlreadyClaimed(value: unknown): boolean {
        return typeof value === "string" && value.toLowerCase().includes("already claimed");
    }

    private _errorText(error: unknown): string {
        if (!error || typeof error !== "object") return "";

        const body = (error as { error?: unknown }).error;
        if (typeof body === "string") return body;
        if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
            return (body as { message: string }).message;
        }

        const message = (error as { message?: unknown }).message;
        return typeof message === "string" ? message : "";
    }

    private _wipeSecrets(): void {
        this._secrets.faceBase64 = "";
        this._secrets.masterPassword = "";
        this.masterPassword = "";
    }
}
