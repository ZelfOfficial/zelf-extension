import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";

/** Redirect legacy `#/domain` deep links to the unified Figma ZELF ID detail screen. */
export const DomainToWalletManageGuard: CanActivateFn = (route) => {
    const router = inject(Router);

    return router.createUrlTree(["/wallet-manage"], {
        queryParams: route.queryParams,
    });
};
