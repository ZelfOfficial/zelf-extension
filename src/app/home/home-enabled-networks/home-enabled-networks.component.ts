import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component, Input } from "@angular/core";
import { TranslocoModule } from "@jsverse/transloco";
import { DEFAULT_NETWORK_CONFIGS } from "app/core/network-settings.util";
import { uniqueChainIds } from "app/core/utils/home-network-list.util";
import { NetworkBalanceStatus } from "app/core/utils/wallet-balance-loader";
import { NetworkService } from "app/services/network.service";
import { WalletService } from "app/wallet.service";

@Component({
    imports: [NgClass, NgFor, NgIf, TranslocoModule],
    selector: "home-enabled-networks",
    styleUrls: ["./home-enabled-networks.component.scss"],
    templateUrl: "./home-enabled-networks.component.html",
})
export class HomeEnabledNetworksComponent {
    @Input({ required: true }) networkIds: string[] = [];
    @Input() networkStatus: Record<string, NetworkBalanceStatus> | null = null;

    constructor(
        private readonly _networkService: NetworkService,
        private readonly _walletService: WalletService
    ) {}

    get chainIds(): string[] {
        return uniqueChainIds(this.networkIds);
    }

    labelFor(id: string): string {
        return DEFAULT_NETWORK_CONFIGS.find((n) => n.id === id)?.name || id;
    }

    iconFor(id: string): string {
        return this._networkService.getNetworkImage(id) || this._walletService.getAssetImage(DEFAULT_NETWORK_CONFIGS.find((n) => n.id === id)?.symbol || id);
    }

    statusFor(id: string): NetworkBalanceStatus {
        return this.networkStatus?.[id] ?? "pending";
    }
}
