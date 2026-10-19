import { formatDisplayAmount, formatDisplayFiat } from "./display-number.util";

describe("display-number.util (max 4 decimals, display only)", () => {
    describe("formatDisplayAmount", () => {
        it("rounds token amounts to at most 4 decimals (qa.zelf examples)", () => {
            expect(formatDisplayAmount("0.000292177900390457")).toBe("0.0003");
            expect(formatDisplayAmount("3.049447617627728757")).toBe("3.0494");
            expect(formatDisplayAmount(4.00011)).toBe("4.0001");
            expect(formatDisplayAmount("1652.90001")).toBe("1,652.9");
            expect(formatDisplayAmount("13.96013650959956")).toBe("13.9601");
            expect(formatDisplayAmount(0.888431365)).toBe("0.8884");
        });

        it("shows exact 0 as 0 and dust as <0.0001 so it never looks like 0", () => {
            expect(formatDisplayAmount(0)).toBe("0");
            expect(formatDisplayAmount("0.0")).toBe("0");
            expect(formatDisplayAmount(0.00009)).toBe("<0.0001");
            expect(formatDisplayAmount("1e-12")).toBe("<0.0001");
            expect(formatDisplayAmount(-0.00001)).toBe("-<0.0001");
            expect(formatDisplayAmount(0.0001)).toBe("0.0001");
        });

        it("supports a minimum of decimals and floor rounding (available-to-send never overstates)", () => {
            expect(formatDisplayAmount(5, { minDecimals: 2 })).toBe("5.00");
            expect(formatDisplayAmount("0.00029217", { rounding: "floor" })).toBe("0.0002");
            expect(formatDisplayAmount("0.3", { rounding: "floor" })).toBe("0.3");
            expect(formatDisplayAmount("1.99999", { rounding: "floor" })).toBe("1.9999");
        });

        it("handles big numbers, commas and invalid input", () => {
            expect(formatDisplayAmount("114326118773.788055419922")).toBe("114,326,118,773.7881");
            expect(formatDisplayAmount("1,234.56789")).toBe("1,234.5679");
            expect(formatDisplayAmount(null)).toBe("");
            expect(formatDisplayAmount(undefined)).toBe("");
            expect(formatDisplayAmount("abc")).toBe("");
            expect(formatDisplayAmount(NaN)).toBe("");
        });
    });

    describe("formatDisplayFiat", () => {
        it("shows USD with 2 to 4 decimals (qa.zelf examples)", () => {
            expect(formatDisplayFiat(2.97682)).toBe("$2.9768");
            expect(formatDisplayFiat(0.7008500514455931)).toBe("$0.7009");
            expect(formatDisplayFiat(0.0933)).toBe("$0.0933");
            expect(formatDisplayFiat(1.3446553446553449)).toBe("$1.3447");
            expect(formatDisplayFiat(25126.50224)).toBe("$25,126.5022");
            expect(formatDisplayFiat(81914.76)).toBe("$81,914.76");
            expect(formatDisplayFiat(0.092)).toBe("$0.092");
        });

        it("keeps $0.00 for zero and shows <$0.0001 for non-zero dust", () => {
            expect(formatDisplayFiat(0)).toBe("$0.00");
            expect(formatDisplayFiat(0.0002339718879008886)).toBe("$0.0002");
            expect(formatDisplayFiat(0.00001676)).toBe("<$0.0001");
            expect(formatDisplayFiat("0.00000493")).toBe("<$0.0001");
        });

        it("returns empty string for missing values", () => {
            expect(formatDisplayFiat(null)).toBe("");
            expect(formatDisplayFiat("")).toBe("");
        });
    });
});
