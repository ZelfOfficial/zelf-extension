import { ErrorService } from "../../../services/error.service";
import { BiometricsBottomSheetComponent } from "./biometrics-bottom-sheet.component";

describe("BiometricsBottomSheetComponent API errors (decrypt audit)", () => {
    const dict: Record<string, string> = {
        "errors.generic": "Generic",
        "errors.ERR_INVALID_PASSWORD": "Wrong password",
        "errors.ERR_PASSWORD_REQUIRED": "Password required",
        "errors.ERR_MISSING_PASSWORD": "Master password required",
        "errors.ERR_VERIFICATION_FAILED": "Face mismatch",
        "errors.liveness_failed_help": "Liveness help",
    };
    const transloco: any = { translate: (k: string) => dict[k] ?? k };
    const make = () =>
        new BiometricsBottomSheetComponent(
            { itemData: {}, itemType: "password", mode: "decrypt" } as any,
            {} as any,
            {} as any,
            {} as any,
            new ErrorService(transloco),
            transloco,
            {} as any,
            {} as any,
            {} as any
        );
    const t = (c: any, err: any) => (c as any)._translateApiError(err, "Fallback");

    it("maps Zelf Keys API bodies to translated messages", () => {
        const c = make();
        expect(t(c, { status: 401, error: { message: "ERR_INVALID_PASSWORD", code: "Unauthorized" } })).toBe("Wrong password");
        expect(t(c, { status: 409, error: { message: "ERR_PASSWORD_REQUIRED", code: "Conflict" } })).toBe("Password required");
        expect(t(c, { status: 400, error: { message: "ERR_MISSING_PASSWORD", code: "BadRequest" } })).toBe("Master password required");
        expect(t(c, { status: 422, error: { message: "ERR_VERIFICATION_FAILED" } })).toBe("Face mismatch");
        expect(t(c, { status: 422, error: { message: "ERR_LIVENESS_FAILED" } })).toBe("Liveness help");
    });

    it("falls back for unknown errors instead of showing raw text", () => {
        expect(t(make(), { status: 409, error: { message: "failed_to_decrypt", code: "Conflict" } })).toBe("Fallback");
    });

    it("closes the face sheet on ERR_PLAN_LIMIT_REACHED instead of the generic storage error", async () => {
        const dismiss = jasmine.createSpy("dismiss");
        const storePasswordWithAuth = jasmine.createSpy("storePasswordWithAuth").and.rejectWith({
            status: 409,
            error: {
                message: "Plan limit reached",
                code: "ERR_PLAN_LIMIT_REACHED",
                kind: "password",
                count: 5,
                limit: 5,
                plan: "free",
                tokenCost: 10,
            },
        });
        const component = new BiometricsBottomSheetComponent(
            {
                itemData: { email: "a@a.com", password: "secret", url: "https://example.com" },
                itemType: "password",
                mode: "encrypt",
            } as any,
            { dismiss } as any,
            { detectChanges() {} } as any,
            {} as any,
            new ErrorService(transloco),
            transloco,
            {} as any,
            {} as any,
            { storePasswordWithAuth } as any
        );

        component.wallet = { zelfProof: "proof", hasPassword: false };

        await component.onBiometricsSuccess({ faceBase64: "face" });

        expect(storePasswordWithAuth).toHaveBeenCalled();
        expect(dismiss).toHaveBeenCalledWith(jasmine.objectContaining({ planLimitReached: jasmine.anything() }));
        expect(component.hasStorageError).toBeFalse();
        expect(component.errorMessage).toBe("");
    });
});
