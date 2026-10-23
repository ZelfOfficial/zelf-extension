import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { TranslocoModule } from "@jsverse/transloco";
import { DEFAULT_NETWORK_CONFIGS } from "app/core/network-settings.util";
import { NetworkConfig, Settings } from "app/models/settings.model";
import { LicenseNetworksService } from "app/services/license-networks.service";
import { NetworkService } from "app/services/network.service";
import { SettingsService } from "app/services/settings.service";
import { WalletService } from "app/wallet.service";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";

@Component({
    imports: [NgFor, NgIf, NgClass, FormsModule, MatSlideToggleModule, TranslocoModule, ZelfLoaderComponent],
    selector: "zelf-settings-networks",
    styleUrls: ["./zelf-settings-networks.component.scss"],
    templateUrl: "./zelf-settings-networks.component.html",
})
export class ZelfSettingsNetworksComponent implements OnInit, OnDestroy {
    private unsubscriber$: Subject<void> = new Subject<void>();
    private _licenseNetworkIds: string[] | null = null;

    loading = true;
    networks: NetworkConfig[] = [];
    settings!: Settings;

    constructor(
        private _licenseNetworks: LicenseNetworksService,
        private _networkService: NetworkService,
        private _settingsService: SettingsService,
        private _walletService: WalletService
    ) {}

    async ngOnInit(): Promise<void> {
        this.settings = this._settingsService.settings;

        await this._fetchLicenseNetworks();
        this._initNetworks();

        this._settingsService.settings$.pipe(takeUntil(this.unsubscriber$)).subscribe((settings) => {
            if (!settings) return;

            this.settings = settings;
            this._initNetworks();
        });

        this.loading = false;
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();

        // Save settings on destroy
        this._saveNetworks();
    }

    /**
     * Networks come only from the domain license (`tags.wallet.networks`), set by the license admin.
     */
    private async _fetchLicenseNetworks(): Promise<void> {
        try {
            this._licenseNetworkIds = await this._licenseNetworks.ensureLoaded(true);
        } catch (error) {
            console.error("Error fetching license networks:", error);
            this._licenseNetworkIds = this._licenseNetworks.allowedNetworkIds;
        }
    }

    private _initNetworks(): void {
        const allowedNetworkIds = this._licenseNetworkIds;

        // License order; display names/icons from the supported-chain catalog. No license config known yet: show the catalog.
        const availableNetworks: NetworkConfig[] = allowedNetworkIds
            ? allowedNetworkIds
                  .map((id) => DEFAULT_NETWORK_CONFIGS.find((n) => n.id === id))
                  .filter((n): n is NetworkConfig => !!n)
            : DEFAULT_NETWORK_CONFIGS;

        // Saved user toggles apply only to networks the license allows
        this.networks = availableNetworks.map((defaultNetwork) => {
            const savedNetwork = this.settings.networks?.find((n) => n.id === defaultNetwork.id);
            return savedNetwork ? { ...defaultNetwork, ...savedNetwork } : { ...defaultNetwork };
        });
    }

    onNetworkToggle(network: NetworkConfig): void {
        network.enabled = !network.enabled;
        this._saveNetworks();
    }

    private _saveNetworks(): void {
        this.settings.networks = this.networks;
        this._settingsService.settings = this.settings;
    }

    onIconError(event: Event): void {
        const img = event.target as HTMLImageElement;
        const fallback = "./assets/tokens/placeholder-coin.png";
        if (img && !img.src.endsWith("placeholder-coin.png")) img.src = fallback;
    }

    getNetworkIcon(network: NetworkConfig): string {
        return this._networkService.getNetworkImage(network.id) || this._walletService.getAssetImage(network.symbol);
    }
}
