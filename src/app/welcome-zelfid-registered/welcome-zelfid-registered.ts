import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { TagModel, TagSearchResponse } from "app/tags.service";
import { ZelfIdsService } from "app/zelf-ids.service";
import { CopyToClipboardBase } from "app/base/copy-to-clipboard/copy-to-clipboard.base";
import { ChromeService } from "app/chrome.service";
import { MatSnackBar } from "@angular/material/snack-bar";
import { environment } from "environments/environment";

interface RegisteredAddress {
    address: string;
    labelKey: string;
    logo: string;
    value: string;
}

@Component({
    imports: [CommonModule, RouterModule, TranslocoModule, MatButtonModule],
    selector: "welcome-zelfid-registered",
    styleUrls: ["./welcome-zelfid-registered.scss"],
    templateUrl: "./welcome-zelfid-registered.html",
})
export class WelcomeZelfidRegisteredComponent extends CopyToClipboardBase implements OnInit {
    private readonly _addressLimit = 4;

    qrCodeImage: string;
    showAllAddresses = false;
    zelfProof: string | undefined;
    tagModel?: TagModel;
    tagResponse?: TagSearchResponse;

    constructor(
        private _activatedRoute: ActivatedRoute,
        private _changeDetectorRef: ChangeDetectorRef,
        private _router: Router,
        private _zelfIdsService: ZelfIdsService,
        public _chromeService: ChromeService,
        public _translocoService: TranslocoService,
        public _snackBar: MatSnackBar
    ) {
        super(_chromeService, _snackBar, _translocoService);

        this.qrCodeImage = "./assets/images/qr-preload.png";
    }

    get isShortHold(): boolean {
        const name = this.tagModel?.tagName || "";
        return this.tagModel?.publicData?.type === "hold" && name.length > 0 && name.length <= 5;
    }

    get planLabel(): string {
        return ((this.tagModel?.publicData as { plan?: string } | undefined)?.plan || "").toString();
    }

    get addresses(): RegisteredAddress[] {
        const tagModel = this.tagModel;
        const data = tagModel?.publicData;

        if (!tagModel || !data) return [];

        return [
            {
                address: data.blockDAGAddress,
                labelKey: "common.bdag_address",
                logo: "assets/networks/bdag.png",
                value: tagModel.displayBlockDAGAddress,
            },
            {
                address: data.btcAddress,
                labelKey: "common.btc_address",
                logo: "assets/networks/btc.png",
                value: tagModel.displayBtcAddress,
            },
            {
                address: data.ethAddress,
                labelKey: "common.eth_address",
                logo: "assets/networks/eth.png",
                value: tagModel.displayEthAddress,
            },
            {
                address: data.solanaAddress,
                labelKey: "common.sol_address",
                logo: "assets/networks/sol.svg",
                value: tagModel.displaySolanaAddress,
            },
            {
                address: data.xlmAddress,
                labelKey: "common.stellar_address",
                logo: "assets/icons/xlm_logo.svg",
                value: tagModel.displayXlmAddress,
            },
            {
                address: data.tonAddress,
                labelKey: "common.ton_address",
                logo: "assets/networks/ton.png",
                value: tagModel.displayTonAddress,
            },
            {
                address: data.ethAddress,
                labelKey: "common.avax_address",
                logo: "assets/networks/avax.png",
                value: tagModel.displayAvalancheAddress,
            },
            {
                address: data.ethAddress,
                labelKey: "common.bnb_address",
                logo: "assets/icons/bnb_logo.svg",
                value: tagModel.displayBinanceAddress,
            },
        ].filter((row) => !!row.value);
    }

    get visibleAddresses(): RegisteredAddress[] {
        return this.showAllAddresses ? this.addresses : this.addresses.slice(0, this._addressLimit);
    }

    get hasMoreAddresses(): boolean {
        return this.addresses.length > this._addressLimit;
    }

    toggleAddresses(): void {
        this.showAllAddresses = !this.showAllAddresses;
    }

    async ngOnInit(): Promise<void> {
        // Load tag data from the new TagsService
        this.zelfProof = await this._zelfIdsService.getZelfProof();

        const tagData = await this._zelfIdsService.getTagNameObject();

        this.tagResponse = (await this._zelfIdsService.getTagResponse()) || undefined;

        // Create TagModel if we have tag data
        if (tagData) {
            this.tagModel = tagData instanceof TagModel ? tagData : new TagModel(tagData);
        }

        this.qrCodeImage = this.tagModel?.image || this.qrCodeImage;

        this._changeDetectorRef.markForCheck();
    }

    async copyToClipboard(address: string): Promise<void> {
        await this._copyToClipboard(address);
    }

    async login(): Promise<void> {
        await this._zelfIdsService.setFlow("unlock");

        this._router.navigate(["/security-zelfid/password"]);
    }

    purchaseNow(): void {
        const name = this.tagModel?.tagName || "";
        const domain = this.tagModel?.domain || "zelf";
        const duration = 1;
        this._router.navigate(["/external-link"], {
            queryParams: {
                externalUrl: `${environment.paymentZelfIdUrl}?tagname=${name}&domain=${domain}&duration=${duration}`,
            },
        });
    }
}
