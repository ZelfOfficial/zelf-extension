import { inject } from "@angular/core";
import { type CanActivateFn } from "@angular/router";

import { ChromeService } from "app/chrome.service";

export const ExternalRedirectGuard: CanActivateFn = (route) => {
    const url = route.queryParams["externalUrl"] || route.data["externalUrl"];
    const chromeService = inject(ChromeService);

    void chromeService.openExternalUrl(url);

    return false;
};
