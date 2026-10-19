import { DisplayAmountPipe, DisplayFiatPipe } from "./display-number.pipe";

describe("DisplayAmountPipe / DisplayFiatPipe", () => {
    it("formats amounts with at most 4 decimals", () => {
        const pipe = new DisplayAmountPipe();
        expect(pipe.transform("0.000292177900390457")).toBe("0.0003");
        expect(pipe.transform(0.00001)).toBe("<0.0001");
        expect(pipe.transform("0.00029217", 0, "floor")).toBe("0.0002");
        expect(pipe.transform(2, 2)).toBe("2.00");
    });

    it("formats USD with 2 to 4 decimals", () => {
        const pipe = new DisplayFiatPipe();
        expect(pipe.transform(2.97682)).toBe("$2.9768");
        expect(pipe.transform(0)).toBe("$0.00");
        expect(pipe.transform(0.00001)).toBe("<$0.0001");
    });
});
