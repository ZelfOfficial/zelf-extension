import { FormBuilder } from "@angular/forms";
import { Router } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";
import { ChromeService } from "app/chrome.service";
import { TagsService } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { WelcomeFindComponent } from "./welcome-find.component";

describe("WelcomeFindComponent search", () => {
    const service = jasmine.createSpyObj<TagsService>("TagsService", ["searchTag"]);
    const wallet = {
        ETHRegex: /^0x[0-9a-f]{40}$/i,
        SOLRegex: /^sol-/,
        BTCRegex: /^btc-/,
    } as WalletService;

    beforeEach(() => {
        service.searchTag.calls.reset();
        service.searchTag.and.resolveTo({ data: { available: true, ipfs: [], arweave: [], tagName: "" } });
    });

    it("passes each address to the Tags API as key and value", async () => {
        const component = new WelcomeFindComponent(
            {} as ChromeService, new FormBuilder(), {} as Router, {} as TranslocoService,
            wallet, service
        );
        for (const [key, value] of [
            ["ethAddress", "0x0000000000000000000000000000000000000001"],
            ["solanaAddress", "sol-address"],
            ["btcAddress", "btc-address"],
        ]) {
            await component._queryZNS(key, value, "zelf");
            expect(service.searchTag).toHaveBeenCalledWith({ key, value, domain: "zelf", os: "DESKTOP" });
        }
    });

    it("keeps name searches as tagName requests", async () => {
        const component = new WelcomeFindComponent(
            {} as ChromeService, new FormBuilder(), {} as Router, {} as TranslocoService,
            wallet, service
        );
        await component._queryZNS("tagName", "sample.zelf", "zelf");
        expect(service.searchTag).toHaveBeenCalledWith({ tagName: "sample.zelf", domain: "zelf", os: "DESKTOP" });
    });
});
