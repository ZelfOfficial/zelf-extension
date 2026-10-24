import { pickFaceWhitelistedBody } from "app/services/face-api/face-body-whitelist.util";

import {
    createSlotIdempotencyKey,
    formatZns,
    insufficientTokensDetails,
    isInsufficientTokensError,
    isLimitsFallbackError,
    isPlanLimitReachedError,
    limitsFromPlanError,
    parseLimitsPayload,
    planLimitDetailsFromError,
    slotAffordability,
    translatedPlanName,
} from "./zelf-keys-plan-limits.util";

const freeAtCap = {
    zelfName: "alice.zelf",
    plan: "free",
    tokenBalance: 4,
    onChainBalance: 14,
    tokensSpent: 10,
    tokenPriceUsd: 0.05,
    balanceAvailable: true,
    kinds: {
        password: {
            used: 5,
            limit: 5,
            planLimit: 5,
            extraSlots: 0,
            activeExtraSlots: [],
            tokenCost: 10,
            slotUsd: 0.5,
            canAdd: false,
        },
        zotp: {
            used: 3,
            limit: 3,
            planLimit: 3,
            extraSlots: 0,
            activeExtraSlots: [],
            tokenCost: 20,
            slotUsd: 1,
            canAdd: false,
        },
    },
};

describe("zelf-keys plan limits", () => {
    it("reads the /limits payload, including a wrapped data object", () => {
        const limits = parseLimitsPayload({ data: freeAtCap });

        expect(limits?.plan).toBe("free");
        expect(limits?.tokenBalance).toBe(4);
        expect(limits?.onChainBalance).toBe(14);
        expect(limits?.tokensSpent).toBe(10);
        expect(limits?.kinds.password).toEqual(jasmine.objectContaining({ used: 5, limit: 5, tokenCost: 10, canAdd: false }));
        expect(limits?.kinds.zotp.tokenCost).toBe(20);
    });

    it("treats a null limit as unlimited", () => {
        const limits = parseLimitsPayload({
            plan: "unlimited",
            tokenBalance: 0,
            onChainBalance: 0,
            tokensSpent: 0,
            tokenPriceUsd: 0.05,
            balanceAvailable: true,
            kinds: {
                password: { used: 12, limit: null, canAdd: true, tokenCost: 10 },
                zotp: { used: 4, limit: null, canAdd: true, tokenCost: 20 },
            },
        });

        expect(limits?.kinds.password.limit).toBeNull();
        expect(limits?.kinds.password.canAdd).toBeTrue();
        expect(limits?.kinds.zotp.canAdd).toBeTrue();
    });

    it("hides the balance when the lookup failed", () => {
        const limits = parseLimitsPayload({
            ...freeAtCap,
            tokenBalance: null,
            onChainBalance: null,
            balanceAvailable: false,
        });

        expect(limits?.balanceAvailable).toBeFalse();
        expect(limits?.tokenBalance).toBeNull();
        expect(limits?.kinds.password.canAdd).toBeFalse();
    });

    it("rejects a payload that is not the limits shape", () => {
        expect(parseLimitsPayload({ data: { passwords: [] } })).toBeNull();
        expect(parseLimitsPayload(null)).toBeNull();
    });

    it("falls back when /limits is missing or the session is not verified", () => {
        expect(isLimitsFallbackError({ status: 404, error: { message: "Not Found" } })).toBeTrue();
        expect(isLimitsFallbackError({ status: 401, error: { code: "ERR_ZELF_IDENTITY_REQUIRED", message: "Authenticated Zelf identity is required" } })).toBeTrue();
        expect(
            isLimitsFallbackError({
                status: 403,
                error: { code: "ERR_SESSION_NOT_VERIFIED", message: "Session is not verified for this wallet" },
            })
        ).toBeTrue();
        expect(isLimitsFallbackError({ status: 500, error: { message: "down" } })).toBeFalse();
        expect(isLimitsFallbackError({ status: 409, error: { code: "ERR_PLAN_LIMIT_REACHED" } })).toBeFalse();
    });

    it("recognizes a plan-limit 409 and ignores other 409s", () => {
        const limit = {
            status: 409,
            error: {
                message: "Plan limit reached",
                code: "ERR_PLAN_LIMIT_REACHED",
                kind: "password",
                count: 5,
                limit: 5,
                plan: "free",
                tokenCost: 10,
                extraSlots: 0,
            },
        };
        const setupKey = { status: 409, error: { code: "ERR_INVALID_SETUP_KEY", message: "ERR_INVALID_SETUP_KEY" } };

        expect(isPlanLimitReachedError(limit)).toBeTrue();
        expect(planLimitDetailsFromError(limit)).toEqual({
            kind: "password",
            count: 5,
            limit: 5,
            plan: "free",
            tokenCost: 10,
            extraSlots: 0,
        });
        expect(isPlanLimitReachedError(setupKey)).toBeFalse();
        expect(planLimitDetailsFromError(setupKey)).toBeNull();
        expect(limitsFromPlanError(limit)?.kinds.password.used).toBe(5);
        expect(limitsFromPlanError(limit)?.balanceAvailable).toBeFalse();
    });

    it("accepts the human message when the code is missing", () => {
        expect(isPlanLimitReachedError({ status: 409, error: { message: "Plan limit reached", code: "Conflict" } })).toBeTrue();
    });

    it("reads an insufficient-token 409", () => {
        const error = {
            status: 409,
            error: { code: "ERR_INSUFFICIENT_TOKENS", message: "Insufficient tokens", kind: "zotp", balance: 4, cost: 20 },
        };

        expect(isInsufficientTokensError(error)).toBeTrue();
        expect(insufficientTokensDetails(error)).toEqual({ kind: "zotp", balance: 4, cost: 20 });
    });

    it("disables a purchase only when the known balance is below the slot cost", () => {
        expect(slotAffordability({ tokenCost: 10, tokenBalance: 4, balanceAvailable: true })).toBe("low_balance");
        expect(slotAffordability({ tokenCost: 10, tokenBalance: 10, balanceAvailable: true })).toBe("ok");
        expect(slotAffordability({ tokenCost: 20, tokenBalance: null, balanceAvailable: false })).toBe("unknown_balance");
    });

    it("formats spendable ZNS without trailing zeros", () => {
        expect(formatZns(10)).toBe("10");
        expect(formatZns(10.5)).toBe("10.5");
        expect(formatZns(null)).toBe("0");
    });

    it("uses the translated plan name", () => {
        const translate = (key: string) => (key.endsWith(".free") ? "Free" : key);

        expect(translatedPlanName("free", translate)).toBe("Free");
        expect(translatedPlanName("custom", translate)).toBe("Custom");
    });

    it("builds an idempotency key the slots route accepts", () => {
        expect(createSlotIdempotencyKey()).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    });

    it("keeps slot purchase fields on the face whitelist and drops the rest", () => {
        const body = pickFaceWhitelistedBody("purchase-slot", {
            kind: "zotp",
            idempotencyKey: "idem-key-1",
            faceBase64: "face",
            masterPassword: "pgp",
            tagName: "mallory.zelf",
            website: "https://example.com",
        });

        expect(body).toEqual({
            kind: "zotp",
            idempotencyKey: "idem-key-1",
            faceBase64: "face",
            masterPassword: "pgp",
        });
    });
});
