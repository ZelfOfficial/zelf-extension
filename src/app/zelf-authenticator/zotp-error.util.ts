import { TranslocoService } from "@jsverse/transloco";

import { ERR_ZELFKEY_PROOF_UNAVAILABLE } from "app/services/zelf-keys-proof.service";

const PASSWORD_REQUIRED_CODES = new Set(["ERR_MISSING_PASSWORD", "ERR_PASSWORD_REQUIRED"]);

/** Angular's HttpErrorResponse.message — not a server payload. */
function isAngularHttpFailureMessage(value: unknown): boolean {
    return typeof value === "string" && value.trim().startsWith("Http failure response");
}

type ZotpErrorBody = {
    message?: string;
    error?: string | { message?: string };
    code?: string;
    validationError?: string;
};

function readZotpError(error: unknown): { body: ZotpErrorBody; topMessage: string } {
    const err = error as { error?: ZotpErrorBody | string; message?: string };

    if (typeof err?.error === "string") {
        return { body: { message: err.error }, topMessage: err.message || "" };
    }

    return { body: err?.error || {}, topMessage: err?.message || "" };
}

/** Resolve ZelfKeys API error token (prefers ERR_* message over HTTP code label). */
export function resolveZotpServerErrorCode(error: unknown): string {
    const { body, topMessage } = readZotpError(error);
    const nestedError = body.error;
    const candidates = [
        body.message,
        typeof nestedError === "object" ? nestedError?.message : null,
        typeof nestedError === "string" ? nestedError : null,
        isAngularHttpFailureMessage(topMessage) ? null : topMessage,
        body.code,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().startsWith("ERR_")) {
            return candidate.trim();
        }
    }

    return "";
}

export function isZotpPasswordRequiredError(error: unknown): boolean {
    return PASSWORD_REQUIRED_CODES.has(resolveZotpServerErrorCode(error));
}

function validationErrorCopy(validationError: string, transloco: TranslocoService): string | null {
    const text = validationError.trim();

    if (!text) return null;

    // Never surface the server sentence: Joi may echo the submitted setup key.
    if (/setup\s*key/i.test(text)) {
        return transloco.translate("zotp.errors.invalid_setup_key");
    }

    if (/\b(algorithm|digits|period)\b/i.test(text)) {
        return transloco.translate("zotp.errors.invalid_totp_params");
    }

    return null;
}

/** Map ZelfKeys / retrieve API errors to user-facing zOTP copy. */
export function extractZotpApiErrorMessage(error: unknown, transloco: TranslocoService): string {
    const fallback = transloco.translate("zotp.decrypt_failed");
    const { body, topMessage } = readZotpError(error);
    const nestedError = body.error;
    const serverMessage =
        body.message ||
        (typeof nestedError === "object" ? nestedError?.message : null) ||
        (typeof nestedError === "string" ? nestedError : null) ||
        (isAngularHttpFailureMessage(topMessage) ? null : topMessage) ||
        null;

    const serverCode = resolveZotpServerErrorCode(error);

    if (PASSWORD_REQUIRED_CODES.has(serverCode)) {
        return transloco.translate("zotp.protection.errors.password_required");
    }

    if (serverCode === "ERR_INVALID_PASSWORD") {
        return transloco.translate("zotp.incorrect_password");
    }

    if (serverCode === "ERR_INVALID_SETUP_KEY") {
        return transloco.translate("zotp.errors.invalid_setup_key");
    }

    if (serverCode === "ERR_INVALID_TOTP_PARAMS") {
        return transloco.translate("zotp.errors.invalid_totp_params");
    }

    if (serverCode === ERR_ZELFKEY_PROOF_UNAVAILABLE || topMessage === ERR_ZELFKEY_PROOF_UNAVAILABLE) {
        return transloco.translate("zotp.errors.proof_load_failed");
    }

    const fromValidation = validationErrorCopy(body.validationError || "", transloco);

    if (fromValidation) return fromValidation;

    if (typeof serverMessage === "string" && serverMessage.trim().length > 0 && !isAngularHttpFailureMessage(serverMessage)) {
        const normalizedKey = serverMessage.trim();
        const translated = transloco.translate(normalizedKey);
        const message = translated && translated !== normalizedKey ? translated : normalizedKey;
        const lower = message.toLowerCase();

        if (lower.includes("password") && (lower.includes("invalid") || lower.includes("incorrect") || lower.includes("required"))) {
            return transloco.translate("zotp.incorrect_password");
        }

        if (lower.includes("liveness") || lower.includes("biometric")) {
            return transloco.translate("zotp.biometrics_failed");
        }

        return message;
    }

    return fallback;
}
