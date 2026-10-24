import { FormBuilder } from "@angular/forms";
import { Subject, of } from "rxjs";

import { PasswordFormComponent } from "./zelf-keys-password-form.component";

describe("PasswordFormComponent plan limits", () => {
    function setup() {
        const ensureCanAdd = jasmine.createSpy("ensureCanAdd").and.resolveTo(false);
        const recoverFromSaveError = jasmine.createSpy("recoverFromSaveError").and.resolveTo("dismissed");
        const open = jasmine.createSpy("open").and.returnValue({ afterDismissed: () => of(undefined) });
        const encryptMessage = jasmine.createSpy("encryptMessage").and.callFake(async (value: string) => `pgp:${value}`);
        const storeData = jasmine.createSpy("storeData").and.resolveTo(undefined);
        const component = new PasswordFormComponent(
            { snapshot: { queryParamMap: { get: () => null }, paramMap: { get: () => "new" } } } as any,
            { urlInfo$: new Subject() } as any,
            { open } as any,
            { detectChanges() {} } as any,
            { storeData } as any,
            { onDestroy: () => () => undefined } as any,
            new FormBuilder(),
            { encryptMessage } as any,
            {} as any,
            { ensureCanAdd, recoverFromSaveError } as any,
            { navigate() {} } as any,
            {} as any
        );

        component.formValid = true;
        component.hasMasterPassword = false;

        return { component, ensureCanAdd, recoverFromSaveError, open, encryptMessage, storeData };
    }

    it("does not charge 10 ZNS per save and stops when the plan sheet is dismissed", async () => {
        const { component, ensureCanAdd, open, storeData } = setup();

        await component.onSave();

        expect(ensureCanAdd).toHaveBeenCalledWith("password", jasmine.objectContaining({ hasMasterPassword: false }));
        expect(open).not.toHaveBeenCalled();
        expect(storeData).not.toHaveBeenCalled();
    });

    it("opens face verification when the plan allows another password", async () => {
        const { component, ensureCanAdd, open, storeData, encryptMessage } = setup();

        ensureCanAdd.and.resolveTo(true);

        await component.onSave();

        expect(encryptMessage).toHaveBeenCalled();
        expect(storeData).toHaveBeenCalledWith("passwords", jasmine.any(Object));
        expect(open).toHaveBeenCalled();
    });

    it("retries the face step after a slot is bought from a storage 409", async () => {
        const { component, open, recoverFromSaveError } = setup();
        const limitError = { status: 409, error: { code: "ERR_PLAN_LIMIT_REACHED" } };

        open.and.returnValues(
            { afterDismissed: () => of({ planLimitReached: limitError }) },
            { afterDismissed: () => of(undefined) }
        );
        recoverFromSaveError.and.resolveTo("retry");
        component.transformedPasswordData = { url: "https://example.com" };

        (component as any)._openBiometricsBottomSheet();
        await Promise.resolve();
        await Promise.resolve();

        expect(recoverFromSaveError).toHaveBeenCalledWith(limitError, "password", jasmine.any(Object));
        expect(open).toHaveBeenCalledTimes(2);
    });
});
