import {
    buildOtpAuthTotpUri,
    OtpAuthTotpParamSource,
    parseOtpAuthTotpUri,
    resolveOtpAuthTotpParams,
} from "./zotp-otpauth.util";

/** RFC 6238 / Key Uri Format example seed. Not a user secret. */
const FAKE_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

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

    it("exports default entries with algorithm, digits, and period and round-trips", () => {
        const uri = buildOtpAuthTotpUri({
            name: "alice@google.com",
            issuer: "Example",
            secret: FAKE_TOTP_SECRET,
        });

        expect(uri).toBe(
            `otpauth://totp/Example:alice%40google.com?secret=${FAKE_TOTP_SECRET}&issuer=Example&algorithm=SHA1&digits=6&period=30`
        );
        expect(parseOtpAuthTotpUri(uri)).toEqual({
            name: "alice@google.com",
            issuer: "Example",
            secret: FAKE_TOTP_SECRET,
            algorithm: "SHA1",
            digits: 6,
            period: 30,
        });
    });

    it("exports SHA256 / 8 digits / 60s entries and round-trips", () => {
        const uri = buildOtpAuthTotpUri({
            name: "Account",
            issuer: "Issuer",
            secret: FAKE_TOTP_SECRET,
            sources: [{ algorithm: "SHA256", digits: 8, period: 60 }],
        });

        expect(uri).toBe(
            `otpauth://totp/Issuer:Account?secret=${FAKE_TOTP_SECRET}&issuer=Issuer&algorithm=SHA256&digits=8&period=60`
        );
        expect(parseOtpAuthTotpUri(uri)).toEqual({
            name: "Account",
            issuer: "Issuer",
            secret: FAKE_TOTP_SECRET,
            algorithm: "SHA256",
            digits: 8,
            period: 60,
        });
    });

    it("uses decrypted parameters instead of later placeholder defaults", () => {
        const params = resolveOtpAuthTotpParams([
            { algorithm: "sha256", digits: "8", period: "60" },
            { algorithm: "SHA1", digits: 6, period: 30 },
        ]);

        expect(params).toEqual({ algorithm: "SHA256", digits: 8, period: 60 });

        const uri = buildOtpAuthTotpUri({
            name: "Account",
            issuer: "Issuer",
            secret: FAKE_TOTP_SECRET,
            sources: [params],
        });

        expect(parseOtpAuthTotpUri(uri)).toEqual({
            name: "Account",
            issuer: "Issuer",
            secret: FAKE_TOTP_SECRET,
            algorithm: "SHA256",
            digits: 8,
            period: 60,
        });
    });

    it("keeps stored entry parameters when decrypt metadata omits them", () => {
        const decryptedWithoutParams: OtpAuthTotpParamSource = {};
        const params = resolveOtpAuthTotpParams([
            decryptedWithoutParams,
            { algorithm: "SHA512", digits: 8, period: 45 },
        ]);

        expect(params).toEqual({ algorithm: "SHA512", digits: 8, period: 45 });
    });

    it("defaults only fields that no source provides", () => {
        expect(resolveOtpAuthTotpParams([{}, null, undefined])).toEqual({
            algorithm: "SHA1",
            digits: 6,
            period: 30,
        });
    });
});
