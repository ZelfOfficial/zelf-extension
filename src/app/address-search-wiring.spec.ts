import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { Router } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";
import { ChromeService } from "app/chrome.service";
import { HttpWrapperService } from "app/http-wrapper.service";
import { FaceApiService } from "app/services/face-api/face-api.service";
import { TagsService } from "app/tags.service";
import { VaultService } from "app/vault.service";
import { WalletService } from "app/wallet.service";
import { ZelfIdsService } from "app/zelf-ids.service";
import { ZaiService } from "app/zai/zai.service";
import { WelcomeFindComponent } from "./welcome-find/welcome-find.component";
import { WelcomeZelfidFindComponent } from "./welcome-zelfid-find/welcome-zelfid-find";

describe("address search request wiring", () => {
    it("serializes recovery address lookups through both real search services", async () => {
        const http = jasmine.createSpyObj<HttpWrapperService>("HttpWrapperService", ["sendRequest"]);
        http.sendRequest.and.resolveTo({ data: { available: true, ipfs: [], arweave: [], tagName: "" } });
        const wallet = {
            ETHRegex: /^0x[0-9a-f]{40}$/i,
            SOLRegex: /^sol-/,
            BTCRegex: /^btc-/,
        };
        TestBed.configureTestingModule({
            providers: [
                TagsService, ZelfIdsService,
                { provide: HttpWrapperService, useValue: http },
                { provide: ChromeService, useValue: {} },
                { provide: VaultService, useValue: {} },
                { provide: WalletService, useValue: wallet },
                { provide: ZaiService, useValue: {} },
                { provide: FaceApiService, useValue: {} },
            ],
        });
        const tags = TestBed.inject(TagsService);
        const zelfIds = TestBed.inject(ZelfIdsService);
        const router = jasmine.createSpyObj<Router>("Router", ["navigate"]);
        router.navigate.and.resolveTo(true);
        const legacy = new WelcomeFindComponent(
            {} as ChromeService, new FormBuilder(), router, {} as TranslocoService,
            TestBed.inject(WalletService), tags
        );
        const current = new WelcomeZelfidFindComponent(
            {} as ChromeService, new FormBuilder(), router, {} as TranslocoService,
            TestBed.inject(WalletService), zelfIds
        );
        for (const [key, value] of [
            ["ethAddress", "0x0000000000000000000000000000000000000001"],
            ["solanaAddress", "sol-address"],
            ["btcAddress", "btc-address"],
        ]) {
            const query = { key, value, domain: "zelf", os: "DESKTOP" };
            legacy.form.patchValue({ publicAddress: value });
            await legacy.searchAddress();
            expect(http.sendRequest).toHaveBeenCalledWith("get", `${tags.baseUrl}/api/tags/search`, query);

            current.form.patchValue({ publicAddress: value });
            await current.searchAddress();
            expect(http.sendRequest).toHaveBeenCalledWith("get", `${zelfIds.apiPath}/search`, query);
            current.clearNotFound();
        }
        legacy.ngOnDestroy();
        current.ngOnDestroy();
    });
});
