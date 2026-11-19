import { environment } from "environments/environment";

import { decryptPasswordShare } from "./password-share-crypto";
import {
    PasswordShareRequestError,
    PasswordShareService,
    extractPasswordShareErrorCode,
    normalizePasswordShareList,
} from "./password-share.service";

describe("PasswordShareService", () => {
    function setup() {
        const sendRequest = jasmine.createSpy("sendRequest");
        const translate = jasmine.createSpy("translate").and.callFake((key: string) => key);
        const service = new PasswordShareService({ sendRequest } as any, { translate } as any);
        return { service, sendRequest, translate };
    }

    const shareId = "Q".repeat(43);

    const input = {
        title: "Example Mail",
        username: "demo.user@example.com",
        password: "synthetic-password",
        url: "https://example.com",
        notes: "Synthetic QA note",
        expiresIn: "7d" as const,
        maxViews: 1,
        label: "Example Mail",
    };

    it("uploads only the envelope and builds a fragment link the landing can decrypt", async () => {
        const { service, sendRequest } = setup();
        sendRequest.and.callFake(async (_method: string, _url: string, body: Record<string, unknown>) => {
            expect(body["password"]).toBeUndefined();
            expect(body["key"]).toBeUndefined();
            expect(body["version"]).toBe(1);
            expect(body["expiresIn"]).toBe(604800);
            expect(body["maxViews"]).toBe(1);
            expect(body["label"]).toBe("Example Mail");
            expect(JSON.stringify(body)).not.toContain("synthetic-password");
            for (const field of ["key", "password", "plaintext", "secret", "dek", "contentKey", "aesKey", "encryptionKey"]) {
                expect(Object.prototype.hasOwnProperty.call(body, field)).toBeFalse();
            }
            expect(Object.keys(body).sort()).toEqual(["ciphertext", "expiresIn", "iv", "label", "maxViews", "version"]);
            return { id: shareId, expiresAt: "2026-11-18T12:00:00.000Z", maxViews: 1 };
        });

        const created = await service.createShare(input);
        const url = new URL(created.link);
        const fragment = url.hash.slice(1);
        const body = sendRequest.calls.mostRecent().args[2];

        expect(sendRequest).toHaveBeenCalledWith("post", `${environment.v4ApiUrl}/api/password-shares`, jasmine.any(Object));
        expect(created.id).toBe(shareId);
        expect(created.link.startsWith(`${environment.landingUrl}/share/${shareId}#`)).toBeTrue();
        expect(url.search).toBe("");
        expect(JSON.stringify(body)).not.toContain(fragment);

        const decrypted = await decryptPasswordShare({
            ciphertext: body.ciphertext,
            iv: body.iv,
            keyFragment: fragment,
        });

        expect(decrypted).toEqual({
            v: 1,
            title: "Example Mail",
            username: "demo.user@example.com",
            password: "synthetic-password",
            url: "https://example.com",
            notes: "Synthetic QA note",
        });
    });

    it("omits a blank label and does not call the API for invalid views", async () => {
        const { service, sendRequest } = setup();
        sendRequest.and.resolveTo({ id: shareId, expiresAt: "2026-11-18T12:00:00.000Z", maxViews: 3 });

        await service.createShare({ ...input, label: "   ", maxViews: 3, username: "", notes: undefined, url: "  " });

        const body = sendRequest.calls.mostRecent().args[2];
        expect(body.label).toBeUndefined();
        expect(body.maxViews).toBe(3);

        sendRequest.calls.reset();
        await expectAsync(service.createShare({ ...input, maxViews: 11 })).toBeRejectedWith(jasmine.any(PasswordShareRequestError));
        await expectAsync(service.createShare({ ...input, maxViews: 0 })).toBeRejectedWithError(/INVALID_MAX_VIEWS/);
        await expectAsync(service.createShare({ ...input, expiresIn: "2d" as "7d" })).toBeRejectedWithError(/INVALID_EXPIRATION/);
        await expectAsync(service.createShare({ ...input, password: "" })).toBeRejectedWithError(/MISSING_PASSWORD/);
        await expectAsync(service.createShare({ ...input, label: "x".repeat(61) })).toBeRejectedWithError(/INVALID_LABEL/);
        await expectAsync(service.createShare({ ...input, label: "bad\u0000label" })).toBeRejectedWithError(/INVALID_LABEL/);
        expect(sendRequest).not.toHaveBeenCalled();
    });

    it("maps API error codes onto translation keys", () => {
        const { service, translate } = setup();
        const error = { status: 400, error: { code: "SHARE_TOO_LARGE", message: "too big" } };

        expect(extractPasswordShareErrorCode(error)).toBe("SHARE_TOO_LARGE");
        expect(extractPasswordShareErrorCode({ error: { error: "SHARE_NOT_FOUND" } })).toBe("SHARE_NOT_FOUND");
        expect(extractPasswordShareErrorCode({ error: "SHARE_FORBIDDEN" })).toBe("SHARE_FORBIDDEN");
        expect(extractPasswordShareErrorCode({ error: { message: "INVALID_EXPIRATION" } })).toBe("INVALID_EXPIRATION");
        expect(extractPasswordShareErrorCode({ error: { message: "something else" } })).toBeNull();

        expect(service.translateError(new PasswordShareRequestError("INVALID_MAX_VIEWS"))).toBe(
            "billing.passwords.share.errors.INVALID_MAX_VIEWS"
        );
        expect(service.translateError(error)).toBe("billing.passwords.share.errors.SHARE_TOO_LARGE");
        expect(service.translateError({ error: { message: "nope" } })).toBe("billing.passwords.share.errors.generic");
        expect(translate).toHaveBeenCalledWith("billing.passwords.share.errors.SHARE_TOO_LARGE");
    });

    it("normalizes the shares list and revokes by id", async () => {
        const shares = normalizePasswordShareList({
            shares: [
                {
                    id: "one",
                    label: "Example Mail",
                    createdAt: "2026-11-11T12:00:00.000Z",
                    expiresAt: "2026-12-03T21:40:00.000Z",
                    remainingViews: 1,
                    maxViews: 1,
                },
                {
                    id: "two",
                    createdAt: "2026-11-11T12:00:00.000Z",
                    expiresAt: "2026-11-18T15:00:00.000Z",
                    remainingViews: 4,
                    maxViews: 10,
                },
            ],
        });

        expect(shares).toEqual([
            {
                id: "one",
                label: "Example Mail",
                createdAt: "2026-11-11T12:00:00.000Z",
                expiresAt: "2026-12-03T21:40:00.000Z",
                remainingViews: 1,
                maxViews: 1,
            },
            {
                id: "two",
                label: "",
                createdAt: "2026-11-11T12:00:00.000Z",
                expiresAt: "2026-11-18T15:00:00.000Z",
                remainingViews: 4,
                maxViews: 10,
            },
        ]);
        expect(normalizePasswordShareList([{ id: "bare", remainingViews: 2, maxViews: 2 }])).toEqual([]);
        expect(normalizePasswordShareList({ data: { shares } })).toEqual([]);

        const { service, sendRequest } = setup();
        sendRequest.and.resolveTo({ id: shareId, revoked: true });
        await expectAsync(service.revokeShare(shareId)).toBeResolvedTo({ id: shareId, revoked: true });
        expect(sendRequest).toHaveBeenCalledWith("delete", `${environment.v4ApiUrl}/api/password-shares/${shareId}`);

        sendRequest.calls.reset();
        sendRequest.and.resolveTo({ id: "a/b", revoked: true });
        await service.revokeShare("a/b");
        expect(sendRequest).toHaveBeenCalledWith("delete", `${environment.v4ApiUrl}/api/password-shares/a%2Fb`);

        sendRequest.and.resolveTo({ shares });
        await expectAsync(service.listShares()).toBeResolvedTo(shares);
    });

    it("reads Retry-After on PASSWORD_SHARE_RATE_LIMITED and ignores a wrapped success body", async () => {
        const { service, sendRequest, translate } = setup();
        sendRequest.and.rejectWith({
            status: 429,
            error: { code: "PASSWORD_SHARE_RATE_LIMITED", message: "PASSWORD_SHARE_RATE_LIMITED" },
            headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "30" : null) },
        });

        await expectAsync(service.createShare(input)).toBeRejectedWith(
            jasmine.objectContaining({ code: "PASSWORD_SHARE_RATE_LIMITED", retryAfterSeconds: 30 })
        );
        expect(service.translateError(new PasswordShareRequestError("PASSWORD_SHARE_RATE_LIMITED", 30))).toBe(
            "billing.passwords.share.errors.PASSWORD_SHARE_RATE_LIMITED"
        );
        expect(translate).toHaveBeenCalledWith("billing.passwords.share.errors.PASSWORD_SHARE_RATE_LIMITED", { seconds: 30 });
        expect(service.translateError(new PasswordShareRequestError("PASSWORD_SHARE_RATE_LIMITED"))).toBe(
            "billing.passwords.share.errors.PASSWORD_SHARE_RATE_LIMITED_WAIT"
        );

        sendRequest.and.resolveTo({ data: { id: shareId, expiresAt: "2026-11-18T12:00:00.000Z", maxViews: 1 } });
        await expectAsync(service.createShare(input)).toBeRejectedWithError(/generic/);
    });

    it("turns a failed create into a coded error", async () => {
        const { service, sendRequest } = setup();
        sendRequest.and.rejectWith({ status: 403, error: { code: "SHARE_FORBIDDEN", message: "no" } });

        await expectAsync(service.createShare(input)).toBeRejectedWithError("SHARE_FORBIDDEN");
    });
});
