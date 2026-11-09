/**
 * Home hub plan badge.
 * The label used to follow `publicData.type === "mainnet"`, so a registered Free name
 * (for example jimbot.zelf) showed "Premium Plan". The plan comes from the license record
 * and from the account APIs, in this order:
 * 1. GET /api/zelf-keys/limits `plan`
 * 2. GET /api/zelf-ids/my-plan `plan`
 * 3. `publicData.plan` on the Zelf ID
 */

export type HomeSubscriptionTier = "free" | "paid" | "unknown";

export interface HomeSubscriptionPlanSources {
    /** `plan` from GET /api/zelf-keys/limits. Null when that call has not succeeded. */
    limitsPlan?: string | null;
    /** `plan` from GET /api/zelf-ids/my-plan. */
    myPlan?: string | null;
    /** `publicData.plan` stored on the Zelf ID / license record. */
    licensePlan?: string | null;
}

export function normalizeHomePlan(plan: string | null | undefined): string {
    return String(plan ?? "")
        .trim()
        .toLowerCase();
}

/** `free` stays free. Any other reported plan is paid. Missing sources stay unknown. */
export function resolveHomeSubscriptionTier(sources: HomeSubscriptionPlanSources): HomeSubscriptionTier {
    const reported = [sources.limitsPlan, sources.myPlan, sources.licensePlan];

    for (const candidate of reported) {
        const plan = normalizeHomePlan(candidate);

        if (!plan) continue;

        if (plan === "free") return "free";

        return "paid";
    }

    return "unknown";
}
