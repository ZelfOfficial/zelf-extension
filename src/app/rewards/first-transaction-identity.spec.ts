import {
    FIRST_TRANSACTION_ERROR_FALLBACK_KEY,
    FIRST_TRANSACTION_ERROR_KEYS,
    isRawRewardErrorCode,
    resolveFirstTransactionErrorCode,
    rewardUserFacingMessage,
} from "./first-transaction-identity";

describe("first transaction identity", () => {
    const messages: Record<string, string> = {
        "rewards.first_transaction.identity_required": "Identity verification is required to claim this reward.",
        "rewards.first_transaction.error_generic": "We couldn't complete this reward. Please try again.",
        "rewards.first_transaction.error_verification_failed": "Face mismatch",
        "rewards.first_transaction.error_owner_mismatch": "Wrong owner",
    };

    function translate(key: string): string {
        return messages[key] ?? key;
    }

    it("reads the identity code with its status prefix", () => {
        expect(
            resolveFirstTransactionErrorCode({
                status: 400,
                error: { message: "400:ERR_IDENTITY_VERIFICATION_REQUIRED", code: "ERR_IDENTITY_VERIFICATION_REQUIRED" },
            })
        ).toBe("ERR_IDENTITY_VERIFICATION_REQUIRED");
    });

    it("reads an owner mismatch without lowercasing the code", () => {
        expect(
            resolveFirstTransactionErrorCode({
                status: 403,
                error: { message: "ERR_SESSION_OWNER_MISMATCH", code: "ERR_SESSION_OWNER_MISMATCH" },
            })
        ).toBe("ERR_SESSION_OWNER_MISMATCH");
    });

    it("does not treat a generic 400 sentence as an identity code", () => {
        expect(resolveFirstTransactionErrorCode({ status: 400, error: { message: "already claimed", code: "BadRequest" } })).toBeNull();
    });

    it("translates the identity code and never returns it", () => {
        const text = rewardUserFacingMessage("ERR_IDENTITY_VERIFICATION_REQUIRED", translate);

        expect(text).toBe("Identity verification is required to claim this reward.");
        expect(isRawRewardErrorCode(text)).toBeFalse();
        expect(text).not.toContain("ERR_");
    });

    it("uses the generic translation when the code is unknown", () => {
        const text = rewardUserFacingMessage("ERR_SOMETHING_NEW", translate);

        expect(text).toBe("We couldn't complete this reward. Please try again.");
        expect(text).not.toContain("ERR_SOMETHING_NEW");
    });

    it("falls back when a translation is missing or is the raw code", () => {
        const echo = (key: string) => (key === FIRST_TRANSACTION_ERROR_KEYS.ERR_IDENTITY_VERIFICATION_REQUIRED ? "ERR_IDENTITY_VERIFICATION_REQUIRED" : key);
        const text = rewardUserFacingMessage("ERR_IDENTITY_VERIFICATION_REQUIRED", echo);

        expect(text).toBe("We couldn't complete this reward. Please try again.");
        expect(text).not.toBe("ERR_IDENTITY_VERIFICATION_REQUIRED");
    });

    it("uses the last resort sentence when every translation is a code", () => {
        const text = rewardUserFacingMessage("ERR_IDENTITY_VERIFICATION_REQUIRED", () => "ERR_IDENTITY_VERIFICATION_REQUIRED");

        expect(isRawRewardErrorCode(text)).toBeFalse();
        expect(text).not.toContain("ERR_");
        expect(text.length).toBeGreaterThan(0);
    });

    it("keeps the fallback key out of the message when translate returns the key", () => {
        const text = rewardUserFacingMessage(null, (key) => key, FIRST_TRANSACTION_ERROR_KEYS, FIRST_TRANSACTION_ERROR_FALLBACK_KEY);

        expect(text).not.toBe(FIRST_TRANSACTION_ERROR_FALLBACK_KEY);
        expect(isRawRewardErrorCode(text)).toBeFalse();
    });
});
