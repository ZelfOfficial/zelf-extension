import { CommonModule } from "@angular/common";
import { Component, DestroyRef, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { distinctUntilChanged, map, skip } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { WalletService } from "app/wallet.service";
import { ZelfKeysPlanLimitCoordinator } from "./zelf-keys-plan-limit.coordinator";
import { ZelfKeysLimits, ZelfKeysSlotKind } from "./zelf-keys-plan-limits.model";
import { translatedPlanName } from "./zelf-keys-plan-limits.util";

@Component({
    imports: [CommonModule, TranslocoModule],
    selector: "zelf-keys-plan-usage",
    styleUrls: ["./zelf-keys-plan-usage.component.scss"],
    templateUrl: "./zelf-keys-plan-usage.component.html",
})
export class ZelfKeysPlanUsageComponent implements OnInit {
    @Input({ required: true }) kind!: ZelfKeysSlotKind;

    constructor(
        private _chrome: ChromeService,
        private _destroyRef: DestroyRef,
        private _limits: ZelfKeysPlanLimitCoordinator,
        private _transloco: TranslocoService,
        private _wallet: WalletService
    ) {}

    get limits$() {
        return this._limits.limits$;
    }

    ngOnInit(): void {
        void this._limits.refresh();

        this._chrome.onWalletChanged$
            .pipe(
                map((wallet) => wallet?.fullTagName ?? ""),
                distinctUntilChanged(),
                skip(1),
                takeUntilDestroyed(this._destroyRef)
            )
            .subscribe(() => {
                void this._limits.refresh();
            });
    }

    row(limits: ZelfKeysLimits): {
        countKey: string;
        used: number;
        limit: number;
        planLabel: string;
        atLimit: boolean;
    } | null {
        const usage = limits.kinds?.[this.kind];

        if (!usage) return null;

        const unlimited = usage.limit == null;
        const countKey =
            this.kind === "password"
                ? unlimited
                    ? "zelf_keys.plan_limits.usage_passwords_unlimited"
                    : "zelf_keys.plan_limits.usage_passwords"
                : unlimited
                  ? "zelf_keys.plan_limits.usage_zotp_unlimited"
                  : "zelf_keys.plan_limits.usage_zotp";
        const plan = translatedPlanName(limits.plan, (key) => this._transloco.translate(key));

        return {
            countKey,
            used: usage.used,
            limit: usage.limit ?? 0,
            planLabel: this._transloco.translate("zelf_keys.plan_limits.usage_plan", { plan }),
            atLimit: !usage.canAdd && usage.limit != null,
        };
    }

    async onBuy(): Promise<void> {
        const wallet = await this._wallet.getCurrentWallet();

        await this._limits.openPurchaseSheet(this.kind, {
            hasMasterPassword: !!wallet?.hasPassword,
            masterPassword: "",
        });
    }
}
