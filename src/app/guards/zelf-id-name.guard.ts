import { inject } from "@angular/core";
import { Router, type CanActivateFn } from "@angular/router";
import { WalletService } from "app/wallet.service";
import { ZelfIdsService } from "app/zelf-ids.service";

export const ZelfIdNameGuard: CanActivateFn = async () => {
    const _walletService = inject(WalletService);
    const _zelfIdsService = inject(ZelfIdsService);
    const router = inject(Router);

    const wallet = await _walletService.getCurrentWallet();

    if (wallet?.publicData?.ethAddress || wallet?.name || wallet?.publicData?.tagName) return true;

    const zelfIdObject = await _zelfIdsService.getTagNameObject();
    const zelfIdName = await _zelfIdsService.getTagName();
    const newZelfIdName = await _zelfIdsService.getNewTagName();

    if (!zelfIdObject?.ethAddress && !zelfIdObject?.publicData?.ethAddress && !zelfIdName && !newZelfIdName) {
        router.navigate(["/welcome-zelfid"]);

        return false;
    }

    return true;
};
