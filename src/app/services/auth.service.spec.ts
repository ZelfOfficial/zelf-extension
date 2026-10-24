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
});
