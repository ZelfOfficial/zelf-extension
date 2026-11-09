import { AsyncPipe, NgIf } from "@angular/common";
import { Component, Input, Optional } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";
import { Observable } from "rxjs";

import { ShellLayoutService } from "app/services/shell-layout.service";
import { ZelfKeysDataService } from "app/services/zelf-keys-data.service";
import { ZOTPService } from "app/services/zotp.service";
import { FooterNavigationService } from "../footer-navigation.service";

@Component({
    imports: [NgIf, AsyncPipe, TranslocoModule, RouterLink],
    selector: "footer-menu",
    styleUrls: ["./footer-menu.component.scss"],
    templateUrl: "./footer-menu.component.html",
})
export class FooterMenuComponent {
    @Input() shareables: any;

    isDeepShell$: Observable<boolean>;

    constructor(
        public navService: FooterNavigationService,
        private readonly _router: Router,
        private readonly _shellLayout: ShellLayoutService,
        @Optional() private readonly _zotpService?: ZOTPService,
        @Optional() private readonly _zelfKeysDataService?: ZelfKeysDataService
    ) {
        this.isDeepShell$ = this._shellLayout.isDeepShell$;
    }

    get showHubRefresh(): boolean {
        const path = this._shellLayout.cleanPath(this._router.url);
        return path.startsWith("/zelf-authenticator") || path.startsWith("/zelf-keys");
    }

    openAppsHub(): void {
        const path = this._router.url.split("?")[0];
        const hubQuickContext = path.startsWith("/zelf-authenticator") ? "zelf-authenticator" : undefined;
        void this._router.navigate(["/apps"], {
            state: hubQuickContext ? { hubQuickContext } : {},
        });
    }

    onHubRefresh(): void {
        const path = this._shellLayout.cleanPath(this._router.url);
        if (path.startsWith("/zelf-authenticator")) {
            void this._zotpService?.loadZOTPsFromBackend(true);
            return;
        }
        if (path.startsWith("/zelf-keys")) {
            void this._zelfKeysDataService?.ensureLoadedForCurrentWallet({
                forceRefresh: true,
                reason: "footer-refresh",
            });
        }
    }

    onDeepAdd(): void {
        void this._shellLayout.navigateToDeepAdd();
    }
}
