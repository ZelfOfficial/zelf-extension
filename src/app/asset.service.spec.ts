import { AssetService } from "./asset.service";

describe("AssetService Sui holdings", () => {
    function service(): AssetService {
        const chrome = { getItem: () => Promise.resolve(null) };

        return new AssetService(chrome as any, {} as any);
    }

    it("keeps native SUI apart from a spam coin whose symbol is SUI", () => {
        const tokens = service().processTokens("Sui", [
            {
                symbol: "SUI",
                name: "Sui",
                tokenType: "SUI",
                address_token: "0x2",
                isNative: true,
                amount: "11",
                balance: "11",
                price: "1",
                fiatBalance: "11",
            },
            {
                symbol: "SUI",
                name: "Sui",
                tokenType: "0xabc::spam::SUI",
                address_token: "0xabc::spam::SUI",
                isNative: false,
                amount: "0.2",
                balance: "0.2",
                price: "1",
                fiatBalance: "0.2",
            },
            {
                symbol: "SUI",
                name: "Sui",
                amount: "1",
                balance: "1",
                price: "0",
                fiatBalance: "0",
            },
        ]);

        expect(tokens.map((token) => token.tokenType)).toEqual(["SUI", "0xabc::spam::SUI", "SUI-TOKEN"]);
        expect(tokens.filter((token) => token.tokenType === "SUI").length).toBe(1);
    });

    it("fills fiat from amount × price and leaves a real zero at 0", () => {
        const [funded] = service().processTokens("Ethereum", [
            { symbol: "ETH", name: "Ethereum", tokenType: "ETH", amount: "1.25", balance: "0", price: "2000", fiatBalance: "0" },
        ]);
        const [empty] = service().processTokens("Optimism", [
            { symbol: "ETH", name: "Ethereum", tokenType: "ETH", amount: "0", price: "2389.89", fiatBalance: "0" },
        ]);

        expect(funded.amount).toBe(1.25);
        expect(funded.fiatBalance).toBe(2500);
        expect(empty.amount).toBe(0);
        expect(empty.fiatBalance).toBe(0);
    });
});
