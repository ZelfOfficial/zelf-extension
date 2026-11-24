import { DomainLicense } from "./core/models/domain.type";

/** Public summary from GET /api/zelf-ids/referral-availability. */
export interface ReferralAvailability {
    exists: boolean;
    acceptsNewReferrals: boolean;
    /** Cap the server used. Null when the payload omits a positive integer. */
    limit: number | null;
    spotsRemaining: number | null;
}

export type ReferralLinkDecision = "accepted" | "limit_reached" | "unknown";

const positiveInt = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        return parsed > 0 ? parsed : null;
    }
    return null;
};

const nonNegativeInt = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
};

/**
 * Referral cap from the domain license (`tags.referrals.limit`).
 * Missing or invalid values are not replaced with a built-in number.
 */
export function referralLimitFromLicense(license: Pick<DomainLicense, "tags"> | null | undefined): number | null {
    return positiveInt(license?.tags?.referrals?.limit);
}

export function parseReferralAvailability(body: unknown): ReferralAvailability | null {
    if (!body || typeof body !== "object") return null;

    const record = body as Record<string, unknown>;
    const data = record["data"] && typeof record["data"] === "object" ? (record["data"] as Record<string, unknown>) : record;

    if (typeof data["exists"] !== "boolean") return null;

    return {
        exists: data["exists"] === true,
        acceptsNewReferrals: data["acceptsNewReferrals"] === true,
        limit: positiveInt(data["limit"]),
        spotsRemaining: nonNegativeInt(data["spotsRemaining"]),
    };
}

/**
 * Whether a new signup may store this referrer.
 * The license cap wins when it is present. Occupied slots are `limit - spotsRemaining`
 * from the public availability payload. No cap is invented here.
 */
export function evaluateReferralLink(availability: ReferralAvailability | null, licenseLimit: number | null): ReferralLinkDecision {
    if (!availability?.exists) return "unknown";

    const serverLimit = availability.limit;
    const spots = availability.spotsRemaining;

    if (licenseLimit != null && serverLimit != null && spots != null && serverLimit - spots >= licenseLimit) {
        return "limit_reached";
    }

    if (spots === 0 || !availability.acceptsNewReferrals) return "limit_reached";

    return "accepted";
}
