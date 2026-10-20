import type { FacePowChallenge } from "./face-pow.util";

export class FaceLockedError extends Error {
    readonly code = "face_locked";
    readonly retryAfterSeconds: number;

    constructor(retryAfterSeconds: number, message?: string) {
        super(message ?? "face_locked");
        this.name = "FaceLockedError";
        this.retryAfterSeconds = Math.max(0, Math.floor(retryAfterSeconds));
    }
}

export function isHttpFaceError(error: unknown): error is { status: number; error?: Record<string, unknown>; headers?: { get?: (k: string) => string | null } } {
    return Boolean(error && typeof error === "object" && "status" in error);
}

export function parseRetryAfterSeconds(error: {
    status?: number;
    error?: Record<string, unknown>;
    headers?: { get?: (k: string) => string | null };
}): number {
    const body = error.error ?? {};
    const fromBody = body["retryAfter"] ?? body["retry_after"];
    if (typeof fromBody === "number" && Number.isFinite(fromBody)) {
        return fromBody;
    }
    if (typeof fromBody === "string" && fromBody.trim()) {
        const parsed = parseInt(fromBody, 10);
        if (!Number.isNaN(parsed)) return parsed;
    }
    const header = error.headers?.get?.("Retry-After");
    if (header) {
        const parsed = parseInt(header, 10);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
}

export function isFaceLockedError(error: { status?: number; error?: Record<string, unknown> }): boolean {
    if (error.status === 429) return true;
    const code = String(error.error?.["code"] ?? "").toLowerCase();
    return code === "face_locked";
}

export function extractErrorCode(error: { error?: Record<string, unknown> }): string {
    return String(error.error?.["code"] ?? "").toLowerCase();
}

export function extractPowChallengeFromError(error: { error?: Record<string, unknown> }): FacePowChallenge | null {
    const body = error.error ?? {};
    const code = String(body["code"] ?? "").toLowerCase();
    const nested = (body["pow"] ?? body["challenge"]) as Record<string, unknown> | undefined;

    if (code !== "pow_required" && code !== "face_pow_required" && code !== "face_pow_invalid" && !nested) {
        return null;
    }

    const source = nested ?? body;
    const challengeId = source["challengeId"] ?? source["challenge_id"];
    const salt = source["salt"];
    const difficulty = source["difficulty"];

    if (typeof challengeId !== "string" || typeof salt !== "string" || typeof difficulty !== "number") {
        return null;
    }

    return {
        challengeId,
        salt,
        difficulty,
        expiresAt: typeof source["expiresAt"] === "string" ? source["expiresAt"] : undefined,
        signature: typeof source["signature"] === "string" ? source["signature"] : undefined,
        algorithm: typeof source["algorithm"] === "string" ? source["algorithm"] : undefined,
        difficultyMode: typeof source["difficultyMode"] === "string" ? source["difficultyMode"] : undefined,
    };
}

const FACE_NONCE_RETRY_CODES = new Set([
    "face_nonce_missing",
    "face_nonce_used",
    "face_nonce_invalid",
    "face_nonce_mismatch",
]);

export function shouldRetryWithFreshNonce(error: { status?: number; error?: Record<string, unknown> }): boolean {
    if (error.status !== 409) return false;
    const code = extractErrorCode(error);
    return FACE_NONCE_RETRY_CODES.has(code) || code === "face_replay_detected";
}

export function shouldRetryWithFreshPow(error: { status?: number; error?: Record<string, unknown> }): boolean {
    if (error.status === 428) return true;
    if (error.status === 409 && extractErrorCode(error) === "face_pow_invalid") return true;
    return false;
}
