import { TestBed } from "@angular/core/testing";

import { HttpWrapperService } from "../../http-wrapper.service";
import { FaceApiService } from "./face-api.service";
import { FaceLockedError } from "./face-api.errors";

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
    });

    it("fetchNonce returns null on 404", async () => {
        sendRequest.and.returnValue(Promise.reject({ status: 404 }));
        const result = await service.fetchNonce("decrypt", "alice@zelf");
        expect(result).toBeNull();
    });

    it("sendWithFace retries once on 428 pow_required", async () => {
        spyOn(service as any, "_solveInWorker").and.resolveTo("42");

        let decryptCalls = 0;
        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                return Promise.resolve({ data: { nonce: "n1" } });
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
        sendRequest.and.callFake((method: string, url: string) => {
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
        spyOn(service as any, "_solveInWorker").and.stub();
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
