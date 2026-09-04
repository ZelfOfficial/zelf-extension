import { inject } from "@angular/core";
import { Router, type CanActivateFn } from "@angular/router";
import { VaultService } from "app/vault.service";
import { ZelfIdsService } from "app/zelf-ids.service";

export const MnemonicZelfidGuard: CanActivateFn = async () => {
    const _vaultService = inject(VaultService);
    const _zelfIdsService = inject(ZelfIdsService);
    const router = inject(Router);

    const mnemonicCount = await _zelfIdsService.getMnemonicCount();

    if (!_vaultService.mnemonic && !mnemonicCount) {
        const flow = await _zelfIdsService.getFlow();

        if (!flow) router.navigate(["/welcome-zelfid"]);
        else if (flow === "import") router.navigate(["/welcome-zelfid/import"]);
        else if (flow === "create") router.navigate(["/security-zelfid"]);
        else if (flow === "unlock" || flow === "recover") return true;

        return false;
    }

    return true;
};
