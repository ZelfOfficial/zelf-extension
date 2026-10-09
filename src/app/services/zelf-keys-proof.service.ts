import { Injectable } from "@angular/core";
import { TranslocoService } from "@jsverse/transloco";

import { ZelfKeysData, ZelfKeysDataService } from "./zelf-keys-data.service";
import { ZelfKeysService } from "./zelf-keys.service";

export const ERR_ZELFKEY_PROOF_UNAVAILABLE = "ERR_ZELFKEY_PROOF_UNAVAILABLE";

/** User-facing copy when GET /proof fails or returns no zelfProof. */
export function extractZelfKeyProofErrorMessage(error: unknown, transloco: TranslocoService): string {
    const err = error as { message?: string };
    if (err?.message === ERR_ZELFKEY_PROOF_UNAVAILABLE) {
        return transloco.translate("zelf_keys.common.proof_load_failed");
    }

    return transloco.translate("zelf_keys.common.proof_load_failed");
}

export type ZelfKeysCacheCategory = "passwords" | "notes" | "paymentCards";

export interface ZelfKeyProofPayload {
    id?: string;
    cid?: string;
    zelfProof?: string;
    zelfProofQRCode?: string;
}

/** Resolve the pin/ipfs id used by GET /api/zelf-keys/proof?id=… */
export function getZelfKeyItemProofId(item: {
    id?: string;
    cid?: string;
    zelfKeysId?: string;
    ipfs?: { id?: string; cid?: string };
}): string | null {
    return item.ipfs?.id || item.zelfKeysId || item.id || item.ipfs?.cid || item.cid || null;
}

export function parseZelfKeyProofResponse(response: unknown): ZelfKeyProofPayload {
    const wrapped = response as { data?: ZelfKeyProofPayload | { data?: ZelfKeyProofPayload } };
    const payload = wrapped?.data;

    if (payload && typeof payload === "object" && "data" in payload) {
        return (payload as { data?: ZelfKeyProofPayload }).data || {};
    }

    return (payload as ZelfKeyProofPayload) || (response as ZelfKeyProofPayload) || {};
}

@Injectable({
    providedIn: "root",
})
export class ZelfKeysProofService {
    constructor(
        private _zelfKeysDataService: ZelfKeysDataService,
        private _zelfKeysService: ZelfKeysService
    ) {}

    /**
     * Lazy-load the per-item ZelfKey proof when list rows omit zelfProof.
     * Never substitutes the wallet session proof.
     */
    async ensureProof<T extends Record<string, any>>(
        item: T,
        options?: { keysCategory?: ZelfKeysCacheCategory }
    ): Promise<T> {
        const existingProof = item["zelfProof"] || item["publicData"]?.zelfProof;
        if (typeof existingProof === "string" && existingProof.trim()) {
            if (!item["zelfProof"]) {
                return this._mergeProof(item, existingProof, item["zelfProofQRCode"]);
            }

            return item;
        }

        const proofId = getZelfKeyItemProofId(item);
        if (!proofId) {
            throw new Error(ERR_ZELFKEY_PROOF_UNAVAILABLE);
        }

        const response = await this._zelfKeysService.getProof(proofId);
        const proofData = parseZelfKeyProofResponse(response);

        if (!proofData.zelfProof?.trim()) {
            throw new Error(ERR_ZELFKEY_PROOF_UNAVAILABLE);
        }

        const hydrated = this._mergeProof(item, proofData.zelfProof, proofData.zelfProofQRCode);

        if (options?.keysCategory) {
            this._zelfKeysDataService.patchCachedItem(options.keysCategory, proofId, {
                zelfProof: proofData.zelfProof,
                zelfProofQRCode: proofData.zelfProofQRCode,
            });
        }

        return hydrated;
    }

    private _mergeProof<T extends Record<string, any>>(item: T, zelfProof: string, zelfProofQRCode?: string): T {
        return {
            ...item,
            zelfProof,
            ...(zelfProofQRCode ? { zelfProofQRCode } : {}),
            ...(item["publicData"]
                ? {
                      publicData: {
                          ...item["publicData"],
                          zelfProof,
                      },
                  }
                : {}),
        };
    }
}
