import { extractZotpApiErrorMessage, isZotpPasswordRequiredError, resolveZotpServerErrorCode } from "./zotp-error.util";

describe("zotp-error.util", () => {
    const transloco = {
        translate: (key: string) => {
            const dict: Record<string, string> = {
                "zotp.decrypt_failed": "Decrypt failed",
                "zotp.protection.errors.password_required": "Master password required",
                "zotp.incorrect_password": "Incorrect password",
            };

            return dict[key] ?? key;
        },
    } as any;

    it("resolves ERR_* codes from message when HTTP code is BadRequest", () => {
        const error = { status: 400, error: { message: "ERR_MISSING_PASSWORD", code: "BadRequest" } };

        expect(resolveZotpServerErrorCode(error)).toBe("ERR_MISSING_PASSWORD");
        expect(isZotpPasswordRequiredError(error)).toBe(true);
        expect(extractZotpApiErrorMessage(error, transloco)).toBe("Master password required");
    });

    it("maps ERR_PASSWORD_REQUIRED to master-password copy", () => {
        const error = { status: 409, error: { message: "ERR_PASSWORD_REQUIRED", code: "Conflict" } };

        expect(extractZotpApiErrorMessage(error, transloco)).toBe("Master password required");
    });
});
