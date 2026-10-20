import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

import { environment } from "environments/environment";
import { HttpWrapperService } from "../../http-wrapper.service";
import {
    extractPowChallengeFromError,
    FaceLockedError,
    isFaceLockedError,
    isHttpFaceError,
    parseRetryAfterSeconds,
} from "./face-api.errors";
import { solveFacePow, type FacePowChallenge, type FacePowSolution } from "./face-pow.util";

export type FaceApiAction =
    | "decrypt"
    | "lease"
    | "lease-recovery"
    | "delete"
    | "transfer"
    | "send"
    | "wallet-create"
    | "wallet-decrypt"
    | "zelf-keys";

export interface FaceRequestContext {
    action: FaceApiAction | string;
    identifier: string;
}

export interface FaceNonceResponse {
    nonce: string;
    expiresAt?: string;
    pow?: FacePowChallenge;
}

const CLIENT_STRIP_KEYS = new Set(["removePGP", "tolerance", "requireLiveness", "__faceAction", "__faceIdentifier"]);

@Injectable({
    providedIn: "root",
})
export class FaceApiService {
    private readonly _baseUrl = environment.v4ApiUrl;
    private readonly _verifying$ = new BehaviorSubject<boolean>(false);

    /** True while a proof-of-work challenge is being solved (Web Worker). */
    readonly verifying$ = this._verifying$.asObservable();

    constructor(private readonly _httpWrapper: HttpWrapperService) {}

    get verifying(): boolean {
        return this._verifying$.value;
    }

    /**
     * POST /api/face/nonce — returns null when the API is unavailable (404 / no nonce).
     */
    async fetchNonce(action: string, identifier: string): Promise<FaceNonceResponse | null> {
        try {
            const response = await this._httpWrapper.sendRequest<{ data?: FaceNonceResponse } & FaceNonceResponse>(
                "post",
                `${this._baseUrl}/api/face/nonce`,
                { action, identifier }
            );
            const data = (response?.data ?? response) as FaceNonceResponse;
            if (!data?.nonce) return null;
            return data;
        } catch (error) {
            if (isHttpFaceError(error) && (error.status === 404 || error.status === 501)) {
                return null;
            }
            const body = isHttpFaceError(error) ? error.error : undefined;
            if (body && !body["nonce"]) {
                return null;
            }
            throw error;
        }
    }

    buildIdentifier(body: object): string {
        const record = body as Record<string, unknown>;
        const tagName = record["tagName"];
        const domain = record["domain"] ?? "zelf";
        if (typeof tagName === "string" && tagName.trim()) {
            const name = tagName.trim().toLowerCase();
            const dom = String(domain).trim().toLowerCase() || "zelf";
            return name.includes(".") ? name : `${name}.${dom}`;
        }
        if (typeof record["zelfProof"] === "string" && record["zelfProof"]) {
            return record["zelfProof"];
        }
        if (typeof record["id"] === "string" && record["id"]) {
            return record["id"];
        }
        const explicit = record["identifier"];
        if (typeof explicit === "string" && explicit.trim()) {
            return explicit.trim();
        }
        return "unknown";
    }

    sanitizeBody<T extends object>(body: T): T {
        const next = { ...(body as Record<string, unknown>) } as Record<string, unknown>;
        for (const key of CLIENT_STRIP_KEYS) {
            delete next[key];
        }
        return next as T;
    }

    /**
     * Runs an HTTP call that includes faceBase64: fetches a nonce, attaches faceNonce/pow, handles 428/429.
     */
    async sendWithFace<T>(
        method: "post" | "put" | "delete",
        url: string,
        body: object,
        context: FaceRequestContext,
        options: Record<string, unknown> = {}
    ): Promise<T> {
        const record = body as Record<string, unknown>;
        if (!record?.faceBase64) {
            return this._httpWrapper.sendRequest(method, url, body, options);
        }

        const sanitized = this.sanitizeBody(body);
        const identifier = context.identifier || this.buildIdentifier(sanitized);

        let nonceBundle: FaceNonceResponse | null = null;
        try {
            nonceBundle = await this.fetchNonce(context.action, identifier);
        } catch {
            nonceBundle = null;
        }

        let powSolution: FacePowSolution | undefined;
        if (nonceBundle?.pow) {
            powSolution = await this._solveChallenge(nonceBundle.pow);
        }

        const enriched = this._attachFaceSecurity(sanitized, nonceBundle, powSolution);

        return this._sendWithPowRetry<T>(method, url, enriched, context, options, Boolean(nonceBundle));
    }

    private async _sendWithPowRetry<T>(
        method: "post" | "put" | "delete",
        url: string,
        body: object,
        context: FaceRequestContext,
        options: Record<string, unknown>,
        hadNonce: boolean,
        powRetried = false
    ): Promise<T> {
        try {
            return await this._httpWrapper.sendRequest<T>(method, url, body, options);
        } catch (error) {
            if (!isHttpFaceError(error)) throw error;

            if (isFaceLockedError(error)) {
                throw new FaceLockedError(parseRetryAfterSeconds(error));
            }

            const challenge = extractPowChallengeFromError(error);
            if (error.status === 428 && challenge && !powRetried) {
                const solution = await this._solveChallenge(challenge);
                const retryBody = {
                    ...body,
                    pow: solution,
                };
                return this._sendWithPowRetry<T>(method, url, retryBody, context, options, hadNonce, true);
            }

            throw error;
        }
    }

    private _attachFaceSecurity(
        body: object,
        nonceBundle: FaceNonceResponse | null,
        powSolution?: FacePowSolution
    ): object {
        const record = body as Record<string, unknown>;
        if (!nonceBundle?.nonce) {
            return body;
        }

        const next: Record<string, unknown> = {
            ...record,
            faceNonce: nonceBundle.nonce,
        };

        if (powSolution) {
            next.pow = powSolution;
        } else if (nonceBundle.pow && !powSolution) {
            // nonce included pow but solving failed upstream — still attach nonce only
        }

        return next;
    }

    private async _solveChallenge(challenge: FacePowChallenge): Promise<FacePowSolution> {
        this._verifying$.next(true);
        try {
            const solution = await this._solveInWorker(challenge);
            return { challengeId: challenge.challengeId, solution };
        } finally {
            this._verifying$.next(false);
        }
    }

    private async _solveInWorker(challenge: FacePowChallenge): Promise<string> {
        if (typeof Worker === "undefined") {
            return solveFacePow(challenge);
        }

        return new Promise<string>((resolve, reject) => {
            let worker: Worker | null = null;
            try {
                worker = new Worker(new URL("./face-pow.worker", import.meta.url), { type: "module" });
            } catch {
                solveFacePow(challenge).then(resolve).catch(reject);
                return;
            }

            const timeout = setTimeout(() => {
                worker?.terminate();
                reject(new Error("face_pow_timeout"));
            }, 120_000);

            worker.onmessage = (event: MessageEvent<{ solution?: string; error?: string }>) => {
                clearTimeout(timeout);
                worker?.terminate();
                if (event.data?.solution) {
                    resolve(event.data.solution);
                } else {
                    reject(new Error(event.data?.error ?? "face_pow_worker_error"));
                }
            };

            worker.onerror = (event) => {
                clearTimeout(timeout);
                worker?.terminate();
                solveFacePow(challenge).then(resolve).catch(() => reject(event.error ?? new Error("face_pow_worker_error")));
            };

            worker.postMessage({ challenge });
        });
    }
}
