import { CommonModule } from "@angular/common";
import { Component, HostListener, OnDestroy, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { Subject, takeUntil } from "rxjs";

import { resolveBillingBackNavigation } from "app/core/utils/back-navigation.util";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";

import { planCurrencySymbol, type StripeCheckoutPhase, type StripeCheckoutSnapshot } from "../stripe-checkout-state";
import { StripeCheckoutTrackerService } from "../stripe-checkout-tracker.service";

@Component({
    imports: [CommonModule, TranslocoModule, MatButtonModule, ZelfLoaderComponent],
    selector: "stripe-checkout-status",
    styleUrls: ["./stripe-checkout-status.component.scss"],
    templateUrl: "./stripe-checkout-status.component.html",
})
export class StripeCheckoutStatusComponent implements OnInit, OnDestroy {
    checking = false;
    loading = true;
    snapshot: StripeCheckoutSnapshot | null = null;

    private readonly _destroy$ = new Subject<void>();

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _router: Router,
        private _tracker: StripeCheckoutTrackerService,
        private _translocoService: TranslocoService
    ) {}

    async ngOnInit(): Promise<void> {
        this._tracker.snapshot$.pipe(takeUntil(this._destroy$)).subscribe((snapshot) => {
            this.snapshot = snapshot;
            this.loading = false;
        });

        const restored = await this._tracker.bootstrapFromStorage();

        if (!restored?.checkoutUrl) {
            await this._navigateToPlans(false);

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

        void this.checkNow();
    }

    get phase(): StripeCheckoutPhase | null {
        return this.snapshot?.phase ?? null;
    }

    currencySymbol(checkout: StripeCheckoutSnapshot): string {
        return planCurrencySymbol(checkout.planCurrency);
    }

    planIntervalLabel(checkout: StripeCheckoutSnapshot): string {
        if (checkout.planInterval === "month") {
            return this._translocoService.translate("zelf_keys.billing_ui.plan.month");
        }

        if (checkout.planInterval === "year") {
            return this._translocoService.translate("zelf_keys.billing_ui.stripe_checkout.interval_year");
        }

        return checkout.planInterval;
    }

    async reopenStripe(): Promise<void> {
        await this._tracker.reopenCheckoutTab();
    }

    async checkNow(): Promise<void> {
        this.checking = true;
        await this._tracker.checkNow();
        this.checking = false;
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
        await this._navigateToPlans(true);
    }

    async tryStripeAgain(): Promise<void> {
        this.checking = true;
        await this._tracker.retryStripeCheckoutForSamePlan();
        this.checking = false;
    }

    private async _navigateToPlans(abandonCheckout: boolean): Promise<void> {
        if (abandonCheckout) {
            await this._tracker.abandonCheckoutForNavigation();
        }

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
