/**
 * Password share envelope (sender side). The landing recipient page must mirror this file.
 *
 * Algorithm
 * - AES-GCM, 256-bit key, 96-bit IV, 128-bit authentication tag.
 * - No additional authenticated data.
 * - WebCrypto appends the tag to the ciphertext. Do not split or prepend it.
 *
 * Encodings
 * - `ciphertext`: standard base64 (RFC 4648, with padding) of the WebCrypto AES-GCM output.
 *   That output is ciphertext || 16-byte tag. Decoded length is 1 to 16384 bytes.
 * - `iv`: standard base64 of exactly 12 bytes.
 * - URL fragment: base64url of the raw 32-byte key, no padding (`+` → `-`, `/` → `_`, strip `=`).
 *   Only the key uses base64url. The API rejects a body field named key, password, plaintext,
 *   secret, dek, contentKey, aesKey, or encryptionKey (`SHARE_KEY_NOT_ACCEPTED`).
 * - The key is never a request field. It lives only in the URL fragment, which browsers do not send.
 *
 * Plaintext
 * - UTF-8 JSON, compact `JSON.stringify` of `{ v: 1, title, password, username?, url?, notes? }`.
 * - `v`, `title`, and `password` are always present. Optional fields are omitted when empty.
 * - Key order is not significant. Parse JSON; do not slice the string.
 *
 * Upload body (unwrapped success `{ id, expiresAt, maxViews }`; id is 256-bit base64url)
 * - `{ ciphertext, iv, version: 1, expiresIn, maxViews, label? }`
 * - `expiresIn` is one of 3600, 86400, 604800, 2592000.
 * - `maxViews` is an integer from 1 to 10.
 * - `label` is optional, trimmed, at most 60 characters, no ASCII control characters.
 *
 * Link
 * - `https://<landingUrl>/share/<id>#<base64url(rawKey)>`
 */

export const PASSWORD_SHARE_MAX_CIPHERTEXT_BYTES = 16 * 1024;
export const PASSWORD_SHARE_GCM_TAG_BYTES = 16;
export const PASSWORD_SHARE_MAX_LABEL_LENGTH = 60;
export const PASSWORD_SHARE_BODY_FIELDS = ["ciphertext", "iv", "version", "expiresIn", "maxViews", "label"] as const;
export const PASSWORD_SHARE_REJECTED_BODY_FIELDS = [
    "key",
    "password",
    "plaintext",
    "secret",
    "dek",
    "contentKey",
    "aesKey",
    "encryptionKey",
] as const;

export const PASSWORD_SHARE_VERSION = 1;
export const PASSWORD_SHARE_IV_BYTES = 12;
export const PASSWORD_SHARE_KEY_BYTES = 32;
export const PASSWORD_SHARE_KEY_BITS = 256;
/** Plaintext cap so ciphertext || 16-byte tag stays within 16384 decoded bytes. */
export const PASSWORD_SHARE_MAX_PLAINTEXT_BYTES = PASSWORD_SHARE_MAX_CIPHERTEXT_BYTES - PASSWORD_SHARE_GCM_TAG_BYTES;

export const PASSWORD_SHARE_EXPIRATION_SECONDS = {
    "1h": 60 * 60,
    "1d": 24 * 60 * 60,
    "7d": 7 * 24 * 60 * 60,
    "30d": 30 * 24 * 60 * 60,
} as const;

export type PasswordShareExpiration = keyof typeof PASSWORD_SHARE_EXPIRATION_SECONDS;

export interface PasswordSharePayload {
    v: 1;
    title: string;
    password: string;
    username?: string;
    url?: string;
    notes?: string;
}

export interface PasswordShareUpload {
    ciphertext: string;
    iv: string;
    version: 1;
    expiresIn: number;
    maxViews: number;
    label?: string;
}

export interface EncryptedPasswordShare {
    uploadWithoutKey: Pick<PasswordShareUpload, "ciphertext" | "iv" | "version">;
    keyFragment: string;
}

export function isPasswordShareExpiration(value: string): value is PasswordShareExpiration {
    return Object.prototype.hasOwnProperty.call(PASSWORD_SHARE_EXPIRATION_SECONDS, value);
}

export function expirationToSeconds(expiration: PasswordShareExpiration): number {
    return PASSWORD_SHARE_EXPIRATION_SECONDS[expiration];
}

export function buildPasswordSharePayload(input: {
    title?: string;
    password: string;
    username?: string;
    url?: string;
    notes?: string;
}): PasswordSharePayload {
    const payload: PasswordSharePayload = {
        v: PASSWORD_SHARE_VERSION,
        title: (input.title ?? "").trim(),
        password: input.password ?? "",
    };

    const username = input.username?.trim();
    const url = input.url?.trim();
    const notes = input.notes?.trim();

    if (username) payload.username = username;
    if (url) payload.url = url;
    if (notes) payload.notes = notes;

    return payload;
}

export function buildPasswordShareUpload(input: {
    ciphertext: string;
    iv: string;
    expiresIn: number;
    maxViews: number;
    label?: string;
}): PasswordShareUpload {
    const upload: PasswordShareUpload = {
        ciphertext: input.ciphertext,
        iv: input.iv,
        version: PASSWORD_SHARE_VERSION,
        expiresIn: input.expiresIn,
        maxViews: input.maxViews,
    };

    const label = normalizeShareLabel(input.label);
    if (label) upload.label = label;

    assertPasswordShareRequestBody(upload);
    return upload;
}

/** Trimmed label, or undefined when blank. Throws INVALID_LABEL when the API would reject it. */
export function normalizeShareLabel(label?: string): string | undefined {
    if (label == null) return undefined;
    const trimmed = label.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > PASSWORD_SHARE_MAX_LABEL_LENGTH || /[\u0000-\u001F\u007F]/.test(trimmed)) {
        throw new Error("INVALID_LABEL");
    }
    return trimmed;
}

/**
 * The POST body is only the envelope. The password JSON stays inside `ciphertext`,
 * so none of the rejected names is a top-level field.
 */
export function assertPasswordShareRequestBody(body: PasswordShareUpload): void {
    const record = body as unknown as Record<string, unknown>;

    for (const field of PASSWORD_SHARE_REJECTED_BODY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(record, field) && record[field] != null && record[field] !== "") {
            throw new Error("SHARE_KEY_NOT_ACCEPTED");
        }
    }

    for (const key of Object.keys(record)) {
        if (!(PASSWORD_SHARE_BODY_FIELDS as readonly string[]).includes(key)) {
            throw new Error("SHARE_KEY_NOT_ACCEPTED");
        }
    }

    let cipherBytes: Uint8Array;
    try {
        cipherBytes = base64ToBytes(body.ciphertext);
    } catch {
        throw new Error("INVALID_CIPHERTEXT");
    }

    if (cipherBytes.length < 1) throw new Error("INVALID_CIPHERTEXT");
    if (cipherBytes.length > PASSWORD_SHARE_MAX_CIPHERTEXT_BYTES) throw new Error("SHARE_TOO_LARGE");

    let ivBytes: Uint8Array;
    try {
        ivBytes = base64ToBytes(body.iv);
    } catch {
        throw new Error("INVALID_IV");
    }

    if (ivBytes.length !== PASSWORD_SHARE_IV_BYTES) throw new Error("INVALID_IV");
    if (body.version !== PASSWORD_SHARE_VERSION) throw new Error("INVALID_VERSION");
}

export function buildPasswordShareLink(landingUrl: string, id: string, keyFragment: string): string {
    const origin = (landingUrl || "").trim().replace(/\/+$/, "");
    return `${origin}/share/${encodeURIComponent(id)}#${keyFragment}`;
}

export async function encryptPasswordShare(payload: PasswordSharePayload): Promise<EncryptedPasswordShare> {
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    if (plaintext.byteLength > PASSWORD_SHARE_MAX_PLAINTEXT_BYTES) {
        throw new Error("SHARE_TOO_LARGE");
    }

    const subtle = requireSubtle();
    const key = await subtle.generateKey({ name: "AES-GCM", length: PASSWORD_SHARE_KEY_BITS }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(PASSWORD_SHARE_IV_BYTES));
    const cipherBuffer = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const cipherBytes = new Uint8Array(cipherBuffer);
    if (cipherBytes.length > PASSWORD_SHARE_MAX_CIPHERTEXT_BYTES) {
        throw new Error("SHARE_TOO_LARGE");
    }
    const rawKey = new Uint8Array(await subtle.exportKey("raw", key));

    return {
        uploadWithoutKey: {
            ciphertext: bytesToBase64(cipherBytes),
            iv: bytesToBase64(iv),
            version: PASSWORD_SHARE_VERSION,
        },
        keyFragment: bytesToBase64Url(rawKey),
    };
}

export async function decryptPasswordShare(input: {
    ciphertext: string;
    iv: string;
    keyFragment: string;
}): Promise<PasswordSharePayload> {
    const ivBytes = base64ToBytes(input.iv);
    const keyBytes = base64UrlToBytes(input.keyFragment);
    const cipherBytes = base64ToBytes(input.ciphertext);

    if (ivBytes.length !== PASSWORD_SHARE_IV_BYTES) throw new Error("PASSWORD_SHARE_INVALID_IV");
    if (keyBytes.length !== PASSWORD_SHARE_KEY_BYTES) throw new Error("PASSWORD_SHARE_INVALID_KEY");

    const subtle = requireSubtle();
    const key = await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);

    let plainBuffer: ArrayBuffer;
    try {
        plainBuffer = await subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, cipherBytes);
    } catch {
        throw new Error("PASSWORD_SHARE_DECRYPT_FAILED");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(plainBuffer));
    } catch {
        throw new Error("PASSWORD_SHARE_DECRYPT_FAILED");
    }

    if (!isPasswordSharePayload(parsed)) throw new Error("PASSWORD_SHARE_DECRYPT_FAILED");

    return parsed;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    return base64ToBytes(normalized + pad);
}

function requireSubtle(): SubtleCrypto {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("PASSWORD_SHARE_WEBCRYPTO_UNAVAILABLE");
    return subtle;
}

function isPasswordSharePayload(value: unknown): value is PasswordSharePayload {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if (record["v"] !== PASSWORD_SHARE_VERSION) return false;
    if (typeof record["title"] !== "string") return false;
    if (typeof record["password"] !== "string") return false;
    if (record["username"] !== undefined && typeof record["username"] !== "string") return false;
    if (record["url"] !== undefined && typeof record["url"] !== "string") return false;
    if (record["notes"] !== undefined && typeof record["notes"] !== "string") return false;
    return true;
}
