import { FormBuilder } from "@angular/forms";

import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { SendConfirmComponent } from "./send-confirm.component";

// Public, well-known test mnemonic (Hardhat/Foundry default). Never funded on mainnet; only used to build params.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

/** #88: nothing may be signed or broadcast from Send without a face step approved for that transaction. */
describe("SendConfirmComponent face gate (#88)", () => {
    const networks = ["ethereum", "binance", "polygon", "base", "solana", "bitcoin", "stellar", "sui", "polkadot", "ton"];

    function setup(network: string, opts: { passwordless?: boolean; lastVerifiedFresh?: boolean } = {}) {
        const passwordless = opts.passwordless ?? true;
        const signingAuth = new SigningAuthorizationService();
        const sendTransaction = jasmine.createSpy("sendTransaction").and.resolveTo({ hash: "0xhash", status: "pending" });
        const decryptMessage = jasmine.createSpy("decryptMessage").and.resolveTo(JSON.stringify({ mnemonic: TEST_MNEMONIC }));
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const vault: any = {
            remainingAttempts: 3,
            password: "",
            mnemonic: "",
            securityType: "withoutPassword",
            // biometric verification interval still open (the old bypass): must not matter
            biometricsRequired: jasmine.createSpy("biometricsRequired").and.resolveTo(!(opts.lastVerifiedFresh ?? true)),
            decryptMessage,
        };
        const wallet: any = {
            pgp: { encryptedMessage: "-----BEGIN PGP MESSAGE-----", privateKey: "-----BEGIN PGP PRIVATE KEY BLOCK-----" },
            publicData: { hasPassword: passwordless ? "false" : "true" },
        };
        const component = new SendConfirmComponent(
            {} as any, // ActivatedRoute
            {} as any, // AssetService
            {} as any, // BitcoinService
            {} as any, // BlockDAGService
            { sendTransaction } as any,
            { detectChanges: () => undefined } as any,
            { removeItemSession: jasmine.createSpy().and.resolveTo() } as any,
            new FormBuilder(),
            {} as any, // NetworkService
            { navigate } as any,
            { open: jasmine.createSpy("open") } as any,
            { setTagName: jasmine.createSpy().and.resolveTo(), setFlow: jasmine.createSpy().and.resolveTo() } as any,
            {
                addToRecentAddresses: jasmine.createSpy(),
                removeTransactionData: jasmine.createSpy().and.resolveTo(),
                setCurrentTransactionData: jasmine.createSpy().and.resolveTo(),
            } as any,
            { translate: (k: string) => k } as any,
            vault,
            {
                getCurrentWallet: jasmine.createSpy().and.resolveTo(wallet),
                addTransactionToPending: jasmine.createSpy().and.resolveTo(),
            } as any,
            signingAuth
        );
        component.wallet = wallet;
        component.transactionData = {
            network,
            amount: "0.001",
            sender: { tagName: "qa", address: "0xSender" },
            receiver: { address: "0xReceiver" },
            token: { symbol: "ETH", decimals: 18 },
            tokenType: "ETH",
        } as any;
        component.form = new FormBuilder().group({ password: [passwordless ? "" : "correct-password"] });
        (component as any)._password = passwordless ? "NO_PASSWORD_PLACEHOLDER" : "";
        component.passwordSet = passwordless;

        const scope = SigningAuthorizationService.scopeFor(component.transactionData as any);
        const approveFaceForThisTx = () => {
            signingAuth.requestAuthorization(scope);
            signingAuth.approvePending();
        };

        return { component, sendTransaction, decryptMessage, navigate, signingAuth, approveFaceForThisTx };
    }

    for (const network of networks) {
        it(`${network}: confirm without a face step never decrypts, signs or broadcasts; it opens the face screen`, async () => {
            const { component, sendTransaction, decryptMessage, navigate } = setup(network);

            await component.confirmTransaction();

            expect(sendTransaction).not.toHaveBeenCalled();
            expect(decryptMessage).not.toHaveBeenCalled();
            expect(navigate).toHaveBeenCalledWith(["security/biometrics"], { queryParams: { return: "/send/confirmation" } });
            expect(component.requiresBiometrics).toBeTrue();
        });
    }

    it("password wallet: a fresh verification interval + correct password still does not sign without the face step", async () => {
        const { component, sendTransaction, decryptMessage, navigate } = setup("ethereum", { passwordless: false });

        await component.confirmTransaction();

        expect(sendTransaction).not.toHaveBeenCalled();
        expect(decryptMessage).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(["security/biometrics"], { queryParams: { return: "/send/confirmation" } });
    });

    it("decrypting on load (auto-send path) returns false without a face step", async () => {
        const { component, decryptMessage } = setup("solana");

        const decrypted = await (component as any)._decryptMnemonics();

        expect(decrypted).toBeFalse();
        expect(decryptMessage).not.toHaveBeenCalled();
        expect(component.requiresBiometrics).toBeTrue();
    });

    it("signs exactly once after a successful face step for this transaction", async () => {
        const { component, sendTransaction, approveFaceForThisTx } = setup("solana");
        approveFaceForThisTx();

        await component.confirmTransaction();
        expect(sendTransaction).toHaveBeenCalledTimes(1);

        // the grant is single use: a second confirm must go back to the face screen
        component.sending = false;
        await component.confirmTransaction();
        expect(sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("EVM: signs after the face step with a derived private key (no mnemonic sent to the service)", async () => {
        const { component, sendTransaction, approveFaceForThisTx } = setup("ethereum");
        approveFaceForThisTx();

        await component.confirmTransaction();

        expect(sendTransaction).toHaveBeenCalledTimes(1);
        const params = sendTransaction.calls.mostRecent().args[0];
        expect(params.privateKey).toBeTruthy();
        expect(params.mnemonic).toBeUndefined();
    });

    it("a face step approved for another transaction does not authorize this one", async () => {
        const { component, sendTransaction, signingAuth } = setup("ethereum");
        signingAuth.requestAuthorization(
            SigningAuthorizationService.scopeFor({ ...(component.transactionData as any), receiver: { address: "0xOther" } })
        );
        signingAuth.approvePending();

        await component.confirmTransaction();

        expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("face cancelled or failed (revoke) means nothing is signed", async () => {
        const { component, sendTransaction, signingAuth } = setup("ethereum");
        signingAuth.requestAuthorization(SigningAuthorizationService.scopeFor(component.transactionData as any));
        signingAuth.revoke(); // biometrics goBack / onBiometricsFailed
        signingAuth.approvePending();

        await component.confirmTransaction();

        expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("an expired face approval does not sign", async () => {
        const { component, sendTransaction, signingAuth, approveFaceForThisTx } = setup("ethereum");
        let t = 5_000_000;
        signingAuth.now = () => t;
        approveFaceForThisTx();
        t += SigningAuthorizationService.GRANT_TTL_MS + 1;

        await component.confirmTransaction();

        expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("going back from the confirmation screen drops the face approval", async () => {
        const { component, sendTransaction, approveFaceForThisTx, signingAuth } = setup("ethereum");
        approveFaceForThisTx();

        await component.goBack();

        expect(signingAuth.has(SigningAuthorizationService.scopeFor(component.transactionData as any))).toBeFalse();
        expect(sendTransaction).not.toHaveBeenCalled();
    });
});
