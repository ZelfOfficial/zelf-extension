import {
    BALANCE_PRIORITY_NETWORKS,
    BALANCE_SECONDARY_NETWORKS,
    DEFAULT_NETWORK_CONFIGS,
    getPriorityBalanceNetworks,
    getSecondaryBalanceNetworks,
} from "./network-settings.util";

describe("network-settings balance lists", () => {
    const allIds = DEFAULT_NETWORK_CONFIGS.map((n) => n.id);

    it("covers every default network in either the priority or the background balance list", () => {
        const covered = new Set([...BALANCE_PRIORITY_NETWORKS, ...BALANCE_SECONDARY_NETWORKS]);
        const missing = allIds.filter((id) => !covered.has(id));

        expect(missing).toEqual([]);
    });

    it("only lists known network ids and never repeats one", () => {
        const listed = [...BALANCE_PRIORITY_NETWORKS, ...BALANCE_SECONDARY_NETWORKS];

        expect(listed.filter((id) => !allIds.includes(id))).toEqual([]);
        expect(new Set(listed).size).toBe(listed.length);
    });

    it("includes Optimism, Arbitrum and Base in the background balance fetch", () => {
        const secondary = getSecondaryBalanceNetworks();

        expect(secondary).toContain("optimism");
        expect(secondary).toContain("arbitrum");
        expect(secondary).toContain("base");
    });

    it("fetches every default network exactly once when no filter is given", () => {
        const fetched = [...getPriorityBalanceNetworks(), ...getSecondaryBalanceNetworks()];

        expect([...fetched].sort()).toEqual([...allIds].sort());
    });

    it("respects the enabled-networks filter", () => {
        const enabled = ["ethereum", "base", "arbitrum", "ton"];

        expect(getPriorityBalanceNetworks(enabled)).toEqual(["ethereum"]);
        expect(getSecondaryBalanceNetworks(enabled)).toEqual(["arbitrum", "base", "ton"]);
    });

    it("returns nothing when no networks are enabled", () => {
        expect(getPriorityBalanceNetworks([])).toEqual([]);
        expect(getSecondaryBalanceNetworks([])).toEqual([]);
    });

    it("never puts a priority network in the background list", () => {
        const secondary = getSecondaryBalanceNetworks();

        for (const id of BALANCE_PRIORITY_NETWORKS) expect(secondary).not.toContain(id);
    });
});
