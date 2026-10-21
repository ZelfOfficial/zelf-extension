import type { Router } from "@angular/router";

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

/** True when the browser/extension history stack has a prior entry (Location.back is meaningful). */
export function canUseBrowserHistoryBack(): boolean {
    return typeof window !== "undefined" && window.history.length > 1;
}

/** Serialized URL of the screen immediately before the current one (Angular router), when it is in-app. */
export function serializeRouterPreviousUrl(router: Pick<Router, "lastSuccessfulNavigation" | "serializeUrl">): string | null {
    const prev = router.lastSuccessfulNavigation?.previousNavigation;
    if (!prev) return null;

    const tree = prev.finalUrl ?? prev.extractedUrl;
    if (!tree) return null;

    const url = router.serializeUrl(tree);

    return isSafeInternalRoute(url) ? url : null;
}

/**
 * Where a screen's "Back" button should go.
 * 1. If the router recorded a previous in-app URL, navigate there (same outcome as history back, reliable in the extension).
 * 2. Else if the browser history stack has a prior entry, use Location.back().
 * 3. Else use the explicit `redirect` query param when it is a safe in-app route.
 * 4. Else the provided fallback route (Settings > Subscription uses `/settings`).
 */
export function resolveBackNavigation(options: {
    previousUrl?: string | null;
    canUseBrowserHistory?: boolean;
    redirect?: unknown;
    fallback: string;
}): BackNavigationTarget {
    const previousUrl = options.previousUrl?.trim();
    if (previousUrl && isSafeInternalRoute(previousUrl)) return { kind: "route", url: previousUrl };

    if (options.canUseBrowserHistory ?? canUseBrowserHistoryBack()) return { kind: "history" };

    if (isSafeInternalRoute(options.redirect)) return { kind: "route", url: String(options.redirect).trim() };

    return { kind: "route", url: options.fallback };
}

/** Subscription billing back target (v3 #266 / #69). */
export function resolveBillingBackNavigation(
    router: Pick<Router, "lastSuccessfulNavigation" | "serializeUrl">,
    redirect: unknown
): BackNavigationTarget {
    return resolveBackNavigation({
        previousUrl: serializeRouterPreviousUrl(router),
        canUseBrowserHistory: canUseBrowserHistoryBack(),
        redirect,
        fallback: "/settings",
    });
}
