import { countLeadingZeroBitsHex, hashMeetsDifficulty, sha256Hex, solveFacePow } from "./face-pow.util";

describe("face-pow.util", () => {
    it("countLeadingZeroBitsHex counts nibbles and partial bits", () => {
        expect(countLeadingZeroBitsHex("0000abc")).toBe(16);
        expect(countLeadingZeroBitsHex("08000000")).toBe(4);
        expect(countLeadingZeroBitsHex("f0000000")).toBe(0);
    });

    it("hashMeetsDifficulty respects difficulty", () => {
        expect(hashMeetsDifficulty("0000ff", 8)).toBe(true);
        expect(hashMeetsDifficulty("00ff00", 8)).toBe(true);
        expect(hashMeetsDifficulty("0fff00", 12)).toBe(false);
    });

    it("solveFacePow finds a solution for low difficulty", async () => {
        const challenge = { challengeId: "c1", salt: "test-salt-", difficulty: 4 };
        const solution = await solveFacePow(challenge);
        const hash = await sha256Hex(`${challenge.salt}${solution}`);
        expect(hashMeetsDifficulty(hash, challenge.difficulty)).toBe(true);
    });
});
