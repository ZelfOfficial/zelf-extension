import { resolveDailyRewardErrorCode, resolveRequiresMasterPassword } from "./daily-reward-identity";

describe("daily reward identity", () => {
    const codes = [
        "ERR_IDENTITY_VERIFICATION_REQUIRED",
        "ERR_VERIFICATION_FAILED",
        "ERR_MISSING_PASSWORD",
        "ERR_INVALID_PASSWORD",
        "ERR_PASSWORD_REQUIRED",
    ];

    it("reads each claim error code from message and code", () => {
        for (const code of codes) {
            expect(resolveDailyRewardErrorCode({ status: 400, error: { message: code, code } })).toBe(code);
        }
    });

    it("does not treat a generic 400 as a missing face", () => {
        expect(resolveDailyRewardErrorCode({ status: 400, error: { message: "already claimed", code: "BadRequest" } })).toBeNull();
    });

    it("treats a face-only public flag as no password", async () => {
        const requires = await resolveRequiresMasterPassword({ hasPassword: "false" }, "", async () => null);

        expect(requires).toBeFalse();
    });

    it("asks for a password when the proof layer has one, even if the stored flag is stale", async () => {
        const requires = await resolveRequiresMasterPassword({ hasPassword: "false" }, "proof", async () => ({ passwordLayer: "WithPassword" }));

        expect(requires).toBeTrue();
    });

    it("omits the password for a face-only proof layer", async () => {
        const requires = await resolveRequiresMasterPassword({ hasPassword: "true" }, "proof", async () => ({ passwordLayer: "NoPassword" }));

        expect(requires).toBeFalse();
    });
});
