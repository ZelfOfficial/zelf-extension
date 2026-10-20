/** Proof-of-work challenge returned by POST /api/face/nonce or error bodies. */
export interface FacePowChallenge {
    challengeId: string;
    salt: string;
    difficulty: number;
    expiresAt?: string;
    signature?: string;
    algorithm?: string;
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

/**
 * Leading hex **zero characters** (not bits) — mirrors `FacePow.hashMeetsDifficulty`.
 */
export function hashMeetsDifficulty(hashHex: string, difficulty: number): boolean {
    const d = Math.max(0, Math.floor(difficulty));
    if (d === 0) return true;
    const prefix = "0".repeat(d);
    return hashHex.toLowerCase().startsWith(prefix);
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

/**
 * Find n such that SHA-256(`${salt}${n}`) has `difficulty` leading hex zeroes.
 * Same loop as `tests/unit/face-security.test.js` in zelf-online-version.
 */
export async function solveFacePow(challenge: FacePowChallenge, startAt = 0, maxAttempts = 500_000): Promise<string> {
    const salt = challenge.salt ?? "";
    const difficulty = challenge.difficulty ?? 0;

    for (let n = startAt; n < startAt + maxAttempts; n++) {
        const hash = await sha256Hex(`${salt}${n}`);
        if (hashMeetsDifficulty(hash, difficulty)) {
            return String(n);
        }
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
