import { ZelfKeysProtection } from "app/models/zelf-keys-protection";
import { ZOTP } from "app/models/zotp.model";

export const ZOTP_DEFAULT_ALGORITHM = "SHA1";
export const ZOTP_DEFAULT_DIGITS = 6;
export const ZOTP_DEFAULT_PERIOD = 30;

export interface ZotpStoreRequestBody {
    username: string;
    setupKey: string;
    issuer: string;
    folder: string;
    insideFolder: boolean;
    faceBase64: string;
    algorithm: string;
    digits: string;
    period: string;
    masterPassword?: string;
    protection?: ZelfKeysProtection;
}

/** Build POST /store/zotp body; TOTP fields are top-level (API persists them in encrypted metadata). */
export function buildZotpStoreRequestBody(
    zotp: Pick<ZOTP, "name" | "secret" | "issuer" | "algorithm" | "digits" | "period">,
    faceBase64: string,
    masterPassword?: string,
    protection?: ZelfKeysProtection
): ZotpStoreRequestBody {
    const algorithm = (zotp.algorithm || ZOTP_DEFAULT_ALGORITHM).toUpperCase();
    const digits = zotp.digits ?? ZOTP_DEFAULT_DIGITS;
    const period = zotp.period ?? ZOTP_DEFAULT_PERIOD;

    if (!zotp.secret) {
        throw new Error("Secret is required to store ZOTP");
    }

    return {
        username: zotp.name,
        setupKey: zotp.secret,
        issuer: zotp.issuer || "Unknown",
        folder: "ZOTP",
        insideFolder: false,
        faceBase64,
        algorithm,
        digits: String(digits),
        period: String(period),
        ...(masterPassword ? { masterPassword } : {}),
        ...(protection ? { protection } : {}),
    };
}

export function parseTotpParamsFromRetrieveSources(
    metadata?: Record<string, unknown> | null,
    publicData?: Record<string, unknown> | null
): { algorithm: string; digits: number; period: number } {
    const algorithmRaw = metadata?.algorithm ?? publicData?.algorithm;
    const digitsRaw = metadata?.digits ?? publicData?.digits;
    const periodRaw = metadata?.period ?? publicData?.period;

    const algorithm =
        algorithmRaw != null && String(algorithmRaw).trim()
            ? String(algorithmRaw).trim().toUpperCase()
            : ZOTP_DEFAULT_ALGORITHM;

    const digitsParsed = digitsRaw != null && String(digitsRaw).trim() !== "" ? Number(digitsRaw) : ZOTP_DEFAULT_DIGITS;
    const periodParsed = periodRaw != null && String(periodRaw).trim() !== "" ? Number(periodRaw) : ZOTP_DEFAULT_PERIOD;

    return {
        algorithm,
        digits: Number.isFinite(digitsParsed) ? digitsParsed : ZOTP_DEFAULT_DIGITS,
        period: Number.isFinite(periodParsed) && periodParsed > 0 ? periodParsed : ZOTP_DEFAULT_PERIOD,
    };
}

export function applyTotpParamsToZotp(
    zotp: ZOTP,
    metadata?: Record<string, unknown> | null,
    publicData?: Record<string, unknown> | null
): ZOTP {
    const params = parseTotpParamsFromRetrieveSources(metadata, publicData);

    return {
        ...zotp,
        algorithm: params.algorithm,
        digits: params.digits,
        period: params.period,
        ipfs: publicData
            ? {
                  ...zotp.ipfs,
                  publicData: {
                      ...zotp.ipfs?.publicData,
                      ...publicData,
                      algorithm: params.algorithm,
                      digits: params.digits,
                      period: params.period,
                  },
              }
            : zotp.ipfs,
    };
}
