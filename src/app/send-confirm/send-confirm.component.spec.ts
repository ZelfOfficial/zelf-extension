import { FormBuilder } from "@angular/forms";

import { FACE_ONLY_PASSPHRASE } from "app/core/security/signing-gate.util";
import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { SendConfirmComponent } from "./send-confirm.component";

// Public, well-known test mnemonic (Hardhat/Foundry default). Never funded; only used to build params.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const PASSWORD = "Correct-Pass-123";
const BIOMETRICS = [["security/biometrics"], { queryParams: { return: "/send/confirmation" } }] as const;

type Kind = "password" | "faceonly";

/** #88 rule on Send: password/PIN inside the window, face after it; face-only wallets: face every time. */
describe("SendConfirmComponent signing rule (#88)", () => {
    const networks = ["ethereum", "binance", "polygon", "base", "solana", "bitcoin", "stellar", "sui", "polkadot", "ton"];

    function setup(network: string, kind: Kind, windowOpen: boolean, opts: { carried?: string } = {}) {
        const signingAuth = new SigningAuthorizationService();
        const sendTransaction = jasmine.createSpy("sendTransaction").and.resolveTo({ hash: "0xhash", status: "pending" });
        const decryptMessage = jasmine.createSpy("decryptMessage").and.callFake(async (_m: string, _k: string, passphrase: string) => {
            const ok = kind === "faceonly" ? passphrase === FACE_ONLY_PASSPHRASE : passphrase === PASSWORD;
            if (!ok) throw new Error("incorrect_passphrase");
            return JSON.stringify({ mnemonic: TEST_MNEMONIC });
        });
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const snack = jasmine.createSpy("open");
        const vault: any = {
            remainingAttempts: 3,
            password: opts.carried || "",
            mnemonic: "",
            securityType: "password",
            biometricsRequired: jasmine.createSpy("biometricsRequired").and.callFake(async () => !windowOpen),
            decryptMessage,
        };
        const wallet: any = {
            pgp: { encryptedMessage: "-----BEGIN PGP MESSAGE-----", privateKey: "-----BEGIN PGP PRIVATE KEY BLOCK-----" },
            publicData: { hasPassword: kind === "faceonly" ? "false" : "true" },
        };
        const txData = {
            network,
            amount: "0.001",
            sender: { tagName: "qa", address: "0xSender" },
            receiver: { address: "0xReceiver" },
            token: { symbol: "ETH", decimals: 18, network },
            tokenType: "ETH",
        };
        const component = new SendConfirmComponent(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { sendTransaction } as any,
            { detectChanges: () => undefined } as any,
            { removeItemSession: jasmine.createSpy().and.resolveTo() } as any,
            new FormBuilder(),
            {} as any,
            { navigate } as any,
            { open: snack } as any,
            { setTagName: jasmine.createSpy().and.resolveTo(), setFlow: jasmine.createSpy().and.resolveTo() } as any,
            {
                addToRecentAddresses: jasmine.createSpy(),
                removeTransactionData: jasmine.createSpy().and.resolveTo(),
                setCurrentTransactionData: jasmine.createSpy().and.resolveTo(),
                getCurrentTransactionData: jasmine.createSpy().and.callFake(async () => ({ ...txData, hasTransactionData: true, hasCompletePaymentData: true })),
            } as any,
            { translate: (k: string) => k } as any,
            vault,
            { getCurrentWallet: jasmine.createSpy().and.resolveTo(wallet), addTransactionToPending: jasmine.createSpy().and.resolveTo() } as any,
            signingAuth,
            { previewZelfProof: jasmine.createSpy().and.resolveTo(null) } as any
        );
        component.wallet = wallet;
        component.transactionData = txData as any;
        component.form = new FormBuilder().group({ password: [""] });
        component.isFaceOnly = kind === "faceonly";

        const scope = SigningAuthorizationService.scopeFor(txData as any);
        const approveFace = () => {
            signingAuth.requestAuthorization(scope);
            signingAuth.approvePending();
        };
        const type = (pw: string) => component.form.get("password")!.setValue(pw);

        return { component, sendTransaction, decryptMessage, navigate, snack, vault, signingAuth, approveFace, type, scope };
    }

    describe("case 1: face + password wallet, inside the verification window", () => {
        for (const network of networks) {
            it(`${network}: signs only with the correct typed password and never opens the face screen`, async () => {
                const t = setup(network, "password", true);

                await t.component.confirmTransaction(); // nothing typed
                expect(t.decryptMessage).not.toHaveBeenCalled();
                expect(t.sendTransaction).not.toHaveBeenCalled();

                t.type("Wrong-Pass-999");
                await t.component.confirmTransaction();
                expect(t.sendTransaction).not.toHaveBeenCalled();
                expect(t.component.passwordError).toBeTrue();

                t.type(PASSWORD);
                await t.component.confirmTransaction();
                expect(t.decryptMessage.calls.mostRecent().args[2]).toBe(PASSWORD);
                expect(t.sendTransaction).toHaveBeenCalledTimes(1);
                expect(t.navigate).not.toHaveBeenCalledWith(...BIOMETRICS);
            });
        }

        it("shows the password field and Confirm (not Verify) on load", async () => {
            const t = setup("ethereum", "password", true);
            await (t.component as any)._checkPasswordlessWallet();
            await (t.component as any)._refreshSigningGate();
            expect(t.component.passwordSet).toBeFalse();
            expect(t.component.requiresBiometrics).toBeFalse();
        });

        it("a password left in the vault/session is ignored: the password must be typed", async () => {
            const t = setup("ethereum", "password", true, { carried: PASSWORD });

            await t.component.confirmTransaction();

            expect(t.decryptMessage).not.toHaveBeenCalled();
            expect(t.sendTransaction).not.toHaveBeenCalled();
            expect(t.snack).toHaveBeenCalled();
        });

        it("a cancelled password (cleared field) signs nothing", async () => {
            const t = setup("solana", "password", true);
            t.type(PASSWORD);
            t.type("");

            await t.component.confirmTransaction();

            expect(t.sendTransaction).not.toHaveBeenCalled();
        });
    });

    describe("case 1: face + password wallet, after the verification window", () => {
        it("typed password opens the face screen (carrying the password) and signs nothing", async () => {
            const t = setup("ethereum", "password", false);
            t.type(PASSWORD);

            await t.component.confirmTransaction();

            expect(t.navigate).toHaveBeenCalledWith(...BIOMETRICS);
            expect(t.vault.password).toBe(PASSWORD);
            expect(t.decryptMessage).not.toHaveBeenCalled();
            expect(t.sendTransaction).not.toHaveBeenCalled();
        });

        it("without a password it asks for it first (no face, no sign)", async () => {
            const t = setup("ethereum", "password", false);

            await t.component.confirmTransaction();

            expect(t.navigate).not.toHaveBeenCalled();
            expect(t.sendTransaction).not.toHaveBeenCalled();
        });

        it("after this transaction's face step it signs once with the password typed before it", async () => {
            const t = setup("polygon", "password", true, { carried: PASSWORD });
            t.approveFace();

            await t.component.confirmTransaction();
            expect(t.sendTransaction).toHaveBeenCalledTimes(1);

            t.component.sending = false;
            await t.component.confirmTransaction(); // approval and carried password are gone
            expect(t.sendTransaction).toHaveBeenCalledTimes(1);
        });

        it("a wrong carried password after the face step signs nothing", async () => {
            const t = setup("polygon", "password", true, { carried: "Wrong-Pass-999" });
            t.approveFace();

            await t.component.confirmTransaction();

            expect(t.sendTransaction).not.toHaveBeenCalled();
        });

        it("stellar: does not open face without a password when the signing grant does not match", async () => {
            const t = setup("stellar", "password", true, { carried: PASSWORD });
            t.approveFace();
            spyOn(t.component as any, "_signingScope").and.returnValue("mismatched-scope");

            await t.component.confirmTransaction();

            expect(t.navigate).not.toHaveBeenCalledWith(...BIOMETRICS);
            expect(t.sendTransaction).not.toHaveBeenCalled();
            expect(t.snack).toHaveBeenCalled();
        });

        it("stellar: carries the typed password into the face step after the verification window", async () => {
            const t = setup("stellar", "password", false);
            t.type(PASSWORD);

            await t.component.confirmTransaction();

            expect(t.navigate).toHaveBeenCalledWith(...BIOMETRICS);
            expect(t.vault.password).toBe(PASSWORD);
            expect((t.component as any)._carriedSecret).toBe(PASSWORD);
        });
    });

    describe("case 2: face-only wallet", () => {
        for (const network of networks) {
            it(`${network}: face on every send, even inside the window; nothing decrypted or signed without it`, async () => {
                const t = setup(network, "faceonly", true);

                await t.component.confirmTransaction();

                expect(t.navigate).toHaveBeenCalledWith(...BIOMETRICS);
                expect(t.decryptMessage).not.toHaveBeenCalled();
                expect(t.sendTransaction).not.toHaveBeenCalled();
            });
        }

        it("signs exactly once per face approval for this transaction", async () => {
            const t = setup("ethereum", "faceonly", true);
            t.approveFace();

            await t.component.confirmTransaction();
            expect(t.sendTransaction).toHaveBeenCalledTimes(1);
            const params = t.sendTransaction.calls.mostRecent().args[0];
            expect(params.privateKey).toBeTruthy();
            expect(params.mnemonic).toBeUndefined();

            t.component.sending = false;
            await t.component.confirmTransaction();
            expect(t.sendTransaction).toHaveBeenCalledTimes(1);
        });

        it("approval for another transaction, an expired one, or a cancelled face step does not sign", async () => {
            const other = setup("ethereum", "faceonly", true);
            other.signingAuth.requestAuthorization(SigningAuthorizationService.scopeFor({ ...(other.component.transactionData as any), amount: "9" }));
            other.signingAuth.approvePending();
            await other.component.confirmTransaction();
            expect(other.sendTransaction).not.toHaveBeenCalled();

            const expired = setup("ethereum", "faceonly", true);
            let now = 1_000_000;
            expired.signingAuth.now = () => now;
            expired.approveFace();
            now += SigningAuthorizationService.GRANT_TTL_MS + 1;
            await expired.component.confirmTransaction();
            expect(expired.sendTransaction).not.toHaveBeenCalled();

            const cancelled = setup("ethereum", "faceonly", true);
            cancelled.signingAuth.requestAuthorization(cancelled.scope);
            cancelled.signingAuth.revoke();
            cancelled.signingAuth.approvePending();
            await cancelled.component.confirmTransaction();
            expect(cancelled.sendTransaction).not.toHaveBeenCalled();
        });
    });

    describe("never auto-signs", () => {
        for (const kind of ["password", "faceonly"] as Kind[]) {
            it(`${kind}: loading the confirmation never decrypts or signs, even with a face approval and carried password`, async () => {
                const t = setup("ethereum", kind, true, { carried: kind === "password" ? PASSWORD : FACE_ONLY_PASSPHRASE });
                t.approveFace();
                spyOn(t.component as any, "_initTransactionData").and.resolveTo();

                await t.component.ngOnInit();

                expect(t.decryptMessage).not.toHaveBeenCalled();
                expect(t.sendTransaction).not.toHaveBeenCalled();
                expect(t.component.requiresBiometrics).toBeFalse(); // approved: shows Confirm, waits for the user
            });
        }
    });

    it("going back drops the face approval", async () => {
        const t = setup("ethereum", "faceonly", true);
        t.approveFace();

        await t.component.goBack();

        expect(t.signingAuth.has(t.scope)).toBeFalse();
    });
});
