import { FormBuilder } from "@angular/forms";

import { FACE_ONLY_PASSPHRASE } from "app/core/security/signing-gate.util";
import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { SwapComponent } from "./swap.component";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const PASSWORD = "Correct-Pass-123";

/** #88 rule on Swap: same policy as Send (password/PIN inside the window, face after it; face-only: face every time). */
describe("SwapComponent signing rule (#88)", () => {
    const pairs = [
        ["ethereum", "ETH", "ethereum", "USDC"],
        ["binance", "BNB", "binance", "USDT"],
        ["polygon", "POL", "polygon", "USDC"],
        ["solana", "SOL", "solana", "USDC"],
    ];

    function setup(kind: "password" | "faceonly", windowOpen: boolean, pair = pairs[0], carried = "") {
        const signingAuth = new SigningAuthorizationService();
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const decryptMessage = jasmine.createSpy("decryptMessage").and.callFake(async (_m: string, _k: string, p: string) => {
            if (p !== (kind === "faceonly" ? FACE_ONLY_PASSPHRASE : PASSWORD)) throw new Error("incorrect_passphrase");
            return JSON.stringify({ mnemonic: TEST_MNEMONIC });
        });
        const vault: any = {
            remainingAttempts: 3,
            password: carried,
            mnemonic: "",
            biometricsRequired: jasmine.createSpy().and.callFake(async () => !windowOpen),
            decryptMessage,
        };
        const wallet: any = {
            tagName: "qa",
            fullTagName: "qa.zelf",
            pgp: { encryptedMessage: "m", privateKey: "k" },
            publicData: { hasPassword: kind === "faceonly" ? "false" : "true" },
        };
        const c = new SwapComponent(
            { canSwap: true } as any,
            {} as any,
            {} as any,
            { detectChanges: () => undefined } as any,
            {} as any,
            new FormBuilder(),
            {} as any,
            {} as any,
            { navigate } as any,
            { open: jasmine.createSpy("open") } as any,
            {} as any,
            { translate: (k: string) => k } as any,
            vault,
            { getCurrentWallet: jasmine.createSpy().and.resolveTo(wallet) } as any,
            { setFlow: jasmine.createSpy().and.resolveTo(), setTagName: jasmine.createSpy().and.resolveTo() } as any,
            {} as any,
            signingAuth
        );
        (c as any)._clearRequiresBiometricsInterval();
        c.wallet = wallet;
        c.isFaceOnly = kind === "faceonly";
        c.form = new FormBuilder().group({ password: [""], sourceAmount: ["0.5"] });
        c.selectedSourceAsset = { network: pair[0], symbol: pair[1] } as any;
        c.selectedTargetAsset = { network: pair[2], symbol: pair[3] } as any;

        const validate = () => (c as any)._validateCredentials() as Promise<boolean>;
        const approveFace = () => {
            signingAuth.requestAuthorization((c as any)._signingScope());
            signingAuth.approvePending();
        };
        const faceOpened = () => navigate.calls.all().some((x) => /^\/?security\/biometrics$/.test(x.args[0]?.[0]));

        return { c, validate, approveFace, faceOpened, decryptMessage, vault, signingAuth };
    }

    for (const pair of pairs) {
        it(`${pair.join("/")}: password wallet in window: correct typed password unlocks, no face`, async () => {
            const t = setup("password", true, pair);

            expect(await t.validate()).toBeFalse(); // nothing typed
            t.c.form.get("password")!.setValue("Wrong-Pass-999");
            expect(await t.validate()).toBeFalse();
            expect(t.c.passwordError).toBeTrue();
            t.c.form.get("password")!.setValue(PASSWORD);
            expect(await t.validate()).toBeTrue();
            expect(t.faceOpened()).toBeFalse();
        });

        it(`${pair.join("/")}: face-only wallet needs the face even in window`, async () => {
            const t = setup("faceonly", true, pair);

            expect(await t.validate()).toBeFalse();
            expect(t.faceOpened()).toBeTrue();
            expect(t.decryptMessage).not.toHaveBeenCalled();
        });
    }

    it("password wallet: a carried password without this swap's face approval is ignored", async () => {
        const t = setup("password", true, pairs[0], PASSWORD);
        expect(await t.validate()).toBeFalse();
        expect(t.decryptMessage).not.toHaveBeenCalled();
    });

    it("password wallet after the window: face with the typed password, nothing decrypted", async () => {
        const t = setup("password", false);
        t.c.form.get("password")!.setValue(PASSWORD);

        expect(await t.validate()).toBeFalse();
        expect(t.faceOpened()).toBeTrue();
        expect(t.vault.password).toBe(PASSWORD);
        expect(t.decryptMessage).not.toHaveBeenCalled();
    });

    it("face-only wallet: one approval unlocks exactly one swap; a different amount is not covered", async () => {
        const t = setup("faceonly", true);
        t.approveFace();
        expect(await t.validate()).toBeTrue();
        expect(await t.validate()).toBeFalse();

        const u = setup("faceonly", true);
        u.approveFace();
        u.c.form.get("sourceAmount")!.setValue("5");
        expect(await u.validate()).toBeFalse();
        expect(u.decryptMessage).not.toHaveBeenCalled();
    });
});
