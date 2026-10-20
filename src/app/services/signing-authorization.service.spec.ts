import { SigningAuthorizationService } from "./signing-authorization.service";

describe("SigningAuthorizationService (#88)", () => {
    const tx = {
        sender: { tagName: "qa", address: "0xSender" },
        receiver: { address: "0xReceiver" },
        network: "ethereum",
        amount: "0.01",
        token: { symbol: "ETH" },
    };
    let svc: SigningAuthorizationService;
    let t: number;

    beforeEach(() => {
        svc = new SigningAuthorizationService();
        t = 1_000_000;
        svc.now = () => t;
    });

    it("has no authorization by default", () => {
        const scope = SigningAuthorizationService.scopeFor(tx);
        expect(scope).not.toBe("");
        expect(svc.has(scope)).toBeFalse();
        expect(svc.consume(scope)).toBeFalse();
    });

    it("approve without a pending request grants nothing", () => {
        expect(svc.approvePending()).toBeFalse();
        expect(svc.has(SigningAuthorizationService.scopeFor(tx))).toBeFalse();
    });

    it("grants only after request + approve, and only once", () => {
        const scope = SigningAuthorizationService.scopeFor(tx);
        svc.requestAuthorization(scope);
        expect(svc.has(scope)).toBeFalse();
        expect(svc.approvePending()).toBeTrue();
        expect(svc.has(scope)).toBeTrue();
        expect(svc.consume(scope)).toBeTrue();
        expect(svc.consume(scope)).toBeFalse();
        expect(svc.has(scope)).toBeFalse();
    });

    it("is bound to the exact transaction", () => {
        const scope = SigningAuthorizationService.scopeFor(tx);
        svc.requestAuthorization(scope);
        svc.approvePending();
        const other = SigningAuthorizationService.scopeFor({ ...tx, amount: "5" });
        const otherReceiver = SigningAuthorizationService.scopeFor({ ...tx, receiver: { address: "0xAttacker" } });
        const otherNetwork = SigningAuthorizationService.scopeFor({ ...tx, network: "binance" });
        expect(svc.has(other)).toBeFalse();
        expect(svc.has(otherReceiver)).toBeFalse();
        expect(svc.has(otherNetwork)).toBeFalse();
        // a failed consume for another tx also burns the grant
        expect(svc.consume(other)).toBeFalse();
        expect(svc.has(scope)).toBeFalse();
    });

    it("expires the pending request and the grant", () => {
        const scope = SigningAuthorizationService.scopeFor(tx);
        svc.requestAuthorization(scope);
        t += SigningAuthorizationService.PENDING_TTL_MS + 1;
        expect(svc.approvePending()).toBeFalse();
        expect(svc.has(scope)).toBeFalse();

        svc.requestAuthorization(scope);
        svc.approvePending();
        t += SigningAuthorizationService.GRANT_TTL_MS + 1;
        expect(svc.consume(scope)).toBeFalse();
    });

    it("revoke (cancel / failure / lock) clears pending and granted state", () => {
        const scope = SigningAuthorizationService.scopeFor(tx);
        svc.requestAuthorization(scope);
        svc.revoke();
        expect(svc.approvePending()).toBeFalse();

        svc.requestAuthorization(scope);
        svc.approvePending();
        svc.revoke();
        expect(svc.consume(scope)).toBeFalse();
    });

    it("a new request clears an older grant", () => {
        const scope = SigningAuthorizationService.scopeFor(tx);
        svc.requestAuthorization(scope);
        svc.approvePending();
        svc.requestAuthorization(scope);
        expect(svc.has(scope)).toBeFalse();
    });

    it("never persists anything to web storage", () => {
        const before = { local: localStorage.length, session: sessionStorage.length };
        const scope = SigningAuthorizationService.scopeFor(tx);
        svc.requestAuthorization(scope);
        svc.approvePending();
        expect(localStorage.length).toBe(before.local);
        expect(sessionStorage.length).toBe(before.session);
    });

    it("returns an empty scope for incomplete transactions (never authorizable)", () => {
        expect(SigningAuthorizationService.scopeFor(null)).toBe("");
        expect(SigningAuthorizationService.scopeFor({ ...tx, receiver: { address: "" } })).toBe("");
        svc.requestAuthorization("");
        svc.approvePending();
        expect(svc.has("")).toBeFalse();
    });
});
