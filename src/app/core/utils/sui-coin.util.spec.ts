import { TransactionData } from "@shared/types/wallet.types";

import {
    decimalToMist,
    floorDisplayMist,
    insufficientSuiMessage,
    isNativeSuiCoinType,
    isNativeSuiHolding,
    isSuiSendTokenType,
    mistGasBudget,
    NATIVE_SUI_COIN_TYPE,
    resolveSuiTransferTarget,
    sendConfirmNetworkLabel,
    sendScreenSuiTokenType,
    shouldSendEntireSuiBalance,
    suiAmountFitsGasBudget,
    suiGasReserveMessage,
    suiGraphqlUrlFromLicenseNetwork,
    typedAmountMatchesDisplayedMax,
} from "./sui-coin.util";

describe("sui coin type", () => {
    it("treats isNative, tokenType SUI, and 0x2::sui::SUI as native", () => {
        expect(isNativeSuiHolding({ isNative: true, symbol: "USDC", tokenType: "0xabc::usdc::USDC" })).toBeTrue();
        expect(isNativeSuiHolding({ tokenType: "SUI", symbol: "SUI", address_token: "0x2" })).toBeTrue();
        expect(isNativeSuiHolding({ tokenType: NATIVE_SUI_COIN_TYPE })).toBeTrue();
        expect(isNativeSuiCoinType("0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI")).toBeTrue();
        expect(isNativeSuiCoinType("0x2")).toBeTrue();
        expect(isNativeSuiCoinType("0x0002")).toBeTrue();
    });

    it("does not treat a spam coin whose symbol is SUI as native", () => {
        const spam = {
            symbol: "SUI",
            name: "Sui",
            tokenType: "0xabc::spam::SUI",
            address_token: "0xabc::spam::SUI",
            isNative: false,
        };

        expect(isNativeSuiHolding(spam)).toBeFalse();
        expect(isNativeSuiHolding({ symbol: "SUI", name: "Sui" })).toBeFalse();
        expect(isNativeSuiCoinType("0xabc::sui::SUI")).toBeFalse();
        expect(isNativeSuiCoinType("SUI")).toBeFalse();
    });

    it("uses a full coin type as-is and keeps the legacy ::coin::COIN suffix", () => {
        expect(resolveSuiTransferTarget("0xabc::usdc::USDC")).toEqual({ kind: "coin", coinType: "0xabc::usdc::USDC" });
        expect(resolveSuiTransferTarget("0xabc")).toEqual({ kind: "coin", coinType: "0xabc::coin::COIN" });
        expect(resolveSuiTransferTarget("0x2")).toEqual({ kind: "native" });
        expect(resolveSuiTransferTarget(NATIVE_SUI_COIN_TYPE)).toEqual({ kind: "native" });
        expect(resolveSuiTransferTarget("")).toEqual({ kind: "native" });
    });

    it("treats a send-screen tokenType that contains :: as SUI_TOKEN", () => {
        expect(isSuiSendTokenType("0xabc::usdc::USDC")).toBeTrue();
        expect(sendScreenSuiTokenType("0xabc::usdc::USDC")).toBe("SUI_TOKEN");
        expect(sendScreenSuiTokenType("SUI")).toBe("SUI");
        expect(isSuiSendTokenType("SUI_TOKEN")).toBeTrue();
        expect(isSuiSendTokenType("ETH")).toBeFalse();

        const coin = new TransactionData({ token: { tokenType: "0xabc::usdc::USDC", network: "Sui", symbol: "USDC" } });
        const spam = new TransactionData({ token: { tokenType: "0xabc::spam::SUI", network: "Sui", symbol: "SUI" } });

        expect(coin.isSuiToken).toBeTrue();
        expect(spam.isSuiToken).toBeTrue();
        expect(new TransactionData({ token: { tokenType: "ETH", network: "Ethereum", symbol: "ETH" } }).isSuiToken).toBeFalse();
    });

    it("reads a GraphQL URL from the license network entry and ignores a JSON-RPC fullnode", () => {
        expect(suiGraphqlUrlFromLicenseNetwork({ enabled: true, graphql: " https://graphql.example/graphql " })).toBe(
            "https://graphql.example/graphql"
        );
        expect(suiGraphqlUrlFromLicenseNetwork({ enabled: true, rpc: "https://fullnode.mainnet.sui.io:443" })).toBeNull();
        expect(suiGraphqlUrlFromLicenseNetwork({ enabled: true })).toBeNull();
        expect(suiGraphqlUrlFromLicenseNetwork(null)).toBeNull();
    });

    it("labels a Sui send as Sui, and sends the whole balance only for Max or for the balance minus the fee", () => {
        expect(sendConfirmNetworkLabel("sui", "SUI_TOKEN")).toBe("Sui");
        expect(sendConfirmNetworkLabel("ethereum", "ETH")).toBe("ETH");

        const balance = 797_281_600_000n;
        const fee = 2_500_000n;
        const delivered = balance - fee;

        expect(shouldSendEntireSuiBalance(balance, delivered, true)).toBeTrue();
        expect(shouldSendEntireSuiBalance(delivered, delivered, false)).toBeTrue();
        expect(shouldSendEntireSuiBalance(797_250_000_000n, delivered, false)).toBeFalse();
        expect(suiAmountFitsGasBudget(9_999_000_000n, 10_000_000_000n, 1_200_000n)).toBeFalse();
        expect(suiAmountFitsGasBudget(9_999_000_000n, 10_000_000_000n, 148_447n)).toBeTrue();
        expect(suiAmountFitsGasBudget(balance - 500_000n, balance, 200_000n)).toBeTrue();
        expect(suiAmountFitsGasBudget(balance - 500_000n, balance, 1_188_000n)).toBeFalse();
        expect(floorDisplayMist(797_281_451_553n)).toBe(797_281_400_000n);
        expect(typedAmountMatchesDisplayedMax(decimalToMist("797.2814"), 797_281_451_553n)).toBeTrue();
        expect(typedAmountMatchesDisplayedMax(decimalToMist("797.2805"), 797_281_451_553n)).toBeFalse();
        expect(decimalToMist("797.281451553")).toBe(797_281_451_553n);
        expect(insufficientSuiMessage(1_000_000_000n, 5_000_000_000n)).toContain("Available 1 SUI");
        expect(suiGasReserveMessage(balance)).toContain("Not enough SUI left for the network fee");
    });

    it("sizes the gas budget from a dry-run", () => {
        expect(mistGasBudget({ computationCost: "1000000", storageCost: "2000000", storageRebate: "500000" })).toBe(3001000n);
    });
});
