export type BackNavigationTarget = { kind: "history" } | { kind: "route"; url: string };

/**
 * Only in-app routes are accepted as a `redirect` target ("/settings", "/zelf-keys?x=1").
 * Protocol-relative ("//host"), absolute URLs and anything not starting with "/" are rejected.
 */
export function isSafeInternalRoute(url: unknown): url is string {
    if (typeof url !== "string") return false;

    const value = url.trim();

    return value.startsWith("/") && !value.startsWith("//") && !value.includes("://") && !value.includes("\\");
}

/**
 * Where a screen's "Back" button should go.
 * 1. If the user navigated here from another in-app screen, go back (respects whatever screen the user came from).
 * 2. Otherwise use the explicit `redirect` query param, when it is a safe in-app route.
 * 3. Otherwise the provided fallback route.
 */
export function resolveBackNavigation(options: { hasPreviousInAppNavigation: boolean; redirect?: unknown; fallback: string }): BackNavigationTarget {
    if (options.hasPreviousInAppNavigation) return { kind: "history" };

    if (isSafeInternalRoute(options.redirect)) return { kind: "route", url: options.redirect.trim() };

    return { kind: "route", url: options.fallback };
}
