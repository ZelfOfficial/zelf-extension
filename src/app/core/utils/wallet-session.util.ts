import { TagModel } from "@shared/types/tag.types";

/** Zelf account identity (`name.domain`), or "" when there is no wallet. */
export function walletAccountIdentity(wallet: unknown): string {
    if (!wallet || typeof wallet !== "object") return "";

    try {
        const model = wallet instanceof TagModel ? wallet : new TagModel(wallet);
        const full = String(model.fullTagName || "")
            .replace(/\.hold$/i, "")
            .trim()
            .toLowerCase();

        return full;
    } catch {
        return "";
    }
}

/**
 * Portfolio session tokens belong to one account. `updateWallet` rewrites storage on every
 * public-data refresh, including when the account did not change. Clear the session only then.
 */
export function shouldClearSessionForWalletChange(previous: unknown, next: unknown): boolean {
    const before = walletAccountIdentity(previous);
    const after = walletAccountIdentity(next);

    if (!before && !after) return false;

    return before !== after;
}
