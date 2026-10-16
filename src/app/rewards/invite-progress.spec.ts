import { inviteProgress } from "./rewards.component";

describe("inviteProgress (#45)", () => {
    it("clamps 11/10 to 10/10 with 1 extra and a full bar", () => {
        expect(inviteProgress(11, 10)).toEqual({ counted: 10, extra: 1, percent: 100 });
    });
    it("keeps partial progress", () => {
        expect(inviteProgress(3, 10)).toEqual({ counted: 3, extra: 0, percent: 30 });
    });
    it("uses the server limit", () => {
        expect(inviteProgress(7, 5)).toEqual({ counted: 5, extra: 2, percent: 100 });
    });
    it("falls back to 10 for a bad limit", () => {
        expect(inviteProgress(4, 0).percent).toBe(40);
    });
});
