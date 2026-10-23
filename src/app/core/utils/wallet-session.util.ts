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
/**
 * Account id to load from a wallet emission. An empty emission is "not yet known"
 * (the wallet subject starts as `{}`), not a signal that there is no account.
 * Returns null when there is nothing new to load.
 */
export function nextAccountToLoad(emitted: unknown, activeAccountId: string): string | null {
    const id = walletAccountIdentity(emitted);

    if (!id || id === activeAccountId) return null;

    return id;
}

/**
 * Cold open sees the empty subject value first, then the wallet already in storage.
 * That stored wallet must load once; a later echo of the same account must not load again.
 */
export function coldOpenAccountsLoaded(firstEmission: unknown, stored: unknown): string[] {
    const loads: string[] = [];
    let active = "";

    const take = (wallet: unknown) => {
        const id = nextAccountToLoad(wallet, active);

        if (!id) return;

        active = id;
        loads.push(id);
    };

    take(firstEmission);

    if (!active) take(stored);

    take(stored);

    return loads;
}

export function shouldClearSessionForWalletChange(previous: unknown, next: unknown): boolean {
    const before = walletAccountIdentity(previous);
    const after = walletAccountIdentity(next);

    if (!before && !after) return false;

    return before !== after;
}
