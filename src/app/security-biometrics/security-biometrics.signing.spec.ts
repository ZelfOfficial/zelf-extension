import { FormBuilder } from "@angular/forms";
import { of } from "rxjs";

import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { FaceApiService } from "app/services/face-api/face-api.service";
import { SecurityBiometricsComponent } from "./security-biometrics.component";

/** #88: the face screen approves a pending Send only after the face decrypt API succeeded. */
describe("SecurityBiometricsComponent signing authorization (#88)", () => {
    const flush = async () => {
        for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    };

    function setup(returnState: string, decryptOk: boolean) {
        const signingAuth = new SigningAuthorizationService();
        const scope = "qa|0xsender|ethereum|0xreceiver|0.001|eth";
        signingAuth.requestAuthorization(scope);

        const decryptTag = jasmine.createSpy("decryptTag").and.callFake(() =>
            decryptOk ? Promise.resolve({ data: { publicData: { tagName: "qa" } } }) : Promise.reject({ error: { code: "face_mismatch" } })
        );
        const component = new SecurityBiometricsComponent(
            { snapshot: { queryParams: { return: returnState } }, queryParams: of({}) } as any,
            {} as any,
            { removeItem: jasmine.createSpy().and.resolveTo(), setItem: jasmine.createSpy() } as any,
            { resolveErrorKey: () => "x", isLivenessError: () => false, translateErrorMessage: () => "x" } as any,
            new FormBuilder(),
            {} as any,
            { navigate: jasmine.createSpy("navigate").and.resolveTo(true) } as any,
            { getZelfProof: jasmine.createSpy().and.resolveTo("proof"), decryptTag } as any,
            { translate: (k: string) => k } as any,
            { securityType: "withoutPassword", password: "" } as any,
            { getUserFingerprint: () => ({ hash: "fp" }), switchWallet: jasmine.createSpy().and.resolveTo() } as any,
            signingAuth,
            { verifying$: of(false), verifying: false } as FaceApiService,
            { markForCheck: () => undefined } as any
        );
        spyOn(component as any, "_showSuccessAndContinue").and.callFake(async (cb: () => void) => cb());

        return { component, signingAuth, scope };
    }

    it("approves the pending Send after a successful face decrypt started from Send", async () => {
        const { component, signingAuth, scope } = setup("/send/confirmation", true);

        await (component as any)._decryptTag({});
        await flush();

        expect(signingAuth.has(scope)).toBeTrue();
    });

    for (const ret of ["/swap", "/dapp/sign"]) {
        it(`approves the pending ${ret} signature after a successful face decrypt started from it`, async () => {
            const { component, signingAuth, scope } = setup(ret, true);

            await (component as any)._decryptTag({});
            await flush();

            expect(signingAuth.has(scope)).toBeTrue();
        });
    }

    it("does not approve anything when the face decrypt fails", async () => {
        const { component, signingAuth, scope } = setup("/send/confirmation", false);

        await (component as any)._decryptTag({});
        await flush();

        expect(signingAuth.has(scope)).toBeFalse();
        expect(signingAuth.approvePending()).toBeFalse();
    });

    it("a face decrypt for another screen (e.g. unlock elsewhere) does not authorize a pending Send", async () => {
        const { component, signingAuth, scope } = setup("/home", true);

        await (component as any)._decryptTag({});
        await flush();

        expect(signingAuth.has(scope)).toBeFalse();
    });

    it("cancelling the face screen revokes the pending Send", () => {
        const { component, signingAuth } = setup("/send/confirmation", true);

        component.goBack();

        expect(signingAuth.approvePending()).toBeFalse();
    });
});
