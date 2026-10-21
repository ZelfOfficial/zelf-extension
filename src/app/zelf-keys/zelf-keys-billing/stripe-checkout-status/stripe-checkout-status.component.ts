import { CommonModule } from "@angular/common";
import { Component, HostListener, OnDestroy, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { Subject, takeUntil } from "rxjs";

import { resolveBillingBackNavigation } from "app/core/utils/back-navigation.util";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";

import { formatPlanPriceLine, type StripeCheckoutPhase, type StripeCheckoutSnapshot } from "../stripe-checkout-state";
import { StripeCheckoutTrackerService } from "../stripe-checkout-tracker.service";

@Component({
    imports: [CommonModule, TranslocoModule, MatButtonModule, MatProgressSpinnerModule, ZelfLoaderComponent],
    selector: "stripe-checkout-status",
    styleUrls: ["./stripe-checkout-status.component.scss"],
    templateUrl: "./stripe-checkout-status.component.html",
})
export class StripeCheckoutStatusComponent implements OnInit, OnDestroy {
    loading = true;
    snapshot: StripeCheckoutSnapshot | null = null;

    private readonly _destroy$ = new Subject<void>();

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _router: Router,
        private _tracker: StripeCheckoutTrackerService
    ) {}

    async ngOnInit(): Promise<void> {
        this._tracker.snapshot$.pipe(takeUntil(this._destroy$)).subscribe((snapshot) => {
            this.snapshot = snapshot;
            this.loading = false;
        });

        const restored = await this._tracker.bootstrapFromStorage();

        if (!restored?.checkoutUrl) {
            await this._navigateToPlans();

            return;
        }
    }

    ngOnDestroy(): void {
        this._destroy$.next();
        this._destroy$.complete();
        this._tracker.stopPolling();
    }

    @HostListener("document:visibilitychange")
    onVisibilityChange(): void {
        if (document.visibilityState !== "visible") return;

        void this._tracker.checkNow();
    }

    get phase(): StripeCheckoutPhase | null {
        return this.snapshot?.phase ?? null;
    }

    get planPriceLine(): string {
        return this.snapshot ? formatPlanPriceLine(this.snapshot) : "";
    }

    get sessionLabel(): string {
        if (!this.snapshot?.sessionId) return "";

        const short = this.snapshot.sessionId.length > 14
            ? `${this.snapshot.sessionId.slice(0, 10)}…${this.snapshot.sessionId.slice(-4)}`
            : this.snapshot.sessionId;

        return short;
    }

    async reopenStripe(): Promise<void> {
        await this._tracker.reopenCheckoutTab();
    }

    async checkNow(): Promise<void> {
        this.loading = true;
        await this._tracker.checkNow();
        this.loading = false;
    }

    async cancelCheckout(): Promise<void> {
        await this._tracker.markCancelled();
    }

    async continueAfterSuccess(): Promise<void> {
        await this._tracker.continueAfterSuccess();
        await this._router.navigate(["/zelf-keys/billing"], {
            queryParams: { redirect: this._activatedRoute.snapshot.queryParamMap.get("redirect") },
        });
    }

    async backToPlans(): Promise<void> {
        await this._navigateToPlans();
    }

    async tryAgain(): Promise<void> {
        await this._navigateToPlans();
    }

    private async _navigateToPlans(): Promise<void> {
        const target = resolveBillingBackNavigation(this._router, this._activatedRoute.snapshot.queryParamMap.get("redirect"));

        if (target.kind === "route" && target.url !== "/zelf-keys/billing") {
            await this._router.navigateByUrl(target.url);

            return;
        }

        await this._router.navigate(["/zelf-keys/billing"], {
            queryParams: { redirect: this._activatedRoute.snapshot.queryParamMap.get("redirect") },
        });
    }
}
