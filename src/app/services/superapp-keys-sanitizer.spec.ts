import { sanitizeSuperappPassword } from "@shared/utils/superapp-keys";

describe("sanitizeSuperappPassword", () => {
    it("returns only public metadata", () => {
        const result = sanitizeSuperappPassword({
            id: "ipfs-id",
            cid: "cid",
            zelfProof: "encrypted-proof",
            zelfProofQRCode: "data:image/png;base64,secret",
            publicData: {
                alias: "Work",
                website: "https://example.com",
                username: "person@example.com",
                folder: "Team",
                timestamp: "2026-09-15T00:00:00.000Z",
                password: "must-not-cross",
            },
            metadata: { password: "must-not-cross" },
        });

        expect(result).toEqual({
            id: "ipfs-id",
            alias: "Work",
            website: "https://example.com",
            username: "person@example.com",
            folder: "Team",
            createdAt: "2026-09-15T00:00:00.000Z",
            updatedAt: null,
        });
        expect(JSON.stringify(result)).not.toContain("zelfProof");
        expect(JSON.stringify(result)).not.toContain("must-not-cross");
    });

    it("drops records without an opaque id", () => {
        expect(sanitizeSuperappPassword({ publicData: { website: "https://example.com" } })).toBeNull();
    });
});
