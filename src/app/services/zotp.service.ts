import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

import { ChromeService } from "../chrome.service";
import { VaultService } from "../vault.service";
import {
    parseZelfKeysProtection,
    resolveZotpProtection,
    ZELF_KEYS_PROTECTION_FACE_PASSWORD,
    ZelfKeysProtection,
} from "../models/zelf-keys-protection";
import { ZOTP } from "../models/zotp.model";
import { TagModel } from "../tags.service";
import { WalletService } from "../wallet.service";
import { ZelfKeysProofService } from "./zelf-keys-proof.service";
import { resolveOtpAuthTotpParams } from "../zelf-authenticator/zotp-otpauth.util";
import { applyTotpParamsToZotp, buildZotpStoreRequestBody } from "../zelf-authenticator/zotp-totp-params.util";
import { RetrieveRequest, ZelfKeysService } from "./zelf-keys.service";

@Injectable({
    providedIn: "root",
})
export class ZOTPService {
    /** Per-wallet cache (suffix = normalized fullTagName). */
    private readonly STORAGE_KEY_PREFIX = "zotps";
    private readonly CACHE_TIMESTAMP_PREFIX = "zotps_cache_timestamp";
    /** Pre–per-wallet-cache keys; removed when refreshing so they cannot leak across accounts. */
    private readonly LEGACY_STORAGE_KEY = "zotps";
    private readonly LEGACY_CACHE_TIMESTAMP_KEY = "zotps_cache_timestamp";
    private readonly CACHE_TTL = 5 * 60 * 1000; // Cache TTL: 5 minutes
    private _cache: ZOTP[] | null = null;
    private _cacheOwner: string | null = null;
    private _legacyCacheMigrated = false;
    /** One in-flight GET /list?category=zotp shared by prefetch and the vault screen. */
    private _inflight: Promise<ZOTP[]> | null = null;
    private _inflightOwner: string | null = null;
    private _background: Promise<void> = Promise.resolve();
    /** When true, per-item cache sync updates memory and the caller writes storage once. */
    private _deferCacheWrite = false;
    private readonly _zotps$ = new BehaviorSubject<ZOTP[] | null>(null);
    private readonly _listLoading$ = new BehaviorSubject<boolean>(false);

    /**
     * Last list paint. `network` is a cold GET /api/zelf-keys/list?category=zotp.
     * That handler walks owner prefixes one after another (each an IPFS search) before it responds.
     */
    lastListLoad: { source: "memory" | "cache" | "stale" | "network"; ms: number; count: number } | null = null;

    constructor(
        private _chromeService: ChromeService,
        private _vaultService: VaultService,
        private _walletService: WalletService,
        private _zelfKeysProofService: ZelfKeysProofService,
        private _zelfKeysService: ZelfKeysService
    ) {}

    get zotps$() {
        return this._zotps$.asObservable();
    }

    get listLoading$() {
        return this._listLoading$.asObservable();
    }

    get currentList(): ZOTP[] | null {
        return this._zotps$.value;
    }

    get listLoading(): boolean {
        return this._listLoading$.value;
    }

    /** Start the list fetch without blocking navigation (authenticated shell). */
    prefetch(): void {
        void this.loadZOTPsFromBackend(false).catch((error) => {
            console.error("Error prefetching ZOTPs:", error);
        });
    }

    /** Resolves when a background refresh or cache write started by the last load finishes. */
    async whenListSettled(): Promise<void> {
        await this._background;
        if (this._inflight) {
            await this._inflight.catch(() => undefined);
        }
    }

    private _walletTagForCache(wallet: Partial<TagModel> | null): string {
        const raw = wallet?.fullTagName || wallet?.publicData?.tagName || "";
        const t = String(raw).trim().toLowerCase();

        return t || "_none";
    }

    private async _getCacheKeys(): Promise<{ storageKey: string; timestampKey: string; ownerTag: string }> {
        const wallet = await this._walletService.getCurrentWallet();
        const ownerTag = this._walletTagForCache(wallet);

        return {
            ownerTag,
            storageKey: `${this.STORAGE_KEY_PREFIX}:${ownerTag}`,
            timestampKey: `${this.CACHE_TIMESTAMP_PREFIX}:${ownerTag}`,
        };
    }

    private async _removeLegacyGlobalCacheOnce(): Promise<void> {
        if (this._legacyCacheMigrated) return;

        this._legacyCacheMigrated = true;
        await this._chromeService.removeItem(this.LEGACY_STORAGE_KEY);
        await this._chromeService.removeItem(this.LEGACY_CACHE_TIMESTAMP_KEY);
    }

    private async _persistCache(keys: { storageKey: string }, zotps: ZOTP[]): Promise<void> {
        this._cache = zotps;
        await this._chromeService.setItem(keys.storageKey, zotps);
    }

    /**
     * Load ZOTPs from ZelfKeys API using GET /list?category=zotp.
     *
     * The API searches each owner prefix one after another (canonical tag, legacy concat,
     * legacy double-domain). Each search is an IPFS listing, so a cold response is slow
     * even for a handful of 2FAs. The vault does not need proofs or QR images for the list,
     * so this method:
     * - paints a fresh or stale cache immediately
     * - shares one in-flight list call (prefetch + screen)
     * - writes storage after the list is already returned to the UI
     *
     * @param forceRefresh - If true, bypass cache and fetch from backend
     */
    async loadZOTPsFromBackend(forceRefresh: boolean = false): Promise<ZOTP[]> {
        const started = performance.now();
        const keys = await this._getCacheKeys();
        void this._removeLegacyGlobalCacheOnce();

        if (!forceRefresh && this._cache && this._cacheOwner === keys.ownerTag) {
            this._publishList(this._cache, "memory", started);
            void this._revalidateIfStale(keys, started);
            return this._cache;
        }

        const stored = await this._readStoredList(keys);

        if (!forceRefresh && stored.fresh && stored.items) {
            this._publishList(stored.items, "cache", started, keys);
            return stored.items;
        }

        if (!forceRefresh && stored.items && stored.items.length > 0) {
            this._publishList(stored.items, "stale", started, keys);
            this._background = this._refreshFromNetwork(keys, started);
            return stored.items;
        }

        this._listLoading$.next(true);

        try {
            const zotps = await this._fetchShared(keys);
            this._publishList(zotps, "network", started, keys);
            return zotps;
        } catch (error) {
            console.error("Error loading ZOTPs from backend:", error);
            const cachedZotps = stored.items ?? (await this.getAllZOTPs());
            this._publishList(cachedZotps, "cache", started, keys);
            return cachedZotps;
        }
    }

    private async _revalidateIfStale(
        keys: { storageKey: string; timestampKey: string; ownerTag: string },
        started: number
    ): Promise<void> {
        const cacheTimestamp = await this._chromeService.getItem<number>(keys.timestampKey);
        if (typeof cacheTimestamp === "number" && Date.now() - cacheTimestamp < this.CACHE_TTL) return;

        this._background = this._refreshFromNetwork(keys, started);
    }

    private _refreshFromNetwork(
        keys: { storageKey: string; timestampKey: string; ownerTag: string },
        started: number
    ): Promise<void> {
        return this._fetchShared(keys)
            .then((zotps) => {
                this._publishList(zotps, "network", started, keys);
            })
            .catch((error) => {
                console.error("Error refreshing ZOTPs:", error);
            });
    }

    private _publishList(
        zotps: ZOTP[],
        source: "memory" | "cache" | "stale" | "network",
        started: number,
        keys?: { storageKey: string; timestampKey: string; ownerTag: string }
    ): void {
        this._cache = zotps;
        if (keys) this._cacheOwner = keys.ownerTag;
        this._zotps$.next(zotps);
        this._listLoading$.next(false);
        this.lastListLoad = {
            source,
            ms: Math.round(performance.now() - started),
            count: zotps.length,
        };

        if (source !== "network" || !keys) return;

        this._background = this._persistList(keys, zotps);
    }

    private _persistList(
        keys: { storageKey: string; timestampKey: string },
        zotps: ZOTP[]
    ): Promise<void> {
        return Promise.all([
            this._chromeService.setItem(keys.storageKey, zotps),
            this._chromeService.setItem(keys.timestampKey, Date.now()),
        ]).then(() => undefined);
    }

    private async _readStoredList(keys: {
        storageKey: string;
        timestampKey: string;
    }): Promise<{ items: ZOTP[] | null; fresh: boolean }> {
        try {
            const cacheTimestamp = await this._chromeService.getItem<number>(keys.timestampKey);
            const cachedZotps = await this._chromeService.getItem<ZOTP[]>(keys.storageKey);
            if (!Array.isArray(cachedZotps)) return { items: null, fresh: false };

            const fresh = typeof cacheTimestamp === "number" && Date.now() - cacheTimestamp < this.CACHE_TTL;
            return { items: cachedZotps, fresh };
        } catch (error) {
            console.error("Error reading cache:", error);
            return { items: null, fresh: false };
        }
    }

    private _fetchShared(keys: { ownerTag: string }): Promise<ZOTP[]> {
        if (this._inflight && this._inflightOwner === keys.ownerTag) return this._inflight;

        this._inflightOwner = keys.ownerTag;
        const run = this._fetchZotpList().finally(() => {
            if (this._inflight === run) {
                this._inflight = null;
                this._inflightOwner = null;
            }
        });
        this._inflight = run;
        return run;
    }

    /**
     * One category list. Metadata only — QR images and per-item decrypt stay off this path.
     */
    private async _fetchZotpList(): Promise<ZOTP[]> {
        const response = await this._zelfKeysService.list("zotp");
        const responseData = response?.data;
        const items = Array.isArray(responseData?.data)
            ? responseData.data
            : Array.isArray(responseData)
              ? responseData
              : [];
        const zotps: ZOTP[] = [];

        for (const item of items) {
            const publicData = item.publicData || {};
            const zotp: ZOTP = {
                id: item.id || item.cid || this.generateId(),
                name: publicData.username || "",
                issuer: publicData.issuer || undefined,
                createdAt: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
                updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : Date.now(),
                isDecrypted: false,
                zelfProof: typeof item.zelfProof === "string" ? item.zelfProof : undefined,
                zelfKeysId: item.id || item.cid,
                ipfs: {
                    id: item.id,
                    cid: item.cid,
                    url: item.url,
                    publicData: publicData,
                },
            };

            if (publicData.walrus) {
                const walrusId = typeof publicData.walrus === "string" ? publicData.walrus : publicData.walrus.blobId;
                if (walrusId) {
                    zotp.walrus = {
                        success: true,
                        blobId: walrusId,
                        publicUrl: `https://walrus-mainnet.mystenlabs.com/${walrusId}`,
                        explorerUrl: `https://walruscan.com/mainnet/blob/${walrusId}`,
                    };
                }
            }

            if (publicData.algorithm) zotp.algorithm = String(publicData.algorithm).toUpperCase();
            if (publicData.digits != null && publicData.digits !== "") {
                const digits = Number(publicData.digits);
                if (Number.isFinite(digits)) zotp.digits = digits;
            }
            if (publicData.period != null && publicData.period !== "") {
                const period = Number(publicData.period);
                if (Number.isFinite(period) && period > 0) zotp.period = period;
            }
            zotp.protection = parseZelfKeysProtection(publicData.protection);

            zotps.push(zotp);
        }

        return zotps;
    }

    /**
     * Load ZOTPs from ZelfKeys API and update local cache
     * @deprecated Use loadZOTPsFromBackend() instead
     * @param zelfProof - Wallet zelfProof
     * @param faceBase64 - Encrypted face image from biometrics
     */
    async loadZOTPsFromZelfKeys(zelfProof: string, faceBase64: string): Promise<ZOTP[]> {
        try {
            const response = await this._zelfKeysService.listZOTPs(zelfProof, faceBase64);
            const zotps: ZOTP[] = [];

            if (response?.data && Array.isArray(response.data)) {
                // Map ZelfKeys response to ZOTP format
                for (const item of response.data) {
                    const zotp: ZOTP = {
                        id: item.id || this.generateId(),
                        name: item.username || "",
                        // DO NOT store secret - it's encrypted in ZelfKeys and must be retrieved via retrieve endpoint
                        issuer: item.website || undefined,
                        createdAt: item.createdAt || Date.now(),
                        updatedAt: item.updatedAt || Date.now(),
                        isDecrypted: false,
                        zelfProof: zelfProof,
                        zelfKeysId: item.id,
                    };

                    // Parse additional metadata from notes if available
                    if (item.notes) {
                        try {
                            const notes = JSON.parse(item.notes);
                            if (notes.algorithm) zotp.algorithm = notes.algorithm;
                            if (notes.digits) zotp.digits = notes.digits;
                            if (notes.period) zotp.period = notes.period;
                        } catch {
                            // Notes is not JSON, ignore
                        }
                    }

                    zotps.push(zotp);
                }
            }

            // Update local cache (scoped)
            const keys = await this._getCacheKeys();
            await this._persistCache(keys, zotps);

            return zotps;
        } catch (error) {
            console.error("Error loading ZOTPs from ZelfKeys:", error);
            // Fallback to local cache if API fails
            return this.getAllZOTPs();
        }
    }

    /**
     * Store ZOTP to ZelfKeys API
     * @param zotp - ZOTP to store
     * @param faceBase64 - Encrypted face image from biometrics
     * @param masterPassword - Encrypted master password
     */
    async storeZOTPToZelfKeys(
        zotp: ZOTP,
        faceBase64: string,
        masterPassword: string,
        protection?: ZelfKeysProtection
    ): Promise<ZOTP> {
        if (!zotp.zelfProof) {
            throw new Error("zelfProof is required to store ZOTP");
        }

        if (!zotp.secret) {
            throw new Error("Secret is required to store ZOTP");
        }

        const storeRequest = buildZotpStoreRequestBody(zotp, faceBase64, masterPassword, protection);

        try {
            const response = await this._zelfKeysService.storeZOTP(storeRequest);

            // Response structure: { data: { zelfProof, zelfProofQRCode, ipfs, type, message } }
            const responseData = response?.data || {};

            // Update ZOTP with full response data
            // IMPORTANT: Do NOT store the secret - it's only kept in memory during creation
            // CRITICAL: Update zelfProof with the one returned from backend - this is the ZOTP-specific zelfProof
            // that must be used for retrieval, not the wallet's zelfProof
            const updatedZotp: ZOTP = {
                ...zotp,
                secret: undefined, // Remove secret - it's stored encrypted in ZelfKeys
                protection: protection || parseZelfKeysProtection(responseData.ipfs?.publicData?.protection) || zotp.protection,
                zelfProof: responseData.zelfProof || zotp.zelfProof, // Use the ZOTP-specific zelfProof from backend
                zelfKeysId: responseData.ipfs?.id || zotp.zelfKeysId,
                zelfProofQRCode: responseData.zelfProofQRCode || zotp.zelfProofQRCode,
                ipfs: responseData.ipfs || zotp.ipfs,
                walrus: responseData.walrus || zotp.walrus, // Save Walrus storage data
                createdAt: responseData.ipfs?.created_at ? new Date(responseData.ipfs.created_at).getTime() : zotp.createdAt,
                updatedAt: responseData.ipfs?.updated_at ? new Date(responseData.ipfs.updated_at).getTime() : Date.now(),
            };

            // Save full response to localStorage and update cache
            await this._saveFullResponseToStorage(updatedZotp, responseData);

            return updatedZotp;
        } catch (error) {
            console.error("Error storing ZOTP to ZelfKeys:", error);
            throw error;
        }
    }

    private _buildZotpRetrieveRequest(
        zotp: ZOTP,
        faceBase64: string,
        clientPublicKey: string,
        encryptedMasterPassword?: string
    ): RetrieveRequest {
        const protection = resolveZotpProtection(zotp);
        const versionHint = zotp.ipfs?.publicData?.v;

        if (protection === ZELF_KEYS_PROTECTION_FACE_PASSWORD && !encryptedMasterPassword) {
            throw new Error("ERR_PASSWORD_REQUIRED");
        }

        const walletPasswordFields = encryptedMasterPassword
            ? {
                  // Store/delete use `masterPassword`; password export retrieve uses `password`.
                  masterPassword: encryptedMasterPassword,
                  password: encryptedMasterPassword,
              }
            : {};

        return {
            zelfProof: zotp.zelfProof!,
            faceBase64,
            type: "zotp",
            clientPublicKey,
            protection,
            publicData: { protection },
            ...walletPasswordFields,
            ...(versionHint != null && String(versionHint).trim() ? { v: String(versionHint) } : {}),
        };
    }

    /**
     * Retrieve decrypted secret from ZelfKeys
     * @param zotp - ZOTP to retrieve
     * @param faceBase64 - Encrypted face image from biometrics
     * @returns The decrypted setupKey (secret)
     */
    async retrieveZOTPSecret(zotp: ZOTP, faceBase64: string, encryptedMasterPassword?: string): Promise<string> {
        const { secret } = await this.retrieveZOTPSecretWithParams(zotp, faceBase64, encryptedMasterPassword);

        return secret;
    }

    /**
     * Retrieve decrypted secret and merge TOTP params from retrieve metadata/publicData onto the ZOTP model.
     */
    async retrieveZOTPSecretWithParams(
        zotp: ZOTP,
        faceBase64: string,
        encryptedMasterPassword?: string
    ): Promise<{ secret: string; zotp: ZOTP }> {
        if (!zotp.zelfProof) {
            throw new Error("zelfProof is required to retrieve ZOTP");
        }

        try {
            const { publicKey: clientPublicKey } = await this._vaultService.generateEphemeralKeyPair();

            const response = await this._zelfKeysService.retrieve(
                this._buildZotpRetrieveRequest(zotp, faceBase64, clientPublicKey, encryptedMasterPassword)
            );

            const envelope = this._extractRetrieveEnvelope(response?.data);
            const secret = this._extractSetupKeyFromRetrieveEnvelope(envelope);

            if (!secret) {
                throw new Error("No setupKey found in ZelfKeys response");
            }

            const updatedZotp = applyTotpParamsToZotp(zotp, envelope.metadata, envelope.publicData);
            await this._addToCache(updatedZotp);

            return { secret, zotp: updatedZotp };
        } catch (error) {
            console.error("Error retrieving ZOTP secret:", error);
            throw error;
        }
    }

    /**
     * Retrieve full ZOTP metadata from ZelfKeys (for export)
     * @param zotp - ZOTP to retrieve
     * @param faceBase64 - Encrypted face image from biometrics
     * @returns The full metadata object containing setupKey and other fields
     */
    async retrieveZOTPMetadata(zotp: ZOTP, faceBase64: string, encryptedMasterPassword?: string): Promise<any> {
        if (!zotp.zelfProof) {
            throw new Error("zelfProof is required to retrieve ZOTP");
        }

        try {
            const { publicKey: clientPublicKey } = await this._vaultService.generateEphemeralKeyPair();

            const response = await this._zelfKeysService.retrieve(
                this._buildZotpRetrieveRequest(zotp, faceBase64, clientPublicKey, encryptedMasterPassword)
            );

            const envelope = this._extractRetrieveEnvelope(response?.data);

            if (envelope.metadata) {
                // Params often exist only inside decrypted metadata (or retrieve publicData).
                // Keep a known entry value when the decrypt payload omits that field.
                const params = resolveOtpAuthTotpParams([
                    envelope.metadata,
                    envelope.publicData,
                    zotp,
                    zotp.ipfs?.publicData,
                ]);
                const metadataForExport = {
                    ...envelope.metadata,
                    algorithm: params.algorithm,
                    digits: params.digits,
                    period: params.period,
                };
                const updatedZotp = applyTotpParamsToZotp(zotp, metadataForExport, envelope.publicData);
                await this._addToCache(updatedZotp);

                return metadataForExport;
            }

            throw new Error("No metadata found in ZelfKeys response");
        } catch (error) {
            console.error("Error retrieving ZOTP metadata:", error);
            throw error;
        }
    }

    /**
     * Get all ZOTPs from local cache
     * Also fixes any ZOTPs that might have the wrong zelfProof by checking stored response data
     */
    async getAllZOTPs(): Promise<ZOTP[]> {
        if (this._cache !== null) {
            return this._cache;
        }

        const keys = await this._getCacheKeys();
        const zotps = await this._chromeService.getItem<ZOTP[]>(keys.storageKey);
        this._cache = zotps && Array.isArray(zotps) ? zotps : [];
        this._cacheOwner = keys.ownerTag;

        // One storage write after every row is synced. A per-item await rewrote the whole cache N times.
        this._deferCacheWrite = true;
        try {
            await Promise.all(this._cache.filter((zotp) => !!zotp.id).map((zotp) => this._syncZotpFromStoredResponse(zotp)));
        } finally {
            this._deferCacheWrite = false;
        }

        await this._persistCache(keys, this._cache);

        return this._cache;
    }

    async getZOTP(id: string): Promise<ZOTP | null> {
        const zotps = await this.getAllZOTPs();

        return zotps.find((z) => z.id === id) || null;
    }

    /**
     * Ensure the item-specific ZelfKey proof is present (lazy GET /proof when list/cache omitted it).
     */
    async ensureZotpProof(zotp: ZOTP): Promise<ZOTP> {
        if (zotp.zelfProof?.trim()) {
            await this._syncZotpFromStoredResponse(zotp);
            if (zotp.zelfProof?.trim()) {
                return zotp;
            }
        }

        const hydrated = await this._zelfKeysProofService.ensureProof(zotp);
        const updated: ZOTP = {
            ...zotp,
            ...hydrated,
            zelfProof: hydrated.zelfProof,
            zelfProofQRCode: hydrated.zelfProofQRCode ?? zotp.zelfProofQRCode,
            ipfs: zotp.ipfs
                ? {
                      ...zotp.ipfs,
                      id: hydrated.ipfs?.id ?? zotp.ipfs.id,
                      cid: hydrated.ipfs?.cid ?? zotp.ipfs.cid,
                  }
                : zotp.ipfs,
        };

        await this._addToCache(updated);

        const responseKey = `zotp_response_${updated.id}`;
        const storedResponse = await this._chromeService.getItem<any>(responseKey);
        if (storedResponse?.response) {
            await this._chromeService.setItem(responseKey, {
                ...storedResponse,
                response: {
                    ...storedResponse.response,
                    zelfProof: updated.zelfProof,
                    zelfProofQRCode: updated.zelfProofQRCode,
                },
            });
        }

        return updated;
    }

    /**
     * Save ZOTP to local cache (for backward compatibility during transition)
     * Note: For new ZOTPs, use storeZOTPToZelfKeys instead
     */
    async saveZOTP(zotp: ZOTP): Promise<void> {
        const zotps = await this.getAllZOTPs();
        const existingIndex = zotps.findIndex((z) => z.id === zotp.id);

        if (existingIndex >= 0) {
            zotps[existingIndex] = { ...zotp, updatedAt: Date.now() };
        } else {
            zotps.push({
                ...zotp,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        const keys = await this._getCacheKeys();
        await this._persistCache(keys, zotps);
    }

    /**
     * Add ZOTP to local cache
     */
    private async _addToCache(zotp: ZOTP): Promise<void> {
        const zotps = await this.getAllZOTPs();
        const existingIndex = zotps.findIndex((z) => z.id === zotp.id || z.zelfKeysId === zotp.zelfKeysId);

        if (existingIndex >= 0) {
            zotps[existingIndex] = { ...zotp, updatedAt: Date.now() };
        } else {
            zotps.push({
                ...zotp,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        this._cache = zotps;
        this._zotps$.next(zotps);

        if (this._deferCacheWrite) return;

        const keys = await this._getCacheKeys();
        this._cacheOwner = keys.ownerTag;
        await this._persistCache(keys, zotps);
    }

    /**
     * Sync a ZOTP with its stored response data (zelfProof, IPFS, Walrus)
     */
    private async _syncZotpFromStoredResponse(zotp: ZOTP): Promise<void> {
        const responseKey = `zotp_response_${zotp.id}`;

        const storedResponse = await this._chromeService.getItem<any>(responseKey);

        if (!storedResponse?.response) return;

        const response = storedResponse.response;

        let updated = false;

        // Update zelfProof if different
        if (response.zelfProof && response.zelfProof !== zotp.zelfProof) {
            zotp.zelfProof = response.zelfProof;
            updated = true;
        }

        // Sync IPFS data if available and not already set
        if (response.ipfs && !zotp.ipfs) {
            zotp.ipfs = response.ipfs;
            updated = true;
        } else if (response.ipfs && zotp.ipfs) {
            // Merge IPFS data, preferring stored response
            zotp.ipfs = { ...zotp.ipfs, ...response.ipfs };
            updated = true;
        }

        // Sync Walrus data if available and not already set
        if (response.walrus && !zotp.walrus) {
            zotp.walrus = response.walrus;
            updated = true;
        } else if (response.walrus && zotp.walrus) {
            // Merge Walrus data, preferring stored response
            zotp.walrus = { ...zotp.walrus, ...response.walrus };
            updated = true;
        }

        // Sync zelfProofQRCode if available
        if (response.zelfProofQRCode && !zotp.zelfProofQRCode) {
            zotp.zelfProofQRCode = response.zelfProofQRCode;
            updated = true;
        }

        // If we have IPFS data but no Walrus data, try to get blobId from IPFS publicData
        if (zotp.ipfs?.publicData?.walrus && !zotp.walrus) {
            const blobId = zotp.ipfs.publicData.walrus;
            if (blobId && typeof blobId === "string") {
                zotp.walrus = {
                    success: true,
                    blobId: blobId,
                    publicUrl: `https://walrus-mainnet.mystenlabs.com/${blobId}`,
                    explorerUrl: `https://walruscan.com/mainnet/blob/${blobId}`,
                };
                updated = true;
            }
        }

        if (updated) {
            await this._addToCache(zotp);
        }
    }

    async deleteZOTP(id: string): Promise<void> {
        const zotps = await this.getAllZOTPs();
        const filtered = zotps.filter((z) => z.id !== id);
        const keys = await this._getCacheKeys();

        await this._persistCache(keys, filtered);
    }

    async searchZOTPs(query: string): Promise<ZOTP[]> {
        const zotps = await this.getAllZOTPs();
        const lowerQuery = query.toLowerCase().trim();

        if (!lowerQuery) return zotps;

        return zotps.filter((z) => {
            const nameMatch = z.name.toLowerCase().includes(lowerQuery);
            const issuerMatch = z.issuer?.toLowerCase().includes(lowerQuery);

            return nameMatch || issuerMatch;
        });
    }

    generateId(): string {
        return `zotp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clear local cache (useful for forcing refresh)
     */
    clearCache(): void {
        this._cache = null;
        this._cacheOwner = null;
        this._zotps$.next(null);
        this._listLoading$.next(false);
    }

    /**
     * Clear cache and force refresh from backend
     */
    async clearCacheAndRefresh(): Promise<ZOTP[]> {
        const keys = await this._getCacheKeys();
        this._cache = null;

        await this._chromeService.removeItem(keys.timestampKey);

        return this.loadZOTPsFromBackend(true);
    }

    /**
     * Save full backend response to localStorage
     * @param zotp - Updated ZOTP object
     * @param responseData - Full response data from backend
     */
    private _extractRetrieveEnvelope(data: any): { metadata?: Record<string, unknown>; publicData?: Record<string, unknown> } {
        if (data?.data?.metadata || data?.data?.publicData) {
            return {
                metadata: data.data.metadata,
                publicData: data.data.publicData,
            };
        }

        return {
            metadata: data?.metadata,
            publicData: data?.publicData,
        };
    }

    private _extractSetupKeyFromRetrieveEnvelope(envelope: {
        metadata?: Record<string, unknown>;
    }): string | null {
        const metadata = envelope.metadata;

        if (!metadata) return null;

        const setupKey = metadata.setupKey;
        if (typeof setupKey === "string" && setupKey.trim()) {
            return setupKey;
        }

        const password = metadata.password;
        if (typeof password === "string" && password.trim()) {
            return password;
        }

        return null;
    }

    private async _saveFullResponseToStorage(zotp: ZOTP, responseData: any): Promise<void> {
        try {
            // Save the full response data to a separate storage key for reference
            const responseKey = `zotp_response_${zotp.id}`;
            await this._chromeService.setItem(responseKey, {
                zotpId: zotp.id,
                zelfKeysId: zotp.zelfKeysId,
                response: responseData,
                savedAt: Date.now(),
            });

            // Update local cache with the ZOTP (which includes all response data)
            await this._addToCache(zotp);
        } catch (error) {
            console.error("Error saving full response to storage:", error);
            // Don't throw - this is supplementary data
        }
    }
}
