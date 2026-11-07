import { Injectable } from "@angular/core";
import { FetchRequest, JsonRpcProvider } from "ethers";
import { Connection } from "@solana/web3.js";
import Web3 from "app/services/web3-facade";
import HttpProvider from "web3-providers-http";
import { ResponseError } from "web3-errors";

import { AuthService } from "app/services/auth.service";
import { environment } from "environments/environment";
import { allowDirectFallbackForChainKey, getChainKeyFromChainId } from "@shared/utils/evm-chain-key.util";
import { fetchWithSessionAuth, protectedRpcUrl, type SessionTokens } from "@shared/utils/rpc-proxy-http";

export interface SolanaConnectionOptions {
    /** Kept so existing call sites compile. Solana always uses the authenticated proxy. */
    useDirectRpc?: boolean;
}

export interface RpcProviderOptions {
    /**
     * Public chains (arbitrum, optimism, base) may use their public endpoint
     * when a session cannot be minted. Paid chains and BlockDAG never do.
     */
    allowDirectFallback?: boolean;
}

/**
 * JSON-RPC for wallet reads and sends goes through `POST /api/protected/rpc/:chainKey`
 * with the session JWT. ethers retries a 401 once after a session refresh; its built-in
 * throttle honors a numeric `Retry-After`. web3 and Solana use the shared fetch helper,
 * which also retries 401 once and waits on 429.
 */
@Injectable({
    providedIn: "root",
})
export class RpcProviderService {
    private _solanaConnection: Promise<Connection> | null = null;

    constructor(private readonly _auth: AuthService) {}

    getProtectedProxyUrl(chainKey: string): string {
        return protectedRpcUrl(environment.apiUrl, chainKey);
    }

    /** Public endpoint used only when a session is unavailable. Paid chains return null. */
    getFallbackDirectRpcUrl(chainKey: string): string | null {
        switch (chainKey) {
            case "arbitrum":
                return environment.arbitrumRpc.mainnet;
            case "optimism":
                return environment.optimismRpc.mainnet;
            case "base":
                return environment.baseRpc.mainnet;
            default:
                return null;
        }
    }

    getSolanaConnection(_opts: SolanaConnectionOptions = {}): Promise<Connection> {
        if (!this._solanaConnection) {
            this._solanaConnection = this._createSolanaConnection().catch((error) => {
                this._solanaConnection = null;
                throw error;
            });
        }

        return this._solanaConnection;
    }

    private _sessionTokens(): SessionTokens {
        return {
            getToken: () => this._auth.checkAccessToken(),
            refreshToken: () => this._auth.refreshAfterUnauthorized(),
        };
    }

    private async _createSolanaConnection(): Promise<Connection> {
        await this._auth.checkAccessToken();

        const endpoint = this.getProtectedProxyUrl("solana");
        const tokens = this._sessionTokens();

        return new Connection(endpoint, {
            commitment: "confirmed",
            disableRetryOnRateLimit: true,
            fetch: (input, init) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

                return fetchWithSessionAuth(url, init, tokens);
            },
        });
    }

    private _bindEthersSession(request: FetchRequest): void {
        request.setHeader("Content-Type", "application/json");
        request.preflightFunc = async (req) => {
            const token = await this._auth.checkAccessToken();

            req.setHeader("Authorization", `Bearer ${token}`);

            return req;
        };
        request.processFunc = async (req, response) => {
            if (response.statusCode !== 401 || req.getHeader("x-zelf-auth-retry") === "1") {
                return response;
            }

            req.setHeader("x-zelf-auth-retry", "1");
            await this._auth.refreshAfterUnauthorized();

            throw Object.assign(new Error("session expired"), { throttle: true, stall: 0 });
        };
    }

    private _directFallbackUrl(chainKey: string, allowDirectFallback: boolean): string | null {
        if (!allowDirectFallback || !allowDirectFallbackForChainKey(chainKey)) return null;

        return this.getFallbackDirectRpcUrl(chainKey);
    }

    async getEthersProvider(chainKey: string, opts: RpcProviderOptions = {}): Promise<JsonRpcProvider> {
        const allowDirectFallback = opts.allowDirectFallback !== false;

        try {
            await this._auth.checkAccessToken();
        } catch (err) {
            const fallback = this._directFallbackUrl(chainKey, allowDirectFallback);

            if (!fallback) {
                throw new Error("Session required for RPC. Sign in and try again.");
            }

            if (!environment.production) {
                console.warn(`[RpcProviderService] Public RPC fallback for ${chainKey} (no JWT)`, err);
            }

            return new JsonRpcProvider(fallback);
        }

        const request = new FetchRequest(this.getProtectedProxyUrl(chainKey));

        this._bindEthersSession(request);

        return new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
    }

    async getEthersProviderForChainId(chainId: number, opts: RpcProviderOptions = {}): Promise<JsonRpcProvider> {
        const key = getChainKeyFromChainId(chainId);

        if (!key) {
            throw new Error(`Unsupported chainId for protected RPC: ${chainId}`);
        }

        return this.getEthersProvider(key, opts);
    }

    async getWeb3(chainKey: string, opts: RpcProviderOptions = {}): Promise<Web3> {
        const allowDirectFallback = opts.allowDirectFallback !== false;

        try {
            await this._auth.checkAccessToken();
        } catch (err) {
            const fallback = this._directFallbackUrl(chainKey, allowDirectFallback);

            if (!fallback) {
                throw new Error("Session required for RPC. Sign in and try again.");
            }

            if (!environment.production) {
                console.warn(`[RpcProviderService] Public RPC fallback for ${chainKey} (no JWT)`, err);
            }

            return new Web3(new HttpProvider(fallback));
        }

        return new Web3(new SessionHttpProvider(this.getProtectedProxyUrl(chainKey), this._sessionTokens()));
    }
}

class SessionHttpProvider extends HttpProvider {
    constructor(
        private readonly _url: string,
        private readonly _tokens: SessionTokens
    ) {
        super(_url);
    }

    override async request(payload: unknown): Promise<any> {
        const response = await fetchWithSessionAuth(
            this._url,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
            this._tokens
        );
        const text = await response.text();
        let body: unknown = text;

        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = { error: { message: text } };
            }
        }

        if (!response.ok) {
            const errorBody = body && typeof body === "object" ? body : { error: { message: text || response.statusText } };

            throw new ResponseError(errorBody as any, undefined, undefined, response.status);
        }

        return body;
    }
}
