import { dedupeBalanceTokens, mergeBalanceTokens } from "app/core/utils/balance-tokens.util";

export interface AccountPortfolioSeed {
    /** Account whose Home/Wallet is being painted. */
    accountId: string;
    inMemoryAccountId?: string | null;
    inMemoryTokens?: readonly any[] | null;
    sessionAccountId?: string | null;
    sessionTokens?: readonly any[] | null;
    /** Last-known portfolios keyed by account id. Only this account's entry may be used. */
    persistedByAccount?: Record<string, readonly any[] | null | undefined> | null;
}

/**
 * Seed for a balance load. Rows that belong to another account are dropped, including when the
 * in-memory list or the global session still holds them after a switch. Last-known balances are
 * kept only for the account being loaded, so a failed fetch cannot resurrect the previous account.
 */
export function selectAccountPortfolioSeed(input: AccountPortfolioSeed): any[] {
    const memory = input.inMemoryAccountId === input.accountId ? input.inMemoryTokens || [] : [];
    let tokens = dedupeBalanceTokens(memory);
    const session = input.sessionAccountId === input.accountId ? input.sessionTokens || [] : [];

    if (session.length) {
        return mergeBalanceTokens(tokens, session);
    }

    const persisted = input.persistedByAccount?.[input.accountId];

    if (persisted?.length) {
        tokens = mergeBalanceTokens(tokens, persisted);
    }

    return tokens;
}
