import { CaptureSignalsService } from "./capture-signals.service";
import { FaceCaptureService } from "./face-capture.service";

describe("CaptureSignalsService (#94)", () => {
    let service: CaptureSignalsService;

    beforeEach(() => {
        service = new CaptureSignalsService();
    });

    it("classifies standard physical cameras as neither virtual nor phone bridge", () => {
        expect(service.classifyDeviceLabel("FaceTime HD Camera (Built-in)")).toEqual({
            virtualCamera: false,
            phoneCamera: false,
        });
        expect(service.classifyDeviceLabel("Logitech BRIO 4K Stream Edition")).toEqual({
            virtualCamera: false,
            phoneCamera: false,
        });
    });

    it("allowlists Continuity and phone-bridge cameras without flagging virtualCamera", () => {
        for (const label of [
            "Miguel's iPhone (Continuity Camera)",
            "Reincubate Camo Camera",
            "DroidCam Source 3",
            "Elgato EpocCam Camera",
            "Iriun Webcam",
        ]) {
            expect(service.classifyDeviceLabel(label)).toEqual({
                virtualCamera: false,
                phoneCamera: true,
            });
        }
    });

    it("flags known virtual camera drivers as virtualCamera = true", () => {
        for (const label of [
            "OBS Virtual Camera",
            "ManyCam Virtual Webcam",
            "Snap Camera",
            "XSplit VCam",
            "SplitCam Video Driver",
            "CamTwist",
            "mmhmm Camera",
            "Dummy video device (0x0000)",
        ]) {
            expect(service.classifyDeviceLabel(label)).toEqual({
                virtualCamera: true,
                phoneCamera: false,
            });
        }
    });

    it("inspects track settings and hardware capabilities to detect missing sensor controls", () => {
        const physicalTrack = {
            label: "FaceTime HD Camera",
            getSettings: () => ({
                width: 1280,
                height: 720,
                frameRate: 30,
                facingMode: "user",
                aspectRatio: 1.7778,
                deviceId: "phys-1",
                groupId: "grp-1",
            }),
            getCapabilities: () => ({
                width: { min: 640, max: 1920 },
                height: { min: 480, max: 1080 },
                exposureMode: ["continuous", "manual"],
                whiteBalanceMode: ["continuous"],
            }),
        } as unknown as MediaStreamTrack;

        const physResult = service.inspectTrack(physicalTrack);
        expect(physResult.hasHardwareCapabilities).toBeTrue();
        expect(physResult.suspiciousResolution).toBeFalse();
        expect(physResult.settings.width).toBe(1280);
        expect(physResult.settings.height).toBe(720);

        const virtualScreenTrack = {
            label: "OBS Virtual Camera",
            getSettings: () => ({
                width: 1920,
                height: 1080,
                frameRate: 60,
                deviceId: "obs-1",
            }),
            getCapabilities: () => ({
                width: { min: 1920, max: 1920 },
                height: { min: 1080, max: 1080 },
            }),
        } as unknown as MediaStreamTrack;

        const virtResult = service.inspectTrack(virtualScreenTrack);
        expect(virtResult.hasHardwareCapabilities).toBeFalse();
        expect(virtResult.suspiciousResolution).toBeTrue();
    });

    it("detects monkey-patched non-native functions in isNativeFunction", () => {
        expect(service.isNativeFunction(Array.prototype.slice)).toBeTrue();
        const patchedFn = function getUserMedia() {
            return Promise.resolve();
        };
        expect(service.isNativeFunction(patchedFn)).toBeFalse();
    });

    it("aggregates high risk for virtual cameras and caches report via FaceCaptureService.inspectStream", async () => {
        spyOn(service, "listVideoInputs").and.resolveTo([
            {
                deviceId: "obs-1",
                label: "OBS Virtual Camera",
                groupId: "g-1",
                virtualCamera: true,
                phoneCamera: false,
            },
            {
                deviceId: "phys-1",
                label: "FaceTime HD Camera",
                groupId: "g-2",
                virtualCamera: false,
                phoneCamera: false,
            },
        ]);
        spyOn(service, "checkEnvironmentIntegrity").and.resolveTo({
            installType: "normal",
            runtimeId: "ext-id-123",
            nativeIntegrity: true,
            tamperedApis: [],
        });

        const fakeStream = {
            getVideoTracks: () => [
                {
                    label: "OBS Virtual Camera",
                    getSettings: () => ({ width: 1920, height: 1080, deviceId: "obs-1", groupId: "g-1" }),
                    getCapabilities: () => ({ width: { min: 1920, max: 1920 } }),
                },
            ],
        } as unknown as MediaStream;

        const faceCaptureService = new FaceCaptureService(
            { encryptMessage: async (m: string) => m } as any,
            { stopAllStreams: async () => {} } as any,
            service
        );

        const report = await faceCaptureService.inspectStream(fakeStream);
        expect(report.virtualCamera).toBeTrue();
        expect(report.phoneCamera).toBeFalse();
        expect(report.videoInputCount).toBe(2);
        expect(report.riskLevel).toBe("high");
        expect(report.reasons).toContain("virtual_camera_label");
        expect(report.reasons).toContain("missing_hardware_capabilities");
        expect(report.reasons).toContain("suspicious_resolution");
        expect(faceCaptureService.lastSignalReport).toEqual(report);
    });
});
