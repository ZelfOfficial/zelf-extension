/** Keys item protection — mirrors publicData.protection on stored items. */
export type ZelfKeysProtection = "face" | "face_password";

export const ZELF_KEYS_PROTECTION_FACE: ZelfKeysProtection = "face";
export const ZELF_KEYS_PROTECTION_FACE_PASSWORD: ZelfKeysProtection = "face_password";

export function parseZelfKeysProtection(value: unknown): ZelfKeysProtection | undefined {
    if (value === ZELF_KEYS_PROTECTION_FACE) {
        return ZELF_KEYS_PROTECTION_FACE;
    }

    if (value === ZELF_KEYS_PROTECTION_FACE_PASSWORD) {
        return ZELF_KEYS_PROTECTION_FACE_PASSWORD;
    }

    return undefined;
}

export function zelfKeysRequiresDecryptPassword(protection?: ZelfKeysProtection | null): boolean {
    return protection === ZELF_KEYS_PROTECTION_FACE_PASSWORD;
}

export function protectionFromDecryptToggle(requireOnDecrypt: boolean): ZelfKeysProtection {
    return requireOnDecrypt ? ZELF_KEYS_PROTECTION_FACE_PASSWORD : ZELF_KEYS_PROTECTION_FACE;
}

/** Resolve protection from the cached zOTP model (list/detail) before retrieve. */
export function resolveZotpProtection(zotp: {
    protection?: ZelfKeysProtection | null;
    ipfs?: { publicData?: { protection?: unknown } } | null;
}): ZelfKeysProtection {
    return (
        parseZelfKeysProtection(zotp.protection) ??
        parseZelfKeysProtection(zotp.ipfs?.publicData?.protection) ??
        ZELF_KEYS_PROTECTION_FACE
    );
}
