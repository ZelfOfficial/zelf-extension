import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, Inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import {
    PlanLimitPurchaseResult,
    ZelfKeysSlotKind,
} from "./zelf-keys-plan-limits.model";
import { createSlotIdempotencyKey, formatZns, slotAffordability, translatedPlanName } from "./zelf-keys-plan-limits.util";

export interface PlanLimitSheetData {
    kind: ZelfKeysSlotKind;
    plan: string;
    limit: number;
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
    kind: ZelfKeysSlotKind;
    limit: number;
    message = "";
    password = "";
    plan: string;
    showPassword: boolean;
    showPasswordField = false;
    tokenBalance: number | null;
    tokenCost: number;

    readonly idempotencyKey = createSlotIdempotencyKey();

    constructor(
        @Inject(MAT_DIALOG_DATA) public data: PlanLimitSheetData,
        private _changeDetectorRef: ChangeDetectorRef,
        private _dialogRef: MatDialogRef<ZelfKeysPlanLimitSheetComponent, PlanLimitSheetResult>,
        private _transloco: TranslocoService
    ) {
        this.kind = data.kind;
        this.plan = data.plan;
        this.limit = data.limit;
        this.tokenCost = data.tokenCost;
        this.tokenBalance = data.tokenBalance;
        this.balanceAvailable = data.balanceAvailable;
        this.password = data.masterPassword || "";
        this.showPassword = data.hasMasterPassword && !data.masterPassword?.trim();
    }

    get title(): string {
        const plan = translatedPlanName(this.plan, (key) => this._transloco.translate(key));
        const key =
            this.kind === "password"
                ? "zelf_keys.plan_limits.sheet.title_passwords"
                : "zelf_keys.plan_limits.sheet.title_zotp";

        return this._transloco.translate(key, { limit: this.limit, plan });
    }

    get balanceText(): string {
        return formatZns(this.tokenBalance);
    }

    get costText(): string {
        return formatZns(this.tokenCost);
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

        try {
            const result = await this.data.purchase({ masterPassword, idempotencyKey: this.idempotencyKey });

            if (result.ok) {
                closed = true;
                this._dialogRef.close({ purchased: true });

                return;
            }

            if (result.reason === "cancelled") return;

            if (result.reason === "password_required") {
                this.message = this._transloco.translate("zelf_keys.plan_limits.sheet.password_required");

                return;
            }

            if (result.reason === "insufficient") {
                this.balanceAvailable = true;
                this.tokenBalance = result.balance;
                if (result.cost != null) this.tokenCost = result.cost;
                this.message = this._transloco.translate("zelf_keys.plan_limits.sheet.insufficient");

                return;
            }

            this.message =
                (result.reason === "error" ? result.message : "") ||
                this._transloco.translate("zelf_keys.plan_limits.sheet.purchase_failed");
        } finally {
            if (!closed) {
                this.busy = false;
                this._changeDetectorRef.detectChanges();
            }
        }
    }

    private get affordabilityInput(): { tokenCost: number; tokenBalance: number | null; balanceAvailable: boolean } {
        return {
            tokenCost: this.tokenCost,
            tokenBalance: this.tokenBalance,
            balanceAvailable: this.balanceAvailable,
        };
    }
}
