import { bareOnboardingName, givenOnboardingName, seedImportNextPath, seedImportPasswordPath } from "./seed-import-name.util";

describe("seed import name", () => {
    it("keeps a name that was already given, without the domain suffix", () => {
        expect(bareOnboardingName("  Sample.Zelf  ")).toBe("sample");
        expect(bareOnboardingName("")).toBe("");
        expect(bareOnboardingName(null)).toBe("");
    });

    it("uses the name chosen for this import before an older stored name", () => {
        expect(givenOnboardingName("fresh", "older")).toBe("fresh");
        expect(givenOnboardingName("", "older.zelf")).toBe("older");
        expect(givenOnboardingName("", "")).toBe("");
    });

    it("goes to the master password when the name is already stored", () => {
        expect(seedImportNextPath("zelfid", "sample")).toBe("/security-zelfid/password");
        expect(seedImportNextPath("legacy", "sample.zelf")).toBe("/security/password");
    });

    it("asks for a name only when none was given", () => {
        expect(seedImportNextPath("zelfid", "")).toBe("/welcome-zelfid/find-import-claim");
        expect(seedImportNextPath("legacy", "   ")).toBe("/welcome/find-import-claim");
    });

    it("does not skip face capture: the carried name stops at the password step", () => {
        expect(seedImportPasswordPath("zelfid")).not.toContain("biometrics");
        expect(seedImportNextPath("zelfid", "sample")).toBe(seedImportPasswordPath("zelfid"));
        expect(seedImportNextPath("legacy", "sample")).toBe(seedImportPasswordPath("legacy"));
    });
});
