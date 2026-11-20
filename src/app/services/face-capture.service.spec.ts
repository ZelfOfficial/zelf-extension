import * as angularJson from "../../../angular.json";
import * as faceapi from "@vladmandic/face-api";
import { FacingMode } from "../biometrics-general/sdk.models";
import { CaptureSignalsService } from "./capture-signals.service";
import { detectionFrameSize, FaceCaptureService, faceDetectorOptions, scaledDetectionMinPixels } from "./face-capture.service";

describe("FaceCaptureService (#93)", () => {
    let service: FaceCaptureService;
    let encryptMessageSpy: jasmine.Spy;
    let stopAllStreamsSpy: jasmine.Spy;

    beforeEach(() => {
        encryptMessageSpy = jasmine.createSpy("encryptMessage").and.callFake(async (msg: string) => `PGP(${msg})`);
        stopAllStreamsSpy = jasmine.createSpy("stopAllStreams").and.resolveTo();

        service = new FaceCaptureService(
            { encryptMessage: encryptMessageSpy } as any,
            { stopAllStreams: stopAllStreamsSpy } as any,
            new CaptureSignalsService()
        );
    });

    it("builds standard camera configuration for landscape, portrait, and specific deviceId", () => {
        const landscapeCfg = service.buildCameraConfiguration({ isLandscape: true, displayMode: "auto" });
        expect(landscapeCfg.facingMode).toBe(FacingMode.USER);
        expect(landscapeCfg.width).toEqual({ ideal: 1280 });
        expect(landscapeCfg.height).toEqual({ ideal: 720 });

        const portraitAutoCfg = service.buildCameraConfiguration({ isLandscape: false, displayMode: "auto" });
        expect(portraitAutoCfg.width).toEqual({ ideal: 720 });
        expect(portraitAutoCfg.height).toEqual({ ideal: 1280 });

        const portraitModeCfg = service.buildCameraConfiguration({ isLandscape: false, displayMode: "portrait", deviceId: "cam-1" });
        expect(portraitModeCfg.width).toEqual({ ideal: 1280 });
        expect(portraitModeCfg.height).toEqual({ ideal: 720 });
        expect(portraitModeCfg.deviceId).toEqual({ exact: "cam-1" });
    });

    it("computes oval center, radius, and margins consistently", () => {
        const oval = service.getCenterAndRadius(600, 400);
        expect(oval.center).toEqual({ x: 200, y: 300 });
        expect(oval.radius.y).toBeCloseTo(252, 2);
        expect(oval.radius.x).toBeCloseTo(189, 2);
        expect(oval.margin.y).toBeCloseTo(30, 2);
        expect(oval.margin.x).toBeCloseTo(24, 2);
    });

    it("evaluates face framing (centered vs not centered vs too far)", () => {
        const oval = service.getCenterAndRadius(600, 800);
        const realDim = { height: 600, width: 800, offsetX: 0 };

        const centeredClose = service.evaluateFaceFraming(
            { x: 400, y: 310 },
            { imageHeight: 400, imageWidth: 400 },
            oval,
            realDim,
            { threshold: 0.25, minPixels: 240 }
        );
        expect(centeredClose.isOk).toBeTrue();
        expect(centeredClose.reason).toBe("ok");

        const tooFar = service.evaluateFaceFraming(
            { x: 400, y: 310 },
            { imageHeight: 120, imageWidth: 120 },
            oval,
            realDim,
            { threshold: 0.25, minPixels: 240 }
        );
        expect(tooFar.isOk).toBeFalse();
        expect(tooFar.reason).toBe("too_far");

        const offCenter = service.evaluateFaceFraming(
            { x: 150, y: 150 },
            { imageHeight: 400, imageWidth: 400 },
            oval,
            realDim,
            { threshold: 0.25, minPixels: 240 }
        );
        expect(offCenter.isOk).toBeFalse();
        expect(offCenter.reason).toBe("not_centered");
        expect(offCenter.direction).toContain("←");
        expect(offCenter.direction).toContain("↓");
    });

    it("computes object-fit: cover oval crops and caps dimensions to maxEdge", () => {
        const oval = service.getCenterAndRadius(600, 375, { radiusYRatio: 0.35 });
        const crops = service.computeOvalCrops({ width: 375, height: 600 }, { width: 1920, height: 1080 }, oval);
        expect(crops).not.toBeNull();
        expect(crops!.display.width).toBeGreaterThan(0);
        expect(crops!.display.height).toBe(600);
        expect(crops!.original.height).toBeCloseTo(1080, 2);

        const capped = service.capRect({ x: 10, y: 20, width: 1600, height: 2400 }, 1080);
        expect(capped.height).toBe(1080);
        expect(capped.width).toBe(720);
    });

    it("strips data URL prefix and PGP-encrypts capture payloads in one place", async () => {
        const encrypted = await service.encryptCapturePayload("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
        expect(encryptMessageSpy).toHaveBeenCalledWith("/9j/4AAQSkZJRg==");
        expect(encrypted).toBe("PGP(/9j/4AAQSkZJRg==)");
    });

    it("excludes assets/dev/** from the production build configuration in angular.json", () => {
        const prodAssets =
            (angularJson as any)?.projects?.["zelf-extension"]?.architect?.build?.configurations?.ext_prod_chrome?.assets || [];
        const srcAssetsEntry = prodAssets.find((entry: any) => typeof entry === "object" && entry.input === "src/assets");
        expect(srcAssetsEntry).toBeDefined();
        expect(srcAssetsEntry.ignore).toContain("dev/**");
    });
});

describe("detection frame size", () => {
    it("downscales a 1080p frame and keeps a smaller frame unchanged", () => {
        const hd = detectionFrameSize(1920, 1080, 640);
        expect(hd).not.toBeNull();
        expect(hd!.width).toBe(640);
        expect(hd!.height).toBe(360);
        expect(hd!.scale).toBeCloseTo(640 / 1920, 5);

        const small = detectionFrameSize(640, 480, 640);
        expect(small).toEqual({ width: 640, height: 480, scale: 1 });
        expect(detectionFrameSize(0, 720, 640)).toBeNull();
    });

    it("scales the pixel floor only when the detection frame is smaller than the camera frame", () => {
        expect(scaledDetectionMinPixels(240, 1)).toBe(240);
        expect(scaledDetectionMinPixels(240, 640 / 1920)).toBeCloseTo(80, 5);
        expect(scaledDetectionMinPixels(240, 0)).toBe(240);
    });

    it("keeps the confidence floor and uses the tiny net only when it is loaded", () => {
        const ssd = faceDetectorOptions(0.2, "ssd", true);
        expect(ssd instanceof faceapi.SsdMobilenetv1Options).toBeTrue();

        const fallback = faceDetectorOptions(0.2, "tiny", false);
        expect(fallback instanceof faceapi.SsdMobilenetv1Options).toBeTrue();

        const tiny = faceDetectorOptions(0.2, "tiny", true) as faceapi.TinyFaceDetectorOptions;
        expect(tiny instanceof faceapi.TinyFaceDetectorOptions).toBeTrue();
        expect(tiny.inputSize).toBe(416);
        expect(tiny.scoreThreshold).toBe(0.2);
    });
});
