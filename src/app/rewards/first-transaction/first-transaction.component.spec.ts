import { FirstTransactionComponent } from "./first-transaction.component";

const messages: Record<string, string> = {
    "rewards.first_transaction.identity_required": "Identity verification is required to claim this reward.",
    "rewards.first_transaction.error_generic": "We couldn't complete this reward. Please try again.",
    "rewards.first_transaction.error_verification_failed": "Face mismatch",
    "rewards.first_transaction.error_missing_password": "Password missing",
    "rewards.first_transaction.error_invalid_password": "Wrong password",
    "rewards.first_transaction.error_password_required": "Password required",
    "rewards.first_transaction.error_owner_mismatch": "Wrong owner",
};

describe("FirstTransactionComponent identity", () => {
    function setup() {
        const claimCalls: Array<Record<string, unknown>> = [];
        const decryptCalls: Array<Record<string, unknown>> = [];
        const order: string[] = [];
        const claimFirstTransaction = jasmine.createSpy("claimFirstTransaction").and.callFake(async (body: Record<string, unknown>) => {
            claimCalls.push({ ...body });
            order.push(body["faceBase64"] ? "claim" : "probe");
            if (!body["faceBase64"]) {
                throw {
                    status: 400,
                    error: { message: "ERR_IDENTITY_VERIFICATION_REQUIRED", code: "ERR_IDENTITY_VERIFICATION_REQUIRED" },
                };
            }
            return { success: true, reward: { amount: 12 } };
        });
        const decryptTag = jasmine.createSpy("decryptTag").and.callFake(async (body: Record<string, unknown>) => {
            decryptCalls.push({ ...body });
            order.push("decrypt");
            return { data: { identityToken: "do-not-read" } };
        });
        const setItem = jasmine.createSpy("setItem").and.resolveTo(undefined);
        const encryptMessage = jasmine.createSpy("encryptMessage").and.resolveTo("pgp-password");
        const component = new FirstTransactionComponent(
            { navigate: jasmine.createSpy("navigate") } as any,
            {} as any,
            { claimFirstTransaction } as any,
            { getItem: async () => null, setItem } as any,
            { translate: (key: string) => messages[key] ?? key } as any,
            { decryptTag, getZelfProof: async () => "", previewZelfProof: async () => null } as any,
            { previewZelfProof: async () => null } as any,
            { setLastVerified: jasmine.createSpy("setLastVerified").and.resolveTo(undefined) } as any,
            { encryptMessage } as any,
            { markForCheck() {} } as any
        );
        component.tagName = "alice";
        component.domain = "zelf";

        return { component, claimFirstTransaction, decryptTag, claimCalls, decryptCalls, order, encryptMessage, setItem };
    }

    it("prompts for a face instead of showing the raw identity code", async () => {
        const { component, decryptTag } = setup();

        await (component as any)._checkAndClaim();

        expect(component.verificationStep).toBe("face");
        expect(component.state).toBe("verify");
        expect(component.errorMessage).toBe("");
        expect(component.errorMessage).not.toContain("ERR_");
        expect(decryptTag).not.toHaveBeenCalled();
    });

    it("stamps ownership and retries the reward with the same face", async () => {
        const { component, claimCalls, decryptCalls, order, encryptMessage } = setup();

        await (component as any)._checkAndClaim();
        await component.onFaceCaptured("pgp-face");

        expect(order).toEqual(["probe", "decrypt", "claim"]);
        expect(decryptCalls[0]["faceBase64"]).toBe("pgp-face");
        expect(decryptCalls[0]["password"]).toBeUndefined();
        expect(decryptCalls[0]["tagName"]).toBe("alice");
        expect(decryptCalls[0]["domain"]).toBe("zelf");
        expect(claimCalls[1]["faceBase64"]).toBe("pgp-face");
        expect(claimCalls[1]["masterPassword"]).toBeUndefined();
        expect(encryptMessage).not.toHaveBeenCalled();
        expect(component.state).toBe("success");
        expect(component.rewardAmount).toBe(12);
        expect((component as any)._secrets.faceBase64).toBe("");
        expect(JSON.stringify(decryptCalls)).not.toContain("do-not-read");
        component.ngOnDestroy();
    });

    it("asks for the password and sends it with the face", async () => {
        const { component, claimCalls, decryptCalls, encryptMessage } = setup();
        component.requiresMasterPassword = true;

        await (component as any)._checkAndClaim();
        await component.onFaceCaptured("pgp-face");

        expect(component.verificationStep).toBe("password");
        expect(decryptCalls.length).toBe(0);

        component.masterPassword = "secret";
        await component.submitMasterPassword();

        expect(encryptMessage).toHaveBeenCalledOnceWith("secret");
        expect(decryptCalls[0]["password"]).toBe("pgp-password");
        expect(decryptCalls[0]["faceBase64"]).toBe("pgp-face");
        expect(claimCalls[1]["masterPassword"]).toBe("secret");
        expect(claimCalls[1]["faceBase64"]).toBe("pgp-face");
        expect(component.masterPassword).toBe("");
        expect((component as any)._secrets.masterPassword).toBe("");
        expect((component as any)._secrets.faceBase64).toBe("");
        expect(JSON.stringify(claimCalls)).not.toContain("pgp-password");
        component.ngOnDestroy();
    });

    it("shows the translated identity message when the user cancels", async () => {
        const { component, claimFirstTransaction, decryptTag } = setup();
        component.requiresMasterPassword = true;

        await (component as any)._checkAndClaim();
        await component.onFaceCaptured("pgp-face");
        component.masterPassword = "secret";
        component.cancelVerification();

        expect(decryptTag).not.toHaveBeenCalled();
        expect(claimFirstTransaction).toHaveBeenCalledTimes(1);
        expect(component.verificationStep).toBe("none");
        expect(component.state).toBe("error");
        expect(component.errorMessage).toBe("Identity verification is required to claim this reward.");
        expect(component.errorMessage).not.toContain("ERR_");
        expect(component.masterPassword).toBe("");
        expect((component as any)._secrets.faceBase64).toBe("");
        expect((component as any)._secrets.masterPassword).toBe("");
    });

    it("shows a translated message for an unknown code", async () => {
        const { component, claimFirstTransaction } = setup();
        claimFirstTransaction.and.rejectWith({
            status: 500,
            error: { message: "ERR_SOMETHING_NEW", code: "ERR_SOMETHING_NEW" },
        });

        await (component as any)._checkAndClaim();

        expect(component.state).toBe("error");
        expect(component.errorMessage).toBe("We couldn't complete this reward. Please try again.");
        expect(component.errorMessage).not.toContain("ERR_");
    });

    it("does not claim when face verification fails", async () => {
        const { component, claimFirstTransaction, decryptTag } = setup();
        decryptTag.and.rejectWith({
            status: 422,
            error: { message: "ERR_VERIFICATION_FAILED", code: "ERR_VERIFICATION_FAILED" },
        });

        await (component as any)._checkAndClaim();
        await component.onFaceCaptured("pgp-face");

        expect(claimFirstTransaction).toHaveBeenCalledTimes(1);
        expect(component.state).toBe("error");
        expect(component.errorMessage).toBe("Face mismatch");
        expect((component as any)._secrets.faceBase64).toBe("");
        component.ngOnDestroy();
    });
});
