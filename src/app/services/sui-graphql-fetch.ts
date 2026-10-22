const CHECKPOINT_RETRY_DELAY_MS = 300;
const CHECKPOINT_ATTEMPTS = 3;

/** GraphQL `BAD_USER_INPUT` when a paged read races a checkpoint that is not published yet. */
export function isCheckpointInTheFuture(body: string): boolean {
    if (!/in the future/i.test(body)) return false;

    return /BAD_USER_INPUT/i.test(body) || /checkpoint/i.test(body);
}

function responseFrom(text: string, response: Response): Response {
    return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

async function readAttempt(url: string, init: RequestInit | undefined, doFetch: typeof fetch): Promise<{ response: Response; checkpoint: boolean }> {
    const response = await doFetch(url, init);
    const text = await response.text();

    return { response: responseFrom(text, response), checkpoint: isCheckpointInTheFuture(text) };
}

/**
 * Retry a GraphQL read twice (~300ms apart) when Sui answers "Checkpoint N in the future",
 * then try the other endpoint (license URL or the public GraphQL URL).
 */
export function createCheckpointRetryFetch(options: {
    fallbackUrl?: string;
    sleep?: (ms: number) => Promise<void>;
    doFetch?: typeof fetch;
}): typeof fetch {
    const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const doFetch = options.doFetch ?? fetch;
    const fallbackUrl = (options.fallbackUrl || "").trim();

    return async (input, init) => {
        const primary = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const body = init?.body;

        const tryUrl = async (url: string): Promise<{ response: Response; checkpoint: boolean }> => {
            let last: { response: Response; checkpoint: boolean } | null = null;

            for (let attempt = 0; attempt < CHECKPOINT_ATTEMPTS; attempt++) {
                if (attempt > 0) await sleep(CHECKPOINT_RETRY_DELAY_MS);

                last = await readAttempt(url, body === undefined ? init : { ...init, body }, doFetch);
                if (!last.checkpoint) return last;
            }

            return last!;
        };

        const first = await tryUrl(primary);
        if (!first.checkpoint || !fallbackUrl || fallbackUrl === primary) return first.response;

        const second = await tryUrl(fallbackUrl);

        return second.response;
    };
}
