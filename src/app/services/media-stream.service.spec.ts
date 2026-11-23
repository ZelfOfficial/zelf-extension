import { Event, NavigationCancel, NavigationEnd, NavigationStart, Router } from "@angular/router";
import { Subject } from "rxjs";

import {
    boundCameraLifecycleEvents,
    handleCameraVisibility,
    installCameraRelease,
    MediaStreamService,
    releaseAllCameraStreams,
    releaseCameraForPageExit,
    resetCameraReleaseForTests,
} from "./media-stream.service";

describe("MediaStreamService camera release", () => {
    function liveStream(): { stream: MediaStream; stops: jasmine.Spy[] } {
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        canvas.getContext("2d")?.fillRect(0, 0, 8, 8);
        const stream = canvas.captureStream();
        const stops = stream.getTracks().map((track) => spyOn(track, "stop").and.callThrough());

        return { stream, stops };
    }

    function fakeTracks(): { stream: MediaStream; stops: jasmine.Spy[] } {
        const stops: jasmine.Spy[] = [];
        const tracks = ["video", "audio"].map((kind) => {
            const track = {
                kind,
                readyState: "live",
                stop: jasmine.createSpy(`stop-${kind}`).and.callFake(() => {
                    track.readyState = "ended";
                }),
            };
            stops.push(track.stop);

            return track;
        });
        const stream = {
            getTracks: () => tracks,
            getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
            getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
        } as unknown as MediaStream;

        return { stream, stops };
    }

    function expectEveryStop(stops: jasmine.Spy[]): void {
        expect(stops.length).toBeGreaterThan(0);
        stops.forEach((stop) => expect(stop).toHaveBeenCalled());
    }

    function attach(service: MediaStreamService): { stream: MediaStream; stops: jasmine.Spy[]; video: HTMLVideoElement } {
        const { stream, stops } = liveStream();
        const video = document.createElement("video");
        video.srcObject = stream;
        document.body.appendChild(video);
        service.addStream(stream);

        return { stream, stops, video };
    }

    afterEach(() => {
        document.querySelectorAll("video").forEach((video) => video.remove());
        resetCameraReleaseForTests();
    });

    it("stops tracked streams and video elements without opening a new camera", async () => {
        const getUserMedia = spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => Promise.reject(new Error("camera opened")));
        const service = new MediaStreamService();
        const { stream, stops, video } = attach(service);

        await service.stopAllStreams();

        expect(getUserMedia).not.toHaveBeenCalled();
        expectEveryStop(stops);
        expect(stream.getTracks().every((track) => track.readyState === "ended")).toBeTrue();
        expect(video.srcObject).toBeNull();
    });

    it("stops every track when capture succeeds", () => {
        const service = new MediaStreamService();
        const opened = attach(service);
        const extra = fakeTracks();
        service.addStream(extra.stream);

        service.releaseAll();

        expectEveryStop(opened.stops);
        expectEveryStop(extra.stops);
        expect(opened.video.srcObject).toBeNull();
    });

    it("stops every track when capture fails", async () => {
        const getUserMedia = spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => Promise.reject(new Error("NotAllowedError")));
        installCameraRelease();
        const service = new MediaStreamService();
        const opened = attach(service);

        await expectAsync(navigator.mediaDevices.getUserMedia({ video: true })).toBeRejected();
        service.releaseAll();

        expect(getUserMedia).toHaveBeenCalled();
        expectEveryStop(opened.stops);
        expect(opened.video.srcObject).toBeNull();
    });

    it("stops every track when capture is cancelled", () => {
        const service = new MediaStreamService();
        const opened = attach(service);

        service.releaseAll();

        expectEveryStop(opened.stops);
        expect(opened.video.srcObject).toBeNull();
    });

    it("stops every track on back navigation", () => {
        const service = new MediaStreamService();
        const opened = attach(service);

        releaseAllCameraStreams();
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

        expectEveryStop(opened.stops);
        expect(opened.video.srcObject).toBeNull();
    });

    it("stops every track when the route changes and keeps the camera on the next screen", async () => {
        const events = new Subject<Event>();
        const nextCamera = fakeTracks();
        spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => Promise.resolve(nextCamera.stream));
        installCameraRelease();
        const service = new MediaStreamService({ events } as unknown as Router);
        events.next(new NavigationStart(1, "/rewards/daily"));

        const opened = attach(service);
        events.next(new NavigationStart(2, "/home"));

        expectEveryStop(opened.stops);
        expect(opened.video.srcObject).toBeNull();

        const restarted = await service.startStream({ video: true });
        events.next(new NavigationEnd(2, "/home", "/home"));

        expect(restarted).toBe(nextCamera.stream);
        nextCamera.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
    });

    it("does not stop the camera when only the query string changes, and resumes after a cancelled navigation", () => {
        const events = new Subject<Event>();
        const service = new MediaStreamService({ events } as unknown as Router);
        const resumed = jasmine.createSpy("resumed");
        service.bindPreviewLifecycle({ onResume: resumed });
        events.next(new NavigationStart(1, "/security/biometrics"));

        const opened = attach(service);
        events.next(new NavigationStart(2, "/security/biometrics?return=home"));

        opened.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
        expect(opened.video.srcObject).toBe(opened.stream);

        events.next(new NavigationStart(3, "/home"));
        expectEveryStop(opened.stops);

        events.next(new NavigationCancel(3, "/home", "guard"));
        expect(resumed).toHaveBeenCalled();
    });

    it("stops every track when the capture view is destroyed", () => {
        const service = new MediaStreamService();
        const opened = attach(service);

        service.releaseAll();

        expectEveryStop(opened.stops);
        expect(opened.video.srcObject).toBeNull();
    });

    it("stops every track when the document becomes hidden", () => {
        const service = new MediaStreamService();
        const opened = attach(service);
        const descriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");

        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));

        expectEveryStop(opened.stops);
        expect(opened.video.srcObject).toBeNull();

        if (descriptor) Object.defineProperty(document, "visibilityState", descriptor);
        handleCameraVisibility("visible");
    });

    it("stops every track on popup pagehide, beforeunload, and unload", () => {
        new MediaStreamService();
        expect(boundCameraLifecycleEvents()).toEqual(jasmine.arrayContaining(["pagehide", "beforeunload", "unload"]));

        const hidden = attach(new MediaStreamService());
        window.dispatchEvent(new Event("pagehide"));
        expectEveryStop(hidden.stops);
        expect(hidden.video.srcObject).toBeNull();
        hidden.video.remove();

        for (const _name of ["beforeunload", "unload"]) {
            const opened = attach(new MediaStreamService());
            releaseCameraForPageExit();
            expectEveryStop(opened.stops);
            expect(opened.video.srcObject).toBeNull();
            opened.video.remove();
        }
    });

    it("stops a getUserMedia stream that resolves after release", async () => {
        const late = fakeTracks();
        let resolveLate: (stream: MediaStream) => void = () => undefined;
        spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => new Promise<MediaStream>((resolve) => (resolveLate = resolve)));
        installCameraRelease();
        const service = new MediaStreamService();
        const opening = navigator.mediaDevices.getUserMedia({ video: true });

        service.releaseAll();
        resolveLate(late.stream);

        let rejected: unknown;
        try {
            await opening;
        } catch (error) {
            rejected = error;
        }

        expect((rejected as DOMException).name).toBe("AbortError");
        expectEveryStop(late.stops);
    });

    it("stops the first mount and keeps the second when the view is destroyed and created again", async () => {
        const first = fakeTracks();
        const second = fakeTracks();
        let resolveFirst: (stream: MediaStream) => void = () => undefined;
        let calls = 0;
        spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => {
            calls += 1;

            if (calls === 1) return new Promise<MediaStream>((resolve) => (resolveFirst = resolve));

            return Promise.resolve(second.stream);
        });
        installCameraRelease();
        const service = new MediaStreamService();
        const firstOpen = navigator.mediaDevices.getUserMedia({ video: true });

        service.releaseAll();
        service.releaseAll();

        const secondStream = await navigator.mediaDevices.getUserMedia({ video: true });
        resolveFirst(first.stream);
        await firstOpen.then(
            () => fail("the first camera should have been cancelled"),
            () => undefined
        );

        expectEveryStop(first.stops);
        second.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
        expect(secondStream).toBe(second.stream);
    });

    it("stops the camera that was still starting when the user switches screens, and keeps the next one", async () => {
        const leaving = fakeTracks();
        const arriving = fakeTracks();
        let resolveLeaving: (stream: MediaStream) => void = () => undefined;
        let calls = 0;
        spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => {
            calls += 1;

            if (calls === 1) return new Promise<MediaStream>((resolve) => (resolveLeaving = resolve));

            return Promise.resolve(arriving.stream);
        });
        installCameraRelease();
        new MediaStreamService();
        const leavingOpen = navigator.mediaDevices.getUserMedia({ video: true });

        releaseAllCameraStreams();

        const arrived = await navigator.mediaDevices.getUserMedia({ video: true });
        resolveLeaving(leaving.stream);
        await leavingOpen.then(
            () => fail("the camera from the previous screen should have been cancelled"),
            () => undefined
        );

        expectEveryStop(leaving.stops);
        arriving.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
        expect(arrived).toBe(arriving.stream);
    });

    it("is idempotent and can open a new camera after release", async () => {
        const nextCamera = fakeTracks();
        spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => Promise.resolve(nextCamera.stream));
        installCameraRelease();
        const service = new MediaStreamService();
        const opened = attach(service);

        service.releaseAll();
        service.releaseAll();

        expectEveryStop(opened.stops);
        opened.stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));

        const restarted = await service.startStream({ video: true });

        expect(restarted).toBe(nextCamera.stream);
        nextCamera.stops.forEach((stop) => expect(stop).not.toHaveBeenCalled());
    });
});
