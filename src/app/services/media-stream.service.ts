import { Injectable, Optional } from "@angular/core";
import { Event, NavigationCancel, NavigationEnd, NavigationStart, Router } from "@angular/router";
import { Subscription } from "rxjs";

/**
 * Marker on the getUserMedia wrapper. Capture-signal checks read the original
 * function through this so our own bookkeeping is not reported as tampering.
 */
const CAMERA_GET_USER_MEDIA = Symbol.for("zelf.camera.getUserMedia");

type GetUserMedia = (constraints?: MediaStreamConstraints) => Promise<MediaStream>;

interface PendingCall {
    generation: number;
}

interface CameraHub {
    generation: number;
    lastPath: string | null;
    pathBeforeNavigation: string | null;
    releasedForNavigation: boolean;
    streams: Set<MediaStream>;
    pending: Set<PendingCall>;
    resumeListeners: Set<() => void>;
    routerSub: Subscription | null;
    lifecycleBound: boolean;
}

const hub: CameraHub = {
    generation: 0,
    lastPath: null,
    pathBeforeNavigation: null,
    releasedForNavigation: false,
    streams: new Set<MediaStream>(),
    pending: new Set<PendingCall>(),
    resumeListeners: new Set<() => void>(),
    routerSub: null,
    lifecycleBound: false,
};

export function isCameraAbortError(error: { mediaStreamError?: { name?: string } } | null | undefined): boolean {
    return error?.mediaStreamError?.name === "AbortError";
}

export function underlyingGetUserMedia(fn: unknown): unknown {
    if (typeof fn === "function" && Object.prototype.hasOwnProperty.call(fn, CAMERA_GET_USER_MEDIA)) {
        return (fn as { [CAMERA_GET_USER_MEDIA]?: unknown })[CAMERA_GET_USER_MEDIA];
    }

    return fn;
}

function pathOf(url: string): string {
    const path = (url || "").split("?")[0].replace(/\/+$/, "");

    return path || "/";
}

function stopTracks(stream: MediaStream | null | undefined): void {
    if (!stream || typeof stream.getTracks !== "function") return;

    hub.streams.delete(stream);

    let tracks: MediaStreamTrack[] = [];

    try {
        tracks = stream.getTracks() || [];
    } catch {
        tracks = [];
    }

    for (const track of tracks) {
        try {
            track.stop();
        } catch {
            /* already ended */
        }
    }
}

function notifyResume(): void {
    hub.resumeListeners.forEach((listener) => {
        try {
            listener();
        } catch {
            /* a preview that already closed can ignore resume */
        }
    });
}

/**
 * Stop every track we know about, detach every video, and invalidate getUserMedia
 * calls that have not resolved yet. Safe to call more than once.
 */
export function releaseAllCameraStreams(): void {
    hub.generation += 1;

    const streams = new Set<MediaStream>(hub.streams);
    hub.streams.clear();

    if (typeof document !== "undefined") {
        document.querySelectorAll("video").forEach((video) => {
            let current: unknown = null;

            try {
                current = video.srcObject;
            } catch {
                current = null;
            }

            if (current instanceof MediaStream) streams.add(current);

            try {
                video.pause();
            } catch {
                /* ignore */
            }

            try {
                video.srcObject = null;
            } catch {
                /* ignore */
            }
        });
    }

    streams.forEach((stream) => stopTracks(stream));
}

export function handleCameraVisibility(state: DocumentVisibilityState = typeof document !== "undefined" ? document.visibilityState : "visible"): void {
    if (state === "hidden") {
        releaseAllCameraStreams();
        return;
    }

    if (state === "visible") notifyResume();
}

/**
 * Wrap getUserMedia once so ngx-webcam and any other caller is tracked.
 * A stream that resolves after release is stopped before the caller can keep it.
 */
export function installCameraRelease(): void {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        bindCameraLifecycle();
        return;
    }

    const current = navigator.mediaDevices.getUserMedia;

    if (!Object.prototype.hasOwnProperty.call(current, CAMERA_GET_USER_MEDIA)) {
        const wrapped: GetUserMedia = (constraints) => trackGetUserMedia((next) => current.call(navigator.mediaDevices, next), constraints);

        Object.defineProperty(wrapped, CAMERA_GET_USER_MEDIA, { value: current });
        navigator.mediaDevices.getUserMedia = wrapped as MediaDevices["getUserMedia"];
    }

    bindCameraLifecycle();
}

async function trackGetUserMedia(original: GetUserMedia, constraints?: MediaStreamConstraints): Promise<MediaStream> {
    const generation = hub.generation;
    const ticket: PendingCall = { generation };
    hub.pending.add(ticket);

    try {
        const stream = await original(constraints);

        if (generation !== hub.generation) {
            stopTracks(stream);
            throw new DOMException("The camera was released before the preview started.", "AbortError");
        }

        hub.streams.add(stream);

        return stream;
    } finally {
        hub.pending.delete(ticket);
    }
}

const boundLifecycleEvents = new Set<string>();

function bindCameraLifecycle(): void {
    if (hub.lifecycleBound || typeof window === "undefined" || typeof document === "undefined") return;

    hub.lifecycleBound = true;

    const listen = (target: Window | Document, type: string, handler: () => void) => {
        boundLifecycleEvents.add(type);
        target.addEventListener(type, handler);
    };

    listen(document, "visibilitychange", () => handleCameraVisibility());
    listen(window, "pagehide", releaseCameraForPageExit);
    listen(window, "beforeunload", releaseCameraForPageExit);
    listen(window, "unload", releaseCameraForPageExit);
    listen(window, "popstate", releaseCameraForPageExit);
}

/** pagehide, beforeunload, and unload all end the popup, so they share this release. */
export function releaseCameraForPageExit(): void {
    releaseAllCameraStreams();
}

export function boundCameraLifecycleEvents(): string[] {
    return [...boundLifecycleEvents];
}

export function watchCameraRouteChanges(router?: Pick<Router, "events"> | null): void {
    if (!router?.events) return;

    hub.routerSub?.unsubscribe();
    hub.routerSub = router.events.subscribe((event: Event) => {
        if (event instanceof NavigationStart) {
            const path = pathOf(event.url);

            if (path === hub.lastPath) return;

            hub.pathBeforeNavigation = hub.lastPath;
            hub.lastPath = path;
            hub.releasedForNavigation = true;
            releaseAllCameraStreams();
            return;
        }

        if (event instanceof NavigationCancel) {
            if (!hub.releasedForNavigation) return;

            hub.lastPath = hub.pathBeforeNavigation;
            hub.releasedForNavigation = false;
            notifyResume();
            return;
        }

        if (event instanceof NavigationEnd) {
            hub.releasedForNavigation = false;
            hub.lastPath = pathOf(event.urlAfterRedirects || event.url);
        }
    });
}

/** Drop the wrapper and route subscription. Used by unit tests. */
export function resetCameraReleaseForTests(): void {
    hub.resumeListeners.clear();
    hub.streams.clear();
    hub.pending.clear();
    hub.lastPath = null;
    hub.pathBeforeNavigation = null;
    hub.releasedForNavigation = false;
    hub.routerSub?.unsubscribe();
    hub.routerSub = null;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;

    let current = navigator.mediaDevices.getUserMedia as unknown;
    const seen = new Set<unknown>();

    while (typeof current === "function" && !seen.has(current) && Object.prototype.hasOwnProperty.call(current, CAMERA_GET_USER_MEDIA)) {
        seen.add(current);
        const next = (current as { [CAMERA_GET_USER_MEDIA]?: unknown })[CAMERA_GET_USER_MEDIA];

        if (typeof next !== "function") break;

        current = next;
    }

    if (typeof current === "function") {
        navigator.mediaDevices.getUserMedia = current as MediaDevices["getUserMedia"];
    }
}

@Injectable({
    providedIn: "root",
})
export class MediaStreamService {
    constructor(@Optional() router?: Router) {
        installCameraRelease();
        watchCameraRouteChanges(router);
    }

    async startStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
        return navigator.mediaDevices.getUserMedia(constraints);
    }

    addStream(stream: MediaStream): void {
        hub.streams.add(stream);
    }

    stopStream(stream: MediaStream): void {
        stopTracks(stream);
    }

    /**
     * Stop every camera we already have and cancel getUserMedia calls still in flight.
     * Do not call getUserMedia here: opening a new stream turns the camera back on.
     */
    releaseAll(): void {
        releaseAllCameraStreams();
    }

    async stopAllStreams(): Promise<void> {
        this.releaseAll();
    }

    /**
     * Preview components call the resume handler when the document is visible again
     * or when a route change is cancelled and the capture screen is still open.
     * The hidden handler only pauses that component's timers; the hardware release
     * already ran from the document listener.
     */
    bindPreviewLifecycle(handlers: { onHidden?: () => void; onResume?: () => void }): () => void {
        const removeResume = handlers.onResume ? this._listenForResume(handlers.onResume) : () => undefined;
        const onVisibility = () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") handlers.onHidden?.();
        };

        if (typeof document !== "undefined" && handlers.onHidden) {
            document.addEventListener("visibilitychange", onVisibility);
        }

        return () => {
            removeResume();

            if (typeof document !== "undefined" && handlers.onHidden) {
                document.removeEventListener("visibilitychange", onVisibility);
            }
        };
    }

    private _listenForResume(listener: () => void): () => void {
        hub.resumeListeners.add(listener);

        return () => {
            hub.resumeListeners.delete(listener);
        };
    }
}
