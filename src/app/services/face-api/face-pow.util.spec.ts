import { hashMeetsDifficulty, sha256Hex, solveFacePow } from "./face-pow.util";

/** Vector from zelf-online-version FacePow (Node): salt + n=53, difficulty 1. */
const SERVER_TEST_SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SERVER_TEST_DIFFICULTY = 1;
const SERVER_TEST_SOLUTION = "53";
const SERVER_TEST_HASH = "0da23d0633eef0c28ebee1c048fe9dfc2aa0c91f73579ee248c523078cd92155";

describe("face-pow.util", () => {
    it("hashMeetsDifficulty uses leading hex zero characters", () => {
        expect(hashMeetsDifficulty("000abc", 3)).toBe(true);
        expect(hashMeetsDifficulty("00abc0", 2)).toBe(true);
        expect(hashMeetsDifficulty("0abc00", 1)).toBe(true);
        expect(hashMeetsDifficulty("abc000", 1)).toBe(false);
    });

    it("matches server verify vector (Repositories/Face/modules/face-pow.module.js)", async () => {
        expect(hashMeetsDifficulty(SERVER_TEST_HASH, SERVER_TEST_DIFFICULTY)).toBe(true);
        const solution = await solveFacePow({
            challengeId: "test",
            salt: SERVER_TEST_SALT,
            difficulty: SERVER_TEST_DIFFICULTY,
        });
        expect(solution).toBe(SERVER_TEST_SOLUTION);
        const hash = await sha256Hex(`${SERVER_TEST_SALT}${solution}`);
        expect(hash).toBe(SERVER_TEST_HASH);
    });
});
