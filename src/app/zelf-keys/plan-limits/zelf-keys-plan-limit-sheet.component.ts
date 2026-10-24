import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, Inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import {
    PlanLimitPurchaseResult,
    ZelfKeysSlotKind,
} from "./zelf-keys-plan-limits.model";
import { createSlotIdempotencyKey, formatZns, slotAffordability, slotsNeededToAdd, translatedPlanName } from "./zelf-keys-plan-limits.util";

export interface PlanLimitSheetData {
    kind: ZelfKeysSlotKind;
    plan: string;
    used: number;
    limit: number;
    /** ZNS for a single extra slot. */
    tokenCost: number;
    tokenBalance: number | null;
    balanceAvailable: boolean;
    hasMasterPassword: boolean;
    masterPassword: string;
    purchase: (input: { masterPassword: string; idempotencyKey: string }) => Promise<PlanLimitPurchaseResult>;
}

export interface PlanLimitSheetResult {
    purchased?: boolean;
    upgrade?: boolean;
}

@Component({
    imports: [CommonModule, FormsModule, TranslocoModule],
    selector: "zelf-keys-plan-limit-sheet",
    styleUrls: ["./zelf-keys-plan-limit-sheet.component.scss"],
    templateUrl: "./zelf-keys-plan-limit-sheet.component.html",
})
export class ZelfKeysPlanLimitSheetComponent {
    balanceAvailable: boolean;
    busy = false;
    completed = 0;
    kind: ZelfKeysSlotKind;
    limit: number;
    message = "";
    password = "";
    plan: string;
    showPassword: boolean;
    showPasswordField = false;
    tokenBalance: number | null;
    tokenCost: number;
    used: number;

    readonly idempotencyKey = createSlotIdempotencyKey();

    constructor(
        @Inject(MAT_DIALOG_DATA) public data: PlanLimitSheetData,
        private _changeDetectorRef: ChangeDetectorRef,
        private _dialogRef: MatDialogRef<ZelfKeysPlanLimitSheetComponent, PlanLimitSheetResult>,
        private _transloco: TranslocoService
    ) {
        this.kind = data.kind;
        this.plan = data.plan;
        this.used = data.used ?? data.limit;
        this.limit = data.limit;
        this.tokenCost = data.tokenCost;
        this.tokenBalance = data.tokenBalance;
        this.balanceAvailable = data.balanceAvailable;
        this.password = data.masterPassword || "";
        this.showPassword = data.hasMasterPassword && !data.masterPassword?.trim();
    }

    get slotsNeeded(): number {
        return slotsNeededToAdd(this.used, this.limit);
    }

    get overCap(): boolean {
        return this.limit != null && this.used > this.limit;
    }

    get totalCost(): number {
        return this.tokenCost * this.slotsNeeded;
    }

    get title(): string {
        const plan = translatedPlanName(this.plan, (key) => this._transloco.translate(key));
        const over = this.overCap;
        const key = over
            ? this.kind === "password"
                ? "zelf_keys.plan_limits.sheet.title_over_passwords"
                : "zelf_keys.plan_limits.sheet.title_over_zotp"
            : this.kind === "password"
              ? "zelf_keys.plan_limits.sheet.title_passwords"
              : "zelf_keys.plan_limits.sheet.title_zotp";

        return this._transloco.translate(key, { limit: this.limit, used: this.used, plan });
    }

    get balanceText(): string {
        return formatZns(this.tokenBalance);
    }

    get costText(): string {
        return formatZns(this.totalCost);
    }

    get showBalance(): boolean {
        return this.balanceAvailable && this.tokenBalance != null;
    }

    get lowBalance(): boolean {
        return slotAffordability(this.affordabilityInput) === "low_balance";
    }

    get buyDisabled(): boolean {
        return this.busy || this.lowBalance;
    }

    close(): void {
        if (this.busy) return;

        this._dialogRef.close();
    }

    upgrade(): void {
        if (this.busy) return;

        this._dialogRef.close({ upgrade: true });
    }

    async buy(): Promise<void> {
        if (this.buyDisabled) return;

        const masterPassword = this.password.trim();

        if (this.data.hasMasterPassword && !masterPassword) {
            this.message = this._transloco.translate("zelf_keys.plan_limits.sheet.password_required");
            this._changeDetectorRef.detectChanges();

            return;
        }

        this.busy = true;
        this.message = "";
        this._changeDetectorRef.detectChanges();

        let closed = false;
        const start = this.completed;
        const end = start + this.slotsNeeded;

        try {
            for (let index = start; index < end; index++) {
                const result = await this.data.purchase({
                    masterPassword,
                    idempotencyKey: `${this.idempotencyKey}-${index}`,
                });

                if (result.ok) {
                    this.completed += 1;
                    this.limit += 1;
                    continue;
                }

                if (result.reason === "cancelled") {
                    if (this.completed > 0) this.message = this._progressMessage();

                    return;
                }

                if (result.reason === "password_required") {
                    this.message = this._transloco.translate("zelf_keys.plan_limits.sheet.password_required");

                    return;
                }

                if (result.reason === "insufficient") {
                    this.balanceAvailable = true;
                    this.tokenBalance = result.balance;
                    this.message =
                        this.completed > 0
                            ? this._progressMessage()
                            : this._transloco.translate("zelf_keys.plan_limits.sheet.insufficient");

                    return;
                }

                this.message =
                    (result.reason === "error" ? result.message : "") ||
                    (this.completed > 0
                        ? this._progressMessage()
                        : this._transloco.translate("zelf_keys.plan_limits.sheet.purchase_failed"));

                return;
            }

            closed = true;
            this._dialogRef.close({ purchased: true });
        } finally {
            if (!closed) {
                this.busy = false;
                this._changeDetectorRef.detectChanges();
            }
        }
    }

    private _progressMessage(): string {
        return this._transloco.translate("zelf_keys.plan_limits.sheet.partial", { count: this.completed });
    }

    private get affordabilityInput(): { tokenCost: number; tokenBalance: number | null; balanceAvailable: boolean } {
        return {
            tokenCost: this.totalCost,
            tokenBalance: this.tokenBalance,
            balanceAvailable: this.balanceAvailable,
        };
    }
}
