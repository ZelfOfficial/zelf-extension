import { proofRequiresPassword } from "app/onboarding-stack";
import { readPublicDataHasPassword } from "@shared/types/tag.types";

/** Face-security action for POST /api/rewards/daily. */
export const DAILY_REWARD_FACE_ACTION = "daily-reward";

/** Server `{ message, code }` values that must stay unclaimed and retryable. */
export const DAILY_REWARD_ERROR_KEYS: Record<string, string> = {
    ERR_IDENTITY_VERIFICATION_REQUIRED: "rewards.error.identity_required",
    ERR_VERIFICATION_FAILED: "rewards.error.verification_failed",
    ERR_MISSING_PASSWORD: "rewards.error.missing_password",
    ERR_INVALID_PASSWORD: "rewards.error.invalid_password",
    ERR_PASSWORD_REQUIRED: "rewards.error.password_required",
};

export interface DailyRewardClaimRequest {
    tagName: string;
    domain: string;
    faceBase64: string;
    /** Plaintext only until the service encrypts it. Omitted for face-only Zelf IDs. */
    masterPassword?: string;
}

export function dailyRewardErrorTranslationKey(code: string | null | undefined): string | null {
    if (!code) return null;

    return DAILY_REWARD_ERROR_KEYS[code] ?? null;
}

/**
 * Read `{ message, code }` from a claim error. Prefers an explicit `ERR_*` token
 * over a generic HTTP status so a 400 validation failure is not shown as a face error.
 */
export function resolveDailyRewardErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") return null;

    const err = error as Record<string, unknown>;
    const texts: string[] = [];
    const body = err["error"];

    if (typeof body === "string") {
        texts.push(body);
    } else if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        if (typeof record["code"] === "string") texts.push(record["code"]);
        if (typeof record["message"] === "string") texts.push(record["message"]);
    }

    if (typeof err["message"] === "string" && !err["message"].startsWith("Http failure")) {
        texts.push(err["message"]);
    }

    for (const text of texts) {
        const normalized = text.replace(/^\d{3}:/, "").trim();
        if (DAILY_REWARD_ERROR_KEYS[normalized]) return normalized;
    }

    const status = typeof err["status"] === "number" ? err["status"] : undefined;
    if (status === 422) return "ERR_VERIFICATION_FAILED";
    if (status === 401) return "ERR_INVALID_PASSWORD";
    if (status === 409) return "ERR_PASSWORD_REQUIRED";

    return null;
}

/** Password-layer preview wins over a stale `publicData.hasPassword` flag. Unknown metadata asks for the password. */
export async function resolveRequiresMasterPassword(
    publicData: { hasPassword?: unknown } | null | undefined,
    zelfProof: string | undefined,
    preview: (zelfProof: string) => Promise<{ passwordLayer?: string } | null>
): Promise<boolean> {
    const flag = readPublicDataHasPassword(publicData);
    let requires: boolean | undefined = flag === "true" ? true : flag === "false" ? false : undefined;

    if (zelfProof) {
        try {
            const result = await preview(zelfProof);
            const fromLayer = proofRequiresPassword(result?.passwordLayer, flag || undefined);
            if (fromLayer === true || fromLayer === false) requires = fromLayer;
        } catch {
            // Preview can be down. A known flag still applies; otherwise the password step stays on.
        }
    }

    return requires !== false;
}
