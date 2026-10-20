import { TestBed } from "@angular/core/testing";

import { HttpWrapperService } from "../../http-wrapper.service";
import { FaceApiService } from "./face-api.service";
import { FaceLockedError, FaceReplayDetectedError } from "./face-api.errors";
import { buildPowPayload } from "./face-pow.util";

describe("FaceApiService", () => {
    let service: FaceApiService;
    let sendRequest: jasmine.Spy;

    beforeEach(() => {
        sendRequest = jasmine.createSpy("sendRequest");
        TestBed.configureTestingModule({
            providers: [
                FaceApiService,
                {
                    provide: HttpWrapperService,
                    useValue: { sendRequest },
                },
            ],
        });
        service = TestBed.inject(FaceApiService);
    });

    it("buildIdentifier matches server tag@domain and zelfProof prefix", () => {
        expect(service.buildIdentifier({ tagName: "Alice", domain: "zelf" })).toBe("alice@zelf");
        expect(service.buildIdentifier({ zelfProof: "x".repeat(80) })).toBe(`zelfProof:${"x".repeat(64)}`);
        expect(service.buildIdentifier({ faceBase64: "enc" })).toBeNull();
    });

    it("fetchNonce posts only action and returns bindingIdentifier from server", async () => {
        sendRequest.and.resolveTo({
            data: { nonce: "n1", bindingIdentifier: "alice@zelf" },
        });
        const result = await service.fetchNonce("store-password");
        expect(result?.nonce).toBe("n1");
        expect(result?.bindingIdentifier).toBe("alice@zelf");
        const body = sendRequest.calls.mostRecent().args[2];
        expect(body).toEqual({ action: "store-password" });
    });

    it("fetchNonce returns null on 404", async () => {
        sendRequest.and.returnValue(Promise.reject({ status: 404 }));
        const result = await service.fetchNonce("decrypt");
        expect(result).toBeNull();
    });

    it("sendWithFace retries once on 428 pow_required", async () => {
        spyOn(service as unknown as { _solveChallengeToPayload: (c: { challengeId: string }) => Promise<unknown> }, "_solveChallengeToPayload").and.callFake(
            async (challenge) => buildPowPayload(challenge as import("./face-pow.util").FacePowChallenge, "42")
        );

        let decryptCalls = 0;
        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                return Promise.resolve({ data: { nonce: "n1", bindingIdentifier: "alice@zelf" } });
            }
            decryptCalls++;
            if (decryptCalls === 1) {
                return Promise.reject({
                    status: 428,
                    error: {
                        code: "pow_required",
                        pow: { challengeId: "ch1", salt: "s-", difficulty: 0 },
                    },
                });
            }
            return Promise.resolve({ ok: true });
        });

        const result = await service.sendWithFace(
            "post",
            "https://api.test/api/tags/decrypt",
            { faceBase64: "enc", tagName: "alice", domain: "zelf" },
            { action: "decrypt" }
        );

        expect(result).toEqual({ ok: true });
        expect(decryptCalls).toBe(2);
        const lastBody = sendRequest.calls.mostRecent().args[2];
        expect(lastBody.pow.challengeId).toBe("ch1");
        expect(lastBody.pow.solution).toBe("42");
    });

    it("sendWithFace throws FaceLockedError on 429", async () => {
        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                return Promise.resolve({ data: { nonce: "n1" } });
            }
            return Promise.reject({
                status: 429,
                error: { code: "face_locked", retryAfter: 90 },
            });
        });

        try {
            await service.sendWithFace(
                "post",
                "https://api.test/api/tags/decrypt",
                { faceBase64: "enc", tagName: "alice", domain: "zelf" },
                { action: "decrypt" }
            );
            fail("expected FaceLockedError");
        } catch (err) {
            expect(err).toBeInstanceOf(FaceLockedError);
            expect((err as FaceLockedError).retryAfterSeconds).toBe(90);
        }
    });

    it("sendWithFace refetches nonce on 409 face_nonce_used", async () => {
        let nonceCalls = 0;
        let decryptCalls = 0;
        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                nonceCalls++;
                return Promise.resolve({ data: { nonce: `n${nonceCalls}` } });
            }
            decryptCalls++;
            if (decryptCalls === 1) {
                return Promise.reject({ status: 409, error: { code: "face_nonce_used" } });
            }
            return Promise.resolve({ ok: true });
        });

        await service.sendWithFace(
            "post",
            "https://api.test/api/tags/decrypt",
            { faceBase64: "enc", tagName: "alice", domain: "zelf" },
            { action: "decrypt" }
        );

        expect(nonceCalls).toBe(2);
        expect(decryptCalls).toBe(2);
    });

    it("sendWithFace refetches nonce once on 409 face_nonce_mismatch", async () => {
        let nonceCalls = 0;
        let decryptCalls = 0;
        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                nonceCalls++;
                return Promise.resolve({ data: { nonce: `n${nonceCalls}`, bindingIdentifier: "user@zelf" } });
            }
            decryptCalls++;
            if (decryptCalls === 1) {
                return Promise.reject({ status: 409, error: { code: "face_nonce_mismatch" } });
            }
            return Promise.resolve({ ok: true });
        });

        await service.sendWithFace(
            "post",
            "https://api.test/api/zelf-keys/store",
            { faceBase64: "enc" },
            { action: "store-password" }
        );

        expect(nonceCalls).toBe(2);
        expect(decryptCalls).toBe(2);
        const nonceBodies = sendRequest.calls.allArgs().filter((args) => String(args[1]).includes("/api/face/nonce")).map((args) => args[2]);
        expect(nonceBodies.every((b) => b.action === "store-password" && b.identifier === undefined)).toBe(true);
    });

    it("sendWithFace throws FaceReplayDetectedError on 409 face_replay_detected", async () => {
        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                return Promise.resolve({ data: { nonce: "n1" } });
            }
            return Promise.reject({
                status: 409,
                error: { code: "face_replay_detected", clientMessage: "Please recapture" },
            });
        });

        try {
            await service.sendWithFace(
                "post",
                "https://api.test/api/tags/decrypt",
                { faceBase64: "enc", tagName: "alice", domain: "zelf" },
                { action: "decrypt" }
            );
            fail("expected FaceReplayDetectedError");
        } catch (err) {
            expect(err).toBeInstanceOf(FaceReplayDetectedError);
            expect((err as FaceReplayDetectedError).clientMessage).toBe("Please recapture");
        }
    });

    it("strips removePGP and non-whitelisted keys for decrypt", async () => {
        sendRequest.and.resolveTo({ ok: true });
        await service.sendWithFace(
            "post",
            "https://api.test/api/tags/decrypt",
            { faceBase64: "enc", tagName: "a", domain: "zelf", removePGP: true, identifier: "device-fp" },
            { action: "decrypt" }
        );
        const body = sendRequest.calls.mostRecent().args[2];
        expect(body.removePGP).toBeUndefined();
        expect(body.identifier).toBeUndefined();
        expect(body.tagName).toBe("a");
    });
});
