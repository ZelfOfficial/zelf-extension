import { FACE_ONLY_PASSPHRASE, SigningGateInput, resolveSigningGate, signingNeedsFace } from "./signing-gate.util";

describe("signing gate rule (#88)", () => {
    const base: SigningGateInput = { faceOnly: false, hasVaultKeys: true, windowOpen: true, faceApproved: false, typedSecret: "", carriedSecret: "" };
    const gate = (o: Partial<SigningGateInput>) => resolveSigningGate({ ...base, ...o });

    describe("face + password/PIN wallet", () => {
        it("in window: asks for the password, never the face", () => {
            expect(gate({})).toEqual({ action: "ask-secret" });
            expect(signingNeedsFace(base)).toBeFalse();
        });

        it("in window: signs with the typed password only, without consuming a face approval", () => {
            expect(gate({ typedSecret: "pw" })).toEqual({ action: "sign", passphrase: "pw", consumeApproval: false });
        });

        it("in window: a carried (session/vault) password alone is NOT enough", () => {
            expect(gate({ carriedSecret: "pw" })).toEqual({ action: "ask-secret" });
        });

        it("after the window: face (with the typed password), or ask for the password first", () => {
            expect(gate({ windowOpen: false, typedSecret: "pw" })).toEqual({ action: "face" });
            expect(gate({ windowOpen: false })).toEqual({ action: "ask-secret" });
            expect(signingNeedsFace({ ...base, windowOpen: false })).toBeTrue();
        });

        it("local keys gone: face, even inside the window", () => {
            expect(gate({ hasVaultKeys: false, typedSecret: "pw" })).toEqual({ action: "face" });
        });

        it("right after this request's face step: signs with the password typed before it (one-time)", () => {
            expect(gate({ windowOpen: true, faceApproved: true, carriedSecret: "pw" })).toEqual({ action: "sign", passphrase: "pw", consumeApproval: true });
        });
    });

    describe("face-only wallet", () => {
        const fo = { faceOnly: true };

        it("always needs the face, even inside the window", () => {
            expect(gate({ ...fo })).toEqual({ action: "face" });
            expect(gate({ ...fo, typedSecret: "x", carriedSecret: FACE_ONLY_PASSPHRASE })).toEqual({ action: "face" });
            expect(signingNeedsFace({ ...base, ...fo })).toBeTrue();
        });

        it("signs only with a face approval for this request, consuming it", () => {
            expect(gate({ ...fo, faceApproved: true })).toEqual({ action: "sign", passphrase: FACE_ONLY_PASSPHRASE, consumeApproval: true });
            expect(gate({ ...fo, faceApproved: true, hasVaultKeys: false })).toEqual({ action: "face" });
        });
    });
});
