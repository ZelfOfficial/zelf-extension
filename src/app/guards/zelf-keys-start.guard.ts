import { inject } from "@angular/core";
import { Router, type CanActivateFn } from "@angular/router";

/**
 * Instant redirect only when list data is already in memory.
 * Never blocks navigation on a network fetch — dashboard/vault load in-screen.
 */
export const ZelfKeysStartGuard: CanActivateFn = () => {
    const router = inject(Router);

    void router.navigate(["/zelf-keys/vault"], { replaceUrl: true });

    return false;
};
