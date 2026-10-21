import { ErrorService } from "./error.service";

describe("ErrorService.resolveErrorKey (tags decrypt #50)", () => {
    const dict: Record<string, string> = {
        "errors.generic": "Generic",
        "errors.ERR_INVALID_PASSWORD": "Wrong password",
        "errors.ERR_PASSWORD_REQUIRED": "Password required",
        "errors.ERR_VERIFICATION_FAILED": "Face mismatch",
        "errors.failed_to_decrypt": "Decrypt failed",
    };

    const service = new ErrorService({ translate: (k: string) => dict[k] ?? k } as any);

    it("maps API error bodies with HTTP status to distinct keys", () => {
        expect(service.resolveErrorKey({ status: 401, error: { message: "ERR_INVALID_PASSWORD", code: "Unauthorized" } })).toBe(
            "ERR_INVALID_PASSWORD"
        );
        expect(service.resolveErrorKey({ status: 409, error: { message: "ERR_PASSWORD_REQUIRED", code: "Conflict" } })).toBe(
            "ERR_PASSWORD_REQUIRED"
        );
        expect(service.resolveErrorKey({ status: 422, error: { message: "ERR_VERIFICATION_FAILED" } })).toBe("ERR_VERIFICATION_FAILED");
    });

    it("uses HTTP status when the body is generic (v4 decrypt contract)", () => {
        expect(service.resolveErrorKey({ status: 401, error: { message: "Unauthorized", code: "Unauthorized" } })).toBe("ERR_INVALID_PASSWORD");
        expect(service.resolveErrorKey({ status: 409, error: { message: "Conflict", code: "Conflict" } })).toBe("ERR_PASSWORD_REQUIRED");
        expect(service.resolveErrorKey({ status: 422, error: { message: "Unprocessable Entity" } })).toBe("ERR_VERIFICATION_FAILED");
    });

    it("remaps legacy 409 verification failures to password required", () => {
        expect(service.resolveErrorKey({ status: 409, error: { message: "ERR_VERIFICATION_FAILED", code: "Conflict" } })).toBe(
            "ERR_PASSWORD_REQUIRED"
        );
    });

    it("keeps explicit decrypt failures on 409", () => {
        expect(service.resolveErrorKey({ status: 409, error: { message: "failed_to_decrypt", code: "Conflict" } })).toBe("failed_to_decrypt");
    });

    it("parses string error bodies", () => {
        expect(service.resolveErrorKey({ status: 409, error: "ERR_PASSWORD_REQUIRED" })).toBe("ERR_PASSWORD_REQUIRED");
    });

    it("translateErrorMessage returns localized copy", () => {
        expect(service.translateErrorMessage("ERR_PASSWORD_REQUIRED")).toBe("Password required");
        expect(service.translateErrorMessage("missing_key", "errors.generic")).toBe("Generic");
    });
});
