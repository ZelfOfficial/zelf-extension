/** Proof-of-work challenge returned by POST /api/face/nonce or error bodies. */
export interface FacePowChallenge {
    challengeId: string;
    salt: string;
    difficulty: number;
    expiresAt?: string;
    signature?: string;
    algorithm?: string;
    /** Server: `leading_zero_bits` (default on API) or legacy `leading_hex_zeros`. */
    difficultyMode?: string;
}

/** Matches server `Repositories/Face/modules/face-pow.module.js` verify payload. */
export interface FacePowPayload {
    challengeId: string;
    solution: string;
    salt?: string;
    difficulty?: number;
    expiresAt?: string;
    signature?: string;
}

const HEX = "0123456789abcdef";

/** Matches server `DIFFICULTY_MODE` / stored challenge mode strings. */
export type FacePowDifficultyMode = "leading_zero_bits" | "leading_hex_zeros";

/**
 * Resolves how to interpret `difficulty` — mirrors API `face-pow.module.js` (commit 022d968).
 * Legacy challenges omit `difficultyMode` and use leading hex zero characters.
 */
export function resolvePowDifficultyMode(challenge?: FacePowChallenge): FacePowDifficultyMode {
    const mode = challenge?.difficultyMode;
    if (!mode || mode === "leading_hex_zeros") {
        return "leading_hex_zeros";
    }
    if (mode === "leading_zero_bits") {
        return "leading_zero_bits";
    }
    return "leading_zero_bits";
}

/** Byte-based leading zero bits — mirrors server `leadingZeroBits(hashHex)`. */
export function leadingZeroBits(hashHex: string): number {
    const normalized = hashHex.length % 2 === 0 ? hashHex : `0${hashHex}`;
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }

    let bits = 0;
    for (const byte of bytes) {
        if (byte === 0) {
            bits += 8;
            continue;
        }
        for (let j = 7; j >= 0; j--) {
            if (byte & (1 << j)) {
                return bits + (7 - j);
            }
        }
        return bits;
    }
    return bits;
}

export function hashMeetsDifficulty(
    hashHex: string,
    difficulty: number,
    mode: FacePowDifficultyMode = "leading_hex_zeros"
): boolean {
    const required = Math.max(0, Math.floor(difficulty));
    if (required === 0) return true;
    const lower = hashHex.toLowerCase();
    if (mode === "leading_zero_bits") {
        return leadingZeroBits(lower) >= required;
    }
    return lower.startsWith("0".repeat(required));
}

export async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
        hex += HEX[bytes[i] >> 4];
        hex += HEX[bytes[i] & 0x0f];
    }
    return hex;
}

export function getPowDeadlineMs(challenge: FacePowChallenge): number {
    if (challenge.expiresAt) {
        const parsed = Date.parse(challenge.expiresAt);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now() + 300_000;
}

const YIELD_BATCH_SIZE = 2_000;

/**
 * Main-thread fallback: runs until challenge expiry, yielding so the UI stays responsive.
 */
export async function solveFacePow(challenge: FacePowChallenge, startAt = 0, deadlineMs?: number): Promise<string> {
    const salt = challenge.salt ?? "";
    const difficulty = challenge.difficulty ?? 0;
    const mode = resolvePowDifficultyMode(challenge);
    const end = deadlineMs ?? getPowDeadlineMs(challenge);
    let n = startAt;

    while (Date.now() < end) {
        for (let batch = 0; batch < YIELD_BATCH_SIZE && Date.now() < end; batch++, n++) {
            const hash = await sha256Hex(`${salt}${n}`);
            if (hashMeetsDifficulty(hash, difficulty, mode)) {
                return String(n);
            }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    throw new Error("face_pow_unsolved");
}

export function buildPowPayload(challenge: FacePowChallenge, solution: string): FacePowPayload {
    return {
        challengeId: challenge.challengeId,
        solution,
        salt: challenge.salt,
        difficulty: challenge.difficulty,
        expiresAt: challenge.expiresAt,
        signature: challenge.signature,
    };
}
