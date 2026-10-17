import { NetworkConfig } from "app/models/settings.model";

import {
    getLicenseWalletNetworkIds,
    resolveEnabledNetworkIds,
    splitBalanceStages,
    SUPPORTED_NETWORK_IDS,
} from "./network-settings.util";

const license = (networks: Record<string, { enabled: boolean }>) => ({ tags: { wallet: { networks } } });
const toggle = (id: string, enabled: boolean): NetworkConfig => ({ id, name: id, symbol: id.toUpperCase(), enabled });

describe("getLicenseWalletNetworkIds", () => {
    it("returns the enabled wallet networks in license order", () => {
        const ids = getLicenseWalletNetworkIds(
            license({ ethereum: { enabled: true }, solana: { enabled: true }, optimism: { enabled: true }, arbitrum: { enabled: true } })
        );

        expect(ids).toEqual(["ethereum", "solana", "optimism", "arbitrum"]);
    });

    it("drops networks the admin disabled", () => {
        expect(getLicenseWalletNetworkIds(license({ ethereum: { enabled: true }, base: { enabled: false } }))).toEqual(["ethereum"]);
    });

    it("never adds networks the license does not list (no hard-coded gap list)", () => {
        const ids = getLicenseWalletNetworkIds(license({ ethereum: { enabled: true }, solana: { enabled: true } }))!;

        for (const id of ["optimism", "arbitrum", "base", "stellar", "ton", "aptos", "polkadot", "kusama"]) {
            expect(ids).not.toContain(id);
        }
    });

    it("ignores chains this build does not support", () => {
        expect(getLicenseWalletNetworkIds(license({ ethereum: { enabled: true }, dogechain: { enabled: true } }))).toEqual(["ethereum"]);
    });

    it("returns null when the license has no wallet network config", () => {
        expect(getLicenseWalletNetworkIds(null)).toBeNull();
        expect(getLicenseWalletNetworkIds({})).toBeNull();
        expect(getLicenseWalletNetworkIds({ tags: {} })).toBeNull();
    });

    it("returns an empty list when the admin disabled every network", () => {
        expect(getLicenseWalletNetworkIds(license({ ethereum: { enabled: false } }))).toEqual([]);
    });
});

describe("resolveEnabledNetworkIds", () => {
    const licensed = ["ethereum", "solana", "polygon", "optimism", "arbitrum"];

    it("uses the license list when the user has no toggles", () => {
        expect(resolveEnabledNetworkIds(licensed, undefined)).toEqual(licensed);
    });

    it("lets the user switch licensed networks off, keeping license order", () => {
        expect(resolveEnabledNetworkIds(licensed, [toggle("optimism", false), toggle("ethereum", true)])).toEqual([
            "ethereum",
            "solana",
            "polygon",
            "arbitrum",
        ]);
    });

    it("never shows a network the license does not allow, even if the user toggle is on", () => {
        const ids = resolveEnabledNetworkIds(licensed, [toggle("base", true), toggle("ton", true)])!;

        expect(ids).not.toContain("base");
        expect(ids).not.toContain("ton");
    });

    it("falls back to the full license list when the user switched everything off", () => {
        expect(resolveEnabledNetworkIds(licensed, licensed.map((id) => toggle(id, false)))).toEqual(licensed);
    });

    it("keeps legacy behaviour while no license config is known", () => {
        expect(resolveEnabledNetworkIds(null, undefined)).toBeUndefined();
        expect(resolveEnabledNetworkIds(null, [toggle("ethereum", true), toggle("solana", false)])).toEqual(["ethereum"]);
        expect(resolveEnabledNetworkIds(null, [toggle("ethereum", false)])).toBeUndefined();
    });
});

describe("splitBalanceStages", () => {
    it("loads the first two license networks first and the rest in the background", () => {
        expect(splitBalanceStages(["ethereum", "solana", "polygon", "optimism", "arbitrum"])).toEqual({
            priority: ["ethereum", "solana"],
            background: ["polygon", "optimism", "arbitrum"],
        });
    });

    it("handles short and duplicated lists", () => {
        expect(splitBalanceStages(["ton"])).toEqual({ priority: ["ton"], background: [] });
        expect(splitBalanceStages(["ethereum", "ethereum", "base"])).toEqual({ priority: ["ethereum", "base"], background: [] });
        expect(splitBalanceStages([])).toEqual({ priority: [], background: [] });
    });

    it("fetches every network it is given exactly once", () => {
        const { priority, background } = splitBalanceStages(SUPPORTED_NETWORK_IDS);

        expect([...priority, ...background].sort()).toEqual([...SUPPORTED_NETWORK_IDS].sort());
    });
});
