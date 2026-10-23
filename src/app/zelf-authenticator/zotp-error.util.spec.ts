import { extractZotpApiErrorMessage, isZotpPasswordRequiredError, resolveZotpServerErrorCode } from "./zotp-error.util";

describe("zotp-error.util", () => {
    const transloco = {
        translate: (key: string) => {
            const dict: Record<string, string> = {
                "zotp.decrypt_failed": "Decrypt failed",
                "zotp.protection.errors.password_required": "Master password required",
                "zotp.incorrect_password": "Incorrect password",
                "zotp.errors.invalid_setup_key": "Setup key rejected",
                "zotp.errors.invalid_totp_params": "TOTP params rejected",
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

    it("maps a store 409 ERR_INVALID_SETUP_KEY that has no message and does not echo the key", () => {
        const setupKey = "JBSWY3DPEHPK3PXP";
        const error = {
            status: 409,
            message: "Http failure response for https://v4.zelf.world/api/zelf-keys/store/zotp: 409 OK",
            error: {
                code: "ERR_INVALID_SETUP_KEY",
                validationError: `setupKey with value "${setupKey}" must be at least 16 Base32 characters`,
            },
        };

        expect(resolveZotpServerErrorCode(error)).toBe("ERR_INVALID_SETUP_KEY");

        const message = extractZotpApiErrorMessage(error, transloco);

        expect(message).toBe("Setup key rejected");
        expect(message).not.toContain(setupKey);
        expect(message).not.toContain("Http failure");
    });

    it("maps validationError-only setup key failures the same way", () => {
        const error = {
            status: 409,
            message: "Http failure response for https://v4.zelf.world/api/zelf-keys/store/zotp: 409 OK",
            error: { validationError: "setupKey must contain only Base32 characters" },
        };

        expect(extractZotpApiErrorMessage(error, transloco)).toBe("Setup key rejected");
    });

    it("maps ERR_INVALID_TOTP_PARAMS without showing the HTTP failure string", () => {
        const error = {
            status: 409,
            message: "Http failure response for https://v4.zelf.world/api/zelf-keys/store/zotp: 409 OK",
            error: { code: "ERR_INVALID_TOTP_PARAMS", validationError: "digits must be between 6 and 8" },
        };

        expect(extractZotpApiErrorMessage(error, transloco)).toBe("TOTP params rejected");
    });
});
