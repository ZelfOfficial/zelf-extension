import { projectHomeNetworkTokens, uniqueChainIds } from "./home-network-list.util";

const row = (symbol: string, network: string, fiatBalance: number, tokenType = symbol) => ({ symbol, network, tokenType, fiatBalance, amount: 1 });

describe("home network list", () => {
    it("de-duplicates enabled chain ids by identity, not display name", () => {
        expect(uniqueChainIds(["Ethereum", "ethereum", "ETH", "optimism", "Optimism", "OP Mainnet"])).toEqual(["ethereum", "optimism"]);
    });

    it("shows every enabled network once and drops a network the user switched off", () => {
        const tokens = [
            row("ETH", "Ethereum", 10),
            row("ETH", "Ether", 4),
            row("ETH", "Optimism", 2),
            row("SOL", "Solana", 5),
            row("USDC", "Ethereum", 3, "ERC-20"),
        ];

        const enabled = projectHomeNetworkTokens(tokens, ["ethereum", "solana", "base"]);
        const disabled = projectHomeNetworkTokens(tokens, ["solana"]);

        expect(enabled.filter((token) => token.symbol === "ETH" && token.tokenType === "ETH").map((token) => token.network).sort()).toEqual(["Base", "Ethereum"]);
        expect(enabled.find((token) => token.symbol === "USDC")).toBeTruthy();
        expect(enabled.find((token) => token.network === "Solana")).toBeTruthy();
        expect(enabled.find((token) => token.network === "Optimism")).toBeUndefined();
        expect(enabled.find((token) => token.network === "Base")!.fiatBalance).toBeNull();
        expect(enabled.filter((token) => token.network === "Base").length).toBe(1);

        expect(disabled.map((token) => token.network)).toEqual(["Solana"]);
    });

    it("toggling a network back on shows it again exactly once", () => {
        const tokens = [row("ETH", "Ethereum", 10), row("ETH", "Optimism", 2), row("SOL", "Solana", 5)];
        const off = projectHomeNetworkTokens(tokens, ["ethereum", "solana"]);
        const on = projectHomeNetworkTokens(tokens, ["ethereum", "optimism", "solana"]);

        expect(off.find((token) => token.network === "Optimism")).toBeUndefined();
        expect(on.filter((token) => token.network === "Optimism").length).toBe(1);
        expect(on.filter((token) => token.symbol === "ETH").length).toBe(2);
    });

    it("does not invent catalog networks when no enable list is known", () => {
        const tokens = [row("KSM", "Kusama", 0)];

        expect(projectHomeNetworkTokens(tokens, undefined).map((token) => token.network)).toEqual(["Kusama"]);
        expect(projectHomeNetworkTokens(tokens, []).map((token) => token.network)).toEqual(["Kusama"]);
    });
});
