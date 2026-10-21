import { TranslocoService } from "@jsverse/transloco";

import { ERR_ZELFKEY_PROOF_UNAVAILABLE } from "app/services/zelf-keys-proof.service";

const PASSWORD_REQUIRED_CODES = new Set(["ERR_MISSING_PASSWORD", "ERR_PASSWORD_REQUIRED"]);

/** Resolve ZelfKeys API error token (prefers ERR_* message over HTTP code label). */
export function resolveZotpServerErrorCode(error: unknown): string {
    const err = error as {
        error?: { message?: string; error?: string | { message?: string }; code?: string };
        message?: string;
    };

    const nestedError = err?.error?.error;
    const serverMessage =
        err?.error?.message ||
        (typeof nestedError === "object" ? nestedError?.message : null) ||
        (typeof err?.error === "string" ? err.error : null) ||
        err?.message ||
        null;

    if (typeof serverMessage === "string" && serverMessage.trim().startsWith("ERR_")) {
        return serverMessage.trim();
    }

    if (typeof nestedError === "string" && nestedError.trim().startsWith("ERR_")) {
        return nestedError.trim();
    }

    const httpCode = err?.error?.code;

    if (typeof httpCode === "string" && httpCode.trim().startsWith("ERR_")) {
        return httpCode.trim();
    }

    return "";
}

export function isZotpPasswordRequiredError(error: unknown): boolean {
    return PASSWORD_REQUIRED_CODES.has(resolveZotpServerErrorCode(error));
}

/** Map ZelfKeys / retrieve API errors to user-facing zOTP copy. */
export function extractZotpApiErrorMessage(error: unknown, transloco: TranslocoService): string {
    const fallback = transloco.translate("zotp.decrypt_failed");
    const err = error as {
        error?: { message?: string; error?: string | { message?: string }; code?: string };
        message?: string;
        status?: number;
    };

    const nestedError = err?.error?.error;
    const serverMessage =
        err?.error?.message ||
        (typeof nestedError === "object" ? nestedError?.message : null) ||
        (typeof err?.error === "string" ? err.error : null) ||
        err?.message ||
        null;

    const serverCode = resolveZotpServerErrorCode(error);

    if (PASSWORD_REQUIRED_CODES.has(serverCode)) {
        return transloco.translate("zotp.protection.errors.password_required");
    }

    if (serverCode === "ERR_INVALID_PASSWORD") {
        return transloco.translate("zotp.incorrect_password");
    }

    if (serverCode === ERR_ZELFKEY_PROOF_UNAVAILABLE || err?.message === ERR_ZELFKEY_PROOF_UNAVAILABLE) {
        return transloco.translate("zotp.errors.proof_load_failed");
    }

    if (typeof serverMessage === "string" && serverMessage.trim().length > 0) {
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
