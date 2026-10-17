import { Injectable } from "@angular/core";
import { DomainLicense } from "app/core/models/domain.type";
import { getLicenseWalletNetworkIds } from "app/core/network-settings.util";
import { DomainService } from "app/domain.service";
import { WalletService } from "app/wallet.service";
import { BehaviorSubject, Observable } from "rxjs";

/**
 * Wallet networks allowed by the current wallet's domain license (`tags.wallet.networks`).
 * The license administrator controls this from the dashboard; nothing here is hard-coded.
 *
 * Source order: cached license (chrome storage, written by DomainService) for an instant answer,
 * then a fresh `GET /api/tags/domains` when the cache is stale. If the API fails we keep the cached
 * license. `null` means no license network config is known yet (callers keep legacy behaviour).
 */
@Injectable({
    providedIn: "root",
})
export class LicenseNetworksService {
    private _domain: string | null = null;
    private _allowedIds: string[] | null = null;
    private _allowedIds$ = new BehaviorSubject<string[] | null>(null);
    private _loading: Promise<string[] | null> | null = null;

    constructor(
        private _domainService: DomainService,
        private _walletService: WalletService
    ) {}

    /** Last known allowlist for the current wallet's domain (sync; null until loaded). */
    get allowedNetworkIds(): string[] | null {
        return this._allowedIds;
    }

    get allowedNetworkIds$(): Observable<string[] | null> {
        return this._allowedIds$.asObservable();
    }

    /**
     * Load (once per domain) the allowlist for the current wallet's domain.
     * @param force refetch from the API even if the cached license is fresh.
     */
    async ensureLoaded(force = false): Promise<string[] | null> {
        const domain = await this._currentDomain();

        if (!force && domain === this._domain && this._allowedIds) return this._allowedIds;

        if (this._loading && !force) return this._loading;

        this._loading = this._load(domain, force).finally(() => (this._loading = null));

        return this._loading;
    }

    private async _load(domain: string, force: boolean): Promise<string[] | null> {
        let license: DomainLicense | undefined;

        try {
            await this._domainService.loadDomainsFromStorage();
            license = this._domainService.getDomainLicense(domain);

            const cacheValid = await this._domainService.isCacheValid();

            if (force || !license || !cacheValid) {
                const response = await this._domainService.getDomains();
                license = response?.data?.[domain] || license;
            }
        } catch (error) {
            console.warn("[LicenseNetworks] license fetch failed, using cached license if any:", error);
            license = license || this._domainService.getDomainLicense(domain);
        }

        const ids = getLicenseWalletNetworkIds(license);

        // Keep the last good answer for this domain if the new read had nothing.
        if (ids || domain !== this._domain) {
            this._domain = domain;
            this._allowedIds = ids;
            this._allowedIds$.next(ids);
        }

        return this._allowedIds;
    }

    private async _currentDomain(): Promise<string> {
        try {
            const wallet: any = await this._walletService.getCurrentWallet();

            return String(wallet?.domain || wallet?.publicData?.domain || "zelf")
                .replace(/^\./, "")
                .toLowerCase();
        } catch {
            return "zelf";
        }
    }
}
