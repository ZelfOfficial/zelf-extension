import { Pipe, PipeTransform } from "@angular/core";
import { parseTagExpiry } from "@shared/utils/tag-expiry";

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

/**
 * Validity term in whole years for a Zelf name, or null when a date/countdown fits better
 * (no expiry, expired, or less than a year left).
 * Term = publicData.duration (years, set by the API lease) when it agrees with registeredAt→expiresAt;
 * otherwise registeredAt→expiresAt (or now→expiresAt) rounded to years. Free leases are 100 years.
 */
export function validityYears(publicData: any, now: number = Date.now()): number | null {
    if (!publicData?.expiresAt) return null;
    const end = parseTagExpiry(publicData.expiresAt).getTime();
    if (!Number.isFinite(end) || end - now < 365 * DAY_MS) return null;

    const start = publicData.registeredAt ? parseTagExpiry(publicData.registeredAt).getTime() : NaN;
    const span = Number.isFinite(start) && start < end ? end - start : end - now;
    const derived = Math.max(1, Math.round(span / YEAR_MS));

    const duration = Number(publicData.duration);
    if (Number.isInteger(duration) && duration >= 1 && Math.abs(duration - span / YEAR_MS) < 1) return duration;
    return derived;
}

@Pipe({ name: "validityYears", standalone: true })
export class ValidityYearsPipe implements PipeTransform {
    transform(publicData: any): number | null {
        return validityYears(publicData);
    }
}
