import { BehaviorSubject } from "rxjs";

import { BiometricsGeneralComponent } from "./biometrics.component";
import { FaceCaptureService } from "app/services/face-capture.service";
import { CaptureSignalsService } from "app/services/capture-signals.service";
import { installCameraRelease, MediaStreamService } from "app/services/media-stream.service";

describe("BiometricsGeneralComponent camera release", () => {
    let component: BiometricsGeneralComponent;
    let faceCapture: FaceCaptureService;
    let host: HTMLDivElement;
    let video: HTMLVideoElement;
    let stream: MediaStream;

    function canvasStream(): MediaStream {
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        canvas.getContext("2d")?.fillRect(0, 0, 8, 8);
        return canvas.captureStream();
    }

    function tracksEnded(media: MediaStream): boolean {
        return media.getTracks().length > 0 && media.getTracks().every((track) => track.readyState === "ended");
    }

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        stream = canvasStream();
        video = document.createElement("video");
        video.srcObject = stream;
        host.appendChild(video);

        const media = new MediaStreamService();
        faceCapture = new FaceCaptureService({ encryptMessage: async () => "pgp-face" } as any, media, {} as any);
        spyOn(faceCapture, "encryptCapturePayload").and.resolveTo("pgp-face");

        component = new BiometricsGeneralComponent(
            { markForCheck() {} } as any,
            {} as any,
            media,
            { listen: () => () => undefined } as any,
            { translate: (key: string) => key } as any,
            { getDeviceData: () => ({ time: 250 }) } as any,
            { nativeElement: host } as any,
            faceCapture
        );

        component.webcamRef = { nativeVideoElement: video } as any;
        component.response = { isLoading: false, isFailed: false };
        component.face = { minHeight: 240, minPixels: 240, successPosition: 0, threshold: 0.25 };
        component.camera = {
            hasPermissions: true,
            isLoading: false,
            isLowQuality: false,
            configuration: faceCapture.buildCameraConfiguration({ displayMode: "portrait" }),
            dimensions: {
                video: { max: { height: 8, width: 8 }, height: 8, width: 8 },
                real: { height: 8, width: 8, offsetX: 0, offsetY: 0 },
                result: { height: 8, width: 8, offsetX: 0, offsetY: 0 },
            },
        };
        component.maskResultCanvasRef = { nativeElement: document.createElement("canvas") };
        component.ToSendCanvasRef = { nativeElement: document.createElement("canvas") };
    });

    afterEach(() => {
        component.ngOnDestroy();
        host.remove();
    });

    it("stops every track and clears the video when capture succeeds", async () => {
        const emitted: string[] = [];
        component.imageCaptured.subscribe((value) => emitted.push(value));
        const source = document.createElement("canvas");
        source.width = 8;
        source.height = 8;
        source.getContext("2d")?.fillRect(0, 0, 8, 8);

        (component as any)._takePictureLiveness(source);
        await Promise.resolve();

        expect(tracksEnded(stream)).toBeTrue();
        expect(video.srcObject).toBeNull();
        expect(emitted).toEqual(["pgp-face"]);
        expect((component as any)._intervals).toEqual({});
    });

    it("stops tracks when capture fails", () => {
        component.cameraError({ mediaStreamError: { name: "NotAllowedError" } } as any);

        expect(tracksEnded(stream)).toBeTrue();
        expect(video.srcObject).toBeNull();
        expect(component.camera.hasPermissions).toBeFalse();
    });

    it("stops tracks and cancels detection when the view is destroyed", async () => {
        const getUserMedia = spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => Promise.reject(new Error("camera opened")));
        let fired = false;
        (component as any)._intervals.detectFace = setInterval(() => {
            fired = true;
        }, 15);
        (component as any)._intervals.checkNgxVideo = setInterval(() => undefined, 15);

        component.ngOnDestroy();
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(getUserMedia).not.toHaveBeenCalled();
        expect(fired).toBeFalse();
        expect(tracksEnded(stream)).toBeTrue();
        expect(video.srcObject).toBeNull();
        expect((component as any)._intervals).toEqual({});
    });

    it("stops a stream assigned after release", () => {
        component.ngOnDestroy();

        const late = canvasStream();
        video.srcObject = late;

        expect(video.srcObject).toBeNull();
        expect(tracksEnded(late)).toBeTrue();
    });

    it("does not run a second detection while one is in flight, and ignores it after release", async () => {
        let finish: (faces: any[]) => void = () => undefined;
        const pending = new Promise<any[]>((resolve) => {
            finish = resolve;
        });
        const detect = spyOn(faceCapture, "detectFacesWithLandmarks").and.returnValue(pending);
        component.webcamRef = { nativeVideoElement: { readyState: 4, videoWidth: 1280, videoHeight: 720 } } as any;

        const first = (component as any)._detectFace();
        const second = (component as any)._detectFace();
        expect(detect).toHaveBeenCalledTimes(1);
        expect(detect).toHaveBeenCalledWith(jasmine.anything(), 0.2);

        component.ngOnDestroy();
        finish!([]);
        await first;
        await second;

        expect(component.response.base64Image).toBeUndefined();
        expect(detect).toHaveBeenCalledTimes(1);
    });

    it("schedules the next SsdMobilenetv1 pass 1000ms after the current one finishes", async () => {
        const delays: number[] = [];
        spyOn(window, "setTimeout").and.callFake(((handler: TimerHandler, timeout?: number) => {
            delays.push(timeout ?? 0);
            return 1;
        }) as any);
        const detect = spyOn(faceCapture, "detectFacesWithLandmarks").and.resolveTo([]);
        component.webcamRef = { nativeVideoElement: { readyState: 4, videoWidth: 1280, videoHeight: 720 } } as any;

        await (component as any)._detectFace();

        expect(detect).toHaveBeenCalledTimes(1);
        expect(delays).toEqual([1000]);
    });

    it("stops every track of a getUserMedia stream that resolves after unmount", async () => {
        const tracks = ["video", "audio"].map((kind) => ({
            kind,
            readyState: "live",
            stop: jasmine.createSpy(`stop-${kind}`).and.callFake(function (this: { readyState: string }) {
                this.readyState = "ended";
            }),
        }));
        const late = { getTracks: () => tracks } as unknown as MediaStream;
        let resolveLate: (stream: MediaStream) => void = () => undefined;
        spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => new Promise<MediaStream>((resolve) => (resolveLate = resolve)));
        installCameraRelease();

        const opening = navigator.mediaDevices.getUserMedia({ video: true });
        component.ngOnDestroy();
        resolveLate(late);

        await opening.then(
            () => fail("the camera should have been cancelled"),
            () => undefined
        );

        tracks.forEach((track) => expect(track.stop).toHaveBeenCalled());
    });
});

describe("BiometricsGeneralComponent camera startup", () => {
    it("arms the preview before face models load and keeps the same ideal constraints", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const models = new BehaviorSubject<boolean>(false);
        const media = new MediaStreamService();
        const faceCapture = new FaceCaptureService({ encryptMessage: async () => "pgp" } as any, media, new CaptureSignalsService());
        spyOn(faceCapture, "inspectStream").and.resolveTo({ videoInputs: [] } as any);

        const component = new BiometricsGeneralComponent(
            { markForCheck() {}, detectChanges() {} } as any,
            {} as any,
            media,
            { listen: () => () => undefined } as any,
            { translate: (key: string) => key } as any,
            { getDeviceData: () => ({ time: 250 }), faceapi$: models.asObservable() } as any,
            { nativeElement: host } as any,
            faceCapture
        );
        component.displayMode = "portrait";

        const started = performance.now();
        const opening = component.ngOnInit();
        const configuration = component.camera.configuration;
        const armedAt = performance.now();

        expect(configuration.width).toEqual({ ideal: 1920 });
        expect(configuration.height).toEqual({ ideal: 1080 });
        expect(configuration.frameRate).toEqual({ ideal: 30 });
        expect(JSON.stringify(configuration)).not.toContain("exact");
        expect((component as any)._intervals.checkNgxVideo).toBeTruthy();
        expect((component as any)._modelsReady).toBeFalse();
        expect(armedAt - started).toBeLessThan(250);

        models.next(true);
        await opening;

        expect(component.camera.configuration).toBe(configuration);
        expect((component as any)._modelsReady).toBeTrue();

        const video = document.createElement("video");
        Object.defineProperty(video, "readyState", { get: () => 2 });
        Object.defineProperty(video, "videoWidth", { get: () => 1920 });
        Object.defineProperty(video, "videoHeight", { get: () => 1080 });
        Object.defineProperty(video, "clientWidth", { get: () => 320 });
        Object.defineProperty(video, "clientHeight", { get: () => 400 });
        component.webcamRef = { nativeVideoElement: video } as any;
        component.maskResultCanvasRef = { nativeElement: document.createElement("canvas") };
        const detect = spyOn(faceCapture, "detectFacesWithLandmarks").and.resolveTo([]);

        (component as any)._checkVideoStreamReady();
        await Promise.resolve();

        expect(component.camera.isLoading).toBeFalse();
        expect(detect).toHaveBeenCalled();
        expect(armedAt - started).toBeLessThan(250);

        component.ngOnDestroy();
        host.remove();
    });
});
