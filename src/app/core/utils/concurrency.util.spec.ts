import { forEachWithConcurrency } from "./concurrency.util";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("forEachWithConcurrency", () => {
    it("never runs more than `limit` workers at once and processes every item", async () => {
        let running = 0;
        let peak = 0;
        const done: number[] = [];

        await forEachWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
            running++;
            peak = Math.max(peak, running);
            await delay(5);
            done.push(n);
            running--;
        });

        expect(peak).toBe(3);
        expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("does not let a slow item block the ones queued after it (v3 #263)", async () => {
        const finished: string[] = [];

        await forEachWithConcurrency(["bsc-slow", "ethereum", "polygon"], 2, async (id) => {
            await delay(id === "bsc-slow" ? 60 : 5);
            finished.push(id);
        });

        expect(finished.indexOf("ethereum")).toBeLessThan(finished.indexOf("bsc-slow"));
        expect(finished.indexOf("polygon")).toBeLessThan(finished.indexOf("bsc-slow"));
    });

    it("keeps going when a worker throws and stops starting new items when told to", async () => {
        const seen: number[] = [];
        let stop = false;

        await forEachWithConcurrency([1, 2, 3], 1, async (n) => {
            seen.push(n);
            if (n === 1) throw new Error("boom");
            if (n === 2) stop = true;
        }, () => !stop);

        expect(seen).toEqual([1, 2]);
    });
});
