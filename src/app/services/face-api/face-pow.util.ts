/** Proof-of-work challenge returned by POST /api/face/nonce or 428 pow_required. */
export interface FacePowChallenge {
    challengeId: string;
    salt: string;
    difficulty: number;
    expiresAt?: string;
    signature?: string;
    algorithm?: string;
}

export interface FacePowSolution {
    challengeId: string;
    solution: string;
}

const HEX = "0123456789abcdef";

/** Count leading zero bits in a lowercase hex digest (4 bits per hex char). */
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

export function hashMeetsDifficulty(hashHex: string, difficulty: number): boolean {
    if (!difficulty || difficulty <= 0) return true;
    return countLeadingZeroBitsHex(hashHex.toLowerCase()) >= difficulty;
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
 * Find the smallest non-negative integer n such that SHA-256(salt + n) meets difficulty.
 * Used by unit tests and as a main-thread fallback.
 */
export async function solveFacePow(challenge: FacePowChallenge, startAt = 0): Promise<string> {
    const salt = challenge.salt ?? "";
    const difficulty = challenge.difficulty ?? 0;

    for (let n = startAt; n < Number.MAX_SAFE_INTEGER; n++) {
        const hash = await sha256Hex(`${salt}${n}`);
        if (hashMeetsDifficulty(hash, difficulty)) {
            return String(n);
        }
    }

    throw new Error("face_pow_unsolved");
}
