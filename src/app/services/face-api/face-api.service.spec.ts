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

    it("fetchNonce returns null on 404", async () => {
        sendRequest.and.returnValue(Promise.reject({ status: 404 }));
        const result = await service.fetchNonce("decrypt", "alice.zelf");
        expect(result).toBeNull();
    });

    it("sendWithFace retries once on 428 pow_required", async () => {
        spyOn(service as any, "_solveInWorker").and.resolveTo("42");

        sendRequest.and.callFake((_method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                return Promise.resolve({ nonce: "n1" });
            }
            if (sendRequest.calls.count() === 2) {
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
            { action: "decrypt", identifier: "alice.zelf" }
        );

        expect(result).toEqual({ ok: true });
        expect(sendRequest.calls.count()).toBe(3);
        const lastBody = sendRequest.calls.mostRecent().args[2];
        expect(lastBody.pow).toEqual({ challengeId: "ch1", solution: "42" });
    });

    it("sendWithFace throws FaceLockedError on 429", async () => {
        sendRequest.and.callFake((method: string, url: string) => {
            if (url.includes("/api/face/nonce")) {
                return Promise.resolve({ nonce: "n1" });
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
                { faceBase64: "enc", tagName: "alice" },
                { action: "decrypt", identifier: "alice.zelf" }
            );
            fail("expected FaceLockedError");
        } catch (err) {
            expect(err).toBeInstanceOf(FaceLockedError);
            expect((err as FaceLockedError).retryAfterSeconds).toBe(90);
        }
    });

    it("strips removePGP from outgoing body", async () => {
        sendRequest.and.resolveTo({ ok: true });
        await service.sendWithFace(
            "post",
            "https://api.test/api/zelf-keys/store/passwords",
            { faceBase64: "enc", removePGP: true, tolerance: 0.5 },
            { action: "zelf-keys", identifier: "proof-1" }
        );
        const body = sendRequest.calls.mostRecent().args[2];
        expect(body.removePGP).toBeUndefined();
        expect(body.tolerance).toBeUndefined();
    });
});
