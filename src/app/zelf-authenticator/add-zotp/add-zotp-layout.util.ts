/** How far to scroll so the hint bottom sits `gap` px above the sticky bar top. */
export function scrollDeltaToRevealAboveBar(hintBottom: number, barTop: number, gap = 8): number {
    if (!Number.isFinite(hintBottom) || !Number.isFinite(barTop)) return 0;

    return Math.max(0, hintBottom - barTop + gap);
}

/** Highest on-screen edge the toast must clear (action bar or footer), else the viewport bottom. */
export function topmostObstacle(tops: Array<number | null | undefined>, viewportHeight: number): number {
    const visible = tops.filter((top): top is number => typeof top === "number" && Number.isFinite(top) && top > 0 && top < viewportHeight);

    if (!visible.length) return viewportHeight;

    return Math.min(...visible);
}

/** `margin-bottom` so a bottom snackbar's lower edge sits `gap` px above `obstacleTop`. */
export function snackbarMarginBottom(viewportHeight: number, obstacleTop: number, gap = 8): number {
    if (!Number.isFinite(viewportHeight) || !Number.isFinite(obstacleTop)) return gap;

    return Math.max(gap, viewportHeight - obstacleTop + gap);
}

/** Nearest ancestor that can actually scroll. */
export function scrollableAncestor(start: HTMLElement | null): HTMLElement | null {
    let node = start?.parentElement ?? null;

    while (node) {
        const overflowY = getComputedStyle(node).overflowY;

        if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && node.scrollHeight > node.clientHeight + 1) {
            return node;
        }

        node = node.parentElement;
    }

    return null;
}
