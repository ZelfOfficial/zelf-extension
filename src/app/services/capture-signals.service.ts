import { Injectable } from "@angular/core";

export interface VideoInputSummary {
    deviceId: string;
    label: string;
    groupId: string;
    virtualCamera: boolean;
    phoneCamera: boolean;
}

export interface TrackSettingsSummary {
    width?: number;
    height?: number;
    frameRate?: number;
    facingMode?: string;
    aspectRatio?: number;
    resizeMode?: string;
    deviceId?: string;
    groupId?: string;
}

export interface EnvironmentIntegritySummary {
    installType: "normal" | "development" | "sideload" | "admin" | "other" | "unknown";
    runtimeId: string;
    nativeIntegrity: boolean;
    tamperedApis: string[];
}

export interface CaptureSignalReport {
    capturedAt: string;
    deviceLabel: string;
    deviceId: string;
    groupId: string;
    virtualCamera: boolean;
    phoneCamera: boolean;
    videoInputCount: number;
    videoInputs: VideoInputSummary[];
    settings: TrackSettingsSummary;
    exposedCapabilities: string[];
    hasHardwareCapabilities: boolean | null;
    suspiciousResolution: boolean;
    environment: EnvironmentIntegritySummary;
    riskLevel: "low" | "medium" | "high";
    reasons: string[];
}

const PHONE_BRIDGE_CAMERA_REGEX = /\b(continuity|iphone|ipad|camo|droidcam|epoccam|iriun)\b/i;

const VIRTUAL_CAMERA_REGEX =
    /\b(virtual|obs|manycam|xsplit|snap\s*camera|vcam|e2esoft|altercam|splitcam|camtwist|mmhmm|fake|dummy|loopback|avatarcam|youcam)\b/i;

const HARDWARE_CAPABILITY_KEYS = [
    "exposureMode",
    "exposureCompensation",
    "exposureTime",
    "focusMode",
    "focusDistance",
    "whiteBalanceMode",
    "colorTemperature",
    "iso",
    "brightness",
    "contrast",
    "saturation",
    "sharpness",
    "zoom",
    "torch",
] as const;

@Injectable({
    providedIn: "root",
})
export class CaptureSignalsService {
    /**
     * Classify a camera label against the Continuity/phone camera allowlist first,
     * then against known virtual camera patterns.
     */
    classifyDeviceLabel(label?: string | null): { virtualCamera: boolean; phoneCamera: boolean } {
        const normalized = String(label || "").trim();
        if (!normalized) {
            return { virtualCamera: false, phoneCamera: false };
        }

        if (PHONE_BRIDGE_CAMERA_REGEX.test(normalized)) {
            return { virtualCamera: false, phoneCamera: true };
        }

        if (VIRTUAL_CAMERA_REGEX.test(normalized)) {
            return { virtualCamera: true, phoneCamera: false };
        }

        return { virtualCamera: false, phoneCamera: false };
    }

    /**
     * Inspect a video MediaStreamTrack's settings and hardware capabilities.
     */
    inspectTrack(track?: MediaStreamTrack | null): {
        deviceLabel: string;
        settings: TrackSettingsSummary;
        exposedCapabilities: string[];
        hasHardwareCapabilities: boolean | null;
        suspiciousResolution: boolean;
    } {
        if (!track) {
            return {
                deviceLabel: "",
                settings: {},
                exposedCapabilities: [],
                hasHardwareCapabilities: null,
                suspiciousResolution: false,
            };
        }

        const rawSettings: MediaTrackSettings = typeof track.getSettings === "function" ? track.getSettings() || {} : {};
        const settings: TrackSettingsSummary = {
            width: typeof rawSettings.width === "number" ? rawSettings.width : undefined,
            height: typeof rawSettings.height === "number" ? rawSettings.height : undefined,
            frameRate: typeof rawSettings.frameRate === "number" ? Math.round(rawSettings.frameRate) : undefined,
            facingMode: typeof rawSettings.facingMode === "string" ? rawSettings.facingMode : undefined,
            aspectRatio: typeof rawSettings.aspectRatio === "number" ? Number(rawSettings.aspectRatio.toFixed(4)) : undefined,
            resizeMode: typeof (rawSettings as any).resizeMode === "string" ? (rawSettings as any).resizeMode : undefined,
            deviceId: typeof rawSettings.deviceId === "string" ? rawSettings.deviceId : undefined,
            groupId: typeof rawSettings.groupId === "string" ? rawSettings.groupId : undefined,
        };

        let exposedCapabilities: string[] = [];
        let hasHardwareCapabilities: boolean | null = null;

        const getCapabilitiesFn = (track as any).getCapabilities;
        if (typeof getCapabilitiesFn === "function") {
            try {
                const rawCaps = getCapabilitiesFn.call(track) || {};
                exposedCapabilities = Object.keys(rawCaps);
                hasHardwareCapabilities = HARDWARE_CAPABILITY_KEYS.some((key) => key in rawCaps);
            } catch {
                hasHardwareCapabilities = null;
            }
        }

        const width = settings.width || 0;
        const height = settings.height || 0;
        const isDesktopScreenResolution =
            (width === 1920 && height === 1080) ||
            (width === 2560 && height === 1440) ||
            (width === 3840 && height === 2160);
        const suspiciousResolution = Boolean(hasHardwareCapabilities === false && isDesktopScreenResolution);

        return {
            deviceLabel: track.label || "",
            settings,
            exposedCapabilities,
            hasHardwareCapabilities,
            suspiciousResolution,
        };
    }

    /**
     * Enumerate available video input devices and classify each label.
     */
    async listVideoInputs(): Promise<VideoInputSummary[]> {
        if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.enumerateDevices !== "function") {
            return [];
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return (devices || [])
                .filter((device) => device.kind === "videoinput")
                .map((device, index) => {
                    const label = device.label || `Camera ${index + 1}`;
                    const classification = this.classifyDeviceLabel(label);
                    return {
                        deviceId: device.deviceId || "",
                        label,
                        groupId: device.groupId || "",
                        virtualCamera: classification.virtualCamera,
                        phoneCamera: classification.phoneCamera,
                    };
                });
        } catch {
            return [];
        }
    }

    /**
     * Check whether a function is still backed by the browser's native implementation.
     */
    isNativeFunction(fn: unknown): boolean {
        if (typeof fn !== "function") return false;
        try {
            const source = Function.prototype.toString.call(fn);
            return source.includes("[native code]");
        } catch {
            return false;
        }
    }

    /**
     * Inspect Chrome extension runtime & native media/canvas API integrity.
     */
    async checkEnvironmentIntegrity(): Promise<EnvironmentIntegritySummary> {
        let installType: EnvironmentIntegritySummary["installType"] = "unknown";
        let runtimeId = "";

        const chromeGlobal = typeof chrome !== "undefined" ? chrome : undefined;
        if (chromeGlobal?.runtime?.id) {
            runtimeId = String(chromeGlobal.runtime.id);
        }

        if (typeof chromeGlobal?.management?.getSelf === "function") {
            try {
                const selfInfo = await new Promise<chrome.management.ExtensionInfo | null>((resolve) => {
                    try {
                        chromeGlobal.management.getSelf((info) => {
                            if (chromeGlobal.runtime?.lastError) {
                                resolve(null);
                                return;
                            }
                            resolve(info || null);
                        });
                    } catch {
                        resolve(null);
                    }
                });
                if (selfInfo?.installType) {
                    installType = selfInfo.installType as EnvironmentIntegritySummary["installType"];
                }
            } catch {
                installType = "unknown";
            }
        }

        const apiChecks: Array<{ name: string; fn: unknown }> = [
            {
                name: "navigator.mediaDevices.getUserMedia",
                fn: typeof navigator !== "undefined" ? navigator.mediaDevices?.getUserMedia : undefined,
            },
            {
                name: "navigator.mediaDevices.enumerateDevices",
                fn: typeof navigator !== "undefined" ? navigator.mediaDevices?.enumerateDevices : undefined,
            },
            {
                name: "MediaStreamTrack.prototype.getSettings",
                fn: typeof MediaStreamTrack !== "undefined" ? MediaStreamTrack.prototype?.getSettings : undefined,
            },
            {
                name: "HTMLCanvasElement.prototype.toDataURL",
                fn: typeof HTMLCanvasElement !== "undefined" ? HTMLCanvasElement.prototype?.toDataURL : undefined,
            },
        ];

        const tamperedApis: string[] = [];
        for (const check of apiChecks) {
            if (check.fn !== undefined && !this.isNativeFunction(check.fn)) {
                tamperedApis.push(check.name);
            }
        }

        return {
            installType,
            runtimeId,
            nativeIntegrity: tamperedApis.length === 0,
            tamperedApis,
        };
    }

    /**
     * Collect all client capture risk signals for an active MediaStream or video MediaStreamTrack.
     */
    async collectSignals(streamOrTrack?: MediaStream | MediaStreamTrack | null): Promise<CaptureSignalReport> {
        const track = this._extractVideoTrack(streamOrTrack);
        const trackInspection = this.inspectTrack(track);
        const [videoInputs, environment] = await Promise.all([this.listVideoInputs(), this.checkEnvironmentIntegrity()]);

        const matchedInput = videoInputs.find(
            (input) =>
                (trackInspection.settings.deviceId && input.deviceId === trackInspection.settings.deviceId) ||
                (trackInspection.deviceLabel && input.label === trackInspection.deviceLabel)
        );

        const effectiveLabel = trackInspection.deviceLabel || matchedInput?.label || "";
        const labelClass = this.classifyDeviceLabel(effectiveLabel);

        const reasons: string[] = [];
        if (labelClass.virtualCamera) {
            reasons.push("virtual_camera_label");
        }
        if (labelClass.phoneCamera) {
            reasons.push("phone_bridge_camera");
        }
        if (trackInspection.hasHardwareCapabilities === false) {
            reasons.push("missing_hardware_capabilities");
        }
        if (trackInspection.suspiciousResolution) {
            reasons.push("suspicious_resolution");
        }
        if (!environment.nativeIntegrity) {
            reasons.push("tampered_media_api");
        }
        if (environment.installType === "development" || environment.installType === "sideload") {
            reasons.push("unpacked_extension");
        }

        let riskLevel: CaptureSignalReport["riskLevel"] = "low";
        if (labelClass.virtualCamera || !environment.nativeIntegrity) {
            riskLevel = "high";
        } else if (
            labelClass.phoneCamera ||
            trackInspection.hasHardwareCapabilities === false ||
            trackInspection.suspiciousResolution ||
            environment.installType === "development"
        ) {
            riskLevel = "medium";
        }

        return {
            capturedAt: new Date().toISOString(),
            deviceLabel: effectiveLabel,
            deviceId: trackInspection.settings.deviceId || matchedInput?.deviceId || "",
            groupId: trackInspection.settings.groupId || matchedInput?.groupId || "",
            virtualCamera: labelClass.virtualCamera,
            phoneCamera: labelClass.phoneCamera,
            videoInputCount: videoInputs.length,
            videoInputs,
            settings: trackInspection.settings,
            exposedCapabilities: trackInspection.exposedCapabilities,
            hasHardwareCapabilities: trackInspection.hasHardwareCapabilities,
            suspiciousResolution: trackInspection.suspiciousResolution,
            environment,
            riskLevel,
            reasons,
        };
    }

    private _extractVideoTrack(streamOrTrack?: MediaStream | MediaStreamTrack | null): MediaStreamTrack | null {
        if (!streamOrTrack) return null;
        if (typeof (streamOrTrack as MediaStream).getVideoTracks === "function") {
            const tracks = (streamOrTrack as MediaStream).getVideoTracks();
            return tracks?.[0] || null;
        }
        return streamOrTrack as MediaStreamTrack;
    }
}
