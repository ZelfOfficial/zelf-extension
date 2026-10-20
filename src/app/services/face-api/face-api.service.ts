import { inject, Injectable, Injector } from "@angular/core";
import { BehaviorSubject } from "rxjs";

import { environment } from "environments/environment";
import { ChromeService } from "../../chrome.service";
import { HttpWrapperService } from "../../http-wrapper.service";
import { WalletService } from "../../wallet.service";
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
import { buildFaceIdentifier, resolveFaceIdentifier } from "./face-identifier.util";
import { solveFacePowInWorker } from "./face-pow-worker";
import { buildPowPayload, type FacePowChallenge, type FacePowPayload } from "./face-pow.util";

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
    private readonly _injector = inject(Injector);

    readonly verifying$ = this._verifying$.asObservable();

    constructor(private readonly _httpWrapper: HttpWrapperService) {}

    get verifying(): boolean {
        return this._verifying$.value;
    }

    buildIdentifier(body: object): string {
        const record = body as Record<string, unknown>;
        const direct = buildFaceIdentifier(record);
        if (direct) {
            return direct;
        }
        return resolveFaceIdentifier(record, {});
    }

    async resolveIdentifier(body: object, explicit?: string): Promise<string> {
        if (explicit?.trim() && explicit !== "unknown") {
            return explicit.trim();
        }

        const record = body as Record<string, unknown>;
        const fromBody = buildFaceIdentifier(record);
        if (fromBody) {
            return fromBody;
        }

        const walletService = this._injector.get(WalletService);
        const chromeService = this._injector.get(ChromeService);
        const wallet = await walletService.getCurrentWallet();
        const sessionKey = (await chromeService.getItem("sessionIdentifier")) as string | null;

        return resolveFaceIdentifier(record, {
            zelfProof: wallet?.zelfProof ?? null,
            tagName: wallet?.name ?? (wallet as { tagName?: string })?.tagName ?? null,
            domain: wallet?.domain ?? null,
            sessionKey,
        });
    }

    async fetchNonce(action: string, identifier: string): Promise<FaceNonceResponse | null> {
        const resolvedId =
            identifier?.trim() && identifier !== "unknown" ? identifier.trim() : await this.resolveIdentifier({});

        try {
            const response = await this._httpWrapper.sendRequest<{ data?: FaceNonceResponse } & FaceNonceResponse>(
                "post",
                `${this._baseUrl}/api/face/nonce`,
                { action, identifier: resolvedId }
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
        const identifier = await this.resolveIdentifier(sanitized, context.identifier);

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
            const solution = await solveFacePowInWorker(challenge);
            return buildPowPayload(challenge, solution);
        } finally {
            this._verifying$.next(false);
        }
    }
}
