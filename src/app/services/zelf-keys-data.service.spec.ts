import { ZelfKeysDataService } from "./zelf-keys-data.service";

describe("ZelfKeysDataService vault list session", () => {
    function setup(options: { hold?: boolean; list: (category: string) => Promise<unknown> }) {
        const calls: string[] = [];
        let hold = options.hold ?? false;
        const list = jasmine.createSpy("list").and.callFake(async (category: string) => {
            calls.push(`list:${category}`);
            return options.list(category);
        });
        const reauthenticateSession = jasmine.createSpy("reauthenticateSession").and.callFake(async () => {
            calls.push("reauth");
            hold = false;
            return "new-token";
        });
        const ensureAccessTokenForCurrentWallet = jasmine.createSpy("ensure").and.callFake(async () => {
            calls.push("ensure");
            return "verified-token";
        });
        const service = new ZelfKeysDataService(
            {
                ensureAccessTokenForCurrentWallet,
                reauthenticateSession,
                releaseVerifiedSession: () => {
                    hold = false;
                },
                get keepingVerifiedSession() {
                    return hold;
                },
                jwtMatchesCurrentWallet: () => false,
                getJwtSessionTag: () => ({ tagName: "alice.zelf", domain: "zelf" }),
            } as any,
            {
                removeItemSession: async () => undefined,
                getItemSession: async () => null,
                setItemSession: async () => undefined,
            } as any,
            {
                getCurrentWallet: async () => ({ fullTagName: "alice.zelf", publicData: { tagName: "alice.zelf" } }),
            } as any,
            { list } as any
        );

        return { service, calls, reauthenticateSession, list };
    }

    it("does not mint a session between unlock and the first list", async () => {
        const { service, calls, reauthenticateSession } = setup({
            hold: true,
            list: async () => ({ data: [{ id: "1" }] }),
        });

        const data = await service.load(true, "after-unlock");

        expect(reauthenticateSession).not.toHaveBeenCalled();
        expect(calls[0]).toBe("ensure");
        expect(calls[1]).toBe("list:password");
        expect(data.passwords.length).toBe(1);
        expect(service.needsReverify).toBeFalse();
    });

    it("retries the list once after recreating the session", async () => {
        let attempt = 0;
        const { service, reauthenticateSession } = setup({
            hold: true,
            list: async () => {
                attempt += 1;
                if (attempt <= 3) throw { status: 401 };

                return { data: [{ id: "1" }] };
            },
        });

        const data = await service.load(true, "after-unlock");

        expect(reauthenticateSession).toHaveBeenCalledTimes(1);
        expect(data.passwords.length).toBe(1);
        expect(service.needsReverify).toBeFalse();
    });

    it("asks the owner to re-verify instead of publishing an empty vault", async () => {
        const { service, reauthenticateSession } = setup({
            hold: true,
            list: async () => {
                throw { status: 403 };
            },
        });

        const data = await service.load(true, "after-unlock");

        expect(reauthenticateSession).toHaveBeenCalledTimes(1);
        expect(data.passwords).toEqual([]);
        expect(service.data).toBeNull();
        expect(service.needsReverify).toBeTrue();
    });
});
