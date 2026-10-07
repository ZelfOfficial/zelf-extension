import { ZelfKeysProtection } from "./zelf-keys-protection";

export interface ZOTP {
    id: string;
    name: string;
    secret?: string; // DO NOT STORE - Only kept in memory when decrypted. Use zelfProof to retrieve from backend.
    issuer?: string;
    algorithm?: string; // Default: SHA1
    digits?: number; // Default: 6
    period?: number; // Default: 30 seconds
    createdAt: number;
    updatedAt: number;
    isDecrypted?: boolean; // Whether the code is currently visible
    decryptedSecret?: string; // Temporarily decrypted secret (only in memory, never persisted)
    /** Item-level decrypt protection from publicData.protection (`face` | `face_password`). */
    protection?: ZelfKeysProtection;
    /** Per-item ZelfKey proof from store or GET /proof — required for retrieve (not the wallet session proof). */
    zelfProof?: string;
    zelfKeysId?: string; // ID returned from ZelfKeys API for retrieval
    zelfProofQRCode?: string; // QR code image from backend response (data:image/png;base64,...)
    ipfs?: any; // Full IPFS data from backend response
    walrus?: any; // Full Walrus storage data from backend response
}
