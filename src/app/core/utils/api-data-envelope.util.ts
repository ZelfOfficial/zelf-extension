/**
 * Most chain endpoints answer `{ data: {...} }`, but the Optimism, Arbitrum and Base address
 * endpoints answer the address payload unwrapped (`{ address, balance, tokenHoldings, ... }`).
 * Callers read `response.data.tokenHoldings`, so wrap a bare payload in `{ data }` and leave
 * already-wrapped (or error) responses untouched.
 */
export function ensureDataEnvelope<T = any>(response: any): { data: T } | any {
    if (!response || typeof response !== "object" || Array.isArray(response)) return response;

    if ("data" in response || "error" in response) return response;

    return { data: response as T };
}
