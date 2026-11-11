import {
    PASSWORD_SHARE_MAX_PLAINTEXT_BYTES,
    PASSWORD_SHARE_REJECTED_BODY_FIELDS,
    assertPasswordShareRequestBody,
    base64ToBytes,
    base64UrlToBytes,
    buildPasswordShareLink,
    buildPasswordSharePayload,
    buildPasswordShareUpload,
    decryptPasswordShare,
    encryptPasswordShare,
} from "./password-share-crypto";

describe("password share crypto", () => {
    const payload = {
        v: 1 as const,
        title: "Example Mail",
        username: "demo.user@example.com",
        password: "synthetic-password",
        url: "https://example.com",
        notes: "Synthetic QA note",
    };

    it("round-trips encrypt and decrypt", async () => {
        const encrypted = await encryptPasswordShare(payload);
        const decrypted = await decryptPasswordShare({
            ciphertext: encrypted.uploadWithoutKey.ciphertext,
            iv: encrypted.uploadWithoutKey.iv,
            keyFragment: encrypted.keyFragment,
        });

        expect(decrypted).toEqual(payload);
    });

    it("omits empty optional fields from the JSON payload", () => {
        expect(buildPasswordSharePayload({ title: " Example ", password: " keep spaces ", username: "  ", url: "", notes: "  " })).toEqual({
            v: 1,
            title: "Example",
            password: " keep spaces ",
        });
    });

    it("keeps the raw key out of the upload and puts base64url in the link fragment", async () => {
        const encrypted = await encryptPasswordShare({ v: 1, title: "Example Mail", password: "synthetic-password" });
        const upload = buildPasswordShareUpload({
            ciphertext: encrypted.uploadWithoutKey.ciphertext,
            iv: encrypted.uploadWithoutKey.iv,
            expiresIn: 604800,
            maxViews: 1,
            label: "  ",
        });

        expect(upload).toEqual({
            ciphertext: encrypted.uploadWithoutKey.ciphertext,
            iv: encrypted.uploadWithoutKey.iv,
            version: 1,
            expiresIn: 604800,
            maxViews: 1,
        });
        expect(JSON.stringify(upload)).not.toContain(encrypted.keyFragment);
        expect(JSON.stringify(upload)).not.toContain("synthetic-password");

        const iv = base64ToBytes(upload.iv);
        const key = base64UrlToBytes(encrypted.keyFragment);
        expect(iv.length).toBe(12);
        expect(key.length).toBe(32);
        expect(encrypted.uploadWithoutKey.iv).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(encrypted.uploadWithoutKey.ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(encrypted.keyFragment).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(encrypted.keyFragment).not.toMatch(/[=+/]/);

        for (const field of PASSWORD_SHARE_REJECTED_BODY_FIELDS) {
            expect(Object.prototype.hasOwnProperty.call(upload, field)).toBeFalse();
        }
        expect(Object.keys(upload).sort()).toEqual(["ciphertext", "expiresIn", "iv", "maxViews", "version"]);

        const link = buildPasswordShareLink("https://zelf.world/", "share id", encrypted.keyFragment);
        const url = new URL(link);

        expect(link).toBe(`https://zelf.world/share/share%20id#${encrypted.keyFragment}`);
        expect(url.search).toBe("");
        expect(url.hash).toBe(`#${encrypted.keyFragment}`);
        expect(url.origin).toBe("https://zelf.world");
    });

    it("rejects a tampered ciphertext and a wrong key", async () => {
        const encrypted = await encryptPasswordShare(payload);
        const cipherBytes = base64ToBytes(encrypted.uploadWithoutKey.ciphertext);
        cipherBytes[0] ^= 0xff;
        const tampered = btoa(String.fromCharCode(...cipherBytes));

        await expectAsync(
            decryptPasswordShare({
                ciphertext: tampered,
                iv: encrypted.uploadWithoutKey.iv,
                keyFragment: encrypted.keyFragment,
            })
        ).toBeRejectedWithError("PASSWORD_SHARE_DECRYPT_FAILED");

        const other = await encryptPasswordShare(payload);
        await expectAsync(
            decryptPasswordShare({
                ciphertext: encrypted.uploadWithoutKey.ciphertext,
                iv: encrypted.uploadWithoutKey.iv,
                keyFragment: other.keyFragment,
            })
        ).toBeRejectedWithError("PASSWORD_SHARE_DECRYPT_FAILED");
    });

    it("rejects a label the API would refuse and any top-level secret field", () => {
        expect(() =>
            buildPasswordShareUpload({
                ciphertext: "YQ==",
                iv: "AAAAAAAAAAAAAAAA",
                expiresIn: 3600,
                maxViews: 1,
                label: "x".repeat(61),
            })
        ).toThrowError("INVALID_LABEL");

        expect(() =>
            buildPasswordShareUpload({
                ciphertext: "YQ==",
                iv: "AAAAAAAAAAAAAAAA",
                expiresIn: 3600,
                maxViews: 1,
                label: "line\nbreak",
            })
        ).toThrowError("INVALID_LABEL");

        expect(() =>
            assertPasswordShareRequestBody({
                ciphertext: "YQ==",
                iv: "AAAAAAAAAAAAAAAA",
                version: 1,
                expiresIn: 3600,
                maxViews: 1,
                password: "synthetic-password",
            } as never)
        ).toThrowError("SHARE_KEY_NOT_ACCEPTED");
    });

    it("keeps ciphertext within 16384 decoded bytes and rejects one byte more", async () => {
        let notes = "n".repeat(PASSWORD_SHARE_MAX_PLAINTEXT_BYTES);
        let payload = { v: 1 as const, title: "", password: "x", notes };

        while (new TextEncoder().encode(JSON.stringify(payload)).byteLength > PASSWORD_SHARE_MAX_PLAINTEXT_BYTES) {
            notes = notes.slice(0, -1);
            payload = { v: 1, title: "", password: "x", notes };
        }

        const encrypted = await encryptPasswordShare(payload);
        const decoded = base64ToBytes(encrypted.uploadWithoutKey.ciphertext);

        expect(decoded.length).toBeLessThanOrEqual(16 * 1024);
        expect(decoded.length).toBe(new TextEncoder().encode(JSON.stringify(payload)).byteLength + 16);

        await expectAsync(encryptPasswordShare({ ...payload, notes: `${notes}n` })).toBeRejectedWithError("SHARE_TOO_LARGE");
    });
});
