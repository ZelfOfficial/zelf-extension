import { TestBed } from "@angular/core/testing";

import { HttpWrapperService } from "../http-wrapper.service";
import { AuthService } from "./auth.service";
import { FaceApiService } from "./face-api/face-api.service";
import { ZelfKeysService } from "./zelf-keys.service";

describe("ZelfKeysService plan limits", () => {
    let service: ZelfKeysService;
    let sendRequest: jasmine.Spy;
    let sendWithFace: jasmine.Spy;

    beforeEach(() => {
        sendRequest = jasmine.createSpy("sendRequest");
        sendWithFace = jasmine.createSpy("sendWithFace").and.resolveTo({ data: { kind: "password" } });
        TestBed.configureTestingModule({
            providers: [
                ZelfKeysService,
                { provide: HttpWrapperService, useValue: { sendRequest } },
                { provide: AuthService, useValue: { checkAccessToken: async () => "token" } },
                { provide: FaceApiService, useValue: { sendWithFace } },
            ],
        });
        service = TestBed.inject(ZelfKeysService);
    });

    it("loads /limits", async () => {
        sendRequest.and.resolveTo({
            data: {
                plan: "premium",
                tokenBalance: 100,
                onChainBalance: 100,
                tokensSpent: 0,
                tokenPriceUsd: 0.05,
                balanceAvailable: true,
                kinds: {
                    password: { used: 3, limit: 100, canAdd: true, tokenCost: 10 },
                    zotp: { used: 1, limit: 20, canAdd: true, tokenCost: 20 },
                },
            },
        });

        const result = await service.getVaultLimits();

        expect(sendRequest).toHaveBeenCalledWith(
            "get",
            jasmine.stringMatching(/\/api\/zelf-keys\/limits$/),
            {},
            jasmine.objectContaining({ headers: { Authorization: "Bearer token" } })
        );
        expect(result.status).toBe("ok");
        if (result.status === "ok") {
            expect(result.limits.plan).toBe("premium");
            expect(result.limits.kinds.password.used).toBe(3);
        }
    });

    it("falls back on 401, 403, and 404, and reports other failures as errors", async () => {
        sendRequest.and.rejectWith({ status: 404, error: { message: "Not Found" } });
        await expectAsync(service.getVaultLimits()).toBeResolvedTo({ status: "unsupported" });

        sendRequest.and.rejectWith({ status: 401, error: { code: "ERR_ZELF_IDENTITY_REQUIRED" } });
        await expectAsync(service.getVaultLimits()).toBeResolvedTo({ status: "unsupported" });

        sendRequest.and.rejectWith({ status: 403, error: { code: "ERR_SESSION_NOT_VERIFIED", message: "Session is not verified for this wallet" } });
        await expectAsync(service.getVaultLimits()).toBeResolvedTo({ status: "unsupported" });

        sendRequest.and.rejectWith({ status: 500, error: { message: "down" } });
        await expectAsync(service.getVaultLimits()).toBeResolvedTo({ status: "error" });
    });

    it("posts a slot purchase through the face gate", async () => {
        await service.purchaseExtraSlot({
            kind: "zotp",
            idempotencyKey: "idem-key-1",
            faceBase64: "face",
            masterPassword: "pgp",
        });

        expect(sendWithFace).toHaveBeenCalledWith(
            "post",
            jasmine.stringMatching(/\/api\/zelf-keys\/slots$/),
            { kind: "zotp", idempotencyKey: "idem-key-1", faceBase64: "face", masterPassword: "pgp" },
            { action: "purchase-slot" },
            jasmine.objectContaining({ headers: { Authorization: "Bearer token" } })
        );
    });
});
