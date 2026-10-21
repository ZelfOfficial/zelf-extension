import {
    findInvalidSetupKeyCharacters,
    formatInvalidSetupKeyCharactersList,
    getSetupKeyValidationState,
    sanitizeSetupKey,
    setupKeyValidator,
} from "./zotp-setup-key.util";

describe("zotp-setup-key.util", () => {
    it("sanitizes setup keys to uppercase base32 without spaces, dashes, or padding", () => {
        expect(sanitizeSetupKey("jbsw y3dp-ehpk 3pxp====")).toBe("JBSWY3DPEHPK3PXP");
    });

    it("detects invalid characters from raw input", () => {
        expect(findInvalidSetupKeyCharacters("PRUEBA123")).toEqual(["1"]);
        expect(findInvalidSetupKeyCharacters("PRUEBA1.")).toEqual(["1", "."]);
    });

    it("formats invalid character lists for copy", () => {
        expect(formatInvalidSetupKeyCharactersList(["1", "."])).toBe('"1", "."');
    });

    it("marks keys shorter than 16 characters as too short when otherwise valid", () => {
        const state = getSetupKeyValidationState("PRUEBA");

        expect(state.tooShort).toBe(true);
        expect(state.valid).toBe(false);
        expect(state.sanitized.length).toBe(6);
    });

    it("accepts valid manual-entry keys", () => {
        const state = getSetupKeyValidationState("JBSWY3DPEHPK3PXP");

        expect(state.valid).toBe(true);
        expect(state.invalidChars).toEqual([]);
        expect(state.tooShort).toBe(false);
    });

    it("setupKeyValidator rejects invalid and short keys", () => {
        const validator = setupKeyValidator();

        expect(validator({ value: "PRUEBA123" } as any)).toEqual({ invalidChars: ["1"] });
        expect(validator({ value: "PRUEBA" } as any)).toEqual({ tooShort: { length: 6 } });
        expect(validator({ value: "JBSWY3DPEHPK3PXP" } as any)).toBeNull();
    });
});
