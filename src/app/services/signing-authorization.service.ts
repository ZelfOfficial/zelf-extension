import { Injectable } from "@angular/core";

/**
 * #88: one-shot, per-transaction authorization to sign/broadcast a Send.
 *
 * A Send may only be signed right after a successful face (biometric) step that was started for that
 * exact transaction. The biometric verification interval (`lastVerified` + cached PGP keys) must NOT
 * authorize signing on its own, and neither may any stored session, decrypt token or dev flag.
 *
 * State lives in memory only (never chrome.storage, sessionStorage or localStorage), so a reload,
 * a new popup or another tab always starts without authorization.
 *
 * Flow:
 *   send-confirm  -> requestAuthorization(scope)       (user pressed Verify/Confirm)
 *   biometrics    -> approvePending(scope?)            (only after the face decrypt API succeeded)
 *   send-confirm  -> consume(scope)                    (immediately before signing; single use)
 * Cancel / failure / back / lock -> revoke().
 */
@Injectable({ providedIn: "root" })
export class SigningAuthorizationService {
    /** How long a started face step may take before the request expires. */
    static readonly PENDING_TTL_MS = 5 * 60 * 1000;
    /** How long an approved face step stays valid for signing the same transaction. */
    static readonly GRANT_TTL_MS = 2 * 60 * 1000;

    private _pending: { scope: string; at: number } | null = null;
    private _grant: { scope: string; at: number } | null = null;

    /** Clock seam for tests. */
    now: () => number = () => Date.now();

    /** Builds the scope string that binds an authorization to one transaction. */
    static scopeFor(tx: {
        sender?: { tagName?: string; address?: string } | null;
        receiver?: { address?: string } | null;
        network?: string | null;
        amount?: string | number | null;
        token?: { symbol?: string; address_token?: string; tokenAddress?: string } | null;
        tokenType?: string | null;
    } | null | undefined): string {
        if (!tx) return "";

        const parts = [
            tx.sender?.tagName || "",
            tx.sender?.address || "",
            tx.network || "",
            tx.receiver?.address || "",
            String(tx.amount ?? ""),
            tx.token?.address_token || tx.token?.tokenAddress || tx.token?.symbol || tx.tokenType || "",
        ];

        if (!parts[2] || !parts[3] || !parts[4]) return "";

        return parts.join("|").toLowerCase();
    }

    /** Called when the user starts the face step for a transaction. Clears any earlier grant. */
    requestAuthorization(scope: string): void {
        this._grant = null;
        this._pending = scope ? { scope, at: this.now() } : null;
    }

    /**
     * Called by the biometrics screen only after the face decrypt API call succeeded.
     * Turns the pending request into a short-lived grant. Returns false when nothing was pending.
     */
    approvePending(): boolean {
        const pending = this._pending;

        this._pending = null;

        if (!pending || this.now() - pending.at > SigningAuthorizationService.PENDING_TTL_MS) {
            this._grant = null;

            return false;
        }

        this._grant = { scope: pending.scope, at: this.now() };

        return true;
    }

    /** True when an unexpired grant exists for exactly this transaction. Does not consume it. */
    has(scope: string): boolean {
        const grant = this._grant;

        if (!scope || !grant) return false;

        if (this.now() - grant.at > SigningAuthorizationService.GRANT_TTL_MS) {
            this._grant = null;

            return false;
        }

        return grant.scope === scope;
    }

    /** Single use: returns true at most once per approved face step, and only for the same transaction. */
    consume(scope: string): boolean {
        const ok = this.has(scope);

        this._grant = null;
        this._pending = null;

        return ok;
    }

    /** Cancel, failure, back navigation or vault lock. */
    revoke(): void {
        this._grant = null;
        this._pending = null;
    }
}
