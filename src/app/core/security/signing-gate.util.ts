/**
 * #88 signing rule (Send, Swap, dApp signing), as defined by product:
 *
 * 1. Face + password/PIN wallet: after a face check the seed stays PGP-encrypted locally for the biometric
 *    verification interval (setting, max 10 min). Inside that window signing needs ONLY the password/PIN,
 *    typed for this signature and verified by decrypting the local keys. Never auto-sign. After the window
 *    (or when the local keys are gone) the face is required again, together with the password/PIN.
 * 2. Face-only wallet (no password/PIN): face on EVERY signature, the window is ignored, never auto-sign.
 *    Authorization is the one-time, per-request approval from SigningAuthorizationService.
 *
 * A password/PIN carried over from another screen (vault/session) is only honoured together with a face
 * approval for this exact request (i.e. it was typed right before this request's face step).
 */
export const FACE_ONLY_PASSPHRASE = "NO_PASSWORD_PLACEHOLDER";

/** Upper bound for the verification interval, whatever is stored in settings. */
export const MAX_BIOMETRIC_WINDOW_MINUTES = 10;

export interface SigningGateInput {
    /** Wallet has no password/PIN (publicData.hasPassword === "false"). */
    faceOnly: boolean;
    /** Encrypted seed + private key are present locally (wallet.pgp). */
    hasVaultKeys: boolean;
    /** Biometric verification interval still open (VaultService.biometricsRequired() === false). */
    windowOpen: boolean;
    /** A face step approved for this exact request (SigningAuthorizationService.has(scope)). */
    faceApproved: boolean;
    /** Password/PIN typed on this screen for this signature. */
    typedSecret: string;
    /** Password/PIN carried from the face step (vault). Only honoured when faceApproved. */
    carriedSecret: string;
}

export type SigningGate =
    /** Open the face screen (password wallets: with the typed password/PIN). */
    | { action: "face" }
    /** Ask for the password/PIN; do not decrypt or sign. */
    | { action: "ask-secret" }
    /** Decrypt with this passphrase and sign. consumeApproval: burn the one-time face approval first. */
    | { action: "sign"; passphrase: string; consumeApproval: boolean };

export function resolveSigningGate(input: SigningGateInput): SigningGate {
    const typed = (input.typedSecret || "").trim() ? input.typedSecret : "";
    const carried = (input.carriedSecret || "").trim() && input.carriedSecret !== FACE_ONLY_PASSPHRASE ? input.carriedSecret : "";

    if (input.faceOnly) {
        if (!input.faceApproved || !input.hasVaultKeys) return { action: "face" };

        return { action: "sign", passphrase: FACE_ONLY_PASSPHRASE, consumeApproval: true };
    }

    // Password / PIN wallet, right after this request's own face step.
    if (input.faceApproved && input.hasVaultKeys && (typed || carried)) {
        return { action: "sign", passphrase: typed || carried, consumeApproval: true };
    }

    // Window closed or local keys gone: face again, which itself needs the password/PIN.
    if (!input.hasVaultKeys || !input.windowOpen) return typed ? { action: "face" } : { action: "ask-secret" };

    // Inside the window: password/PIN only, typed now. Never the face, never a carried secret.
    if (!typed) return { action: "ask-secret" };

    return { action: "sign", passphrase: typed, consumeApproval: false };
}

/** Which primary button a screen should show before the user acts. */
export function signingNeedsFace(input: SigningGateInput): boolean {
    if (input.faceOnly) return !input.faceApproved || !input.hasVaultKeys;

    if (input.faceApproved && input.hasVaultKeys && ((input.carriedSecret || "").trim() || (input.typedSecret || "").trim())) return false;

    return !input.hasVaultKeys || !input.windowOpen;
}
