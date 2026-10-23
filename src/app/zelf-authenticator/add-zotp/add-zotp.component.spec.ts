import { FormBuilder } from "@angular/forms";

import { AddZotpComponent } from "./add-zotp.component";

/** Public RFC 6238 example secret. Not a user credential. */
const SETUP_KEY = "JBSWY3DPEHPK3PXP";
const FACE = "enc-face-image";

describe("AddZotpComponent face verification", () => {
    const copy: Record<string, string> = {
        "common.close": "Close",
        "zotp.errors.invalid_setup_key": "Setup key rejected",
        "zotp.protection.errors.password_required": "Master password required",
        "zotp.decrypt_failed": "Decrypt failed",
    };

    function setup(kind: "face" | "face_password") {
        const storeZOTPToZelfKeys = jasmine.createSpy("storeZOTPToZelfKeys").and.resolveTo({ id: "stored" });
        const navigate = jasmine.createSpy("navigate").and.resolveTo(true);
        const snack = jasmine.createSpy("open");
        const encryptMessage = jasmine.createSpy("encryptMessage").and.callFake(async (value: string) => `pgp:${value}`);
        const component = new AddZotpComponent(
            new FormBuilder(),
            { encryptMessage } as any,
            { navigate } as any,
            { open: snack } as any,
            { getZelfProof: jasmine.createSpy("getZelfProof").and.resolveTo("wallet-proof") } as any,
            { translate: (key: string) => copy[key] ?? key } as any,
            {} as any,
            {
                getCurrentWallet: jasmine.createSpy("getCurrentWallet").and.resolveTo({
                    hasPassword: kind === "face_password",
                    name: "qa",
                }),
            } as any,
            { generateId: () => "zotp-id", storeZOTPToZelfKeys } as any
        );

        return { component, storeZOTPToZelfKeys, navigate, snack, encryptMessage };
    }

    async function fill(component: AddZotpComponent, setupKey = SETUP_KEY, password?: string): Promise<void> {
        await component.ngOnInit();
        component.form.patchValue({
            name: "qa",
            issuer: "qa",
            setupKey,
            ...(password !== undefined ? { masterPassword: password } : {}),
        });
    }

    it("does not open the face step for an invalid setup key", async () => {
        const { component, storeZOTPToZelfKeys, snack } = setup("face");

        await fill(component, "123456");

        expect(component.isFormReadyToSave).toBeFalse();

        await component.save();

        expect(component.showBiometrics).toBeFalse();
        expect(storeZOTPToZelfKeys).not.toHaveBeenCalled();
        expect(snack).toHaveBeenCalledWith(
            "Setup key rejected",
            "Close",
            jasmine.objectContaining({
                panelClass: ["zelf-snackbar", "zelf-snackbar--above-footer"],
                verticalPosition: "bottom",
            })
        );
        expect(component.form.get("setupKey")?.value).toBe("123456");
    });

    it("stores a face-only ZOTP only after a face scan, then allows a retry after a 409", async () => {
        const { component, storeZOTPToZelfKeys, navigate, snack } = setup("face");
        const httpFailure = "Http failure response for https://v4.zelf.world/api/zelf-keys/store/zotp: 409 OK";

        await fill(component);

        expect(component.isFormReadyToSave).toBeTrue();

        await component.save();

        expect(component.showBiometrics).toBeTrue();
        expect(storeZOTPToZelfKeys).not.toHaveBeenCalled();

        storeZOTPToZelfKeys.and.rejectWith({
            status: 409,
            message: httpFailure,
            error: {
                code: "ERR_INVALID_SETUP_KEY",
                validationError: `setupKey with value "${SETUP_KEY}" must be at least 16 Base32 characters`,
            },
        });

        await component.onBiometricsScanned(FACE);

        expect(storeZOTPToZelfKeys).toHaveBeenCalledTimes(1);
        expect(storeZOTPToZelfKeys.calls.mostRecent().args[1]).toBe(FACE);
        expect(storeZOTPToZelfKeys.calls.mostRecent().args[2]).toBe("");
        expect(storeZOTPToZelfKeys.calls.mostRecent().args[3]).toBe("face");
        expect(navigate).not.toHaveBeenCalled();
        expect(component.showBiometrics).toBeFalse();
        expect(component.form.get("name")?.value).toBe("qa");
        expect(component.form.get("issuer")?.value).toBe("qa");
        expect(component.form.get("setupKey")?.value).toBe(SETUP_KEY);

        const shown = snack.calls.mostRecent().args[0] as string;

        expect(shown).toBe("Setup key rejected");
        expect(shown).not.toContain(SETUP_KEY);
        expect(shown).not.toContain("Http failure");

        storeZOTPToZelfKeys.and.resolveTo({ id: "stored" });

        await component.save();
        expect(component.showBiometrics).toBeTrue();

        await component.onBiometricsScanned(FACE);

        expect(storeZOTPToZelfKeys).toHaveBeenCalledTimes(2);
        expect(storeZOTPToZelfKeys.calls.mostRecent().args[2]).toBe("");
        expect(storeZOTPToZelfKeys.calls.mostRecent().args[3]).toBe("face");
        expect(navigate).toHaveBeenCalledWith(["/zelf-authenticator"]);
    });

    it("asks a face+password wallet for the password and sends it with the face scan", async () => {
        const { component, storeZOTPToZelfKeys, navigate, encryptMessage } = setup("face_password");

        await fill(component, SETUP_KEY);

        expect(component.isFormReadyToSave).toBeFalse();

        await component.save();

        expect(component.showBiometrics).toBeFalse();
        expect(storeZOTPToZelfKeys).not.toHaveBeenCalled();

        component.form.get("masterPassword")?.setValue("wallet-secret");
        component.form.get("requireMasterPasswordOnDecrypt")?.setValue(true);

        expect(component.isFormReadyToSave).toBeTrue();

        await component.save();

        expect(component.showBiometrics).toBeTrue();

        await component.onBiometricsScanned(FACE);

        expect(encryptMessage).toHaveBeenCalledWith("wallet-secret");
        expect(storeZOTPToZelfKeys).toHaveBeenCalledTimes(1);

        const [zotp, face, password, protection] = storeZOTPToZelfKeys.calls.mostRecent().args;

        expect(zotp.secret).toBe(SETUP_KEY);
        expect(zotp.protection).toBe("face_password");
        expect(face).toBe(FACE);
        expect(password).toBe("pgp:wallet-secret");
        expect(protection).toBe("face_password");
        expect(navigate).toHaveBeenCalledWith(["/zelf-authenticator"]);
    });

    it("still sends the wallet password when the ZOTP itself stays face-only", async () => {
        const { component, storeZOTPToZelfKeys } = setup("face_password");

        await fill(component, SETUP_KEY, "wallet-secret");

        expect(component.form.get("requireMasterPasswordOnDecrypt")?.value).toBeFalse();

        await component.save();
        await component.onBiometricsScanned(FACE);

        const [zotp, , password, protection] = storeZOTPToZelfKeys.calls.mostRecent().args;

        expect(zotp.protection).toBe("face");
        expect(protection).toBe("face");
        expect(password).toBe("pgp:wallet-secret");
    });
});
