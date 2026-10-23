import { Injectable } from "@angular/core";

import { ChromeService } from "app/chrome.service";
import { WalletBalanceCacheSnapshot } from "app/core/utils/wallet-balance-loader";

const cacheKey = (tagName: string) => `walletBalanceCache_${tagName}`;

@Injectable({
    providedIn: "root",
})
export class WalletBalanceCacheService {
    constructor(private readonly _chromeService: ChromeService) {}

    async load(tagName: string): Promise<WalletBalanceCacheSnapshot | null> {
        if (!tagName) return null;

        try {
            const raw = await this._chromeService.getItem(cacheKey(tagName));

            if (!raw || typeof raw !== "object") return null;

            const snapshot = raw as WalletBalanceCacheSnapshot;

            if (!Array.isArray(snapshot.tokens)) return null;

            return snapshot;
        } catch {
            return null;
        }
    }

    async save(snapshot: WalletBalanceCacheSnapshot): Promise<void> {
        if (!snapshot?.tagName) return;

        await this._chromeService.setItem(cacheKey(snapshot.tagName), snapshot);
    }

    /** Drop one account's snapshot so a switch cannot reload another account's rows from it. */
    async clear(tagName: string): Promise<void> {
        if (!tagName) return;

        await this._chromeService.removeItem(cacheKey(tagName));
    }
}
