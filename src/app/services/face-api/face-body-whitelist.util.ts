/**
 * Subset of server `Repositories/Face/modules/face-body-whitelist.module.js`
 * for extension face routes (keys we may send).
 */

const COMMON = [
    "faceBase64",
    "faceNonce",
    "pow",
    "password",
    "securePassword",
    "os",
    "masterPassword",
    "captchaToken",
] as const;

const withCommon = (...fields: string[]) => [...new Set([...COMMON, ...fields])];

/** Allowed body keys per face `action` (server gate whitelist). */
export const FACE_ALLOWED_BY_ACTION: Record<string, readonly string[]> = {
    decrypt: withCommon("tagName", "domain", "addServerPassword", "zelfProof", "securityType", "mnemonic"),
    lease: withCommon(
        "tagName",
        "domain",
        "type",
        "mnemonic",
        "referralTagName",
        "wordsCount",
        "addServerPassword",
        "securityType"
    ),
    "lease-recovery": withCommon(
        "zelfProof",
        "tagName",
        "domain",
        "securityType",
        "referralTagName",
        "duration",
        "addServerPassword"
    ),
    delete: withCommon("tagName", "domain", "cid", "id"),
    "my-tags-transfer": withCommon("tagName", "domain"),
    retrieve: withCommon(
        "zelfProof",
        "id",
        "category",
        "clientPublicKey",
        "type",
        "v",
        "publicData",
        "protection"
    ),
    preview: withCommon("zelfProof", "id", "category"),
    "store-password": withCommon(
        "alias",
        "website",
        "username",
        "folder",
        "insideFolder",
        "notes",
        "protection",
        "defaultProtection"
    ),
    "store-passwords-bulk": withCommon("passwords", "protection"),
    "store-zotp": withCommon(
        "username",
        "setupKey",
        "issuer",
        "folder",
        "insideFolder",
        "protection",
        "algorithm",
        "digits",
        "period"
    ),
    "store-notes": withCommon("title", "keyValuePairs", "folder", "insideFolder", "protection"),
    "store-credit-card": withCommon(
        "alias",
        "cardName",
        "cardNumber",
        "expiryMonth",
        "expiryYear",
        "cvv",
        "bankName",
        "folder",
        "insideFolder",
        "protection"
    ),
    "wallet-decrypt": withCommon(),
    "wallet-create": withCommon(),
};

/** Server-only keys stripped silently when present (never forwarded). */
export const FACE_STRIPPED_SERVER_ONLY_FIELDS = [
    "removePGP",
    "tolerance",
    "requireLiveness",
    "liveness_tolerance",
    "livenessDetectionPriorCreation",
    "check_live_face_before_creation",
    "verifierKey",
    "referenceFaceBase64",
    "hasPassword",
    "require_live_face",
] as const;

export function pickFaceWhitelistedBody(action: string, body: Record<string, unknown>): Record<string, unknown> {
    const allowed = FACE_ALLOWED_BY_ACTION[action];
    if (!allowed) {
        return { ...body };
    }

    const allowedSet = new Set(allowed);
    const picked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
        if (allowedSet.has(key)) {
            picked[key] = value;
        }
    }

    for (const key of FACE_STRIPPED_SERVER_ONLY_FIELDS) {
        delete picked[key];
    }

    if (picked["securePassword"] && !picked["password"]) {
        picked["password"] = picked["securePassword"];
    }
    delete picked["securePassword"];

    if (picked["securityType"] === "securePassword") {
        delete picked["securityType"];
    }

    return picked;
}
