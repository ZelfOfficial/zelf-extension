import { inject } from "@angular/core";
import { ActivatedRouteSnapshot, Router, type CanActivateFn } from "@angular/router";

import { ZotpDataService } from "../services/zotp-data.service";

export const ZelfAuthenticatorZotpGuard: CanActivateFn = (_route: ActivatedRouteSnapshot) => {
    const router = inject(Router);
    const zotpDataService = inject(ZotpDataService);

    if (!zotpDataService.getCurrentZotp()) {
        void router.navigate(["/zelf-authenticator"], { replaceUrl: true });
        return false;
    }

    return true;
};
