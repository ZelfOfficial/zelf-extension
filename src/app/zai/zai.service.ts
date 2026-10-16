import { Injectable } from "@angular/core";

import { environment } from "environments/environment";

/**
 * zAI client (contract: zai-api-contract.md v0.1).
 *
 * - identityToken comes inline from a successful decrypt (data.identityToken).
 * - It is exchanged for a short-lived zAI token via POST /api/zai/session.
 * - Tokens live in memory and chrome.storage.session only (cleared on lock/logout);
 *   they are never written to local storage and never logged.
 */
export type ZaiRole = "user" | "assistant";

export interface ZaiHistoryItem {
    role: ZaiRole;
    content: string;
}

export interface ZaiTransactionCard {
    type: "transaction";
    hash: string;
    chain: string;
    status: "success" | "pending" | "failed" | string;
    amount?: string;
    symbol?: string;
    timestamp?: string | null;
    explorerUrl?: string | null;
}

export interface ZaiBalanceCard {
    type: "balance";
    chain: string;
    symbol: string;
    amount: string;
    usdValue?: number | null;
}

export interface ZaiDocCard {
    type: "doc";
    title: string;
    url: string;
}

/** Cards are built by the server from tool results only (event: card); never parsed from reply text. */
export type ZaiCard = ZaiTransactionCard | ZaiBalanceCard | ZaiDocCard;

export interface ZaiMeta {
    requestId: string;
    rulesVersion: string;
}

export interface ZaiDone {
    usage?: { inputTokens?: number; outputTokens?: number };
    finishReason?: "stop" | "length" | "filtered" | string;
}

export interface ZaiResult {
    requestId: string;
    status: "pending" | "answered" | "failed" | "timeout";
    text: string | null;
    cards: ZaiCard[];
}

export interface ZaiStreamHandlers {
    onMeta?: (meta: ZaiMeta) => void;
    /** "thinking": Angela is working on the answer (her runs queue; can take minutes). */
    onStatus?: (status: { state: string }) => void;
    onDelta: (text: string) => void;
    onCard?: (card: ZaiCard) => void;
    onDone?: (done: ZaiDone) => void;
}

const SAFE_URL = /^https:\/\//i;

/** Validate a server card before it reaches the UI (unknown types and non-https links are dropped). */
export function sanitizeZaiCard(raw: any): ZaiCard | null {
    if (!raw || typeof raw !== "object") return null;
    const str = (v: any) => (v === undefined || v === null ? undefined : String(v));
    const url = (v: any) => (typeof v === "string" && SAFE_URL.test(v) ? v : null);
    switch (raw.type) {
        case "transaction":
            if (!raw.hash || !raw.chain) return null;
            return {
                type: "transaction",
                hash: String(raw.hash),
                chain: String(raw.chain),
                status: String(raw.status || "success"),
                amount: str(raw.amount),
                symbol: str(raw.symbol),
                timestamp: str(raw.timestamp) ?? null,
                explorerUrl: url(raw.explorerUrl),
            };
        case "balance":
            if (!raw.chain || !raw.symbol) return null;
            return {
                type: "balance",
                chain: String(raw.chain),
                symbol: String(raw.symbol),
                amount: String(raw.amount ?? ""),
                usdValue: typeof raw.usdValue === "number" ? raw.usdValue : null,
            };
        case "doc": {
            const u = url(raw.url);
            if (!u) return null;
            return { type: "doc", title: String(raw.title || u), url: u };
        }
        default:
            return null;
    }
}

export type ZaiErrorKind = "unavailable" | "unauthorized" | "rate_limited" | "refused" | "network" | "timeout" | "dropped" | "error";

export class ZaiError extends Error {
    constructor(
        public kind: ZaiErrorKind,
        public code?: string,
        public retryAfter?: number,
        public requestId?: string
    ) {
        super(code || kind);
    }
}

const SESSION_KEY = "zai_session";
const PENDING_KEY = "zai_pending_request";

interface ZaiSessionState {
    identityToken?: string;
    zaiToken?: string;
    zaiTokenExp?: number;
}

@Injectable({ providedIn: "root" })
export class ZaiService {
    private readonly _baseUrl: string = (environment as any).v4ApiUrl || "https://v4.zelf.world";
    private _state: ZaiSessionState = {};
    private _loaded = false;

    /** Called by decrypt flows when the response carries data.identityToken. */
    async setIdentityToken(identityToken?: string): Promise<void> {
        if (!identityToken || typeof identityToken !== "string") return;
        this._state = { identityToken };
        this._loaded = true;
        await this._persist();
    }

    /** Capture identityToken from any decrypt response shape without touching other fields. */
    captureFromDecrypt(response: any): void {
        const token = response?.data?.identityToken ?? response?.identityToken;
        if (token) void this.setIdentityToken(token);
    }

    async hasIdentity(): Promise<boolean> {
        await this._load();
        return !!this._state.identityToken;
    }

    /** Revoke on lock/logout (best effort), then clear session memory. */
    async revoke(): Promise<void> {
        await this._load();
        const { identityToken, zaiToken } = this._state;
        this._state = {};
        await this._persist();
        await this._setPending(undefined);
        if (!identityToken && !zaiToken) return;
        // Fire-and-forget so lock/logout never waits on the network.
        void fetch(`${this._baseUrl}/api/zai/revoke`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(zaiToken ? { Authorization: `Bearer ${zaiToken}` } : {}),
                },
                body: JSON.stringify({ identityToken }),
            }).catch(() => undefined);
    }

    async chat(
        body: { conversationId: string; message: string; history: ZaiHistoryItem[]; locale: string },
        handlers: ZaiStreamHandlers,
        signal?: AbortSignal
    ): Promise<void> {
        let token = await this._getZaiToken();
        let res = await this._postChat(token, body, signal);

        if (res.status === 401 && this._state.identityToken) {
            this._state.zaiToken = undefined;
            token = await this._getZaiToken();
            res = await this._postChat(token, body, signal);
        }

        if (!res.ok) throw await this._toError(res);
        if (!res.body) throw new ZaiError("unavailable");

        let requestId: string | undefined;
        let finished = false;
        const tracked: ZaiStreamHandlers = {
            ...handlers,
            onMeta: (m) => {
                requestId = m?.requestId;
                if (requestId) void this._setPending(requestId);
                handlers.onMeta?.(m);
            },
            onDone: (d) => {
                finished = true;
                void this._setPending(undefined);
                handlers.onDone?.(d);
            },
        };
        try {
            await this._readSse(res.body, tracked);
        } catch (e: any) {
            if (e instanceof ZaiError) {
                if (e.kind !== "timeout") void this._setPending(undefined);
                throw e;
            }
            if (e?.name === "AbortError") throw e;
            finished = false;
        }
        // Stream ended (or broke) without done/error: the answer may still arrive → result pickup.
        if (!finished) throw new ZaiError("dropped", "ZAI_STREAM_DROPPED", undefined, requestId);
    }

    /**
     * Main recovery path: GET /api/zai/result/:requestId (same Zelf ID only).
     * Polls until answered/failed/timeout or until `maxWaitMs`.
     */
    async pickupResult(requestId: string, opts: { intervalMs?: number; maxWaitMs?: number; signal?: AbortSignal } = {}): Promise<ZaiResult> {
        const intervalMs = opts.intervalMs ?? 4000;
        const until = Date.now() + (opts.maxWaitMs ?? 4 * 60 * 1000);
        for (;;) {
            if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
            const token = await this._getZaiToken();
            let res: Response;
            try {
                res = await fetch(`${this._baseUrl}/api/zai/result/${encodeURIComponent(requestId)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: opts.signal,
                });
            } catch (e: any) {
                if (e?.name === "AbortError") throw e;
                res = undefined as any;
            }
            if (res && res.ok) {
                const json: any = await res.json().catch(() => ({}));
                const data = json?.data || {};
                const result: ZaiResult = {
                    requestId,
                    status: data.status,
                    text: typeof data.text === "string" ? data.text : null,
                    cards: (Array.isArray(data.cards) ? data.cards : []).map(sanitizeZaiCard).filter(Boolean) as ZaiCard[],
                };
                if (result.status !== "pending") {
                    await this._setPending(undefined);
                    return result;
                }
            } else if (res && res.status !== 401) {
                await this._setPending(undefined);
                throw await this._toError(res);
            }
            if (Date.now() + intervalMs > until) return { requestId, status: "timeout", text: null, cards: [] };
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }

    /** requestId of a question still in flight (survives the popup closing; chrome.storage.session only). */
    async getPendingRequestId(): Promise<string | undefined> {
        try {
            const api: any = (globalThis as any).chrome?.storage?.session;
            if (api) return (await api.get(PENDING_KEY))?.[PENDING_KEY] || undefined;
            return sessionStorage.getItem(PENDING_KEY) || undefined;
        } catch {
            return undefined;
        }
    }

    private async _setPending(requestId?: string): Promise<void> {
        try {
            const api: any = (globalThis as any).chrome?.storage?.session;
            if (api) {
                if (requestId) await api.set({ [PENDING_KEY]: requestId });
                else await api.remove(PENDING_KEY);
            } else if (requestId) sessionStorage.setItem(PENDING_KEY, requestId);
            else sessionStorage.removeItem(PENDING_KEY);
        } catch {
            /* memory only */
        }
    }

    private async _postChat(token: string, body: any, signal?: AbortSignal): Promise<Response> {
        try {
            return await fetch(`${this._baseUrl}/api/zai/chat`, {
                method: "POST",
                signal,
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    Accept: "text/event-stream",
                    "X-Zelf-Client": "extension/2.1.x",
                },
                body: JSON.stringify(body),
            });
        } catch (e: any) {
            if (e?.name === "AbortError") throw e;
            throw new ZaiError("network");
        }
    }

    private async _getZaiToken(): Promise<string> {
        await this._load();
        const now = Math.floor(Date.now() / 1000);
        if (this._state.zaiToken && (this._state.zaiTokenExp || 0) - 30 > now) return this._state.zaiToken;
        if (!this._state.identityToken) throw new ZaiError("unauthorized", "ZAI_TOKEN_MISSING");

        let res: Response;
        try {
            res = await fetch(`${this._baseUrl}/api/zai/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${this._state.identityToken}` },
                body: JSON.stringify({ identityToken: this._state.identityToken }),
            });
        } catch {
            throw new ZaiError("network");
        }
        if (!res.ok) {
            const err = await this._toError(res);
            if (err.kind === "unauthorized") {
                this._state = {};
                await this._persist();
            }
            throw err;
        }
        const json: any = await res.json().catch(() => ({}));
        const data = json?.data ?? json;
        const zaiToken: string | undefined = data?.zaiToken ?? data?.token;
        if (!zaiToken) throw new ZaiError("error", "ZAI_SESSION_SHAPE");
        this._state.zaiToken = zaiToken;
        this._state.zaiTokenExp = Number(data?.expiresAt) || this._jwtExp(zaiToken) || now + 15 * 60;
        await this._persist();
        return zaiToken;
    }

    private async _toError(res: Response): Promise<ZaiError> {
        const json: any = await res.json().catch(() => ({}));
        const code: string | undefined = json?.code;
        const retry = Number(res.headers.get("Retry-After") || json?.retryAfter) || undefined;
        switch (res.status) {
            case 404:
            case 503:
                return new ZaiError("unavailable", code);
            case 401:
            case 403:
                return new ZaiError("unauthorized", code);
            case 429:
                return new ZaiError("rate_limited", code, retry);
            case 451:
                return new ZaiError("refused", code);
            default:
                return new ZaiError("error", code);
        }
    }

    private async _readSse(stream: ReadableStream<Uint8Array>, h: ZaiStreamHandlers): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
                const raw = buffer.slice(0, idx);
                buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
                this._dispatch(raw, h);
            }
        }
        if (buffer.trim()) this._dispatch(buffer, h);
    }

    private _dispatch(raw: string, h: ZaiStreamHandlers): void {
        let event = "message";
        const dataLines: string[] = [];
        for (const line of raw.split(/\r?\n/)) {
            if (!line || line.startsWith(":")) continue;
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (!dataLines.length) return;
        let data: any;
        try {
            data = JSON.parse(dataLines.join("\n"));
        } catch {
            data = { text: dataLines.join("\n") };
        }
        switch (event) {
            case "meta":
                h.onMeta?.(data);
                break;
            case "status":
                h.onStatus?.(data);
                break;
            case "delta":
                if (data?.text) h.onDelta(String(data.text));
                break;
            case "card": {
                const card = sanitizeZaiCard(data);
                if (card) h.onCard?.(card);
                break;
            }
            case "done":
                h.onDone?.(data);
                break;
            case "error": {
                const kind: ZaiErrorKind = data?.code === "ZAI_RATE_LIMITED" ? "rate_limited" : data?.code === "ZAI_TIMEOUT" ? "timeout" : "error";
                throw new ZaiError(kind, data?.code, data?.retryAfter, data?.requestId);
            }
        }
    }

    private _jwtExp(token: string): number | undefined {
        try {
            const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            return typeof payload?.exp === "number" ? payload.exp : undefined;
        } catch {
            return undefined;
        }
    }

    private async _load(): Promise<void> {
        if (this._loaded) return;
        this._loaded = true;
        try {
            const api: any = (globalThis as any).chrome?.storage?.session;
            if (api) {
                const r = await api.get(SESSION_KEY);
                this._state = { ...(r?.[SESSION_KEY] || {}), ...this._state };
            } else {
                const raw = sessionStorage.getItem(SESSION_KEY);
                if (raw) this._state = { ...JSON.parse(raw), ...this._state };
            }
        } catch {
            /* memory only */
        }
    }

    private async _persist(): Promise<void> {
        try {
            const api: any = (globalThis as any).chrome?.storage?.session;
            const empty = !this._state.identityToken && !this._state.zaiToken;
            if (api) {
                if (empty) await api.remove(SESSION_KEY);
                else await api.set({ [SESSION_KEY]: this._state });
            } else if (empty) sessionStorage.removeItem(SESSION_KEY);
            else sessionStorage.setItem(SESSION_KEY, JSON.stringify(this._state));
        } catch {
            /* memory only */
        }
    }
}
