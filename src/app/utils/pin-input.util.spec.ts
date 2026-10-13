import { spreadPinInput } from "./pin-input.util";

describe("spreadPinInput", () => {
    const empty = () => ["", "", "", "", "", ""];

    it("stores a single typed character and moves to the next box", () => {
        const d = empty();
        expect(spreadPinInput(d, 0, "a")).toBe(1);
        expect(d).toEqual(["a", "", "", "", "", ""]);
    });

    it("keeps both characters when a fast second keystroke lands in the same box", () => {
        const d = ["1", "", "", "", "", ""];
        expect(spreadPinInput(d, 0, "12")).toBe(2);
        expect(d).toEqual(["1", "2", "", "", "", ""]);
    });

    it("spreads a full pasted PIN from the first box", () => {
        const d = ["x", "", "", "", "", ""];
        expect(spreadPinInput(d, 3, "ab12cd")).toBe(5);
        expect(d).toEqual(["a", "b", "1", "2", "c", "d"]);
    });

    it("clears the box on delete", () => {
        const d = ["1", "2", "", "", "", ""];
        expect(spreadPinInput(d, 1, "")).toBeNull();
        expect(d).toEqual(["1", "", "", "", "", ""]);
    });

    it("replaces a selected character when typing over it", () => {
        const d = ["1", "2", "3", "", "", ""];
        expect(spreadPinInput(d, 1, "9")).toBe(2);
        expect(d).toEqual(["1", "9", "3", "", "", ""]);
    });
});
