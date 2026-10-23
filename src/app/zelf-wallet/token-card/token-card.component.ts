import { Component, EventEmitter, Input, OnChanges, Output } from "@angular/core";
import { CurrencyPipe, DecimalPipe, NgClass, NgIf } from "@angular/common";
import { FlexLayoutModule } from "@angular/flex-layout";
import { TranslocoModule } from "@jsverse/transloco";
import { isNativeChainToken } from "app/core/utils/token-balance.util";
import { tokenNetworkToLicenseId } from "app/core/utils/token-network-id.util";
import { NetworkService } from "app/services/network.service";
import { WalletService } from "app/wallet.service";
import { DisplayAmountPipe, DisplayFiatPipe } from "../../pipes/display-number.pipe";

@Component({
    selector: "token-card",
    template: `
        <div
            class="card-container"
            fxLayout="row"
            fxLayoutAlign="start center"
            (click)="onClick()"
            (mouseenter)="isHovered = true"
            (mouseleave)="isHovered = false"
        >
            <div class="status-icon-container">
                <img [src]="currentImage" [alt]="data.symbol" (error)="onImageError()" />
            </div>

            <div class="text-container" fxLayout="column" fxLayoutAlign="start start">
                <div class="token-card__network-info">
                    <p class="token-card__network">{{ data.symbol }}</p>
                    <p class="token-card__network-chip">{{ data.network }}</p>
                    <p
                        *ngIf="data.network === 'Solana' && data.symbol === 'SOL' && data.tokenType === 'SOL'"
                        class="token-card__network-chip token-card__network-chip--kind"
                    >
                        {{ "home.token_sol_native" | transloco }}
                    </p>
                    <p *ngIf="data.isWrappedSol" class="token-card__network-chip token-card__network-chip--kind token-card__network-chip--wrapped">
                        {{ "home.token_sol_wrapped" | transloco }}
                    </p>
                </div>

                <p class="token-card__name" *ngIf="!hideBalances">{{ data.price | displayFiat }}</p>
                <p class="token-card__name token-card__name--masked" *ngIf="hideBalances">••••</p>
            </div>

            <div class="amount-container" fxLayout="column" fxLayoutAlign="end end">
                <h4 class="stats stats--no-margin">
                    <div
                        class="stats__percentage"
                        [ngClass]="{
                            'stats__percentage--positive': false,
                            'stats__percentage--negative': false,
                        }"
                    >
                        <span class="stats__text stats__text--colored" *ngIf="!hideBalances">{{ (data.amount ?? data.balance) | displayAmount }}</span>
                        <span class="stats__text stats__text--colored" *ngIf="hideBalances">••••</span>
                    </div>
                </h4>

                <div class="token-card__balance" *ngIf="!hideBalances">
                    {{ data.fiatBalance | displayFiat }}
                </div>
                <div class="token-card__balance" *ngIf="hideBalances">••••</div>
            </div>

            <div class="pin-icon-container" [class.visible]="isHovered || data.isPinned" [class.pinned]="data.isPinned" (click)="onPinClick($event)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                        d="M16 9V4H15V3H9V4H8V9C8 9.55 7.55 10 7 10H6V12H11V20L12 21L13 20V12H18V10H17C16.45 10 16 9.55 16 9Z"
                        fill="currentColor"
                    />
                </svg>
            </div>
        </div>
    `,
    styleUrls: ["./token-card.component.scss"],
    imports: [DisplayAmountPipe, DisplayFiatPipe, CurrencyPipe, NgClass, NgIf, DecimalPipe, FlexLayoutModule, TranslocoModule],
})
export class TokenCardComponent implements OnChanges {
    @Input() data: any;
    @Input() hideBalances: boolean = false;
    @Input() view: string;
    @Input() shareables: any;
    @Output() pinToggled = new EventEmitter<any>();

    currentImage!: string;
    isHovered: boolean = false;

    constructor(
        private _networkService: NetworkService,
        private _walletService: WalletService
    ) {
        this.view = "default";
    }

    ngOnChanges(): void {
        this.currentImage = this._resolveImage();
    }

    /** Native rows use the chain icon. Optimism, Arbitrum and Base all use symbol ETH, so the ETH icon made them look like duplicate Ethereum cards. */
    private _resolveImage(): string {
        const chainId = tokenNetworkToLicenseId(this.data?.network);
        const chainIcon = isNativeChainToken(this.data) ? this._networkService.getNetworkImage(chainId) : "";

        if (chainIcon) return chainIcon;

        return this._walletService.getAssetImage(this.data?.symbol, this.data?.image);
    }

    onImageError() {
        this.currentImage = this._walletService.getAssetImage(this.data.symbol, "/assets/images/token-placeholder.png");
    }

    onClick(): void {}

    onPinClick(event: Event): void {
        event.stopPropagation();
        this.pinToggled.emit(this.data);
    }
}
