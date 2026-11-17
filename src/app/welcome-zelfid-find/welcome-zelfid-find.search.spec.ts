import { FormBuilder } from "@angular/forms";
import { Router } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";
import { ChromeService } from "app/chrome.service";
import { WalletService } from "app/wallet.service";
import { ZelfIdsService } from "app/zelf-ids.service";
import { WelcomeZelfidFindComponent } from "./welcome-zelfid-find";

describe("WelcomeZelfidFindComponent search", () => {
    const service = jasmine.createSpyObj<ZelfIdsService>("ZelfIdsService", ["searchTag"]);
    const wallet = {
        ETHRegex: /^0x[0-9a-f]{40}$/i,
        SOLRegex: /^sol-/,
        BTCRegex: /^btc-/,
    } as WalletService;

    beforeEach(() => {
        service.searchTag.calls.reset();
        service.searchTag.and.resolveTo({ data: { available: true, ipfs: [], arweave: [], tagName: "" } });
    });

    it("passes each address to the Zelf IDs API as key and value", async () => {
        const component = new WelcomeZelfidFindComponent(
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
        const component = new WelcomeZelfidFindComponent(
            {} as ChromeService, new FormBuilder(), {} as Router, {} as TranslocoService,
            wallet, service
        );
        await component._queryZNS("tagName", "sample.zelf", "zelf");
        expect(service.searchTag).toHaveBeenCalledWith({ tagName: "sample.zelf", domain: "zelf", os: "DESKTOP" });
    });
});
