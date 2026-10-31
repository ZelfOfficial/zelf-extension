import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { RouterModule } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";

import { WalletService } from "../../wallet.service";
import { SolanaService } from "../../solana.service";

const ZNS_TOKEN_SYMBOL = "ZNS";

export interface RedeemOption {
    id: string;
    titleKey: string;
    costZns: number;
    disabled?: boolean;
}

@Component({
    imports: [CommonModule, MatButtonModule, RouterModule, TranslocoModule],
    selector: "app-redeem-zns",
    styleUrls: ["./redeem-zns.component.scss", "../../main.scss"],
    templateUrl: "./redeem-zns.component.html",
})
export class RedeemZnsComponent implements OnInit {
    znsBalance: number = 0;
    znsBalanceLoading: boolean = false;
    useRpcForZnsBalance: boolean = false;

    readonly options: RedeemOption[] = [
        { id: "zelfname-1m", titleKey: "rewards.redeem.option_1m", costZns: 100 },
        { id: "zelfname-2m", titleKey: "rewards.redeem.option_2m", costZns: 200 },
        { id: "zelfname-5m", titleKey: "rewards.redeem.option_5m", costZns: 500 },
        { id: "zns-3y-6-15", titleKey: "rewards.redeem.option_3y", costZns: 3000 },
        { id: "zns-1y-6-15", titleKey: "rewards.redeem.option_1y", costZns: 1000 },
        { id: "zns-2y-6-15", titleKey: "rewards.redeem.option_2y", costZns: 2000 },
        { id: "zns-3y-6-15-b", titleKey: "rewards.redeem.option_3y", costZns: 3000 },
    ];

    constructor(
        private _walletService: WalletService,
        private _solanaService: SolanaService
    ) {}

    ngOnInit(): void {
        this._loadZnsBalance();
    }

    private async _loadZnsBalance(): Promise<void> {
        this.znsBalanceLoading = true;
        this.znsBalance = 0;

        try {
            const wallet = await this._walletService.getCurrentWallet();
            const solanaAddress = wallet?.publicData?.solanaAddress;

            if (!solanaAddress) {
                return;
            }

            if (this.useRpcForZnsBalance) {
                this.znsBalance = await this._solanaService.getZnsBalanceViaRpc(solanaAddress);
                return;
            }

            let amount = 0;

            try {
                const response = await this._solanaService.getWalletDetails(solanaAddress, { source: "oklink" });
                const tokens = response?.data?.tokenHoldings?.tokens ?? response?.tokenHoldings?.tokens ?? [];
                const znsToken = Array.isArray(tokens) ? tokens.find((t: any) => (t.symbol || "").toUpperCase() === ZNS_TOKEN_SYMBOL) : null;
                amount = znsToken?.amount ?? znsToken?.balance ?? 0;
            } catch (err) {
                console.warn("Backend API for ZNS balance failed, preparing RPC fallback", err);
            }

            // Fallback to RPC if backend returned 0
            if (!amount || amount === 0) {
                try {
                    const rpcAmount = await this._solanaService.getZnsBalanceViaRpc(solanaAddress);
                    if (rpcAmount > 0) amount = rpcAmount;
                } catch (rpcErr) {
                    console.warn("RPC fallback for ZNS balance failed", rpcErr);
                }
            }

            this.znsBalance = typeof amount === "number" ? amount : parseFloat(String(amount)) || 0;
        } catch (error) {
            console.error("Error loading ZNS balance:", error);
        } finally {
            this.znsBalanceLoading = false;
        }
    }

    isOptionDisabled(opt: RedeemOption): boolean {
        return this.znsBalance < opt.costZns;
    }

    onOptionClick(opt: RedeemOption): void {
        if (this.isOptionDisabled(opt)) return;
        // TODO: Implement redemption flow
        console.log("Redeem option clicked:", opt);
    }
}
