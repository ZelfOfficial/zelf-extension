import { TOTPService } from "./totp.service";

/** RFC 6238 appendix B test secret (20-byte ASCII), base32-encoded. */
const RFC_6238_TEST_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTPService", () => {
    let service: TOTPService;

    beforeEach(() => {
        service = new TOTPService();
    });

    it("throws when base32 secret contains invalid characters", async () => {
        await expectAsync(service.generate("PRUEBA123", 30, 6, "SHA1")).toBeRejected();
    });

    it("generates RFC 6238 SHA-1 / 8-digit codes at T = 59 s (30-second step)", async () => {
        const code = await service.generate(RFC_6238_TEST_SECRET, 30, 8, "SHA1", 59);

        expect(code).toBe("94287082");
    });

    it("generates SHA-256 / 8-digit codes at T = 59 s (30-second step)", async () => {
        const code = await service.generate(RFC_6238_TEST_SECRET, 30, 8, "SHA256", 59);

        expect(code).toBe("32247374");
    });

    it("generates SHA-256 / 8-digit codes at T = 59 s (60-second step)", async () => {
        const code = await service.generate(RFC_6238_TEST_SECRET, 60, 8, "SHA256", 59);

        expect(code).toBe("74875740");
    });
});
