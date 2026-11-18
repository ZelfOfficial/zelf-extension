import moment from "moment";

import { AuthService } from "./auth.service";

function jwt(payload: Record<string, unknown>): string {
    const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    return `header.${body}.sig`;
}

describe("AuthService Zelf name", () => {
    it("sends one lowercase name.zelf on the session", async () => {
        const post = jasmine.createSpy("post").and.returnValue({
            toPromise: () => Promise.resolve({ data: { token: "tok", expiresAt: moment().add(1, "hour").unix() } }),
        });
        const setItem = jasmine.createSpy("setItem").and.resolveTo(undefined);
        const service = new AuthService(
            { getItem: async () => null, setItem, removeItem: async () => undefined } as any,
            { post } as any,
            {
                getCurrentWallet: async () => ({
                    tagName: "JimBot.Zelf",
                    name: "JimBot.Zelf",
                    publicData: { domain: "Zelf", ethAddress: "0xabc" },
                }),
            } as any
        );

        await service.checkAccessToken();

        const body = post.calls.mostRecent().args[1];

        expect(body.tagName).toBe("jimbot.zelf");
        expect(body.domain).toBe("zelf");
    });

    it("treats mixed-case names as the same wallet session", () => {
        const service = new AuthService({} as any, {} as any, {} as any);
        const token = jwt({ tagName: "alice.zelf", domain: "zelf" });

        expect(service.jwtMatchesCurrentWallet(token, { tagName: "Alice", publicData: { domain: "Zelf" } } as any)).toBeTrue();
        expect(service.jwtMatchesCurrentWallet(token, { tagName: "bob.zelf", publicData: { domain: "zelf" } } as any)).toBeFalse();
    });

    it("keeps the verified token until the vault list, even when the identifier drifted", async () => {
        const token = jwt({ identifier: "stale-session", tagName: "alice.zelf", domain: "zelf" });
        const post = jasmine.createSpy("post");
        const service = new AuthService(
            {
                getItem: async (key: string) => {
                    if (key === "accessToken") return token;
                    if (key === "accessTokenExpiresAt") return moment().add(1, "hour").unix();
                    return null;
                },
                setItem: async () => undefined,
                removeItem: async () => undefined,
            } as any,
            { post } as any,
            {
                getCurrentWallet: async () => ({
                    tagName: "alice.zelf",
                    publicData: { domain: "zelf", ethAddress: "0xabc" },
                }),
            } as any
        );

        service.keepVerifiedSession();

        await expectAsync(service.checkAccessToken()).toBeResolvedTo(token);
        await expectAsync(service.reauthenticateSession()).toBeResolvedTo(token);
        expect(post).not.toHaveBeenCalled();

        service.releaseVerifiedSession();
    });

    it("mints a replacement session after the proxy rejects the token", async () => {
        const token = jwt({ identifier: "current", tagName: "alice.zelf", domain: "zelf" });
        const post = jasmine.createSpy("post").and.returnValue({
            toPromise: () => Promise.resolve({ data: { token: "next", expiresAt: moment().add(1, "hour").unix() } }),
        });
        const service = new AuthService(
            {
                getItem: async (key: string) => {
                    if (key === "accessToken") return token;
                    if (key === "accessTokenExpiresAt") return moment().add(1, "hour").unix();
                    return null;
                },
                setItem: async () => undefined,
                removeItem: async () => undefined,
            } as any,
            { post } as any,
            {
                getCurrentWallet: async () => ({
                    tagName: "alice.zelf",
                    publicData: { domain: "zelf", ethAddress: "0xabc" },
                }),
            } as any
        );

        service.keepVerifiedSession();

        await expectAsync(service.refreshAfterUnauthorized()).toBeResolvedTo("next");
        expect(post.calls.mostRecent().args[1].killSession).toBe(1);
        expect(service.keepingVerifiedSession).toBeTrue();
    });

    it("creates a new session when the kept token is no longer valid", async () => {
        const token = jwt({ identifier: "stale-session", tagName: "alice.zelf", domain: "zelf" });
        const wallet = {
            getCurrentWallet: async () => ({
                tagName: "alice.zelf",
                publicData: { domain: "zelf", ethAddress: "0xabc" },
            }),
        };
        const storage = {
            getItem: async (key: string) => {
                if (key === "accessToken") return token;
                if (key === "accessTokenExpiresAt") return moment().subtract(1, "minute").unix();
                return null;
            },
            setItem: async () => undefined,
            removeItem: async () => undefined,
        };

        const checkPost = jasmine.createSpy("post").and.returnValue({
            toPromise: () => Promise.resolve({ data: { token: "fresh", expiresAt: moment().add(1, "hour").unix() } }),
        });
        const checkService = new AuthService(storage as any, { post: checkPost } as any, wallet as any);

        checkService.keepVerifiedSession();

        await expectAsync(checkService.checkAccessToken()).toBeResolvedTo("fresh");
        expect(checkPost.calls.mostRecent().args[1].killSession).toBeUndefined();
        expect(checkService.keepingVerifiedSession).toBeTrue();

        const reauthPost = jasmine.createSpy("post").and.returnValue({
            toPromise: () => Promise.resolve({ data: { token: "fresh", expiresAt: moment().add(1, "hour").unix() } }),
        });
        const reauthService = new AuthService(storage as any, { post: reauthPost } as any, wallet as any);

        reauthService.keepVerifiedSession();

        await expectAsync(reauthService.reauthenticateSession()).toBeResolvedTo("fresh");
        expect(reauthPost.calls.mostRecent().args[1].killSession).toBe(1);
        expect(reauthService.keepingVerifiedSession).toBeTrue();
    });
});
