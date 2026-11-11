export const environment = {
    apiUrl: "http://localhost:3050",
    v4ApiUrl: "http://localhost:3050",
    appUrl: "https://zelf.world",
    /** Public Zelf landing site. Share links are `${landingUrl}/share/<id>#<key>`. */
    landingUrl: "https://zelf.world",
    baseUrl: "/index.html",
    captchaKey: "6LcAhbIqAAAAANEZltlDqWutQ_kcujZ7IUKIQiK1",
    includeNonPaidDomains: true,
    keysUrl: "https://keys.zelf.world",
    paymentDomainUrl: "http://localhost:3009/tags/payment",
    paymentZelfIdUrl: "http://localhost:3009/zelf-ids/payment",
    production: false,
    /** Local/dev QA only: allow bundled selfie bypass when `devFaceBypass=1` is in the URL. */
    devBiometricsBypass: true,
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
    /** TON (The Open Network) JSON-RPC via toncenter for client-side send. `apiKey` optional (raises rate limits). */
    tonRpc: {
        mainnet: "https://toncenter.com/api/v2/jsonRPC",
        testnet: "https://testnet.toncenter.com/api/v2/jsonRPC",
        apiKey: "",
    },
    /** Public Fullnode used only for locally signed native APT submission. Reads and estimates go through the backend. */
    aptosRpc: {
        mainnet: "https://api.mainnet.aptoslabs.com/v1",
    },
    /** Polkadot / Kusama relay JSON-RPC (HTTP) for @polkadot/api in the extension. */
    polkadotRelayRpc: "https://rpc.polkadot.io",
    kusamaRelayRpc: "https://kusama-rpc.polkadot.io",
    /** Kusama Asset Hub (parachain) — same SS58 as relay; Trust and many apps default native KSM here. */
    kusamaAssetHubRpc: "https://kusama-asset-hub-rpc.polkadot.io",
};
