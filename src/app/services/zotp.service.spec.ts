import { ZOTP } from "app/models/zotp.model";

import { ZOTPService } from "./zotp.service";

class MemoryChrome {
    store = new Map<string, unknown>();

    async getItem<T>(key: string): Promise<T> {
        return (this.store.has(key) ? this.store.get(key) : "") as T;
    }

    async setItem(key: string, value: unknown): Promise<void> {
        this.store.set(key, value);
    }

    async removeItem(key: string): Promise<void> {
        this.store.delete(key);
    }
}

function row(id: string, username: string, issuer: string) {
    return {
        id,
        cid: id,
        url: `https://ipfs.example/${id}`,
        publicData: { username, issuer, protection: "face" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        zelfProofQRCode: "data:image/png;base64," + "A".repeat(4000),
    };
}

function cached(id: string, name: string, issuer: string): ZOTP {
    return {
        id,
        name,
        issuer,
        createdAt: 1,
        updatedAt: 1,
        zelfKeysId: id,
    };
}

describe("ZOTPService list loading", () => {
    const owner = "qa.zelf";
    const storageKey = `zotps:${owner}`;
    const timestampKey = `zotps_cache_timestamp:${owner}`;

    function setup(listImpl?: () => Promise<unknown>) {
        const chrome = new MemoryChrome();
        const list = jasmine.createSpy("list").and.callFake(
            listImpl ||
                (() =>
                    Promise.resolve({
                        data: { data: [row("1", "a@zelf", "Stripe"), row("2", "b@zelf", "Mercury"), row("3", "c@zelf", "HubSpot")] },
                    }))
        );
        const service = new ZOTPService(
            chrome as any,
            {} as any,
            { getCurrentWallet: async () => ({ fullTagName: owner }) } as any,
            {} as any,
            { list } as any
        );

        return { chrome, list, service };
    }

    it("returns a fresh cache without waiting on the list request", async () => {
        const { chrome, list, service } = setup(
            () => new Promise((resolve) => setTimeout(() => resolve({ data: { data: [] } }), 900))
        );
        await chrome.setItem(storageKey, [cached("1", "a@zelf", "Stripe"), cached("2", "b@zelf", "Mercury"), cached("3", "c@zelf", "HubSpot")]);
        await chrome.setItem(timestampKey, Date.now());

        const started = performance.now();
        const items = await service.loadZOTPsFromBackend(false);

        expect(items.length).toBe(3);
        expect(performance.now() - started).toBeLessThan(50);
        expect(list).not.toHaveBeenCalled();
        expect(service.lastListLoad?.source).toBe("cache");
        expect(service.listLoading).toBeFalse();
    });

    it("paints a stale cache before the backend list resolves, then replaces it", async () => {
        const { chrome, list, service } = setup();
        let resolveList: (value: unknown) => void = () => undefined;
        list.and.returnValue(new Promise((resolve) => (resolveList = resolve)));
        await chrome.setItem(storageKey, [cached("1", "a@zelf", "Stripe"), cached("2", "b@zelf", "Mercury"), cached("3", "c@zelf", "HubSpot")]);
        await chrome.setItem(timestampKey, Date.now() - 10 * 60 * 1000);

        const started = performance.now();
        const first = await service.loadZOTPsFromBackend(false);

        expect(first.map((item) => item.id)).toEqual(["1", "2", "3"]);
        expect(performance.now() - started).toBeLessThan(50);
        expect(service.listLoading).toBeFalse();
        expect(service.currentList?.length).toBe(3);

        resolveList({
            data: {
                data: [row("1", "a@zelf", "Stripe"), row("2", "b@zelf", "Mercury"), row("3", "c@zelf", "HubSpot"), row("4", "d@zelf", "GitHub")],
            },
        });
        await service.whenListSettled();

        expect(list).toHaveBeenCalledTimes(1);
        expect(list).toHaveBeenCalledWith("zotp");
        expect(service.currentList?.length).toBe(4);
        const stored = await chrome.getItem<ZOTP[]>(storageKey);
        expect(stored.length).toBe(4);
        expect(stored[0].zelfProofQRCode).toBeUndefined();
    });

    it("keeps a cold load in the loading state until the single list call returns", async () => {
        const { list, service } = setup();
        let resolveList: (value: unknown) => void = () => undefined;
        list.and.callFake(() => new Promise((resolve) => (resolveList = resolve)));

        const pending = service.loadZOTPsFromBackend(false);
        for (let i = 0; list.calls.count() === 0 && i < 20; i++) {
            await Promise.resolve();
        }

        expect(service.listLoading).toBeTrue();
        expect(service.currentList).toBeNull();

        resolveList({
            data: { data: [row("1", "a@zelf", "Stripe"), row("2", "b@zelf", "Mercury"), row("3", "c@zelf", "HubSpot")] },
        });
        const items = await pending;

        expect(items.length).toBe(3);
        expect(list).toHaveBeenCalledTimes(1);
        expect(service.listLoading).toBeFalse();
        expect(service.lastListLoad?.source).toBe("network");
    });

    it("shares one in-flight list call between prefetch and the screen", async () => {
        const { list, service } = setup();
        let resolveList: (value: unknown) => void = () => undefined;
        list.and.returnValue(new Promise((resolve) => (resolveList = resolve)));

        const first = service.loadZOTPsFromBackend(false);
        service.prefetch();
        const second = service.loadZOTPsFromBackend(false);

        resolveList({ data: { data: [row("1", "a@zelf", "Stripe")] } });
        const [a, b] = await Promise.all([first, second]);

        expect(list).toHaveBeenCalledTimes(1);
        expect(a.length).toBe(1);
        expect(b.length).toBe(1);
    });

    it("publishes an empty vault only after the list call finishes", async () => {
        const { service } = setup(async () => ({ data: { data: [] } }));

        const items = await service.loadZOTPsFromBackend(false);

        expect(items).toEqual([]);
        expect(service.listLoading).toBeFalse();
        expect(service.currentList).toEqual([]);
    });
});
