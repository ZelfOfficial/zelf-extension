import { TranslocoService } from "@jsverse/transloco";

/** Map ZelfKeys / retrieve API errors to user-facing zOTP copy. */
export function extractZotpApiErrorMessage(error: unknown, transloco: TranslocoService): string {
    const fallback = transloco.translate("zotp.decrypt_failed");
    const err = error as {
        error?: { message?: string; error?: { message?: string }; code?: string };
        message?: string;
        status?: number;
    };

    const serverMessage =
        err?.error?.message ||
        err?.error?.error?.message ||
        (typeof err?.error === "string" ? err.error : null) ||
        err?.message ||
        null;

    const serverCode = err?.error?.code || "";

    if (serverCode === "ERR_PASSWORD_REQUIRED") {
        return transloco.translate("zotp.protection.errors.password_required");
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
