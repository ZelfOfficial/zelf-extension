import { NgFor, NgIf } from "@angular/common";
import { Component, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogRef } from "@angular/material/dialog";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ChromeService } from "app/chrome.service";
import { ConfirmationDialogComponent } from "app/confirmation-dialog/confirmation-dialog.component";
import { WalletConnectService } from "app/services/walletconnect.service";
import { Subject, takeUntil } from "rxjs";
import { ZelfSettingsNetworksComponent } from "./zelf-settings-networks/zelf-settings-networks.component";
import { ZelfSettingsSecurityComponent } from "./zelf-settings-security/zelf-settings-security.component";
import { ZelfSettingsLanguageComponent } from "./zelf-settings-language/zelf-settings-language.component";
import { ZelfSettingsDappsComponent } from "./zelf-settings-dapps/zelf-settings-dapps.component";
import { ZelfSettingsNotificationsComponent } from "./zelf-settings-notifications/zelf-settings-notifications.component";
import { ZelfSettingsThemeComponent } from "./zelf-settings-theme/zelf-settings-theme.component";

@Component({
    imports: [
        NgFor,
        NgIf,
        FormsModule,
        TranslocoModule,
        MatButtonModule,
        RouterLink,
        ZelfSettingsNetworksComponent,
        ZelfSettingsSecurityComponent,
        ZelfSettingsLanguageComponent,
        ZelfSettingsDappsComponent,
        ZelfSettingsNotificationsComponent,
        ZelfSettingsThemeComponent,
    ],
    selector: "zelf-settings",
    styleUrls: ["./zelf-settings.component.scss"],
    templateUrl: "./zelf-settings.component.html",
})
export class ZelfSettingsComponent implements OnDestroy {

    private unsubscriber$: Subject<void> = new Subject<void>();

    selectedSettings: "networks" | "security" | "theme" | "language" | "dapps" | "notifications" | "" = "";
    settingsItems: {
        text: string;
        icon: string;
        routerLink: string[];
        queryParams: Record<string, string>;
    }[] = [
        {
            text: "settings.networks_label",
            icon: "lan",
            routerLink: ["./"],
            queryParams: { edit: "networks" },
        },
        {
            text: "settings.security_label",
            icon: "shield_lock",
            routerLink: ["./"],
            queryParams: { edit: "security" },
        },
        {
            text: "settings.notifications_label",
            icon: "notifications",
            routerLink: ["./"],
            queryParams: { edit: "notifications" },
        },
        {
            text: "settings.theme_label",
            icon: "contrast",
            routerLink: ["./"],
            queryParams: { edit: "theme" },
        },
        {
            text: "settings.language_label",
            icon: "translate",
            routerLink: ["./"],
            queryParams: { edit: "language" },
        },
        {
            text: "settings.dapps_label",
            icon: "cable",
            routerLink: ["./"],
            queryParams: { edit: "dapps" },
        },
        {
            text: "settings.subscription_label",
            icon: "workspace_premium",
            routerLink: ["/zelf-keys/billing"],
            queryParams: { redirect: "/settings" },
        },
    ];

    footerLinks = [
        {
            url: "https://docs.zelf.world/",
            text: "common.documentation",
            icon: "menu_book",
        },
        {
            url: "https://docs.zelf.world/docs/legal/terms-of-use",
            text: "common.terms_and_conditions",
            icon: "gavel",
        },
        {
            url: "https://docs.zelf.world/docs/legal/privacy-policy",
            text: "common.privacy",
            icon: "privacy_tip",
        },
        {
            url: "https://zelf.world/pricing",
            text: "common.pricing",
            icon: "sell",
        },
    ];

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _chromeService: ChromeService,
        private _dialog: MatDialog,
        private _router: Router,
        private _translocoService: TranslocoService
    ) {
        this._setSelectedSettings();
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    private _createDialogRef(): MatDialogRef<ConfirmationDialogComponent> {
        return this._dialog.open(ConfirmationDialogComponent, {
            panelClass: "zelf-dialog",
            backdropClass: "zelf-backdrop",
            data: {
                message: this._translocoService.translate("logout_message"),
                confirm: this._translocoService.translate("common.confirm"),
                cancel: this._translocoService.translate("common.cancel"),
                title: this._translocoService.translate("logout_title"),
                destructiveButton: true,
            },
        });
    }

    private _setSelectedSettings() {
        this.selectedSettings = this._activatedRoute.snapshot.queryParams?.edit ? this._activatedRoute.snapshot.queryParams.edit : "";

        this._activatedRoute.queryParams.pipe(takeUntil(this.unsubscriber$)).subscribe((queryParams) => {
            this.selectedSettings = queryParams.edit ? queryParams.edit : "";
        });
    }


    get pageTitle(): string {
        switch (this.selectedSettings) {
            case "networks":
                return "settings.networks.title";
            case "security":
                return "settings.security_label";
            case "notifications":
                return "settings.notifications.title";
            case "theme":
                return "settings.theme_label";
            case "language":
                return "settings.language_label";
            case "dapps":
                return "settings.dapps.title";
            default:
                return "common.settings";
        }
    }

    logout() {
        const dialogRef = this._createDialogRef();

        dialogRef.afterClosed().subscribe((result) => {
            if (!result) return;

            this._chromeService.clearLocalStorage();
            this._chromeService.clearSessionStorage();

            this._router.navigate(["/welcome-zelfid"], { replaceUrl: true });
        });
    }
}
