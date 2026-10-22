import {
    applyTotpParamsToZotp,
    buildZotpStoreRequestBody,
    parseTotpParamsFromRetrieveSources,
    shouldRevealZotpTotpParams,
    zotpHasTotpParamsInPublicData,
} from "./zotp-totp-params.util";
import { ZOTP } from "app/models/zotp.model";

describe("zotp-totp-params.util", () => {
    it("buildZotpStoreRequestBody sends TOTP fields at the top level as strings for digits/period", () => {
        const body = buildZotpStoreRequestBody(
            {
                name: "Work",
                secret: "JBSWY3DPEHPK3PXP",
                issuer: "GitHub",
                algorithm: "SHA256",
                digits: 8,
                period: 60,
            },
            "face-data",
            "enc-password",
            "face_password"
        );

        expect(body).toEqual({
            username: "Work",
            setupKey: "JBSWY3DPEHPK3PXP",
            issuer: "GitHub",
            folder: "ZOTP",
            insideFolder: false,
            faceBase64: "face-data",
            algorithm: "SHA256",
            digits: "8",
            period: "60",
            masterPassword: "enc-password",
            protection: "face_password",
        });
        expect("publicData" in body).toBeFalse();
    });

    it("defaults missing TOTP fields to SHA1 / 6 / 30 on store", () => {
        const body = buildZotpStoreRequestBody(
            {
                name: "Legacy",
                secret: "JBSWY3DPEHPK3PXP",
            },
            "face"
        );

        expect(body.algorithm).toBe("SHA1");
        expect(body.digits).toBe("6");
        expect(body.period).toBe("30");
    });

    it("parseTotpParamsFromRetrieveSources prefers metadata over publicData", () => {
        expect(
            parseTotpParamsFromRetrieveSources(
                { algorithm: "SHA512", digits: "7", period: "45" },
                { algorithm: "SHA1", digits: 6, period: 30 }
            )
        ).toEqual({ algorithm: "SHA512", digits: 7, period: 45 });
    });

    it("zotpHasTotpParamsInPublicData is false when TOTP fields are only on the model (e.g. list defaults)", () => {
        const zotp: ZOTP = {
            id: "z1",
            name: "Work",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
            createdAt: 1,
            updatedAt: 1,
            ipfs: { publicData: { type: "zotp", username: "Work" } },
        };

        expect(zotpHasTotpParamsInPublicData(zotp.ipfs?.publicData)).toBeFalse();
        expect(shouldRevealZotpTotpParams(zotp, false)).toBeFalse();
        expect(shouldRevealZotpTotpParams(zotp, true)).toBeTrue();
    });

    it("shouldRevealZotpTotpParams is true before decrypt when publicData includes TOTP params", () => {
        const zotp: ZOTP = {
            id: "z2",
            name: "Legacy",
            createdAt: 1,
            updatedAt: 1,
            ipfs: { publicData: { type: "zotp", algorithm: "SHA256", digits: 8, period: 60 } },
        };

        expect(shouldRevealZotpTotpParams(zotp, false)).toBeTrue();
    });

    it("applyTotpParamsToZotp merges retrieve params onto the model", () => {
        const updated = applyTotpParamsToZotp(
            { id: "z1", name: "A", createdAt: 1, updatedAt: 1, ipfs: { publicData: { type: "zotp" } } },
            { algorithm: "SHA256", digits: "8", period: "60" },
            { type: "zotp", issuer: "GitHub" }
        );

        expect(updated.algorithm).toBe("SHA256");
        expect(updated.digits).toBe(8);
        expect(updated.period).toBe(60);
        expect(updated.ipfs?.publicData?.algorithm).toBe("SHA256");
    });
});
