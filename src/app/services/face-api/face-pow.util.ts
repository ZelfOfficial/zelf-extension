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

export type PowDifficultyMode = "hex-leading-zeros" | "leading-zero-bits";

/** Read algorithm hint from challenge (server currently uses SHA-256 + hex zeroes). */
export function powDifficultyMode(challenge?: FacePowChallenge): PowDifficultyMode {
    const algo = String(challenge?.algorithm ?? "SHA-256").toUpperCase();
    if (algo.includes("BIT")) {
        return "leading-zero-bits";
    }
    return "hex-leading-zeros";
}

export function countLeadingZeroBitsHex(hashHex: string): number {
    let bits = 0;
    for (let i = 0; i < hashHex.length; i++) {
        const nibble = parseInt(hashHex[i], 16);
        if (Number.isNaN(nibble)) break;
        if (nibble === 0) {
            bits += 4;
            continue;
        }
        for (let bit = 3; bit >= 0; bit--) {
            if ((nibble >> bit) & 1) {
                return bits;
            }
            bits++;
        }
        break;
    }
    return bits;
}

/**
 * Leading hex zero characters — mirrors `FacePow.hashMeetsDifficulty` on API branch f99e.
 */
export function hashMeetsDifficulty(hashHex: string, difficulty: number, mode: PowDifficultyMode = "hex-leading-zeros"): boolean {
    const d = Math.max(0, Math.floor(difficulty));
    if (d === 0) return true;
    const lower = hashHex.toLowerCase();
    if (mode === "leading-zero-bits") {
        return countLeadingZeroBitsHex(lower) >= d;
    }
    return lower.startsWith("0".repeat(d));
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
    const mode = powDifficultyMode(challenge);
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
