import type { ZelfIdEligibility, ZelfIdPlan, ZelfIdPlans, ZelfIdSearchResponse } from "app/zelf-ids.service";

/**
 * Plan matrix from GET /api/zelf-ids/search.
 * Amounts come only from `plans`. Free is $0 when `plans.free` is missing.
 * `eligibility.freeTermYears` / `plans.free.termYears` set the free hold.
 * Length is used only when the server sends neither a term nor allowed plans / eligibility.
 */

const YEAR_KEYS = ["1", "2", "3", "4", "5"] as const;
const DURATION_META_KEYS = new Set(["price", "termYears", "currency", "limits", "allowedPlans"]);
const KNOWN_PLANS = new Set<ZelfIdPlan>(["free", "premium", "unlimited"]);

const LIMIT_KEYS: Record<string, ZelfIdLimitLine["key"]> = {
    passwords: "passwords",
    password: "passwords",
    notes: "notes",
    note: "notes",
    cards: "cards",
    card: "cards",
    paymentcards: "cards",
    payment_cards: "cards",
    authenticators: "authenticators",
    authenticator: "authenticators",
    zotp: "authenticators",
    totp: "authenticators",
    wallets: "wallets",
    wallet: "wallets",
};

export interface ZelfIdDurationPrice {
    key: string;
    price: number;
}

export interface ZelfIdLimitLine {
    key: "passwords" | "notes" | "cards" | "authenticators" | "wallets" | "generic" | "text";
    count?: number;
    label?: string;
    value?: string;
    text?: string;
}

export interface ZelfIdPlanCard {
    id: ZelfIdPlan;
    /** Free list price. Paid cards leave this unset and use `durations`. */
    price?: number;
    durations: ZelfIdDurationPrice[];
    recommended: boolean;
}

export interface ZelfIdPlanSelection {
    plan: ZelfIdPlan;
    /** Empty when Free is selected. Otherwise a duration key from the response, or "1" when the search had no durations. */
    duration: string;
}

export interface ZelfIdPlanCatalog {
    currency: string;
    freeTermYears: number;
    freePrice: number;
    /** True when the free hold is a single year, so purchase should be the primary action. */
    emphasizePaid: boolean;
    isShortName: boolean;
    /** Server list when allowedPlans or eligibility was sent. Length fallback otherwise. */
    allowedPlans: ZelfIdPlan[];
    /** Record plan. Every name can be registered on Free. */
    recordPlan: ZelfIdPlan;
    limits: ZelfIdLimitLine[];
    plans: ZelfIdPlanCard[];
    /** Paid plans the name may buy when the search did not include a price map. */
    fallbackPaidPlans: Array<"premium" | "unlimited">;
    hasPricedPaidPlans: boolean;
}

export interface ZelfIdPaymentQuery {
    tagName: string;
    domain: string;
    plan: string;
    duration: string;
}

export function resolveZelfIdPlanCatalog(response?: ZelfIdSearchResponse | null, tagName?: string): ZelfIdPlanCatalog {
    const allowedPlans = readAllowedPlans(response, tagName);
    const isShortName = readIsShortName(response, allowedPlans, tagName);
    const freeTermYears = readFreeTermYears(response, tagName);
    const currency = readCurrency(response);
    const limits = readFreeLimits(response?.plans?.free?.limits);
    const priced = pricedPlans(response, allowedPlans, freeTermYears);
    const fallbackPaidPlans = allowedPlans.filter((plan): plan is "premium" | "unlimited" => plan === "premium" || plan === "unlimited");

    return {
        currency,
        freeTermYears,
        freePrice: readFreePrice(response?.plans),
        emphasizePaid: freeTermYears === 1,
        isShortName,
        allowedPlans,
        recordPlan: readRecordPlan(response),
        limits,
        plans: priced,
        fallbackPaidPlans,
        hasPricedPaidPlans: priced.some((plan) => plan.id !== "free" && plan.durations.length > 0),
    };
}

export function defaultPlanSelection(catalog: ZelfIdPlanCatalog, mode: "register" | "purchase"): ZelfIdPlanSelection {
    const pricedPaid = catalog.plans.filter((plan) => plan.id !== "free" && plan.durations.length > 0);

    if (mode === "register" && catalog.emphasizePaid && pricedPaid.length > 0) {
        return selectionForCard(pricedPaid[0]);
    }

    if (mode === "purchase") {
        if (pricedPaid.length > 0) return selectionForCard(pricedPaid[0]);

        const fallback = catalog.fallbackPaidPlans[0];

        if (fallback) return { plan: fallback, duration: "1" };
    }

    return { plan: "free", duration: "" };
}

export function buildZelfIdPaymentUrl(base: string, query: ZelfIdPaymentQuery): string {
    const url = new URL(base);
    const name = bareName(query.tagName);

    url.searchParams.set("tagname", name);
    url.searchParams.set("domain", (query.domain || "zelf").replace(/^\./, ""));
    url.searchParams.set("duration", query.duration || "1");
    url.searchParams.set("plan", query.plan);

    return url.toString();
}

/**
 * Upgrade / renew link for a name that already exists.
 * A free or empty record points at Unlimited for 1–5 character names and Premium otherwise.
 * An existing Premium or Unlimited record keeps that plan.
 */
export function ownedNamePaymentQuery(input: {
    tagName: string;
    domain?: string | null;
    currentPlan?: string | null;
    currentDuration?: string | number | null;
}): ZelfIdPaymentQuery {
    const current = normalizePlan(input.currentPlan);
    const length = bareName(input.tagName).length;
    const plan = current === "premium" || current === "unlimited" ? current : length > 0 && length <= 5 ? "unlimited" : "premium";

    return {
        tagName: input.tagName,
        domain: input.domain || "zelf",
        plan,
        duration: normalizeDuration(input.currentDuration) || "1",
    };
}

function selectionForCard(plan: ZelfIdPlanCard): ZelfIdPlanSelection {
    const preferred = plan.durations.find((duration) => duration.key === "1") || plan.durations[0];

    return { plan: plan.id, duration: preferred?.key || "1" };
}

function pricedPlans(response: ZelfIdSearchResponse | null | undefined, allowedPlans: ZelfIdPlan[], freeTermYears: number): ZelfIdPlanCard[] {
    const emphasizePaid = freeTermYears === 1;
    const premium = paidCard("premium", response, allowedPlans);
    const unlimited = paidCard("unlimited", response, allowedPlans);
    const free: ZelfIdPlanCard = {
        id: "free",
        price: readFreePrice(response?.plans),
        durations: [],
        recommended: false,
    };
    const paid = (emphasizePaid ? [unlimited, premium] : [premium, unlimited]).filter((plan): plan is ZelfIdPlanCard => !!plan);
    const ordered = emphasizePaid ? [...paid, free] : [free, ...paid];

    if (emphasizePaid && paid.length > 0) {
        paid[0].recommended = true;
    }

    return ordered;
}

function paidCard(
    id: "premium" | "unlimited",
    response: ZelfIdSearchResponse | null | undefined,
    allowedPlans: ZelfIdPlan[]
): ZelfIdPlanCard | null {
    if (!paidPlanOffered(id, response, allowedPlans)) return null;

    const durations = durationPrices(response?.plans?.[id]);

    if (!durations.length) return null;

    return { id, durations, recommended: false };
}

function paidPlanOffered(
    id: "premium" | "unlimited",
    response: ZelfIdSearchResponse | null | undefined,
    allowedPlans: ZelfIdPlan[]
): boolean {
    const eligibility = response?.eligibility;

    if (eligibility) {
        if (id === "premium" && eligibility.premium === false) return false;
        if (id === "unlimited" && eligibility.unlimited === false) return false;
    }

    if (serverSentPlanList(response) && !allowedPlans.includes(id)) return false;

    return true;
}

function durationPrices(map: unknown): ZelfIdDurationPrice[] {
    if (!map || typeof map !== "object" || Array.isArray(map)) return [];

    const entries: ZelfIdDurationPrice[] = [];

    for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
        if (DURATION_META_KEYS.has(key)) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) continue;

        entries.push({ key, price: value });
    }

    entries.sort((left, right) => compareDuration(left.key, right.key));

    return entries;
}

function compareDuration(left: string, right: string): number {
    return durationRank(left) - durationRank(right) || left.localeCompare(right);
}

function durationRank(key: string): number {
    if ((YEAR_KEYS as readonly string[]).includes(key)) return Number(key);
    if (key === "lifetime") return 6;
    if (/^\d+$/.test(key)) return 100 + Number(key);

    return 1000;
}

function readFreePrice(plans: ZelfIdPlans | null | undefined): number {
    const price = plans?.free?.price;

    return typeof price === "number" && Number.isFinite(price) ? price : 0;
}

function readFreeTermYears(response: ZelfIdSearchResponse | null | undefined, tagName?: string): number {
    const fromPlan = response?.plans?.free?.termYears;

    if (typeof fromPlan === "number" && Number.isFinite(fromPlan) && fromPlan > 0) return fromPlan;

    const fromEligibility = response?.eligibility?.freeTermYears;

    if (typeof fromEligibility === "number" && Number.isFinite(fromEligibility) && fromEligibility > 0) return fromEligibility;

    const length = bareName(tagName || response?.tagName).length;

    return length > 0 && length <= 5 ? 1 : 100;
}

function readCurrency(response: ZelfIdSearchResponse | null | undefined): string {
    const candidates = [response?.plans?.free?.currency, response?.currency, response?.price?.currency];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim().toUpperCase();
    }

    return "USD";
}

function readRecordPlan(response: ZelfIdSearchResponse | null | undefined): ZelfIdPlan {
    return normalizePlan(response?.plan) || normalizePlan(response?.price?.plan) || "free";
}

function readIsShortName(response: ZelfIdSearchResponse | null | undefined, allowedPlans: ZelfIdPlan[], tagName?: string): boolean {
    if (typeof response?.eligibility?.shortName === "boolean") return response.eligibility.shortName;

    if (serverSentPlanList(response)) {
        return allowedPlans.includes("unlimited") && !allowedPlans.includes("premium");
    }

    const length = bareName(tagName || response?.tagName).length;

    return length > 0 && length <= 5;
}

function readAllowedPlans(response: ZelfIdSearchResponse | null | undefined, tagName?: string): ZelfIdPlan[] {
    const listed = normalizePlanList(response?.allowedPlans) || normalizePlanList(response?.price?.allowedPlans);

    if (listed?.length) return listed;

    if (response?.eligibility) return plansFromEligibility(response.eligibility);

    const length = bareName(tagName || response?.tagName).length;

    if (length > 0 && length <= 5) return ["free", "unlimited"];

    return ["free", "premium", "unlimited"];
}

function serverSentPlanList(response: ZelfIdSearchResponse | null | undefined): boolean {
    return !!normalizePlanList(response?.allowedPlans)?.length || !!normalizePlanList(response?.price?.allowedPlans)?.length || !!response?.eligibility;
}

function plansFromEligibility(eligibility: ZelfIdEligibility): ZelfIdPlan[] {
    const plans: ZelfIdPlan[] = ["free"];

    if (eligibility.premium) plans.push("premium");
    if (eligibility.unlimited) plans.push("unlimited");

    return plans;
}

function normalizePlanList(value: unknown): ZelfIdPlan[] | null {
    if (!Array.isArray(value)) return null;

    const plans: ZelfIdPlan[] = [];

    for (const entry of value) {
        const plan = normalizePlan(entry);

        if (plan && !plans.includes(plan)) plans.push(plan);
    }

    return plans.length ? plans : null;
}

function normalizePlan(value: unknown): ZelfIdPlan | "" {
    if (typeof value !== "string") return "";

    const plan = value.trim().toLowerCase();

    return KNOWN_PLANS.has(plan as ZelfIdPlan) ? (plan as ZelfIdPlan) : "";
}

function normalizeDuration(value: unknown): string | null {
    if (value == null) return null;

    const raw = String(value).trim().toLowerCase();

    if (!raw) return null;
    if (raw === "lifetime" || raw === "999") return "lifetime";

    const years = raw.match(/^(\d+)y?$/);

    if (years && (YEAR_KEYS as readonly string[]).includes(years[1])) return years[1];

    return null;
}

function bareName(tagName?: string | null): string {
    return String(tagName || "")
        .trim()
        .split(".")[0];
}

function readFreeLimits(limits: unknown): ZelfIdLimitLine[] {
    if (limits == null) return [];

    if (typeof limits === "string") {
        const text = limits.trim();

        return text ? [{ key: "text", text }] : [];
    }

    if (typeof limits === "number" && Number.isFinite(limits)) {
        return [{ key: "generic", label: "Limit", value: String(limits) }];
    }

    if (Array.isArray(limits)) {
        const lines: ZelfIdLimitLine[] = [];

        for (const entry of limits) {
            if (typeof entry === "string" && entry.trim()) {
                lines.push({ key: "text", text: entry.trim() });
                continue;
            }

            lines.push(...readFreeLimits(entry));
        }

        return lines;
    }

    if (typeof limits !== "object") return [];

    const record = limits as Record<string, unknown>;
    const label = typeof record["label"] === "string" ? record["label"].trim() : "";
    const direct = limitValue(record);

    if (label && direct) {
        return [lineForKey(label, direct)];
    }

    const lines: ZelfIdLimitLine[] = [];

    for (const [key, value] of Object.entries(record)) {
        if (key === "label" || key === "name") continue;

        const parsed = limitValue(value);

        if (!parsed) continue;

        lines.push(lineForKey(key, parsed));
    }

    return lines;
}

function limitValue(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "boolean") return value ? "true" : null;

    if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const nested = record["limit"] ?? record["max"] ?? record["value"] ?? record["count"];

        if (typeof nested === "number" && Number.isFinite(nested)) return String(nested);
        if (typeof nested === "string" && nested.trim()) return nested.trim();
    }

    return null;
}

function lineForKey(key: string, value: string): ZelfIdLimitLine {
    const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, "");
    const known = LIMIT_KEYS[normalized];
    const numeric = Number(value);

    if (known && Number.isFinite(numeric) && String(numeric) === value) {
        return { key: known, count: numeric };
    }

    if (known && value === "true") {
        return { key: "generic", label: humanize(key), value: "" };
    }

    return { key: "generic", label: humanize(key), value: value === "true" ? "" : value };
}

function humanize(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim();

    if (!spaced) return key;

    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
