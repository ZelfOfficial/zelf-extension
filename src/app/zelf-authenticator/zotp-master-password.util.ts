import { HttpWrapperService } from "app/http-wrapper.service";

/** Normalize wallet master password the same way on store and retrieve. */
export function normalizeWalletMasterPassword(plain?: string | null): string {
    return plain?.trim() || "";
}

/** PGP-encrypt wallet master password for ZelfKeys transport (store / retrieve / delete). */
export async function encryptWalletMasterPassword(
    http: HttpWrapperService,
    plain?: string | null
): Promise<string | undefined> {
    const normalized = normalizeWalletMasterPassword(plain);
    if (!normalized) return undefined;

    const encrypted = await http.encryptMessage(normalized);
    return typeof encrypted === "string" ? encrypted : String(encrypted ?? "");
}
