export const environment = {
    apiUrl: "https://v4.zelf.world",
    v4ApiUrl: "https://v4.zelf.world",
    appUrl: "https://zelf.world",
    /** Public Zelf landing site. Share links are `${landingUrl}/share/<id>#<key>`. */
    landingUrl: "https://zelf.world",
    baseUrl: "/",
    captchaKey: "",
    includeNonPaidDomains: false,
    keysUrl: "https://keys.zelf.world",
    paymentDomainUrl: "https://zelf.world/tags/payment",
    paymentZelfIdUrl: "https://zelf.world/zelf-ids/payment",
    production: true,
    devBiometricsBypass: false,
    testnetAddress: "",
    znsUsdPrice: 0.05,
    networks: {
        ethereum: "sepolia",
        avalanche: "avalanche",
        solana: "solana",
    },
    optimismRpc: {
        mainnet: "https://mainnet.optimism.io",
    },
    arbitrumRpc: {
        mainnet: "https://arb1.arbitrum.io/rpc",
    },
    baseRpc: {
        mainnet: "https://mainnet.base.org",
    },
    /** Sui GraphQL. The public fullnode JSON-RPC endpoint is retired. A domain license may override this. */
    suiRpc: {
        mainnet: "https://graphql.mainnet.sui.io/graphql",
        testnet: "https://graphql.testnet.sui.io/graphql",
        devnet: "https://graphql.devnet.sui.io/graphql",
    },
    tonRpc: {
        mainnet: "https://toncenter.com/api/v2/jsonRPC",
        testnet: "https://testnet.toncenter.com/api/v2/jsonRPC",
        apiKey: "",
    },
    polkadotRelayRpc: "https://rpc.polkadot.io",
    kusamaRelayRpc: "https://kusama-rpc.polkadot.io",
    kusamaAssetHubRpc: "https://kusama-asset-hub-rpc.polkadot.io",
};
