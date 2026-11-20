import { resolveDailyRewardErrorCode } from "./daily-reward-identity";

/** Face-security action for POST /api/rewards/first-transaction. */
export const FIRST_TRANSACTION_FACE_ACTION = "first-transaction";

/** Shown only when every translation is missing or is itself an error code. */
const LAST_RESORT_MESSAGE = "We couldn't complete this reward. Please try again.";

/** Server `{ message, code }` values for the first-transaction reward. Codes stay UPPER_SNAKE. */
export const FIRST_TRANSACTION_ERROR_KEYS: Record<string, string> = {
    ERR_IDENTITY_VERIFICATION_REQUIRED: "rewards.first_transaction.identity_required",
    ERR_VERIFICATION_FAILED: "rewards.first_transaction.error_verification_failed",
    ERR_MISSING_PASSWORD: "rewards.first_transaction.error_missing_password",
    ERR_INVALID_PASSWORD: "rewards.first_transaction.error_invalid_password",
    ERR_PASSWORD_REQUIRED: "rewards.first_transaction.error_password_required",
    ERR_SESSION_OWNER_MISMATCH: "rewards.first_transaction.error_owner_mismatch",
    BDAG_DEPRECATED: "errors.BDAG_DEPRECATED",
};

export const FIRST_TRANSACTION_ERROR_FALLBACK_KEY = "rewards.first_transaction.error_generic";

export interface FirstTransactionClaimRequest {
    tagName: string;
    domain: string;
    /** Encrypted capture. Omitted on the probe request that may ask for a face. */
    faceBase64?: string;
    /** Plaintext only until the service encrypts it. Omitted for face-only Zelf IDs. */
    masterPassword?: string;
}

export function resolveFirstTransactionErrorCode(error: unknown): string | null {
    return resolveDailyRewardErrorCode(error, FIRST_TRANSACTION_ERROR_KEYS);
}

/** A whole message that is only an API code, or a sentence that still contains one. */
export function isRawRewardErrorCode(text: string | null | undefined): boolean {
    const trimmed = (text || "").trim();
    if (!trimmed) return false;
    if (/^(?:\d{3}:)?[A-Z][A-Z0-9_]+$/.test(trimmed)) return true;
    return /\b(?:\d{3}:)?ERR_[A-Z0-9_]+\b/.test(trimmed);
}

/**
 * Translate a reward error. A missing key, or a translation that is still the raw code, uses the fallback.
 * The raw code is never returned.
 */
export function rewardUserFacingMessage(
    code: string | null | undefined,
    translate: (key: string) => string,
    keys: Record<string, string> = FIRST_TRANSACTION_ERROR_KEYS,
    fallbackKey: string = FIRST_TRANSACTION_ERROR_FALLBACK_KEY
): string {
    const key = code ? keys[code] : undefined;
    if (key) {
        const text = safeTranslation(translate, key);
        if (text) return text;
    }

    const fallback = safeTranslation(translate, fallbackKey);
    return fallback || LAST_RESORT_MESSAGE;
}

function safeTranslation(translate: (key: string) => string, key: string): string | null {
    let text = "";
    try {
        text = translate(key) || "";
    } catch {
        return null;
    }

    const trimmed = text.trim();
    if (!trimmed || trimmed === key || isRawRewardErrorCode(trimmed)) return null;
    return trimmed;
}
