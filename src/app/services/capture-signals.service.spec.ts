import * as ar from "../../assets/i18n/ar.json";
import * as br from "../../assets/i18n/br.json";
import * as cn from "../../assets/i18n/cn.json";
import * as en from "../../assets/i18n/en.json";
import * as es from "../../assets/i18n/es.json";
import * as fr from "../../assets/i18n/fr.json";
import * as hindi from "../../assets/i18n/in.json";
import * as ja from "../../assets/i18n/ja.json";
import * as kr from "../../assets/i18n/kr.json";
import * as ph from "../../assets/i18n/ph.json";
import * as ru from "../../assets/i18n/ru.json";
import * as th from "../../assets/i18n/th.json";
import * as ur from "../../assets/i18n/ur.json";

import { CaptureSignalsService } from "./capture-signals.service";
import { FaceCaptureService } from "./face-capture.service";

const LOCALES: Record<string, any> = { ar, br, cn, en, es, fr, in: hindi, ja, kr, ph, ru, th, ur };

describe("CaptureSignalsService (#94)", () => {
    let service: CaptureSignalsService;

    beforeEach(() => {
        service = new CaptureSignalsService();
    });

    it("classifies standard physical cameras as neither virtual nor phone bridge", () => {
        for (const label of ["FaceTime HD Camera (Built-in)", "FaceTime HD Camera", "Integrated Webcam", "Logitech C920", "Logitech BRIO 4K Stream Edition"]) {
            expect(service.classifyDeviceLabel(label)).toEqual({
                virtualCamera: false,
                phoneCamera: false,
            });
        }
    });

    it("does not flag ordinary names that only contain virtual-camera letters inside another word", () => {
        for (const label of ["Observation Camera", "Robson HD Camera", "My Webcam"]) {
            expect(service.classifyDeviceLabel(label)).toEqual({
                virtualCamera: false,
                phoneCamera: false,
            });
        }
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
            "ManyCam",
            "ManyCam Virtual Webcam",
            "Snap Camera",
            "XSplit VCam",
            "SplitCam Video Driver",
            "CamTwist",
            "mmhmm Camera",
            "Dummy video device (0x0000)",
            "fake_device_0",
            "Fake-Camera",
            "fakecam",
            "OBSCamera",
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

describe("virtual camera copy (#167)", () => {
    it("has the warning and camera selector in every locale", () => {
        for (const [name, mod] of Object.entries(LOCALES)) {
            const root = mod?.liveness ? mod : mod?.default;
            const warning = root?.liveness?.virtual_camera_warning;
            const select = root?.liveness?.select_camera;

            expect(typeof warning === "string" && warning.trim().length > 0).withContext(`${name} warning`).toBeTrue();
            expect(typeof select === "string" && select.trim().length > 0).withContext(`${name} select`).toBeTrue();
            expect(warning).not.toBe("liveness.virtual_camera_warning");
            expect(select).not.toBe("liveness.select_camera");
        }
    });
});
