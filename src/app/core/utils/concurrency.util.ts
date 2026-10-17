/**
 * Runs `worker` for every item with at most `limit` running at the same time.
 * Workers start in input order; results are handled by the worker itself as soon as each finishes,
 * so one slow item (e.g. a network API taking 15s) never blocks the others behind it.
 * A worker that throws does not stop the rest. `shouldContinue` is checked before starting each item.
 */
export async function forEachWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
    shouldContinue: () => boolean = () => true
): Promise<void> {
    const queue = items.map((item, index) => ({ item, index }));
    const size = Math.max(1, Math.min(Math.floor(limit) || 1, queue.length));

    const lane = async (): Promise<void> => {
        while (queue.length) {
            if (!shouldContinue()) return;

            const next = queue.shift()!;

            try {
                await worker(next.item, next.index);
            } catch (error) {
                console.warn("[forEachWithConcurrency] worker failed:", error);
            }
        }
    };

    await Promise.all(Array.from({ length: size }, () => lane()));
}
