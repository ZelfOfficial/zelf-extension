import { normalizeZelfName } from "app/core/utils/zelf-name.util";

/**
 * GET /api/zelf-ids/my-plan (zelf-online-version #209).
 * The body is the plan object itself (not wrapped in `data`). `zelfName` is a required query.
 * `upgrade.action` is stripe_portal, checkout, mobile_store, or none. `url` is only set for the first two.
 * `planExpiresAt` is when the paid plan ends. `leaseExpiresAt` is the name's lease.
 * `expiresAt` is an alias of `planExpiresAt`.
 */

export const ZELF_ID_PRICING_URL = "https://zelf.world/pricing";

export type ZelfIdUpgradeAction = "stripe_portal" | "checkout" | "mobile_store" | "none";

export interface ZelfIdMyPlan {
    plan: string | null;
    /** Lease duration from the API, such as `1y` or `lifetime`. */
    duration: string | null;
    /** When the paid plan ends. Absent on Free. */
    planExpiresAt: string | null;
    /** When the Zelf name's lease ends. Not shown on the plan line. */
    leaseExpiresAt: string | null;
    /** Alias of `planExpiresAt`. */
    expiresAt: string | null;
    upgrade: {
        action: ZelfIdUpgradeAction;
        url: string | null;
    };
}

export type ZelfIdUpgradeTarget = { kind: "url"; url: string } | { kind: "mobile" } | { kind: "hidden" };

const ACTIONS = new Set<ZelfIdUpgradeAction>(["stripe_portal", "checkout", "mobile_store", "none"]);

export function isMyPlanFallbackError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const status = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;

    return status === 401 || status === 403 || status === 404;
}

export function parseMyPlan(payload: unknown): ZelfIdMyPlan | null {
    const source = unwrap(payload);

    if (!source) return null;

    const upgrade = source["upgrade"];

    if (!upgrade || typeof upgrade !== "object") return null;

    const action = (upgrade as { action?: unknown }).action;

    if (typeof action !== "string" || !ACTIONS.has(action as ZelfIdUpgradeAction)) return null;

    const rawUrl = (upgrade as { url?: unknown }).url;
    const url = typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : null;

    const planExpiresAt = readPlanExpiresAt(source);

    return {
        plan: readPlan(source),
        duration: readDuration(source),
        planExpiresAt,
        leaseExpiresAt: readDate(source["leaseExpiresAt"]),
        expiresAt: planExpiresAt,
        upgrade: { action: action as ZelfIdUpgradeAction, url },
    };
}

export function upgradeTarget(plan: ZelfIdMyPlan | null): ZelfIdUpgradeTarget {
    if (!plan) return { kind: "url", url: ZELF_ID_PRICING_URL };

    if (plan.upgrade.action === "none") return { kind: "hidden" };

    if (plan.upgrade.action === "mobile_store") return { kind: "mobile" };

    const url = safeHttpUrl(plan.upgrade.url);

    if (url) return { kind: "url", url };

    return { kind: "url", url: ZELF_ID_PRICING_URL };
}

const DATE_LOCALES: Record<string, string> = {
    en: "en-US",
    es: "es",
    fr: "fr",
    br: "pt-BR",
    cn: "zh-CN",
    ja: "ja",
    kr: "ko",
    ru: "ru",
    ar: "ar",
    th: "th",
    ph: "fil",
    in: "hi",
    ur: "ur",
};

export function dateLocale(lang: string | null | undefined): string {
    const code = String(lang || "en").trim().toLowerCase();

    return DATE_LOCALES[code] || DATE_LOCALES["en"];
}

/**
 * The name required by GET /my-plan.
 * Prefer the vault name from /limits. Otherwise use the stored wallet tag.
 */
export function resolveMyPlanZelfName(input: {
    explicit?: string | null;
    walletTag?: string | null;
    walletDomain?: string | null;
}): string | null {
    if (input.explicit && input.explicit.trim()) {
        return normalizeZelfName(input.explicit).zelfName || null;
    }

    if (!input.walletTag || !input.walletTag.trim()) return null;

    return normalizeZelfName(input.walletTag, input.walletDomain || "zelf").zelfName || null;
}

/**
 * Plan line date. Free, lifetime, and a missing plan end read as no expiration.
 * Uses `planExpiresAt`, then `expiresAt`. The name lease is not included.
 */
export function planEndLabel(
    plan: Pick<ZelfIdMyPlan, "plan" | "duration" | "planExpiresAt" | "expiresAt"> | null,
    now = Date.now(),
    locale = "en-US"
): { kind: "date"; label: string } | { kind: "open" } | null {
    if (!plan?.plan) return null;

    const name = plan.plan.trim().toLowerCase();
    const duration = String(plan.duration || "")
        .trim()
        .toLowerCase();

    if (name === "free" || duration === "lifetime" || duration === "999") return { kind: "open" };

    const raw = plan.planExpiresAt || plan.expiresAt;

    if (!raw) return { kind: "open" };

    return planExpiryLabel(raw, now, locale) ?? { kind: "open" };
}

/** Far-future dates (about 100 years) and unreadable values are not shown as a plan end. */
export function planExpiryLabel(
    expiresAt: string | null,
    now = Date.now(),
    locale = "en-US"
): { kind: "date"; label: string } | { kind: "open" } | null {
    if (!expiresAt) return null;

    const date = new Date(expiresAt);

    if (Number.isNaN(date.getTime())) return null;

    const years = (date.getTime() - now) / (365.25 * 24 * 60 * 60 * 1000);

    if (years >= 50) return { kind: "open" };

    const label = new Intl.DateTimeFormat(locale || "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    }).format(date);

    return { kind: "date", label };
}

function unwrap(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    const data = record["data"];

    if (data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>)["upgrade"]) {
        return data as Record<string, unknown>;
    }

    if (record["upgrade"]) return record;

    return null;
}

function readPlan(source: Record<string, unknown>): string | null {
    const value = source["plan"] ?? source["currentPlan"];

    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDuration(source: Record<string, unknown>): string | null {
    const value = source["duration"];

    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPlanExpiresAt(source: Record<string, unknown>): string | null {
    return readDate(source["planExpiresAt"]) ?? readDate(source["expiresAt"]) ?? readDate(source["expiry"]) ?? readDate(source["expires"]);
}

function readDate(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeHttpUrl(url: string | null): string | null {
    if (!url) return null;

    try {
        const parsed = new URL(url);

        if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
    } catch {
        return null;
    }

    return null;
}
