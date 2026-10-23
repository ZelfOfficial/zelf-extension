import { scrollDeltaToRevealAboveBar, snackbarMarginBottom, topmostObstacle } from "./add-zotp-layout.util";

describe("add-zotp layout", () => {
    it("scrolls by hint.bottom - bar.top + gap when the hint is under the bar", () => {
        // QA: hint bottom ~460, bar top ~390.
        expect(scrollDeltaToRevealAboveBar(460, 390)).toBe(78);
        expect(scrollDeltaToRevealAboveBar(390, 400)).toBe(0);
    });

    it("places the snackbar above whichever of the bar or footer is higher", () => {
        expect(topmostObstacle([460, 518], 600)).toBe(460);
        expect(topmostObstacle([530, 518], 600)).toBe(518);
        expect(snackbarMarginBottom(600, 390)).toBe(218);
    });
});