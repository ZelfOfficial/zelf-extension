import { DatePipe, NgIf, NgTemplateOutlet } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router, RouterModule } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { CopyToClipboardBase } from "app/base/copy-to-clipboard/copy-to-clipboard.base";
import { CaptchaService } from "app/captcha.service";
import { ChromeService } from "app/chrome.service";
import { TagModel } from "app/tags.service";
import { ZelfIdsService } from "app/zelf-ids.service";
import { environment } from "environments/environment";

@Component({
    imports: [RouterModule, NgIf, NgTemplateOutlet, DatePipe, TranslocoModule, MatButtonModule],
    selector: "welcome-zelfid-grace",
    styleUrls: ["./welcome-zelfid-grace.scss"],
    templateUrl: "./welcome-zelfid-grace.html",
})
export class WelcomeZelfidGraceComponent extends CopyToClipboardBase implements OnInit {
    loading: boolean = false;
    captchaToken: string | undefined;
    tagNameObject!: TagModel;
    zelfProof: string | undefined;
    tagName: string | undefined;
    domain: string | undefined;
    constructor(
        private _captchaService: CaptchaService,
        private _router: Router,
        protected _chromeService: ChromeService,
        protected _translocoService: TranslocoService,
        protected _snackBar: MatSnackBar,
        private _zelfIdsService: ZelfIdsService
    ) {
        super(_chromeService, _snackBar, _translocoService);
    }

    async ngOnInit(): Promise<void> {
        this.tagName = await this._zelfIdsService.getTagName();

        const tagResponse = await this._zelfIdsService.getTagResponse();

        if (tagResponse?.tagObject) {
            this.tagNameObject = new TagModel(tagResponse?.tagObject);
        } else {
            this.tagNameObject = new TagModel();
        }

        this.zelfProof = await this._zelfIdsService.getZelfProof();

        this.domain = await this._zelfIdsService.getDomain();

        await this._queryZNS(this.tagName);
    }

    get externalUrl(): string {
        const name = this.tagNameObject?.tagName || "";
        const domain = this.tagNameObject?.domain || "zelf";
        const duration = 1;
        return `${environment.paymentZelfIdUrl}?tagname=${name}&domain=${domain}&duration=${duration}`;
    }

    private async _queryZNS(zelfName: string): Promise<void> {
        try {
            const response = await this._zelfIdsService.searchTag({ tagName: zelfName, domain: this.domain, captchaToken: this.captchaToken });

            if (!response.data) {
                this._router.navigate(["/welcome-zelfid/available"]);

                return;
            }

            // If tag is available, it means it doesn't exist in IPFS/Arweave anymore
            // Redirect to welcome/find so user can recover it using their zelfProof
            if (response.data?.available) {
                // Ensure zelfProof is set in the service for recovery
                if (this.zelfProof) {
                    await this._zelfIdsService.setZelfProof(this.zelfProof);
                }
                // Redirect to find page to recover the tag
                this._router.navigate(["/welcome-zelfid/find"]);

                return;
            }

            const tagNameObject = new TagModel(response.data.tagObject);

            // Update the component's tagNameObject with fresh data
            if (response.data.tagObject) {
                this.tagNameObject = tagNameObject;
            }

            const isOwnedByUser = tagNameObject.zelfProof === this.tagNameObject.zelfProof;

            if (!isOwnedByUser && tagNameObject.publicData?.expiresAt && new Date(tagNameObject.publicData.expiresAt) < new Date()) {
                this._router.navigate(["/welcome-zelfid/recover"]);

                return;
            }

            this.loading = false;
        } catch (error) {
            console.error({ error });

            this.loading = false;
        }
    }

    async copyToClipboard(address: string): Promise<void> {
        await this._copyToClipboard(address);
    }

    decryptZelfName(): void {
        this._zelfIdsService.setFlow("unlock");

        this._router.navigate(["/security-zelfid/password"], { queryParams: { return: "/welcome-zelfid/grace" } });
    }

    renewZelfName(): void {
        const name = this.tagNameObject?.tagName || "";
        const domain = this.tagNameObject?.domain || "zelf";
        const duration = 1;
        this._router.navigate(["/external-link"], {
            queryParams: { externalUrl: `${environment.paymentZelfIdUrl}?tagname=${name}&domain=${domain}&duration=${duration}` },
        });
    }
}
