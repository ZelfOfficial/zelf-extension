import { createCheckpointRetryFetch, isCheckpointInTheFuture } from "./sui-graphql-fetch";

describe("Sui GraphQL checkpoint retry", () => {
    const checkpoint = JSON.stringify({
        errors: [{ message: "Checkpoint 42 in the future", extensions: { code: "BAD_USER_INPUT" } }],
    });

    it("recognises the checkpoint race", () => {
        expect(isCheckpointInTheFuture(checkpoint)).toBeTrue();
        expect(isCheckpointInTheFuture(JSON.stringify({ data: { ok: true } }))).toBeFalse();
    });

    it("retries twice, then fails over to the other GraphQL URL", async () => {
        const slept: number[] = [];
        const urls: string[] = [];
        const fetch = createCheckpointRetryFetch({
            fallbackUrl: "https://graphql.example/graphql",
            sleep: async (ms) => {
                slept.push(ms);
            },
            doFetch: async (input) => {
                const url = String(input);
                urls.push(url);

                return new Response(checkpoint, { status: 200, headers: { "content-type": "application/json" } });
            },
        });

        const response = await fetch("https://graphql.mainnet.sui.io/graphql", { method: "POST", body: "{}" });

        expect(await response.text()).toBe(checkpoint);
        expect(urls.filter((url) => url.includes("mainnet")).length).toBe(3);
        expect(urls.filter((url) => url.includes("graphql.example")).length).toBe(3);
        expect(slept).toEqual([300, 300, 300, 300]);
    });

    it("returns the first successful response without failing over", async () => {
        const urls: string[] = [];
        const fetch = createCheckpointRetryFetch({
            fallbackUrl: "https://graphql.example/graphql",
            sleep: async () => undefined,
            doFetch: async (input) => {
                urls.push(String(input));

                return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
            },
        });

        const response = await fetch("https://graphql.mainnet.sui.io/graphql", { method: "POST", body: "{}" });

        expect(JSON.parse(await response.text()).data.ok).toBeTrue();
        expect(urls).toEqual(["https://graphql.mainnet.sui.io/graphql"]);
    });
});
