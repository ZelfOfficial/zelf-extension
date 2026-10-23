import { shouldClearSessionForWalletChange } from "./wallet-session.util";

const account = (tagName: string, extra: Record<string, unknown> = {}) => ({
    name: tagName,
    publicData: { tagName, domain: tagName.split(".").pop(), ethAddress: "0xabc", ...extra },
});

describe("wallet session clear", () => {
    it("does not clear when the same account is rewritten", () => {
        const previous = account("alice.zelf", { ethAddress: "0xabc" });
        const next = account("alice.zelf", { ethAddress: "0xabc", refreshed: true });

        expect(shouldClearSessionForWalletChange(previous, next)).toBeFalse();
    });

    it("clears when the account identity changes", () => {
        expect(shouldClearSessionForWalletChange(account("alice.zelf"), account("bob.zelf"))).toBeTrue();
    });

    it("clears on logout and on the first account, and ignores an empty rewrite", () => {
        expect(shouldClearSessionForWalletChange(account("alice.zelf"), null)).toBeTrue();
        expect(shouldClearSessionForWalletChange(null, account("alice.zelf"))).toBeTrue();
        expect(shouldClearSessionForWalletChange(null, undefined)).toBeFalse();
        expect(shouldClearSessionForWalletChange({}, {})).toBeFalse();
    });
});
