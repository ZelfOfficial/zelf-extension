import { NgClass, NgFor, NgIf } from "@angular/common";
import { Component, Input } from "@angular/core";
import { TranslocoModule } from "@jsverse/transloco";
import { DEFAULT_NETWORK_CONFIGS } from "app/core/network-settings.util";
import { NetworkBalanceStatus } from "app/core/utils/wallet-balance-loader";
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

    constructor(private readonly _walletService: WalletService) {}

    labelFor(id: string): string {
        return DEFAULT_NETWORK_CONFIGS.find((n) => n.id === id)?.name || id;
    }

    iconFor(id: string): string {
        const symbol = DEFAULT_NETWORK_CONFIGS.find((n) => n.id === id)?.symbol || id;

        return this._walletService.getAssetImage(symbol);
    }

    statusFor(id: string): NetworkBalanceStatus {
        return this.networkStatus?.[id] ?? "pending";
    }
}
