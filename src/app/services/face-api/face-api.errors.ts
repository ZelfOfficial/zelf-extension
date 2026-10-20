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

export class FacePowRequiredError extends Error {
    readonly code = "pow_required";
    readonly challenge: FacePowChallenge;

    constructor(challenge: FacePowChallenge) {
        super("pow_required");
        this.name = "FacePowRequiredError";
        this.challenge = challenge;
    }
}

export function isHttpFaceError(error: unknown): error is { status: number; error?: Record<string, unknown> } {
    return Boolean(error && typeof error === "object" && "status" in error);
}

export function parseRetryAfterSeconds(error: { status?: number; error?: Record<string, unknown>; headers?: { get?: (k: string) => string | null } }): number {
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

export function extractPowChallengeFromError(error: { error?: Record<string, unknown> }): FacePowChallenge | null {
    const body = error.error ?? {};
    const code = String(body["code"] ?? "").toLowerCase();
    if (code !== "pow_required" && code !== "face_pow_required") {
        return null;
    }

    const nested = (body["pow"] ?? body["challenge"] ?? body) as Record<string, unknown>;
    const challengeId = nested["challengeId"] ?? nested["challenge_id"];
    const salt = nested["salt"];
    const difficulty = nested["difficulty"];

    if (typeof challengeId !== "string" || typeof salt !== "string" || typeof difficulty !== "number") {
        return null;
    }

    return {
        challengeId,
        salt,
        difficulty,
        expiresAt: typeof nested["expiresAt"] === "string" ? nested["expiresAt"] : undefined,
        signature: typeof nested["signature"] === "string" ? nested["signature"] : undefined,
        algorithm: typeof nested["algorithm"] === "string" ? nested["algorithm"] : undefined,
    };
}

export function isFaceLockedError(error: { status?: number; error?: Record<string, unknown> }): boolean {
    if (error.status === 429) return true;
    const code = String(error.error?.["code"] ?? "").toLowerCase();
    return code === "face_locked";
}
