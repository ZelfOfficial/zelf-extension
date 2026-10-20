import { Injectable } from "@angular/core";
import { MAX_BIOMETRIC_WINDOW_MINUTES } from "app/core/security/signing-gate.util";
import { mergeNetworkSettings, resolveEnabledNetworkIds, shouldPersistNetworkMerge } from "app/core/network-settings.util";
import { LicenseNetworksService } from "app/services/license-networks.service";
import { ChromeService } from "app/chrome.service";
import { Settings } from "app/models/settings.model";
import { VaultService } from "app/vault.service";
import { WalletService } from "app/wallet.service";
import { BehaviorSubject, Observable } from "rxjs";

@Injectable({
    providedIn: "root",
})
export class SettingsService {
    private _settings$ = new BehaviorSubject<Settings>({} as Settings);
    private _settings: Settings = {} as Settings;

    constructor(
        private _chromeService: ChromeService,
        private _vaultService: VaultService,
        private _walletService: WalletService,
        private _licenseNetworks: LicenseNetworksService
    ) {
        this._settings = {
            security: {
                biometricVerificationInterval: 10,
                passwordAttempts: 4,
            },
        };

        this._chromeService.onSettingsChanged$.subscribe((settings) => {
            this._applySettingsFromStorage(settings);
        });

        this._chromeService.getItem("settings").then((settings) => {
            this._applySettingsFromStorage(settings);
        });

        // Warm the license network allowlist so every screen filters by the license.
        void this._licenseNetworks.ensureLoaded().catch(() => undefined);
    }

    private _applySettingsFromStorage(raw: Settings | null | undefined): void {
        const hasRaw = raw && Object.keys(raw).length > 0;
        const base: Settings = hasRaw
            ? {
                  ...this._settings,
                  ...raw,
                  security: raw!.security ?? this._settings.security,
              }
            : this._settings;

        const mergedNetworks = mergeNetworkSettings(base.networks);
        const next: Settings = { ...base, networks: mergedNetworks };

        this._settings = next;
        this._settings$.next(this._settings);

        if (hasRaw && shouldPersistNetworkMerge(raw!.networks, mergedNetworks)) {
            void this._chromeService.setItem("settings", next);
        }
    }

    get settings$(): Observable<Settings> {
        return this._settings$.asObservable();
    }

    get settings(): Settings {
        return this._settings;
    }

    /**
     * Enabled chain ids for portfolio / history / send / swap filters, in license order.
     * The domain license (`tags.wallet.networks`, managed by the license admin) decides which chains exist;
     * the user's Manage networks toggles can only switch licensed chains off.
     * Returns undefined only when no license config is known yet and the user has no toggles (legacy "no filter").
     * Call `LicenseNetworksService.ensureLoaded()` first when you need the license applied.
     */
    getEnabledNetworkIds(): string[] | undefined {
        return resolveEnabledNetworkIds(this._licenseNetworks.allowedNetworkIds, this._settings?.networks);
    }

    /** Same as {@link getEnabledNetworkIds} after making sure the license allowlist is loaded. */
    async getEnabledNetworkIdsFromLicense(): Promise<string[] | undefined> {
        await this._licenseNetworks.ensureLoaded();

        return this.getEnabledNetworkIds();
    }

    set settings(value: Settings) {
        const security = value.security ?? this._settings.security;

        if (this._settings.security.passwordAttempts !== security.passwordAttempts) {
            this._vaultService.passwordAttempts = security.passwordAttempts;
        }

        const mergedNetworks = mergeNetworkSettings(value.networks);
        const next: Settings = { ...value, security, networks: mergedNetworks };

        this._settings = next;
        this._chromeService.setItem("settings", next);
        this._settings$.next(this._settings);

        this._biometricsRequired();
    }

    private async _biometricsRequired(): Promise<void> {
        const lastVerified = await this._chromeService.getItem("lastVerified");

        // Force biometrics if someone has tampered with the lastVerified timestamp
        if (!lastVerified || this._vaultService.lastVerified !== lastVerified) {
            await this._walletService.clearPGPKeys();

            return;
        }

        const minutesSinceLastVerified = Math.floor((new Date().getTime() - new Date(lastVerified).getTime()) / (1000 * 60));

        const windowMinutes = Math.min(Number(this._settings?.security?.biometricVerificationInterval) || MAX_BIOMETRIC_WINDOW_MINUTES, MAX_BIOMETRIC_WINDOW_MINUTES);

        if (minutesSinceLastVerified < windowMinutes) return;

        await this._walletService.clearPGPKeys();
    }
}
