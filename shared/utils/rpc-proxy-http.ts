/**
 * Authenticated calls to the Zelf API RPC proxy.
 * Paid chain traffic stays on these routes; the extension does not embed upstream provider URLs.
 */

export interface SessionTokens {
    getToken: () => Promise<string>;
    refreshToken: () => Promise<string>;
}

export interface RpcProxyFetchDeps {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;

export function protectedRpcUrl(apiBase: string, chainKey: string): string {
    const base = apiBase.replace(/\/$/, "");

    return `${base}/api/protected/rpc/${chainKey}`;
}

export function stellarProxyBase(apiBase: string): string {
    return protectedRpcUrl(apiBase, "stellar");
}

export function btcProxyUrl(apiBase: string, network: "mainnet" | "testnet", suffix: string): string {
    const path = suffix.replace(/^\//, "");

    return `${protectedRpcUrl(apiBase, "btc")}/${network}/${path}`;
}

/** Blockbook UTXO `value` may be a decimal string of satoshis. */
export function blockbookUtxoSatoshis(value: unknown): number {
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error("Invalid UTXO value");
    }

    return Math.trunc(numeric);
}

/**
 * `Retry-After` is either delta-seconds or an HTTP date.
 * The wait is capped so a bad header cannot stall the wallet indefinitely.
 */
export function retryAfterDelayMs(header: string | null | undefined, now = Date.now()): number {
    if (!header) return DEFAULT_RETRY_AFTER_MS;

    const trimmed = header.trim();

    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(Number(trimmed) * 1000)));
    }

    const date = Date.parse(trimmed);

    if (Number.isFinite(date)) {
        return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - now));
    }

    return DEFAULT_RETRY_AFTER_MS;
}

async function discardResponse(response: Response): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {
        // The body may already be locked or unsupported in this runtime.
    }
}

/**
 * Sends one request with the session JWT.
 * On 401, refreshes the session and retries once.
 * On 429, waits for `Retry-After` and retries once.
 */
export async function fetchWithSessionAuth(
    url: string,
    init: RequestInit | undefined,
    tokens: SessionTokens,
    deps: RpcProxyFetchDeps = {}
): Promise<Response> {
    const doFetch = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = deps.now ?? (() => Date.now());

    let token = await tokens.getToken();
    let authRetried = false;
    let rateRetried = false;

    for (;;) {
        const headers = new Headers(init?.headers);

        headers.set("Authorization", `Bearer ${token}`);

        const response = await doFetch(url, { ...init, headers });

        if (response.status === 401 && !authRetried) {
            authRetried = true;
            await discardResponse(response);
            token = await tokens.refreshToken();
            continue;
        }

        if (response.status === 429 && !rateRetried) {
            rateRetried = true;
            const delay = retryAfterDelayMs(response.headers.get("retry-after"), now());

            await discardResponse(response);
            await sleep(delay);
            continue;
        }

        return response;
    }
}
