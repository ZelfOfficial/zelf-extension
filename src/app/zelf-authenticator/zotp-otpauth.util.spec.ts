import { parseOtpAuthTotpUri } from "./zotp-otpauth.util";

describe("zotp-otpauth.util", () => {
    it("parses default otpauth parameters", () => {
        const parsed = parseOtpAuthTotpUri(
            "otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example"
        );

        expect(parsed).toEqual({
            name: "alice@google.com",
            issuer: "Example",
            secret: "JBSWY3DPEHPK3PXP",
            algorithm: undefined,
            digits: undefined,
            period: undefined,
        });
    });

    it("parses non-default algorithm, digits, and period", () => {
        const parsed = parseOtpAuthTotpUri(
            "otpauth://totp/Issuer:Account?secret=JBSWY3DPEHPK3PXP&issuer=Issuer&algorithm=SHA256&digits=8&period=60"
        );

        expect(parsed).toEqual({
            name: "Account",
            issuer: "Issuer",
            secret: "JBSWY3DPEHPK3PXP",
            algorithm: "SHA256",
            digits: 8,
            period: 60,
        });
    });

    it("returns null for invalid URIs", () => {
        expect(parseOtpAuthTotpUri("https://example.com")).toBeNull();
        expect(parseOtpAuthTotpUri("otpauth://hotp/Test?secret=ABC")).toBeNull();
    });
});
