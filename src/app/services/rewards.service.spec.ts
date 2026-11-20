import { TestBed } from "@angular/core/testing";

import { HttpWrapperService } from "../http-wrapper.service";
import { pickFaceWhitelistedBody } from "./face-api/face-body-whitelist.util";
import { FaceApiService } from "./face-api/face-api.service";
import { RewardsService } from "./rewards.service";

describe("RewardsService daily claim", () => {
    let service: RewardsService;
    let sendRequest: jasmine.Spy;
    let encryptMessage: jasmine.Spy;

    const reward = {
        success: true,
        message: "ok",
        reward: {
            amount: 4,
            winningIndex: 1,
            nextClaimAvailable: "tomorrow",
        },
    };

    beforeEach(() => {
        sendRequest = jasmine.createSpy("sendRequest");
        encryptMessage = jasmine.createSpy("encryptMessage").and.resolveTo("-----BEGIN PGP MESSAGE-----\narmored-password\n-----END PGP MESSAGE-----");
        TestBed.configureTestingModule({
            providers: [
                RewardsService,
                FaceApiService,
                { provide: HttpWrapperService, useValue: { sendRequest, encryptMessage } },
            ],
        });
        service = TestBed.inject(RewardsService);
    });

    function stubHttp(nonce: { data: { nonce: string } } | null): Array<{ url: string; body: Record<string, unknown> }> {
        const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
        sendRequest.and.callFake(async (_method: string, url: string, body: Record<string, unknown>) => {
            sent.push({ url: String(url), body: { ...(body || {}) } });
            if (String(url).includes("/api/face/nonce")) {
                if (!nonce) return Promise.reject({ status: 404, error: {} });
                return nonce;
            }
            return reward;
        });
        return sent;
    }

    function dailyBody(sent: Array<{ url: string; body: Record<string, unknown> }>): Record<string, unknown> {
        const call = sent.find((entry) => entry.url.includes("/api/rewards/daily"));
        if (!call) throw new Error("daily claim was not sent");
        return call.body;
    }

    it("sends a face-only claim with faceBase64 and no password", async () => {
        const sent = stubHttp({ data: { nonce: "nonce-daily" } });
        const input = { tagName: "alice", domain: "zelf", faceBase64: "pgp-face" };

        await service.claimDailyReward(input);

        const body = dailyBody(sent);
        expect(body["tagName"]).toBe("alice");
        expect(body["domain"]).toBe("zelf");
        expect(body["faceBase64"]).toBe("pgp-face");
        expect(body["masterPassword"]).toBeUndefined();
        expect(body["password"]).toBeUndefined();
        expect(body["faceNonce"]).toBe("nonce-daily");
        expect(encryptMessage).not.toHaveBeenCalled();
        expect(input.faceBase64).toBe("");
        expect(sent.some((entry) => entry.url.includes("/api/face/nonce") && entry.body["action"] === "daily-reward")).toBeTrue();
    });

    it("encrypts the master password and sends it with the face", async () => {
        const sent = stubHttp({ data: { nonce: "nonce-daily" } });
        const input = { tagName: "alice", domain: "zelf", faceBase64: "pgp-face", masterPassword: "secret" };

        await service.claimDailyReward(input);

        const body = dailyBody(sent);
        expect(encryptMessage).toHaveBeenCalledOnceWith("secret");
        expect(body["faceBase64"]).toBe("pgp-face");
        expect(body["masterPassword"]).toBe("-----BEGIN PGP MESSAGE-----\narmored-password\n-----END PGP MESSAGE-----");
        expect(body["masterPassword"]).not.toBe("secret");
        expect(body["faceNonce"]).toBe("nonce-daily");
        expect(input.faceBase64).toBe("");
        expect(input.masterPassword).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("secret");
    });

    it("still claims when the face nonce endpoint is absent", async () => {
        const sent = stubHttp(null);

        await service.claimDailyReward({ tagName: "alice", domain: "zelf", faceBase64: "pgp-face" });

        const body = dailyBody(sent);
        expect(body["faceBase64"]).toBe("pgp-face");
        expect(body["faceNonce"]).toBeUndefined();
    });

    it("keeps the daily-reward face fields and drops anything else", () => {
        expect(
            pickFaceWhitelistedBody("daily-reward", {
                tagName: "alice",
                domain: "zelf",
                faceBase64: "pgp-face",
                masterPassword: "armored",
                faceNonce: "nonce-daily",
                loggedSecret: "nope",
            })
        ).toEqual({
            tagName: "alice",
            domain: "zelf",
            faceBase64: "pgp-face",
            masterPassword: "armored",
            faceNonce: "nonce-daily",
        });
    });
});

describe("RewardsService first transaction claim", () => {
    let service: RewardsService;
    let sendRequest: jasmine.Spy;
    let encryptMessage: jasmine.Spy;

    const claimed = { success: true, reward: { amount: 12 } };

    beforeEach(() => {
        sendRequest = jasmine.createSpy("sendRequest");
        encryptMessage = jasmine
            .createSpy("encryptMessage")
            .and.resolveTo("-----BEGIN PGP MESSAGE-----\narmored-password\n-----END PGP MESSAGE-----");
        TestBed.configureTestingModule({
            providers: [RewardsService, FaceApiService, { provide: HttpWrapperService, useValue: { sendRequest, encryptMessage } }],
        });
        service = TestBed.inject(RewardsService);
    });

    function stubHttp(nonce: { data: { nonce: string } } | null): Array<{ url: string; body: Record<string, unknown> }> {
        const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
        sendRequest.and.callFake(async (_method: string, url: string, body: Record<string, unknown>) => {
            sent.push({ url: String(url), body: { ...(body || {}) } });
            if (String(url).includes("/api/face/nonce")) {
                if (!nonce) return Promise.reject({ status: 404, error: {} });
                return nonce;
            }
            return claimed;
        });
        return sent;
    }

    function rewardBody(sent: Array<{ url: string; body: Record<string, unknown> }>): Record<string, unknown> {
        const call = sent.find((entry) => entry.url.includes("/api/rewards/first-transaction"));
        if (!call) throw new Error("first transaction claim was not sent");
        return call.body;
    }

    it("probes without a face", async () => {
        const sent = stubHttp(null);

        await service.claimFirstTransaction({ tagName: "alice", domain: "zelf" });

        const body = rewardBody(sent);
        expect(body["tagName"]).toBe("alice");
        expect(body["domain"]).toBe("zelf");
        expect(body["faceBase64"]).toBeUndefined();
        expect(body["masterPassword"]).toBeUndefined();
        expect(sent.some((entry) => entry.url.includes("/api/face/nonce"))).toBeFalse();
    });

    it("retries with the face proof and a first-transaction nonce", async () => {
        const sent = stubHttp({ data: { nonce: "nonce-first" } });
        const input = { tagName: "alice", domain: "zelf", faceBase64: "pgp-face" };

        await service.claimFirstTransaction(input);

        const body = rewardBody(sent);
        expect(body["faceBase64"]).toBe("pgp-face");
        expect(body["masterPassword"]).toBeUndefined();
        expect(body["faceNonce"]).toBe("nonce-first");
        expect(input.faceBase64).toBe("");
        expect(sent.some((entry) => entry.url.includes("/api/face/nonce") && entry.body["action"] === "first-transaction")).toBeTrue();
        expect(encryptMessage).not.toHaveBeenCalled();
    });

    it("encrypts the password and does not keep the plaintext", async () => {
        const sent = stubHttp({ data: { nonce: "nonce-first" } });
        const input = { tagName: "alice", domain: "zelf", faceBase64: "pgp-face", masterPassword: "secret" };

        await service.claimFirstTransaction(input);

        const body = rewardBody(sent);
        expect(encryptMessage).toHaveBeenCalledOnceWith("secret");
        expect(body["faceBase64"]).toBe("pgp-face");
        expect(body["masterPassword"]).toBe("-----BEGIN PGP MESSAGE-----\narmored-password\n-----END PGP MESSAGE-----");
        expect(body["masterPassword"]).not.toBe("secret");
        expect(input.faceBase64).toBe("");
        expect(input.masterPassword).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("secret");
    });

    it("keeps the first-transaction face fields and drops anything else", () => {
        expect(
            pickFaceWhitelistedBody("first-transaction", {
                tagName: "alice",
                domain: "zelf",
                faceBase64: "pgp-face",
                masterPassword: "armored",
                faceNonce: "nonce-first",
                loggedSecret: "nope",
            })
        ).toEqual({
            tagName: "alice",
            domain: "zelf",
            faceBase64: "pgp-face",
            masterPassword: "armored",
            faceNonce: "nonce-first",
        });
    });
});
