import { Injectable } from "@angular/core";
import { TranslocoService } from "@jsverse/transloco";

import { environment } from "environments/environment";
import { HttpWrapperService } from "app/http-wrapper.service";

import {
    PasswordShareExpiration,
    PasswordSharePayload,
    PasswordShareUpload,
    buildPasswordShareLink,
    buildPasswordSharePayload,
    buildPasswordShareUpload,
    encryptPasswordShare,
    expirationToSeconds,
    isPasswordShareExpiration,
} from "./password-share-crypto";

export const PASSWORD_SHARE_ERROR_CODES = [
    "INVALID_CIPHERTEXT",
    "INVALID_IV",
    "INVALID_VERSION",
    "INVALID_EXPIRATION",
    "INVALID_MAX_VIEWS",
    "INVALID_LABEL",
    "SHARE_KEY_NOT_ACCEPTED",
    "SHARE_SESSION_REQUIRED",
    "SHARE_FORBIDDEN",
    "SHARE_NOT_FOUND",
    "SHARE_EXPIRED",
    "SHARE_TOO_LARGE",
    "PASSWORD_SHARE_RATE_LIMITED",
    "SHARE_UNAVAILABLE",
    "MISSING_PASSWORD",
] as const;

export type PasswordShareErrorCode = (typeof PASSWORD_SHARE_ERROR_CODES)[number];

const ERROR_TRANSLATION_KEYS: Record<PasswordShareErrorCode, string> = {
    INVALID_CIPHERTEXT: "billing.passwords.share.errors.INVALID_CIPHERTEXT",
    INVALID_IV: "billing.passwords.share.errors.INVALID_IV",
    INVALID_VERSION: "billing.passwords.share.errors.INVALID_VERSION",
    INVALID_EXPIRATION: "billing.passwords.share.errors.INVALID_EXPIRATION",
    INVALID_MAX_VIEWS: "billing.passwords.share.errors.INVALID_MAX_VIEWS",
    INVALID_LABEL: "billing.passwords.share.errors.INVALID_LABEL",
    SHARE_KEY_NOT_ACCEPTED: "billing.passwords.share.errors.SHARE_KEY_NOT_ACCEPTED",
    SHARE_SESSION_REQUIRED: "billing.passwords.share.errors.SHARE_SESSION_REQUIRED",
    SHARE_FORBIDDEN: "billing.passwords.share.errors.SHARE_FORBIDDEN",
    SHARE_NOT_FOUND: "billing.passwords.share.errors.SHARE_NOT_FOUND",
    SHARE_EXPIRED: "billing.passwords.share.errors.SHARE_EXPIRED",
    SHARE_TOO_LARGE: "billing.passwords.share.errors.SHARE_TOO_LARGE",
    PASSWORD_SHARE_RATE_LIMITED: "billing.passwords.share.errors.PASSWORD_SHARE_RATE_LIMITED",
    SHARE_UNAVAILABLE: "billing.passwords.share.errors.SHARE_UNAVAILABLE",
    MISSING_PASSWORD: "billing.passwords.share.missing_password",
};

const LOCAL_FAILURES = new Set([
    "SHARE_TOO_LARGE",
    "INVALID_LABEL",
    "INVALID_IV",
    "INVALID_CIPHERTEXT",
    "INVALID_VERSION",
    "SHARE_KEY_NOT_ACCEPTED",
]);

export class PasswordShareRequestError extends Error {
    readonly code: string;
    readonly retryAfterSeconds?: number;

    constructor(code: string, retryAfterSeconds?: number) {
        super(code);
        this.name = "PasswordShareRequestError";
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export interface CreatePasswordShareInput {
    title: string;
    password: string;
    username?: string;
    url?: string;
    notes?: string;
    expiresIn: PasswordShareExpiration;
    maxViews: number;
    label?: string;
}

export interface CreatedPasswordShare {
    id: string;
    expiresAt: string;
    maxViews: number;
    link: string;
}

export interface RevokedPasswordShare {
    id: string;
    revoked: true;
}

export interface PasswordShareSummary {
    id: string;
    label: string;
    expiresAt: string;
    maxViews: number;
    remainingViews: number;
    createdAt: string;
}

@Injectable({
    providedIn: "root",
})
export class PasswordShareService {
    private readonly _baseUrl = `${environment.v4ApiUrl}/api/password-shares`;

    constructor(
        private _http: HttpWrapperService,
        private _transloco: TranslocoService
    ) {}

    async createShare(input: CreatePasswordShareInput): Promise<CreatedPasswordShare> {
        if (!input.password) throw new PasswordShareRequestError("MISSING_PASSWORD");
        if (!isPasswordShareExpiration(input.expiresIn)) throw new PasswordShareRequestError("INVALID_EXPIRATION");

        const maxViews = normalizeMaxViews(input.maxViews);
        if (maxViews === null) throw new PasswordShareRequestError("INVALID_MAX_VIEWS");

        const payload: PasswordSharePayload = buildPasswordSharePayload(input);
        let body: PasswordShareUpload;
        let keyFragment: string;

        try {
            const encrypted = await encryptPasswordShare(payload);
            keyFragment = encrypted.keyFragment;
            body = buildPasswordShareUpload({
                ciphertext: encrypted.uploadWithoutKey.ciphertext,
                iv: encrypted.uploadWithoutKey.iv,
                expiresIn: expirationToSeconds(input.expiresIn),
                maxViews,
                label: input.label,
            });
        } catch (error) {
            throw localShareError(error);
        }

        let response: unknown;
        try {
            response = await this._http.sendRequest("post", this._baseUrl, body);
        } catch (error) {
            throw shareErrorFromHttp(error);
        }

        const created = readCreatedShare(response);
        if (!created) throw new PasswordShareRequestError("generic");

        return {
            ...created,
            link: buildPasswordShareLink(environment.landingUrl, created.id, keyFragment),
        };
    }

    async listShares(): Promise<PasswordShareSummary[]> {
        try {
            const response = await this._http.sendRequest("get", this._baseUrl);
            return normalizePasswordShareList(response);
        } catch (error) {
            throw shareErrorFromHttp(error);
        }
    }

    async revokeShare(id: string): Promise<RevokedPasswordShare> {
        let response: unknown;
        try {
            response = await this._http.sendRequest("delete", `${this._baseUrl}/${encodeURIComponent(id)}`);
        } catch (error) {
            throw shareErrorFromHttp(error);
        }

        const record = asRecord(response);
        if (!record || record["revoked"] !== true || typeof record["id"] !== "string" || !record["id"]) {
            throw new PasswordShareRequestError("generic");
        }

        return { id: record["id"], revoked: true };
    }

    translateError(error: unknown): string {
        const code = error instanceof PasswordShareRequestError ? error.code : extractPasswordShareErrorCode(error);
        const key = code && isPasswordShareErrorCode(code) ? ERROR_TRANSLATION_KEYS[code] : "billing.passwords.share.errors.generic";

        if (code === "PASSWORD_SHARE_RATE_LIMITED") {
            const seconds = error instanceof PasswordShareRequestError ? error.retryAfterSeconds : extractRetryAfterSeconds(error);
            if (typeof seconds === "number") {
                return this._transloco.translate(key, { seconds });
            }
            return this._transloco.translate("billing.passwords.share.errors.PASSWORD_SHARE_RATE_LIMITED_WAIT");
        }

        return this._transloco.translate(key);
    }
}

export function extractPasswordShareErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") return null;

    const body = (error as { error?: unknown }).error;
    const candidates: unknown[] = [];

    if (typeof body === "string") candidates.push(body);
    if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        candidates.push(record["code"], record["error"]);
        if (record["error"] && typeof record["error"] === "object") {
            candidates.push((record["error"] as Record<string, unknown>)["code"]);
        }
        candidates.push(record["message"]);
    }

    for (const candidate of candidates) {
        if (typeof candidate !== "string") continue;
        const code = candidate.trim();
        if (/^[A-Z][A-Z0-9_]+$/.test(code)) return code;
    }

    return null;
}

export function extractRetryAfterSeconds(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;

    const headers = (error as { headers?: { get?: (name: string) => string | null } }).headers;
    const raw = headers?.get?.("Retry-After") ?? headers?.get?.("retry-after");
    if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return undefined;

    return Number(raw.trim());
}

function shareErrorFromHttp(error: unknown): PasswordShareRequestError {
    return new PasswordShareRequestError(extractPasswordShareErrorCode(error) ?? "generic", extractRetryAfterSeconds(error));
}

function localShareError(error: unknown): PasswordShareRequestError {
    const message = error instanceof Error ? error.message : "";
    if (LOCAL_FAILURES.has(message)) return new PasswordShareRequestError(message);
    return new PasswordShareRequestError("generic");
}

export function normalizePasswordShareList(body: unknown): PasswordShareSummary[] {
    const record = asRecord(body);
    const raw = record?.["shares"];
    if (!Array.isArray(raw)) return [];

    return raw.map(normalizePasswordShare).filter((item): item is PasswordShareSummary => !!item);
}

const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

function readCreatedShare(body: unknown): { id: string; expiresAt: string; maxViews: number } | null {
    const record = asRecord(body);
    if (!record || typeof record["id"] !== "string" || !SHARE_ID_PATTERN.test(record["id"])) return null;
    if (typeof record["expiresAt"] !== "string" || !record["expiresAt"]) return null;
    if (typeof record["maxViews"] !== "number" || !Number.isInteger(record["maxViews"])) return null;

    return {
        id: record["id"],
        expiresAt: record["expiresAt"],
        maxViews: record["maxViews"],
    };
}

function normalizePasswordShare(value: unknown): PasswordShareSummary | null {
    const record = asRecord(value);
    if (!record || typeof record["id"] !== "string" || !record["id"]) return null;
    if (typeof record["maxViews"] !== "number" || typeof record["remainingViews"] !== "number") return null;

    return {
        id: record["id"],
        label: typeof record["label"] === "string" ? record["label"].trim() : "",
        expiresAt: typeof record["expiresAt"] === "string" ? record["expiresAt"] : "",
        maxViews: record["maxViews"],
        remainingViews: Math.max(0, record["remainingViews"]),
        createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : "",
    };
}

function normalizeMaxViews(value: number): number | null {
    if (!Number.isInteger(value) || value < 1 || value > 10) return null;
    return value;
}

function isPasswordShareErrorCode(code: string): code is PasswordShareErrorCode {
    return (PASSWORD_SHARE_ERROR_CODES as readonly string[]).includes(code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
