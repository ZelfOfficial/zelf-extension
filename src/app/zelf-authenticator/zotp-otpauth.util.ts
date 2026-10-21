export interface ParsedTotpSetup {
    name: string;
    issuer: string;
    secret: string;
    algorithm?: string;
    digits?: number;
    period?: number;
}

const OTPAUTH_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);

export function parseOtpAuthAlgorithm(value: string | null | undefined): string | undefined {
    if (!value) return undefined;

    const normalized = value.trim().toUpperCase().replace(/-/g, "");

    return OTPAUTH_ALGORITHMS.has(normalized) ? normalized : undefined;
}

export function parseOtpAuthDigits(value: string | null | undefined): number | undefined {
    if (!value) return undefined;

    const digits = Number.parseInt(value, 10);

    if (!Number.isFinite(digits) || digits < 6 || digits > 8) {
        return undefined;
    }

    return digits;
}

export function parseOtpAuthPeriod(value: string | null | undefined): number | undefined {
    if (!value) return undefined;

    const period = Number.parseInt(value, 10);

    if (!Number.isFinite(period) || period <= 0) {
        return undefined;
    }

    return period;
}

/** Parse `otpauth://totp/...` URIs including non-default algorithm, digits, and period. */
export function parseOtpAuthTotpUri(uri: string): ParsedTotpSetup | null {
    if (!uri.startsWith("otpauth://")) return null;

    try {
        const url = new URL(uri);

        if (url.protocol !== "otpauth:" || url.hostname !== "totp") return null;

        const pathParts = decodeURIComponent(url.pathname.replace(/^\//, "")).split(":");
        const pathIssuer = pathParts[0] || "";
        const pathName = pathParts[1] || "";
        const secret = url.searchParams.get("secret") || "";

        if (!secret) return null;

        const issuerParam = url.searchParams.get("issuer");
        const issuer = issuerParam ? decodeURIComponent(issuerParam) : decodeURIComponent(pathIssuer);
        const name = pathName || issuerParam || "";

        return {
            name: decodeURIComponent(name),
            issuer,
            secret,
            algorithm: parseOtpAuthAlgorithm(url.searchParams.get("algorithm")),
            digits: parseOtpAuthDigits(url.searchParams.get("digits")),
            period: parseOtpAuthPeriod(url.searchParams.get("period")),
        };
    } catch {
        return null;
    }
}

export function migrationAlgorithmFromEnum(value: number): string | undefined {
    switch (value) {
        case 1:
            return "SHA1";
        case 2:
            return "SHA256";
        case 3:
            return "SHA512";
        default:
            return undefined;
    }
}

export function migrationDigitsFromEnum(value: number): number | undefined {
    switch (value) {
        case 1:
            return 6;
        case 2:
            return 8;
        default:
            return undefined;
    }
}
