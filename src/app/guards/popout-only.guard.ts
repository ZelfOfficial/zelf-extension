import { type CanActivateFn } from "@angular/router";

export const PopoutOnlyGuard: CanActivateFn = async () => {
    // Popout-decryptor is used both as an extension action popup and as a standalone
    // popup window created via chrome.windows.create (e.g. from SuperApp or dapp integrations).
    // Always permit navigation to prevent blank white screens in standalone popout windows.
    return true;
};

