import { blockbookUtxoSatoshis, btcProxyUrl, fetchWithSessionAuth, retryAfterDelayMs, stellarProxyBase } from "@shared/utils/rpc-proxy-http";

describe("RPC proxy HTTP", () => {
    it("builds protected Bitcoin and Stellar routes", () => {
        expect(btcProxyUrl("https://v4.zelf.world/", "testnet", "tx/abc/hex")).toBe(
            "https://v4.zelf.world/api/protected/rpc/btc/testnet/tx/abc/hex"
        );
        expect(stellarProxyBase("http://localhost:3050")).toBe("http://localhost:3050/api/protected/rpc/stellar");
    });

    it("reads Blockbook satoshi values that arrive as strings", () => {
        expect(blockbookUtxoSatoshis("1500")).toBe(1500);
        expect(blockbookUtxoSatoshis(42.9)).toBe(42);
        expect(() => blockbookUtxoSatoshis("nope")).toThrowError("Invalid UTXO value");
    });

    it("honors Retry-After seconds and HTTP dates, with a cap", () => {
        expect(retryAfterDelayMs("2")).toBe(2000);
        expect(retryAfterDelayMs("120")).toBe(60_000);
        expect(retryAfterDelayMs(new Date(1_000_000).toUTCString(), 990_000)).toBe(10_000);
        expect(retryAfterDelayMs(null)).toBe(1000);
    });

    it("sends the session JWT, refreshes once on 401, and waits once on 429", async () => {
        const calls: Array<{ authorization: string | null; url: string }> = [];
        const slept: number[] = [];
        let token = "expired";
        const statuses = [401, 429, 200];

        const response = await fetchWithSessionAuth(
            "https://api.example/api/protected/rpc/ethereum",
            { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"jsonrpc":"2.0"}' },
            {
                getToken: async () => token,
                refreshToken: async () => {
                    token = "fresh";

                    return token;
                },
            },
            {
                now: () => 0,
                sleep: async (ms) => {
                    slept.push(ms);
                },
                fetchImpl: async (input, init) => {
                    const headers = new Headers(init?.headers);

                    calls.push({ authorization: headers.get("Authorization"), url: String(input) });

                    const status = statuses.shift() ?? 200;

                    return new Response(status === 200 ? '{"result":"0x1"}' : "", {
                        status,
                        headers: status === 429 ? { "retry-after": "3" } : undefined,
                    });
                },
            }
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ result: "0x1" });
        expect(calls.map((call) => call.authorization)).toEqual(["Bearer expired", "Bearer fresh", "Bearer fresh"]);
        expect(slept).toEqual([3000]);
    });

    it("does not refresh more than once when the new session is also rejected", async () => {
        let refreshes = 0;

        const response = await fetchWithSessionAuth(
            "https://api.example/rpc",
            { method: "GET" },
            {
                getToken: async () => "one",
                refreshToken: async () => {
                    refreshes += 1;

                    return "two";
                },
            },
            {
                fetchImpl: async () => new Response("nope", { status: 401 }),
            }
        );

        expect(response.status).toBe(401);
        expect(refreshes).toBe(1);
    });
});
