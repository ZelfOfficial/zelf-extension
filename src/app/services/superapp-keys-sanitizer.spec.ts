import { sanitizeSuperappCard, sanitizeSuperappPassword } from "@shared/utils/superapp-keys";

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

describe("sanitizeSuperappCard", () => {
    it("returns only masked card metadata", () => {
        const result = sanitizeSuperappCard({
            id: "card-id",
            zelfProof: "encrypted-proof",
            publicData: {
                alias: "Travel",
                folder: "Finance",
                timestamp: "2026-09-15T00:00:00.000Z",
                card: JSON.stringify({
                    bankName: "Chase",
                    expires: "12/30",
                    name: "Miguel Trevino",
                    number: "****-****-****-1111",
                }),
                cardNumber: "4111111111111111",
                cvv: "123",
            },
        });

        expect(result).toEqual({
            id: "card-id",
            alias: "Travel",
            cardName: "Miguel Trevino",
            bankName: "Chase",
            lastFour: "1111",
            expires: "12/30",
            folder: "Finance",
            createdAt: "2026-09-15T00:00:00.000Z",
            updatedAt: null,
        });
        expect(JSON.stringify(result)).not.toContain("zelfProof");
        expect(JSON.stringify(result)).not.toContain("4111111111111111");
        expect(JSON.stringify(result)).not.toContain("123");
    });
});
