/** Same cadence as Android `WalletHomePromoCarousel` (`AUTO_ADVANCE_MS`). */
export const PROMO_AUTO_ADVANCE_MS = 5_000;

/** Next slide, wrapping to the first. A single slide stays put. */
export function nextPromoIndex(current: number, length: number): number {
    if (length <= 1) return 0;
    const index = Number.isFinite(current) ? Math.floor(current) : 0;
    return (index + 1) % length;
}
