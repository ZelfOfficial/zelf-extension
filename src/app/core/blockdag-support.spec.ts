import {
    applyBlockdagNetworkVisibility,
    coerceSelectableDomain,
    isBlockdagToken,
    isDeadBdagscanUrl,
    selectableNameDomains,
    userHadBlockdagEnabled,
    walletQualifiesForBlockdagNotice,
    withoutBdagPaymentCurrencies,
} from "./blockdag-support";

describe("blockdag support cutoff", () => {
    it("treats only an explicit enabled toggle as already on", () => {
        expect(userHadBlockdagEnabled([{ id: "blockdag", enabled: true }])).toBeTrue();
        expect(userHadBlockdagEnabled([{ id: "blockdag", enabled: false }])).toBeFalse();
        expect(userHadBlockdagEnabled([{ id: "ethereum", enabled: true }])).toBeFalse();
        expect(userHadBlockdagEnabled(undefined)).toBeFalse();
    });

    it("hides blockdag unless the wallet already enabled it, and keeps it when it did", () => {
        expect(applyBlockdagNetworkVisibility(["ethereum", "blockdag"], [{ id: "blockdag", enabled: false }])).toEqual(["ethereum"]);
        expect(applyBlockdagNetworkVisibility(["ethereum"], [{ id: "blockdag", enabled: true }])).toEqual(["ethereum", "blockdag"]);
        expect(applyBlockdagNetworkVisibility(["ethereum", "blockdag"], [{ id: "blockdag", enabled: true }])).toEqual(["ethereum", "blockdag"]);
    });

    it("removes .bdag from new-name choices and payment currencies", () => {
        expect(selectableNameDomains([{ name: "zelf" }, { name: "bdag" }, { name: "avax" }]).map((domain) => domain.name)).toEqual([
            "zelf",
            "avax",
        ]);
        expect(coerceSelectableDomain("bdag")).toBe("zelf");
        expect(coerceSelectableDomain(".BDAG")).toBe("zelf");
        expect(coerceSelectableDomain("avax")).toBe("avax");
        expect(withoutBdagPaymentCurrencies(["BTC", "BDAG", "USDC"])).toEqual(["BTC", "USDC"]);
    });

    it("notices holders by enablement, balance, or a .bdag name", () => {
        expect(walletQualifiesForBlockdagNotice({ networks: [{ id: "blockdag", enabled: true }] })).toBeTrue();
        expect(
            walletQualifiesForBlockdagNotice({
                tokens: [{ symbol: "BDAG", network: "BlockDAG", amount: 1.2, fiatBalance: 0 }],
            })
        ).toBeTrue();
        expect(walletQualifiesForBlockdagNotice({ domain: "bdag" })).toBeTrue();
        expect(walletQualifiesForBlockdagNotice({ tagName: "nic.bdag" })).toBeTrue();
        expect(
            walletQualifiesForBlockdagNotice({
                networks: [{ id: "blockdag", enabled: false }],
                tokens: [{ symbol: "BDAG", network: "BlockDAG", amount: 0, fiatBalance: 0 }],
                domain: "zelf",
                tagName: "nic.zelf",
            })
        ).toBeFalse();
    });

    it("recognizes BDAG rows and the retired scan hosts", () => {
        expect(isBlockdagToken({ network: "BlockDAG", symbol: "ZNS", tokenType: "ERC-20" })).toBeTrue();
        expect(isBlockdagToken({ network: "Ethereum", symbol: "BDAG", tokenType: "ERC-20" })).toBeTrue();
        expect(isBlockdagToken({ network: "Ethereum", symbol: "ETH", tokenType: "ETH" })).toBeFalse();
        expect(isDeadBdagscanUrl("https://rpc.bdagscan.com")).toBeTrue();
        expect(isDeadBdagscanUrl("https://bdagscan.com/tx/0x1")).toBeTrue();
        expect(isDeadBdagscanUrl("https://api.bdagscan.com/v1")).toBeTrue();
        expect(isDeadBdagscanUrl("https://explorer.east.bdag-us.org/tx/0x1")).toBeFalse();
    });
});
