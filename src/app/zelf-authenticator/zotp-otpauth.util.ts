export interface ParsedTotpSetup {
    name: string;
    issuer: string;
    secret: string;
    algorithm?: string;
    digits?: number;
    period?: number;
}

const OTPAUTH_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);

/** Key Uri Format defaults. Used only when an entry has no stored value for that field. */
const OTPAUTH_DEFAULT_ALGORITHM = "SHA1";
const OTPAUTH_DEFAULT_DIGITS = 6;
const OTPAUTH_DEFAULT_PERIOD = 30;

export interface OtpAuthTotpParamSource {
    algorithm?: unknown;
    digits?: unknown;
    period?: unknown;
}

export interface OtpAuthTotpUriInput {
    name: string;
    issuer?: string | null;
    secret: string;
    /**
     * Parameter sources in priority order. The first source with a real value for a field wins.
     * Pass decrypted metadata before the locked entry so unlock values are not replaced by placeholders.
     */
    sources?: Array<OtpAuthTotpParamSource | null | undefined>;
}

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

function asParamString(value: unknown): string | undefined {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return undefined;
        return String(value);
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }

    return undefined;
}

/**
 * Resolve algorithm, digits, and period for an otpauth URI.
 * Earlier sources win per field. Defaults apply only when every source omits that field.
 */
export function resolveOtpAuthTotpParams(
    sources: Array<OtpAuthTotpParamSource | null | undefined>
): { algorithm: string; digits: number; period: number } {
    let algorithm: string | undefined;
    let digits: number | undefined;
    let period: number | undefined;

    for (const source of sources) {
        if (!source) continue;

        if (!algorithm) {
            algorithm = parseOtpAuthAlgorithm(asParamString(source.algorithm));
        }

        if (digits == null) {
            digits = parseOtpAuthDigits(asParamString(source.digits));
        }

        if (period == null) {
            period = parseOtpAuthPeriod(asParamString(source.period));
        }
    }

    return {
        algorithm: algorithm ?? OTPAUTH_DEFAULT_ALGORITHM,
        digits: digits ?? OTPAUTH_DEFAULT_DIGITS,
        period: period ?? OTPAUTH_DEFAULT_PERIOD,
    };
}

/**
 * Build an `otpauth://totp/` URI. Issuer and label encoding match the existing QR export.
 * `algorithm`, `digits`, and `period` are always included (Key Uri Format).
 */
export function buildOtpAuthTotpUri(input: OtpAuthTotpUriInput): string {
    const issuer = input.issuer ? input.issuer : "";
    const label = issuer
        ? `${encodeURIComponent(issuer)}:${encodeURIComponent(input.name)}`
        : encodeURIComponent(input.name);
    const params = resolveOtpAuthTotpParams(input.sources ?? []);
    const issuerQuery = issuer ? `&issuer=${encodeURIComponent(issuer)}` : "";

    return `otpauth://totp/${label}?secret=${input.secret}${issuerQuery}&algorithm=${params.algorithm}&digits=${params.digits}&period=${params.period}`;
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
