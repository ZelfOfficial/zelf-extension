import { Injectable } from "@angular/core";
import { MatBottomSheet } from "@angular/material/bottom-sheet";
import { MatDialog } from "@angular/material/dialog";
import { Router } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { HttpWrapperService } from "app/http-wrapper.service";
import { ErrorService } from "app/services/error.service";
import { ZelfKeysService } from "app/services/zelf-keys.service";
import {
    BiometricsBottomSheetComponent,
    BiometricsBottomSheetData,
} from "../shared/biometrics-bottom-sheet/biometrics-bottom-sheet.component";
import { encryptWalletMasterPassword } from "app/zelf-authenticator/zotp-master-password.util";
import { PlanLimitSheetData, PlanLimitSheetResult, ZelfKeysPlanLimitSheetComponent } from "./zelf-keys-plan-limit-sheet.component";
import {
    PlanLimitPurchaseContext,
    PlanLimitPurchaseResult,
    PlanLimitRecoverOutcome,
    ZelfKeysLimits,
    ZelfKeysLimitsAvailability,
    ZelfKeysSlotKind,
} from "./zelf-keys-plan-limits.model";
import {
    insufficientTokensDetails,
    isInsufficientTokensError,
    isPlanLimitReachedError,
    limitsFromPlanError,
} from "./zelf-keys-plan-limits.util";

/**
 * Plan caps for new passwords and 2FA accounts.
 * A missing or unverified /limits response (401, 403, 404) leaves saves on the previous path.
 * A later 409 ERR_PLAN_LIMIT_REACHED still opens the slot sheet.
 */
@Injectable({
    providedIn: "root",
})
export class ZelfKeysPlanLimitCoordinator {
    private readonly _limits = new BehaviorSubject<ZelfKeysLimits | null>(null);
    private _request = 0;

    readonly limits$ = this._limits.asObservable();

    constructor(
        private _bottomSheet: MatBottomSheet,
        private _dialog: MatDialog,
        private _errors: ErrorService,
        private _http: HttpWrapperService,
        private _keys: ZelfKeysService,
        private _router: Router,
        private _transloco: TranslocoService
    ) {}

    get limits(): ZelfKeysLimits | null {
        return this._limits.value;
    }

    async refresh(): Promise<ZelfKeysLimitsAvailability> {
        const request = ++this._request;

        try {
            const result = await this._keys.getVaultLimits();

            if (request !== this._request) return this._limits.value ? "ok" : "error";

            if (result.status === "ok") {
                this._limits.next(result.limits);

                return "ok";
            }

            if (result.status === "unsupported") {
                this._limits.next(null);

                return "unsupported";
            }

            return "error";
        } catch {
            return "error";
        }
    }

    /**
     * @returns true when the caller should continue the save.
     * Unsupported or unread limits do not block the save.
     */
    async ensureCanAdd(kind: ZelfKeysSlotKind, context: PlanLimitPurchaseContext): Promise<boolean> {
        const availability = await this.refresh();

        if (availability !== "ok") return true;

        const usage = this._limits.value?.kinds[kind];

        if (!usage || usage.canAdd || usage.limit == null) return true;

        return (await this._prompt(kind, this._limits.value as ZelfKeysLimits, context)) === "retry";
    }

    /** After a save 409. `not-limit` means the caller should keep its existing error. */
    async recoverFromSaveError(error: unknown, kind: ZelfKeysSlotKind, context: PlanLimitPurchaseContext): Promise<PlanLimitRecoverOutcome> {
        if (!isPlanLimitReachedError(error)) return "not-limit";

        await this.refresh();

        const current = this._limits.value;
        const limits = current ?? limitsFromPlanError(error);

        if (!limits) return "not-limit";

        const usage = limits.kinds[kind];

        if (!usage || usage.limit == null) return "not-limit";

        if (current?.kinds[kind]?.canAdd) return "retry";

        return this._prompt(kind, limits, context);
    }

    /** Opens the sheet from a usage indicator that is already at the cap. */
    async openPurchaseSheet(kind: ZelfKeysSlotKind, context: PlanLimitPurchaseContext): Promise<boolean> {
        if (!this._limits.value) await this.refresh();

        const limits = this._limits.value;

        if (!limits) return false;

        const usage = limits.kinds[kind];

        if (!usage || usage.canAdd || usage.limit == null) return false;

        return (await this._prompt(kind, limits, context)) === "retry";
    }

    private async _prompt(
        kind: ZelfKeysSlotKind,
        limits: ZelfKeysLimits,
        context: PlanLimitPurchaseContext
    ): Promise<PlanLimitRecoverOutcome> {
        const usage = limits.kinds[kind];
        const data: PlanLimitSheetData = {
            kind,
            plan: limits.plan,
            limit: usage.limit ?? usage.used,
            tokenCost: usage.tokenCost,
            tokenBalance: limits.tokenBalance,
            balanceAvailable: limits.balanceAvailable,
            hasMasterPassword: context.hasMasterPassword,
            masterPassword: context.masterPassword?.trim() || "",
            purchase: (input) => this._purchase(kind, context, input),
        };

        const ref = this._dialog.open<ZelfKeysPlanLimitSheetComponent, PlanLimitSheetData, PlanLimitSheetResult>(
            ZelfKeysPlanLimitSheetComponent,
            {
                data,
                autoFocus: false,
                width: "100vw",
                maxWidth: "100vw",
                height: "100vh",
                maxHeight: "100vh",
                panelClass: "zelf-plan-limit-sheet",
                backdropClass: "zelf-plan-limit-backdrop",
            }
        );
        const closed = await firstValueFrom(ref.afterClosed());

        if (closed?.upgrade) {
            await this._router.navigate(["/zelf-keys/billing"]);

            return "dismissed";
        }

        return closed?.purchased ? "retry" : "dismissed";
    }

    private async _purchase(
        kind: ZelfKeysSlotKind,
        context: PlanLimitPurchaseContext,
        input: { masterPassword: string; idempotencyKey: string }
    ): Promise<PlanLimitPurchaseResult> {
        const masterPassword = input.masterPassword.trim();

        if (context.hasMasterPassword && !masterPassword) {
            return { ok: false, reason: "password_required" };
        }

        const face = await this._captureFace();

        if (!face?.faceBase64) return { ok: false, reason: "cancelled" };

        let encrypted: string | undefined;

        if (context.hasMasterPassword) {
            encrypted = await encryptWalletMasterPassword(this._http, masterPassword);

            if (!encrypted) return { ok: false, reason: "password_required" };
        }

        try {
            await this._keys.purchaseExtraSlot({
                kind,
                idempotencyKey: input.idempotencyKey,
                faceBase64: face.faceBase64,
                ...(encrypted ? { masterPassword: encrypted } : {}),
            });
            await this.refresh();

            return { ok: true };
        } catch (error) {
            if (isInsufficientTokensError(error)) {
                const details = insufficientTokensDetails(error);

                await this.refresh();

                const latest = this._limits.value;

                return {
                    ok: false,
                    reason: "insufficient",
                    balance: latest?.balanceAvailable ? latest.tokenBalance : details.balance,
                    cost: details.cost,
                };
            }

            return { ok: false, reason: "error", message: this._purchaseErrorMessage(error) };
        }
    }

    private _captureFace(): Promise<{ faceBase64?: string } | undefined> {
        const data: BiometricsBottomSheetData = {
            itemData: {
                title: this._transloco.translate("zelf_keys.plan_limits.sheet.face_title"),
                instructions: this._transloco.translate("zelf_keys.plan_limits.sheet.face_instructions"),
            },
            itemType: "password",
            mode: "capture",
        };
        const ref = this._bottomSheet.open(BiometricsBottomSheetComponent, {
            data,
            backdropClass: "zelf-backdrop",
            panelClass: "zelf-bottom-sheet-biometrics",
        });

        return firstValueFrom(ref.afterDismissed());
    }

    private _purchaseErrorMessage(error: unknown): string {
        const key = this._errors.resolveErrorKey(error);

        if (this._errors.isLivenessError(key)) {
            return this._transloco.translate("errors.liveness_failed_help");
        }

        return this._errors.translateErrorMessage(key, "zelf_keys.plan_limits.sheet.purchase_failed");
    }
}
