import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { ActivatedRoute, RouterLink, RouterModule } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { ChromeService } from "app/chrome.service";
import { ZelfNamePipe } from "app/pipes/zelf-name.pipe";
import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { ZelfIdPlanOptionsComponent } from "app/zelf-id-plan-options/zelf-id-plan-options.component";
import { ZelfIdSearchResponse, ZelfIdsService } from "app/zelf-ids.service";
import { buildZelfIdPaymentUrl, defaultPlanSelection, resolveZelfIdPlanCatalog, ZelfIdPlanCatalog, ZelfIdPlanSelection } from "app/zelf-ids/plan-pricing";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { environment } from "environments/environment";
import { Subject, takeUntil } from "rxjs";

@Component({
    selector: "domain-purchase",
    imports: [
        TranslocoModule,
        CommonModule,
        MatButtonModule,
        RouterLink,
        RouterModule,
        ZelfNamePipe,
        FormsModule,
        ZelfLoaderComponent,
        ZelfIdPlanOptionsComponent,
    ],
    templateUrl: "./domain-purchase.component.html",
    styleUrls: ["./domain-purchase.component.scss"],
})
export class DomainPurchaseComponent implements OnInit, OnDestroy {
    private unsubscriber$ = new Subject<void>();
    private _selectedZelfName: string = "";

    durationToken: string = "";
    agreement: boolean = false;
    loading: boolean = false;
    wallet: Partial<TagModel> = {};
    catalog: ZelfIdPlanCatalog | null = null;
    planSelection: ZelfIdPlanSelection = { plan: "free", duration: "" };
    tagName = "";
    domain = "zelf";

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _chromeService: ChromeService,
        private _walletService: WalletService,
        private _zelfIdsService: ZelfIdsService
    ) {
        this._selectedZelfName = this._activatedRoute.snapshot.queryParams.zelfName;

        this._activatedRoute.queryParams.pipe(takeUntil(this.unsubscriber$)).subscribe((params) => {
            this._selectedZelfName = params.zelfName;
        });
    }

    async ngOnInit(): Promise<void> {
        await this._setWallets();
        await this._loadPlans();

        this.durationToken = await this._chromeService.getItem("durationToken");
        this.loading = false;
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    get paymentUrl(): string {
        if (!this.planSelection.plan || this.planSelection.plan === "free") return "";

        return buildZelfIdPaymentUrl(environment.paymentZelfIdUrl, {
            tagName: this.tagName,
            domain: this.domain,
            plan: this.planSelection.plan,
            duration: this.planSelection.duration || "1",
        });
    }

    onPlanSelection(selection: ZelfIdPlanSelection): void {
        this.planSelection = selection;
    }

    private async _setWallets(): Promise<void> {
        this.loading = true;

        const { wallet, wallets } = await this._walletService.getAllWalletsFromStorage();

        if (this._selectedZelfName) {
            this.wallet = wallets.find((w) => w.tagName.toLowerCase() === this._selectedZelfName.toLowerCase()) || wallet || {};

            return;
        }

        this.wallet = wallet || {};
    }

    private async _loadPlans(): Promise<void> {
        const raw = this.wallet.tagName || this.wallet.publicData?.tagName || this._selectedZelfName || "";
        const fallbackDomain = this.wallet.publicData?.domain || "zelf";
        const parsed = raw.includes(".") ? this._zelfIdsService.parseTagName(raw) : { name: raw, domain: fallbackDomain };

        this.tagName = parsed.name;
        this.domain = parsed.domain || fallbackDomain;

        let response: ZelfIdSearchResponse | null = null;

        if (this.tagName) {
            try {
                const result = await this._zelfIdsService.searchTag({ tagName: this.tagName, domain: this.domain });

                response = result?.data || null;
            } catch (error) {
                console.error({ error });
            }
        }

        this.catalog = resolveZelfIdPlanCatalog(response, this.tagName);
        this.planSelection = defaultPlanSelection(this.catalog, "purchase");
    }
}
