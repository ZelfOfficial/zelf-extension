import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { TranslocoModule } from "@jsverse/transloco";

import { ZelfIdPlan } from "app/zelf-ids.service";
import { ZelfIdLimitLine, ZelfIdPlanCard, ZelfIdPlanCatalog, ZelfIdPlanSelection } from "app/zelf-ids/plan-pricing";

@Component({
    imports: [CommonModule, TranslocoModule],
    selector: "zelf-id-plan-options",
    styleUrls: ["./zelf-id-plan-options.component.scss"],
    templateUrl: "./zelf-id-plan-options.component.html",
})
export class ZelfIdPlanOptionsComponent {
    @Input() catalog: ZelfIdPlanCatalog | null = null;
    @Input() selection: ZelfIdPlanSelection | null = null;
    /** Names without a price map can still be chosen on the purchase screen. */
    @Input() allowUnpriced = false;

    @Output() selectionChange = new EventEmitter<ZelfIdPlanSelection>();

    get plans(): ZelfIdPlanCard[] {
        return this.catalog?.plans || [];
    }

    trackPlan(_index: number, plan: ZelfIdPlanCard): string {
        return plan.id;
    }

    trackDuration(_index: number, duration: { key: string }): string {
        return duration.key;
    }

    isSelected(plan: ZelfIdPlan, duration = ""): boolean {
        if (!this.selection || this.selection.plan !== plan) return false;

        return !duration || this.selection.duration === duration;
    }

    selectFree(): void {
        this.selectionChange.emit({ plan: "free", duration: "" });
    }

    selectPaid(plan: ZelfIdPlanCard, durationKey?: string): void {
        const duration = durationKey || plan.durations.find((entry) => entry.key === "1")?.key || plan.durations[0]?.key || "1";

        this.selectionChange.emit({ plan: plan.id, duration });
    }

    selectUnpriced(plan: "premium" | "unlimited"): void {
        this.selectionChange.emit({ plan, duration: "1" });
    }

    termKey(years: number): string {
        return years === 1 ? "welcomeZelfid.free_term_one" : "welcomeZelfid.free_term_years";
    }

    durationLabel(key: string): { i18n: string; params?: { count: number }; raw?: string } {
        if (key === "lifetime" || key === "999") return { i18n: "welcomeZelfid.duration_lifetime" };
        if (key === "1") return { i18n: "welcomeZelfid.duration_one" };

        const years = Number(key);

        if (Number.isFinite(years) && years > 0) return { i18n: "welcomeZelfid.duration_years", params: { count: years } };

        return { i18n: "", raw: key };
    }

    limitKey(line: ZelfIdLimitLine): string {
        if (line.key === "text" || line.key === "generic") return "";

        return `welcomeZelfid.limit_${line.key}`;
    }
}
