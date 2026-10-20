import { FormBuilder } from "@angular/forms";

import { FACE_ONLY_PASSPHRASE } from "app/core/security/signing-gate.util";
import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { DappSignComponent } from "./dapp-sign.component";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const PASSWORD = "Correct-Pass-123";

/** #88 rule on dApp signing: same policy as Send. */
describe("DappSignComponent signing rule (#88)", () => {
    let savedChrome: any;

    beforeEach(() => {
        savedChrome = (window as any).chrome;
        (window as any).chrome = { runtime: { sendMessage: jasmine.createSpy("sendMessage").and.resolveTo() } };
        spyOn(window, "close");
    });

    afterEach(() => {
        (window as any).chrome = savedChrome;
        sessionStorage.removeItem("pending_sign_request_id");
    });

    function setup(kind: "password" | "faceonly", windowOpen: boolean, opts: { pin?: boolean; carried?: string; method?: string } = {}) {
        const signingAuth = new SigningAuthorizationService();
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const decryptMnemonicOnce = jasmine.createSpy("decryptMnemonicOnce").and.callFake(async (_w: any, p: string) => {
            if (p !== (kind === "faceonly" ? FACE_ONLY_PASSPHRASE : PASSWORD)) throw new Error("incorrect_passphrase");
            return TEST_MNEMONIC;
        });
        const signMessage = jasmine.createSpy("signMessage").and.resolveTo({ signature: "0xsig" });
        const signRawTransaction = jasmine.createSpy("signRawTransaction").and.resolveTo("0xraw");
        const vault: any = { remainingAttempts: 3, password: opts.carried || "", mnemonic: "", biometricsRequired: async () => !windowOpen };
        const wallet: any = { fullTagName: "qa.zelf", pgp: { encryptedMessage: "m", privateKey: "k" }, publicData: { hasPassword: kind === "faceonly" ? "false" : "true", tagName: "qa" } };
        const c = new DappSignComponent(
            {} as any,
            { detectChanges: () => undefined } as any,
            {} as any,
            {} as any,
            new FormBuilder(),
            { navigate } as any,
            { decryptMnemonicOnce, signMessage, signRawTransaction } as any,
            { open: jasmine.createSpy("open") } as any,
            { setTagName: jasmine.createSpy().and.resolveTo(), setFlow: jasmine.createSpy().and.resolveTo() } as any,
            { translate: (k: string) => k } as any,
            {} as any,
            vault,
            { getCurrentWallet: jasmine.createSpy().and.resolveTo(wallet) } as any,
            signingAuth
        );
        c.wallet = wallet;
        c.requestId = "req-1";
        c.method = opts.method || "personal_sign";
        c.isMessageSign = c.method === "personal_sign";
        (c as any)._pendingParams = c.isMessageSign ? ["0x68656c6c6f"] : [{ to: "0x0000000000000000000000000000000000000001", value: "0x0" }];
        c.form = new FormBuilder().group({ password: [""] });
        c.isFaceOnly = kind === "faceonly";
        c.isPinUnlock = !!opts.pin;
        if (c.isFaceOnly) c.passwordSet = true;

        const signed = () => signMessage.calls.count() + signRawTransaction.calls.count();
        const faceOpened = () => navigate.calls.all().some((x) => /^\/?security\/biometrics$/.test(x.args[0]?.[0]));
        const approveFace = () => {
            signingAuth.requestAuthorization((c as any)._signingScope());
            signingAuth.approvePending();
        };

        return { c, signed, faceOpened, approveFace, decryptMnemonicOnce, vault };
    }

    for (const method of ["personal_sign", "eth_signTransaction"]) {
        it(`${method}: password wallet in window signs only with the correct typed password, no face`, async () => {
            const t = setup("password", true, { method });

            await t.c.confirmSigning();
            expect(t.signed()).toBe(0);

            t.c.form.get("password")!.setValue("Wrong-Pass-999");
            await t.c.confirmSigning();
            expect(t.signed()).toBe(0);

            t.c.form.get("password")!.setValue(PASSWORD);
            await t.c.confirmSigning();
            expect(t.signed()).toBe(1);
            expect(t.faceOpened()).toBeFalse();
        });

        it(`${method}: face-only wallet needs the face in window, then signs once`, async () => {
            const t = setup("faceonly", true, { method });

            await t.c.confirmSigning();
            expect(t.faceOpened()).toBeTrue();
            expect(t.decryptMnemonicOnce).not.toHaveBeenCalled();

            t.approveFace();
            await t.c.confirmSigning();
            expect(t.signed()).toBe(1);
        });
    }

    it("PIN wallet in window: needs the full 6-digit PIN", async () => {
        const t = setup("password", true, { pin: true });
        t.c.pinDigits = ["1", "2", "3", "", "", ""];
        await t.c.confirmSigning();
        expect(t.decryptMnemonicOnce).not.toHaveBeenCalled();
    });

    it("password wallet after the window: face (carrying the typed password), nothing signed", async () => {
        const t = setup("password", false);
        t.c.form.get("password")!.setValue(PASSWORD);

        await t.c.confirmSigning();

        expect(t.faceOpened()).toBeTrue();
        expect(t.vault.password).toBe(PASSWORD);
        expect(t.signed()).toBe(0);
    });

    it("a carried password without this request's face approval is ignored", async () => {
        const t = setup("password", true, { carried: PASSWORD });
        await t.c.confirmSigning();
        expect(t.decryptMnemonicOnce).not.toHaveBeenCalled();
    });

    it("an approval for another request does not sign this one", async () => {
        const t = setup("faceonly", true);
        t.approveFace();
        t.c.requestId = "req-2";
        await t.c.confirmSigning();
        expect(t.signed()).toBe(0);
    });
});
