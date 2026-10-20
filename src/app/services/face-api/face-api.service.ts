import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

import { environment } from "environments/environment";
import { HttpWrapperService } from "../../http-wrapper.service";
import { pickFaceWhitelistedBody } from "./face-body-whitelist.util";
import {
    extractPowChallengeFromError,
    FaceLockedError,
    isFaceLockedError,
    isHttpFaceError,
    parseRetryAfterSeconds,
    shouldRetryWithFreshNonce,
    shouldRetryWithFreshPow,
} from "./face-api.errors";
import { buildFaceIdentifier } from "./face-identifier.util";
import { buildPowPayload, solveFacePow, type FacePowChallenge, type FacePowPayload } from "./face-pow.util";

export type FaceApiAction =
    | "decrypt"
    | "lease"
    | "lease-recovery"
    | "delete"
    | "my-tags-transfer"
    | "wallet-create"
    | "wallet-decrypt"
    | "retrieve"
    | "preview"
    | "store-password"
    | "store-passwords-bulk"
    | "store-zotp"
    | "store-notes"
    | "store-credit-card";

export interface FaceRequestContext {
    action: FaceApiAction | string;
    /** When set, used for POST /api/face/nonce (must match server `buildIdentifier` for the body). */
    identifier?: string;
}

export interface FaceNonceResponse {
    nonce: string;
    expiresAt?: string;
    pow?: FacePowChallenge;
}

@Injectable({
    providedIn: "root",
})
export class FaceApiService {
    private readonly _baseUrl = environment.v4ApiUrl;
    private readonly _verifying$ = new BehaviorSubject<boolean>(false);

    readonly verifying$ = this._verifying$.asObservable();

    constructor(private readonly _httpWrapper: HttpWrapperService) {}

    get verifying(): boolean {
        return this._verifying$.value;
    }

    buildIdentifier(body: object): string {
        return buildFaceIdentifier(body as Record<string, unknown>);
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
            if (isHttpFaceError(error) && isFaceLockedError(error)) {
                throw new FaceLockedError(parseRetryAfterSeconds(error));
            }
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

    prepareBodyForFaceAction(action: string, body: object): Record<string, unknown> {
        const record = { ...(body as Record<string, unknown>) };
        return pickFaceWhitelistedBody(action, record);
    }

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

        const action = context.action;
        const sanitized = this.prepareBodyForFaceAction(action, body);
        const identifier = context.identifier ?? this.buildIdentifier(sanitized);

        return this._sendFaceAttempt<T>(method, url, sanitized, { action, identifier }, options, {
            nonceRetried: false,
            powRetried: false,
        });
    }

    private async _sendFaceAttempt<T>(
        method: "post" | "put" | "delete",
        url: string,
        body: Record<string, unknown>,
        context: { action: string; identifier: string },
        options: Record<string, unknown>,
        flags: { nonceRetried: boolean; powRetried: boolean }
    ): Promise<T> {
        let nonceBundle: FaceNonceResponse | null = null;
        try {
            nonceBundle = await this.fetchNonce(context.action, context.identifier);
        } catch (err) {
            if (err instanceof FaceLockedError) throw err;
            nonceBundle = null;
        }

        let powPayload: FacePowPayload | undefined;
        if (nonceBundle?.pow) {
            powPayload = await this._solveChallengeToPayload(nonceBundle.pow);
        }

        const requestBody = this._attachFaceSecurity(body, nonceBundle, powPayload);

        try {
            return await this._httpWrapper.sendRequest<T>(method, url, requestBody, options);
        } catch (error) {
            if (!isHttpFaceError(error)) throw error;

            if (isFaceLockedError(error)) {
                throw new FaceLockedError(parseRetryAfterSeconds(error));
            }

            if (shouldRetryWithFreshPow(error) && !flags.powRetried) {
                const challenge = extractPowChallengeFromError(error);
                if (challenge) {
                    const freshPow = await this._solveChallengeToPayload(challenge);
                    return this._sendFaceAttempt<T>(
                        method,
                        url,
                        { ...requestBody, pow: freshPow },
                        context,
                        options,
                        { ...flags, powRetried: true }
                    );
                }
            }

            if (shouldRetryWithFreshNonce(error) && !flags.nonceRetried) {
                return this._sendFaceAttempt<T>(method, url, body, context, options, {
                    ...flags,
                    nonceRetried: true,
                    powRetried: false,
                });
            }

            throw error;
        }
    }

    private _attachFaceSecurity(
        body: Record<string, unknown>,
        nonceBundle: FaceNonceResponse | null,
        pow?: FacePowPayload
    ): Record<string, unknown> {
        if (!nonceBundle?.nonce) {
            return body;
        }

        const next: Record<string, unknown> = {
            ...body,
            faceNonce: nonceBundle.nonce,
        };

        if (pow) {
            next.pow = pow;
        }

        return next;
    }

    private async _solveChallengeToPayload(challenge: FacePowChallenge): Promise<FacePowPayload> {
        this._verifying$.next(true);
        try {
            const solution = await this._solveInWorker(challenge);
            return buildPowPayload(challenge, solution);
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
