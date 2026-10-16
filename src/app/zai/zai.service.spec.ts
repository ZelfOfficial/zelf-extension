import { sanitizeZaiCard, ZaiError, ZaiService } from "./zai.service";

function sseBody(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
        start(c) {
            // split mid-event to exercise buffering
            c.enqueue(bytes.slice(0, 37));
            c.enqueue(bytes.slice(37));
            c.close();
        },
    });
}

describe("ZaiService SSE events", () => {
    const run = async (text: string) => {
        const svc: any = new ZaiService();
        const out: any = { meta: null, text: "", cards: [], done: null };
        await svc._readSse(sseBody(text), {
            onMeta: (m: any) => (out.meta = m),
            onDelta: (t: string) => (out.text += t),
            onCard: (c: any) => out.cards.push(c),
            onDone: (d: any) => (out.done = d),
        });
        return out;
    };

    it("consumes meta, delta, card and done; ignores pings", async () => {
        const out = await run(
            'event: meta\ndata: {"requestId":"r1","rulesVersion":"v0.1+abc"}\n\n: ping\n\n' +
                'event: delta\ndata: {"text":"Your tx "}\n\n' +
                'event: card\ndata: {"type":"transaction","hash":"0xh","chain":"eth","status":"failed","amount":"1","symbol":"ETH","timestamp":"2026-10-16T00:00:00Z","explorerUrl":"https://etherscan.io/tx/0xh"}\n\n' +
                'event: delta\ndata: {"text":"failed."}\n\n' +
                'event: done\ndata: {"usage":{"inputTokens":1,"outputTokens":2},"finishReason":"stop"}\n\n'
        );
        expect(out.meta).toEqual({ requestId: "r1", rulesVersion: "v0.1+abc" });
        expect(out.text).toBe("Your tx failed.");
        expect(out.cards.length).toBe(1);
        expect(out.cards[0].explorerUrl).toBe("https://etherscan.io/tx/0xh");
        expect(out.done.finishReason).toBe("stop");
    });

    it("never builds cards from reply text", async () => {
        const out = await run('event: delta\ndata: {"text":"[[tx:0xFAKE|failed|Oct 1|eth]]"}\n\n');
        expect(out.cards).toEqual([]);
        expect(out.text).toBe("[[tx:0xFAKE|failed|Oct 1|eth]]");
    });

    it("throws ZaiError on an error event", async () => {
        await expectAsync(run('event: error\ndata: {"code":"ZAI_UPSTREAM_ERROR","message":"x"}\n\n')).toBeRejectedWith(jasmine.any(ZaiError));
    });
});

describe("sanitizeZaiCard", () => {
    it("drops unknown types and non-https links", () => {
        expect(sanitizeZaiCard({ type: "script" })).toBeNull();
        expect(sanitizeZaiCard({ type: "doc", title: "x", url: "javascript:alert(1)" })).toBeNull();
        const tx: any = sanitizeZaiCard({ type: "transaction", hash: "h", chain: "eth", status: "success", explorerUrl: "http://evil" });
        expect(tx.explorerUrl).toBeNull();
        expect(sanitizeZaiCard({ type: "balance", chain: "sol", symbol: "SOL", amount: 1, usdValue: 2 })).toEqual({
            type: "balance",
            chain: "sol",
            symbol: "SOL",
            amount: "1",
            usdValue: 2,
        });
    });
});
