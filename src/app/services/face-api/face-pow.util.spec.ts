import {
    hashMeetsDifficulty,
    leadingZeroBits,
    resolvePowDifficultyMode,
    sha256Hex,
    solveFacePow,
} from "./face-pow.util";

/**
 * Vectors generated with Node `crypto` + `face-pow.module.js` algorithms (022d968).
 * Legacy hex: SHA-256(salt+n) must start with `difficulty` hex zero characters.
 * Bits: `leadingZeroBits(digest) >= difficulty`.
 */
const LEGACY_HEX_SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const LEGACY_HEX_DIFFICULTY = 1;
const LEGACY_HEX_SOLUTION = "53";
const LEGACY_HEX_HASH = "0da23d0633eef0c28ebee1c048fe9dfc2aa0c91f73579ee248c523078cd92155";

const BITS_SALT = "face-pow-test-salt-bits-8";
const BITS_DIFFICULTY = 8;
const BITS_SOLUTION = "113";
const BITS_HASH = "0015088686ddafa6f162570d309684362939bdd3dc48791b9c3fd1db89e0aa0b";

const BITS16_SALT = "face-pow-test-salt-bits-mode-0001";
const BITS16_DIFFICULTY = 16;
const BITS16_SOLUTION = "80709";
const BITS16_HASH = "0000a1f9a7feca427e1a2b0011aaba360cd1e25c2b2cd4214e5bd158f99a770e";

describe("face-pow.util", () => {
    it("resolvePowDifficultyMode matches server strings", () => {
        expect(resolvePowDifficultyMode({} as import("./face-pow.util").FacePowChallenge)).toBe("leading_hex_zeros");
        expect(resolvePowDifficultyMode({ difficultyMode: "leading_hex_zeros" } as import("./face-pow.util").FacePowChallenge)).toBe(
            "leading_hex_zeros"
        );
        expect(resolvePowDifficultyMode({ difficultyMode: "leading_zero_bits" } as import("./face-pow.util").FacePowChallenge)).toBe(
            "leading_zero_bits"
        );
    });

    it("leadingZeroBits uses digest bytes like server leadingZeroBits", () => {
        expect(leadingZeroBits(BITS_HASH)).toBe(11);
        expect(leadingZeroBits(BITS16_HASH)).toBe(16);
    });

    it("hashMeetsDifficulty leading_hex_zeros uses hex character prefix", () => {
        expect(hashMeetsDifficulty("000abc", 3, "leading_hex_zeros")).toBe(true);
        expect(hashMeetsDifficulty("00abc0", 2, "leading_hex_zeros")).toBe(true);
        expect(hashMeetsDifficulty("0abc00", 1, "leading_hex_zeros")).toBe(true);
        expect(hashMeetsDifficulty("abc000", 1, "leading_hex_zeros")).toBe(false);
        expect(hashMeetsDifficulty(LEGACY_HEX_HASH, LEGACY_HEX_DIFFICULTY, "leading_hex_zeros")).toBe(true);
    });

    it("hashMeetsDifficulty leading_zero_bits uses leading zero bit count", () => {
        expect(hashMeetsDifficulty(BITS_HASH, BITS_DIFFICULTY, "leading_zero_bits")).toBe(true);
        expect(hashMeetsDifficulty(BITS16_HASH, BITS16_DIFFICULTY, "leading_zero_bits")).toBe(true);
        expect(hashMeetsDifficulty(LEGACY_HEX_HASH, 16, "leading_zero_bits")).toBe(false);
    });

    it("solves legacy leading_hex_zeros challenge (no difficultyMode)", async () => {
        const solution = await solveFacePow({
            challengeId: "test-legacy",
            salt: LEGACY_HEX_SALT,
            difficulty: LEGACY_HEX_DIFFICULTY,
        });
        expect(solution).toBe(LEGACY_HEX_SOLUTION);
        const hash = await sha256Hex(`${LEGACY_HEX_SALT}${solution}`);
        expect(hash).toBe(LEGACY_HEX_HASH);
    });

    it("solves leading_zero_bits challenge from server vector", async () => {
        const solution = await solveFacePow({
            challengeId: "test-bits",
            salt: BITS_SALT,
            difficulty: BITS_DIFFICULTY,
            difficultyMode: "leading_zero_bits",
        });
        expect(solution).toBe(BITS_SOLUTION);
        const hash = await sha256Hex(`${BITS_SALT}${solution}`);
        expect(hash).toBe(BITS_HASH);
        expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(BITS_DIFFICULTY);
    });

    it("solves leading_zero_bits difficulty 16 server vector", async () => {
        const solution = await solveFacePow({
            challengeId: "test-bits-16",
            salt: BITS16_SALT,
            difficulty: BITS16_DIFFICULTY,
            difficultyMode: "leading_zero_bits",
        });
        expect(solution).toBe(BITS16_SOLUTION);
        const hash = await sha256Hex(`${BITS16_SALT}${solution}`);
        expect(hash).toBe(BITS16_HASH);
    });
});
