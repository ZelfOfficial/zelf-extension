/** Password and 2FA caps from GET /api/zelf-keys/limits (zelf-online-version #207). */

export type ZelfKeysSlotKind = "password" | "zotp";

export type ZelfKeysLimitsAvailability = "ok" | "unsupported" | "error";

export interface ZelfKeysExtraSlot {
    slotId: string;
    kind: ZelfKeysSlotKind;
    purchasedAt: string;
    expiresAt: string;
    tokenCost: number;
}

export interface ZelfKeysKindLimits {
    used: number;
    /** `null` means the plan does not cap this kind. */
    limit: number | null;
    planLimit: number | null;
    extraSlots: number;
    activeExtraSlots: ZelfKeysExtraSlot[];
    tokenCost: number;
    slotUsd: number;
    canAdd: boolean;
}

export interface ZelfKeysLimits {
    zelfName?: string;
    plan: string;
    /** Spendable ZNS: on-chain balance minus tokens already spent on slots. */
    tokenBalance: number | null;
    onChainBalance: number | null;
    tokensSpent: number;
    tokenPriceUsd: number | null;
    balanceAvailable: boolean;
    kinds: Record<ZelfKeysSlotKind, ZelfKeysKindLimits>;
}

export type ZelfKeysLimitsFetch =
    | { status: "ok"; limits: ZelfKeysLimits }
    | { status: "unsupported" }
    | { status: "error" };

export interface PlanLimitReachedDetails {
    kind: ZelfKeysSlotKind;
    count: number;
    limit: number | null;
    plan: string;
    tokenCost: number;
    extraSlots: number;
}

export interface InsufficientTokensDetails {
    kind: ZelfKeysSlotKind | null;
    balance: number | null;
    cost: number | null;
}

export type SlotAffordability = "ok" | "low_balance" | "unknown_balance";

export interface PlanLimitPurchaseContext {
    /** Wallet was created with a master password. */
    hasMasterPassword: boolean;
    /** Plain password already collected on the form, when there is one. */
    masterPassword?: string;
}

export type PlanLimitRecoverOutcome = "retry" | "dismissed" | "not-limit";

export type PlanLimitPurchaseResult =
    | { ok: true }
    | { ok: false; reason: "cancelled" | "password_required" }
    | { ok: false; reason: "insufficient"; balance: number | null; cost: number | null }
    | { ok: false; reason: "error"; message: string };
