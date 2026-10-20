import { Injectable } from "@angular/core";
import { TranslocoService } from "@jsverse/transloco";

@Injectable({
    providedIn: "root",
})
export class ErrorService {
    _defaultErrorMessage = "";

    constructor(private _translocoService: TranslocoService) {
        this._defaultErrorMessage = this._translocoService.translate("errors.generic");
    }

    private readonly API_MESSAGE_TO_KEY: Record<string, string> = {
        "FACE IS NOT CENTRAL, PLEASE USE AN IMAGE WITH A CENTRAL FACE.": "face_not_central",
        "VERIFICATION FAILED": "ERR_VERIFICATION_FAILED",
        "VERIFICATION FAILED.": "ERR_VERIFICATION_FAILED",
        "500:ERR_VERIFICATION_FAILED": "ERR_VERIFICATION_FAILED",
        "409:ERR_VERIFICATION_FAILED": "ERR_VERIFICATION_FAILED",
        "422:ERR_VERIFICATION_FAILED": "ERR_VERIFICATION_FAILED",
        "INVALID PASSWORD": "ERR_INVALID_PASSWORD",
        "INVALID PASSWORD.": "ERR_INVALID_PASSWORD",
        "THE PROVIDED PASSWORD IS INVALID.": "ERR_INVALID_PASSWORD",
        "401:ERR_INVALID_PASSWORD": "ERR_INVALID_PASSWORD",
        "PASSWORD REQUIRED": "ERR_PASSWORD_REQUIRED",
        "PASSWORD REQUIRED.": "ERR_PASSWORD_REQUIRED",
        "409:ERR_PASSWORD_REQUIRED": "ERR_PASSWORD_REQUIRED",
    };

    resolveErrorKey(error: unknown): string {
        if (!error || typeof error !== "object") {
            return "unknown_error";
        }

        const err = error as Record<string, unknown>;
        const body = err["error"];

        if (body && typeof body === "object") {
            const errorBody = body as Record<string, unknown>;

            if (typeof errorBody["code"] === "string") {
                const code = errorBody["code"];
                if (code.startsWith("ERR_")) {
                    return code;
                }
                if (code === "face_locked" || code === "pow_required") {
                    return code;
                }
            }

            if (typeof errorBody["message"] === "string" && errorBody["message"].trim()) {
                return this._normalizeErrorKey(errorBody["message"]);
            }
        }

        if (typeof err["message"] === "string" && err["message"].trim()) {
            return this._normalizeErrorKey(err["message"]);
        }

        return "unknown_error";
    }

    isLivenessError(key: string): boolean {
        const normalized = key.toLowerCase();

        return normalized.includes("liveness") || normalized.includes("err_liveness") || normalized.includes("face_not");
    }

    translateErrorMessage(key: string, fallbackErrorKey: string = "", params?: Record<string, unknown>): string {
        const trimmed = key?.trim() || "";
        const mappedKey = this.API_MESSAGE_TO_KEY[trimmed] ?? trimmed;
        const formattedKey = `errors.${mappedKey}`;

        const translation = this._translocoService.translate(formattedKey, params ?? {});

        return translation !== formattedKey
            ? translation
            : fallbackErrorKey
              ? this._translocoService.translate(fallbackErrorKey, params ?? {})
              : this._defaultErrorMessage;
    }

    formatFaceLockDuration(retryAfterSeconds: number): string {
        const total = Math.max(0, Math.floor(retryAfterSeconds));
        if (total >= 3600) {
            const hours = Math.max(1, Math.ceil(total / 3600));
            return this._translocoService.translate("errors.face_locked_about_hours", { hours });
        }
        if (total >= 120) {
            const minutes = Math.max(1, Math.ceil(total / 60));
            return this._translocoService.translate("errors.face_locked_about_minutes", { minutes });
        }
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    translateFaceLocked(retryAfterSeconds: number): { title: string; message: string } {
        const time = this.formatFaceLockDuration(retryAfterSeconds);
        const params = { time, seconds: retryAfterSeconds };
        return {
            title: this._translocoService.translate("errors.face_locked_title", params),
            message: this._translocoService.translate("errors.face_locked", params),
        };
    }

    private _normalizeErrorKey(message: string): string {
        const withoutStatus = message.replace(/^\d{3}:/, "").trim();

        if (withoutStatus.startsWith("ERR_")) {
            return withoutStatus;
        }

        const mapped = this.API_MESSAGE_TO_KEY[withoutStatus];
        if (mapped) {
            return mapped;
        }

        const slug = withoutStatus.toLowerCase().replace(/\s+/g, "_").replace(/\.+$/, "");

        return slug === "verification_failed" ? "ERR_VERIFICATION_FAILED" : slug;
    }
}
