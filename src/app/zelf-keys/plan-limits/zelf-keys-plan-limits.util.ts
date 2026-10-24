import {
    InsufficientTokensDetails,
    PlanLimitReachedDetails,
    SlotAffordability,
    ZelfKeysExtraSlot,
    ZelfKeysKindLimits,
    ZelfKeysLimits,
    ZelfKeysSlotKind,
} from "./zelf-keys-plan-limits.model";

const PLAN_LIMIT_CODE = "ERR_PLAN_LIMIT_REACHED";
const INSUFFICIENT_CODE = "ERR_INSUFFICIENT_TOKENS";
const KINDS: ZelfKeysSlotKind[] = ["password", "zotp"];

export function httpStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;

    const record = error as { status?: unknown; statusCode?: unknown };
    const status = record.status ?? record.statusCode;

    return typeof status === "number" ? status : undefined;
}

export function apiErrorBody(error: unknown): Record<string, unknown> | null {
    if (!error || typeof error !== "object") return null;

    const body = (error as { error?: unknown }).error;

    if (body && typeof body === "object") return body as Record<string, unknown>;

    return null;
}

export function apiErrorCode(error: unknown): string {
    const body = apiErrorBody(error);
    const code = body?.["code"];

    if (typeof code === "string" && code.startsWith("ERR_")) return code;

    const message = body?.["message"];

    if (typeof message === "string" && message.trim().startsWith("ERR_")) return message.trim();

    return "";
}

/**
 * /limits cannot be used yet: the route is missing (404), or this session is not
 * identity-verified (401 / 403 ERR_SESSION_NOT_VERIFIED). Saves keep working.
 */
export function isLimitsFallbackError(error: unknown): boolean {
    const status = httpStatus(error);

    return status === 401 || status === 403 || status === 404;
}

export function isPlanLimitReachedError(error: unknown): boolean {
    if (apiErrorCode(error) === PLAN_LIMIT_CODE) return true;

    const body = apiErrorBody(error);
    const message = typeof body?.["message"] === "string" ? body["message"].trim().toLowerCase() : "";

    return httpStatus(error) === 409 && message === "plan limit reached";
}

export function isInsufficientTokensError(error: unknown): boolean {
    return apiErrorCode(error) === INSUFFICIENT_CODE;
}

export function planLimitDetailsFromError(error: unknown): PlanLimitReachedDetails | null {
    if (!isPlanLimitReachedError(error)) return null;

    const body = apiErrorBody(error) || {};
    const kind = normalizeKind(body["kind"]);

    if (!kind) return null;

    return {
        kind,
        count: finiteNumber(body["count"], 0),
        limit: nullableNumber(body["limit"]),
        plan: typeof body["plan"] === "string" && body["plan"].trim() ? body["plan"].trim() : "free",
        tokenCost: finiteNumber(body["tokenCost"], 0),
        extraSlots: finiteNumber(body["extraSlots"], 0),
    };
}

export function insufficientTokensDetails(error: unknown): InsufficientTokensDetails {
    const body = apiErrorBody(error) || {};

    return {
        kind: normalizeKind(body["kind"]),
        balance: nullableNumber(body["balance"]),
        cost: nullableNumber(body["cost"]),
    };
}

/**
 * Accepts `{ data: usage }` from the controller or the usage object itself.
 * Returns null when the payload is not the #207 shape.
 */
export function parseLimitsPayload(payload: unknown): ZelfKeysLimits | null {
    const source = unwrapData(payload);

    if (!source) return null;

    const password = parseKind(source["kinds"], "password");
    const zotp = parseKind(source["kinds"], "zotp");

    if (!password || !zotp) return null;

    const balanceAvailable = source["balanceAvailable"] !== false && nullableNumber(source["tokenBalance"]) != null;

    return {
        zelfName: typeof source["zelfName"] === "string" ? source["zelfName"] : undefined,
        plan: typeof source["plan"] === "string" && source["plan"].trim() ? source["plan"].trim() : "free",
        tokenBalance: balanceAvailable ? nullableNumber(source["tokenBalance"]) : null,
        onChainBalance: balanceAvailable ? nullableNumber(source["onChainBalance"]) : null,
        tokensSpent: finiteNumber(source["tokensSpent"], 0),
        tokenPriceUsd: nullableNumber(source["tokenPriceUsd"]),
        balanceAvailable,
        kinds: { password, zotp },
    };
}

export function limitsFromPlanError(error: unknown): ZelfKeysLimits | null {
    const details = planLimitDetailsFromError(error);

    if (!details) return null;

    const empty = (kind: ZelfKeysSlotKind): ZelfKeysKindLimits => ({
        used: kind === details.kind ? details.count : 0,
        limit: kind === details.kind ? details.limit : 0,
        planLimit: kind === details.kind ? details.limit : 0,
        extraSlots: kind === details.kind ? details.extraSlots : 0,
        activeExtraSlots: [],
        tokenCost: kind === details.kind ? details.tokenCost : 0,
        slotUsd: 0,
        canAdd: false,
    });

    return {
        plan: details.plan,
        tokenBalance: null,
        onChainBalance: null,
        tokensSpent: 0,
        tokenPriceUsd: null,
        balanceAvailable: false,
        kinds: {
            password: empty("password"),
            zotp: empty("zotp"),
        },
    };
}

export function slotAffordability(input: {
    tokenCost: number;
    tokenBalance: number | null;
    balanceAvailable: boolean;
}): SlotAffordability {
    if (!input.balanceAvailable || input.tokenBalance == null || !Number.isFinite(input.tokenBalance)) {
        return "unknown_balance";
    }

    if (input.tokenBalance < input.tokenCost) return "low_balance";

    return "ok";
}

export function formatZns(amount: number | null | undefined): string {
    const value = Number(amount);

    if (!Number.isFinite(value)) return "0";

    const rounded = Math.round(value * 1e8) / 1e8;

    if (Number.isInteger(rounded)) return String(rounded);

    return rounded.toFixed(2).replace(/\.?0+$/, "");
}

export function translatedPlanName(plan: string, translate: (key: string) => string): string {
    const normalized = String(plan || "free").trim().toLowerCase() || "free";
    const key = `zelf_keys.plan_limits.plan.${normalized}`;
    const translated = translate(key);

    if (translated && translated !== key) return translated;

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** 8–128 chars of `[A-Za-z0-9._:-]`, matching POST /slots. */
export function createSlotIdempotencyKey(): string {
    const uuid = globalThis.crypto?.randomUUID?.();

    if (uuid && /^[A-Za-z0-9._:-]{8,128}$/.test(uuid)) return uuid;

    const random = Math.random().toString(36).slice(2, 12);
    const time = Date.now().toString(36);

    return `slot-${time}-${random}`.slice(0, 128);
}

function unwrapData(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    const data = record["data"];

    if (data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>)["kinds"]) {
        return data as Record<string, unknown>;
    }

    if (record["kinds"]) return record;

    return null;
}

function parseKind(kinds: unknown, kind: ZelfKeysSlotKind): ZelfKeysKindLimits | null {
    if (!kinds || typeof kinds !== "object") return null;

    const row = (kinds as Record<string, unknown>)[kind];

    if (!row || typeof row !== "object") return null;

    const record = row as Record<string, unknown>;
    const limit = nullableNumber(record["limit"]);
    const used = finiteNumber(record["used"], 0);
    const canAdd = typeof record["canAdd"] === "boolean" ? record["canAdd"] : limit == null || used < limit;

    return {
        used,
        limit,
        planLimit: record["planLimit"] === undefined ? limit : nullableNumber(record["planLimit"]),
        extraSlots: finiteNumber(record["extraSlots"], 0),
        activeExtraSlots: parseSlots(record["activeExtraSlots"]),
        tokenCost: finiteNumber(record["tokenCost"], 0),
        slotUsd: finiteNumber(record["slotUsd"], 0),
        canAdd,
    };
}

function parseSlots(value: unknown): ZelfKeysExtraSlot[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((slot) => {
        if (!slot || typeof slot !== "object") return [];

        const record = slot as Record<string, unknown>;
        const kind = normalizeKind(record["kind"]);

        if (!kind || typeof record["slotId"] !== "string") return [];

        return [
            {
                slotId: record["slotId"],
                kind,
                purchasedAt: typeof record["purchasedAt"] === "string" ? record["purchasedAt"] : "",
                expiresAt: typeof record["expiresAt"] === "string" ? record["expiresAt"] : "",
                tokenCost: finiteNumber(record["tokenCost"], 0),
            },
        ];
    });
}

function normalizeKind(value: unknown): ZelfKeysSlotKind | null {
    if (value === "2fa") return "zotp";

    return KINDS.includes(value as ZelfKeysSlotKind) ? (value as ZelfKeysSlotKind) : null;
}

function finiteNumber(value: unknown, fallback: number): number {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown): number | null {
    if (value == null || value === "") return null;

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}
