import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import { TranslocoModule } from "@jsverse/transloco";

import { StellarFeeBreakdown } from "app/services/stellar-send.types";
import { DisplayAmountPipe } from "app/pipes/display-number.pipe";

@Component({
    selector: "stellar-send-summary",
    standalone: true,
    imports: [CommonModule, TranslocoModule, DisplayAmountPipe],
    styleUrls: ["./stellar-send-summary.component.scss"],
    templateUrl: "./stellar-send-summary.component.html",
})
export class StellarSendSummaryComponent {
    @Input() breakdown: StellarFeeBreakdown | null = null;

    has(key: string): boolean {
        return !!this.breakdown?.preview.warningKeys.includes(key);
    }

    showNewAccountDetails(): boolean {
        const p = this.breakdown?.preview;

        if (!p || p.amountBelowMinimum) return false;

        return p.destinationAccountMissing && (p.mode === "create_only" || p.mode === "create_and_pay");
    }
}
