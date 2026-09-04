import { inject } from "@angular/core";
import { ActivatedRouteSnapshot, Router, type CanActivateFn } from "@angular/router";
import { VaultService } from "app/vault.service";

export const PasswordZelfidGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
    const router = inject(Router);
    const _vaultService = inject(VaultService);

    if (!_vaultService.password) {
        const returnPath = route?.queryParams?.return;

        router.navigate(["/security-zelfid/password"], { replaceUrl: true, queryParams: { return: returnPath } });

        return false;
    }

    return true;
};
