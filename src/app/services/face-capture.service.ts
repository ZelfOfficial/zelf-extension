import { Injectable } from "@angular/core";
import * as faceapi from "@vladmandic/face-api";

import { HttpWrapperService } from "app/http-wrapper.service";
import { CaptureSignalReport, CaptureSignalsService, VideoInputSummary } from "app/services/capture-signals.service";
import { MediaStreamService } from "app/services/media-stream.service";
import { isDevBiometricsBypassEnabled, loadDevBiometricsFixtureBase64 } from "app/utils/dev-biometrics-bypass.util";
import { FacingMode, OvalData } from "../biometrics-general/sdk.models";

export interface FaceCaptureRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FaceFramingEvaluation {
    isOk: boolean;
    direction: string;
    reason: "ok" | "not_centered" | "too_far";
}

export interface FaceFrameDetectionResult {
    hasFace: boolean;
    detection: any | null;
    evaluation: FaceFramingEvaluation | null;
}

@Injectable({
    providedIn: "root",
})
export class FaceCaptureService {
    static readonly DEFAULT_ASPECT_RATIO = 0.75;
    static readonly CAPTURE_JPEG_QUALITY = 0.92;

    lastSignalReport: CaptureSignalReport | null = null;

    constructor(
        private _httpWrapperService: HttpWrapperService,
        private _mediaStreamService: MediaStreamService,
        private _captureSignalsService: CaptureSignalsService
    ) {}

    /**
     * Collect capture risk signals for a live MediaStream or HTMLVideoElement and cache the report.
     */
    async inspectStream(streamOrVideo?: MediaStream | HTMLVideoElement | null): Promise<CaptureSignalReport> {
        const stream =
            streamOrVideo && "srcObject" in streamOrVideo
                ? (streamOrVideo.srcObject as MediaStream | null)
                : (streamOrVideo as MediaStream | null);
        const report = await this._captureSignalsService.collectSignals(stream);
        this.lastSignalReport = report;
        return report;
    }

    /**
     * List available video input devices for camera selection.
     */
    async listVideoInputs(): Promise<VideoInputSummary[]> {
        return this._captureSignalsService.listVideoInputs();
    }

    /**
     * Build standard camera MediaTrackConstraints used across all face capture flows.
     */
    buildCameraConfiguration(options?: {
        isLandscape?: boolean;
        displayMode?: "auto" | "portrait";
        deviceId?: string;
    }): {
        facingMode: FacingMode;
        frameRate: { ideal: number; max: number };
        height: { ideal: number };
        width: { ideal: number };
        deviceId?: { exact: string };
    } {
        const displayMode = options?.displayMode ?? "auto";
        const isLandscape = options?.isLandscape ?? true;

        const baseConfig =
            displayMode === "portrait"
                ? {
                      width: { ideal: 1920 },
                      height: { ideal: 1080 },
                      facingMode: FacingMode.USER,
                      frameRate: { ideal: 30, max: 30 },
                  }
                : {
                      height: { ideal: isLandscape ? 1080 : 1920 },
                      width: { ideal: isLandscape ? 1920 : 1080 },
                      facingMode: FacingMode.USER,
                      frameRate: { ideal: 30, max: 30 },
                  };

        if (options?.deviceId) {
            return {
                ...baseConfig,
                deviceId: { exact: options.deviceId },
            };
        }

        return baseConfig;
    }

    /**
     * Compute the face-oval center, radius, and centering margins for a frame or viewport.
     */
    getCenterAndRadius(
        height: number,
        width: number,
        options?: { aspectRatio?: number; radiusYRatio?: number }
    ): OvalData {
        const aspectRatio = options?.aspectRatio ?? FaceCaptureService.DEFAULT_ASPECT_RATIO;
        const radiusYRatio = options?.radiusYRatio ?? 0.42;

        const data: OvalData = {
            center: {
                x: width / 2,
                y: height / 2,
            },
            radius: {
                x: 0,
                y: 0,
            },
            margin: {
                y: height * 0.05,
                x: 0,
            },
        };

        data.margin.x = data.margin.y * 0.8;
        data.radius.y = height * radiusYRatio;
        data.radius.x = data.radius.y * aspectRatio;

        if (data.radius.x * 2 >= width) {
            data.radius.x = width * 0.48;
            data.radius.y = data.radius.x / aspectRatio;
        }

        return data;
    }

    /**
     * Evaluate whether the detected face is centered in the oval and sufficiently close.
     */
    evaluateFaceFraming(
        nosePoint: { x: number; y: number },
        landmarks: { imageHeight: number; imageWidth: number },
        realOval: OvalData,
        realDimensions: { height: number; width: number; offsetX?: number },
        constraints: { threshold: number; minPixels: number }
    ): FaceFramingEvaluation {
        const { center, margin } = realOval || { center: { x: 0, y: 0 }, margin: { x: 0, y: 0 } };
        const inRangeX = nosePoint.x >= center.x - margin.x && nosePoint.x <= center.x + margin.x;
        const inRangeY = nosePoint.y >= center.y && nosePoint.y <= center.y + margin.y * 2.5;
        const isCentered = inRangeX && inRangeY;

        let direction = "";
        if (!inRangeX) direction += nosePoint.x < center.x - margin.x ? "←" : "→";
        if (!inRangeY) direction += nosePoint.y < center.y ? "↓" : "↑";

        const effectiveWidth = Math.max(1, (realDimensions.width || 0) - (realDimensions.offsetX || 0));
        const totalImageArea = Math.max(1, Math.floor((realDimensions.height || 0) * effectiveWidth));
        const totalFaceArea = (landmarks?.imageHeight || 0) * (landmarks?.imageWidth || 0);
        const faceProportion = totalFaceArea / totalImageArea;

        const isTooFar =
            faceProportion < constraints.threshold ||
            (landmarks?.imageHeight || 0) < constraints.minPixels ||
            (landmarks?.imageWidth || 0) < constraints.minPixels;

        if (isTooFar) {
            return {
                isOk: false,
                direction,
                reason: "too_far",
            };
        }

        if (!isCentered) {
            return {
                isOk: false,
                direction,
                reason: "not_centered",
            };
        }

        return {
            isOk: true,
            direction: "",
            reason: "ok",
        };
    }

    /**
     * Detect faces on an HTMLImageElement or HTMLVideoElement using SsdMobilenetv1 + 68 landmarks.
     */
    async detectFacesWithLandmarks(
        input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
        minConfidence = 0.2
    ): Promise<any[]> {
        return faceapi.detectAllFaces(input as any, new faceapi.SsdMobilenetv1Options({ minConfidence })).withFaceLandmarks();
    }

    /**
     * Compute object-fit: cover oval crop rectangles for native source and display coordinates.
     */
    computeOvalCrops(
        videoDim: { width?: number; height?: number },
        realDim: { width?: number; height?: number },
        videoOval?: OvalData
    ): { original: FaceCaptureRect; display: FaceCaptureRect } | null {
        if (!videoDim?.width || !videoDim?.height) return null;
        if (!realDim?.width || !realDim?.height) return null;

        const ovalRadiusX = videoOval?.radius?.x || 0;
        const centerX = videoOval?.center?.x ?? videoDim.width / 2;

        if (!ovalRadiusX) return null;

        const displayWidth = Math.min(2.8 * ovalRadiusX, videoDim.width);
        const display: FaceCaptureRect = {
            x: Math.max(0, centerX - displayWidth / 2),
            y: 0,
            width: displayWidth,
            height: videoDim.height,
        };

        const coverScale = Math.max(videoDim.width / realDim.width, videoDim.height / realDim.height);
        const visibleSrcWidth = videoDim.width / coverScale;
        const visibleSrcHeight = videoDim.height / coverScale;
        const offsetSrcX = (realDim.width - visibleSrcWidth) / 2;
        const offsetSrcY = (realDim.height - visibleSrcHeight) / 2;

        const original: FaceCaptureRect = {
            x: offsetSrcX + display.x / coverScale,
            y: offsetSrcY + display.y / coverScale,
            width: display.width / coverScale,
            height: display.height / coverScale,
        };

        return { original, display };
    }

    /**
     * Downscale a rectangle so that its longest edge does not exceed maxEdge.
     */
    capRect(rect: FaceCaptureRect, maxEdge: number): FaceCaptureRect {
        const longest = Math.max(rect.width, rect.height);
        if (longest <= maxEdge) return rect;

        const scale = maxEdge / longest;
        return {
            x: rect.x,
            y: rect.y,
            width: Math.round(rect.width * scale),
            height: Math.round(rect.height * scale),
        };
    }

    /**
     * Draw a cropped region onto a target canvas.
     */
    drawCrop(
        canvas: HTMLCanvasElement,
        img: HTMLImageElement,
        src: FaceCaptureRect,
        dst: { width: number; height: number; offsetX?: number; offsetY?: number }
    ): void {
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = dst.width;
        canvas.height = dst.height;

        if (typeof dst.offsetX === "number") {
            canvas.style.marginLeft = `${dst.offsetX}px`;
        }
        if (typeof dst.offsetY === "number") {
            canvas.style.marginTop = `${dst.offsetY}px`;
        }

        context.clearRect(0, 0, dst.width, dst.height);
        context.drawImage(img, src.x, src.y, src.width, src.height, 0, 0, dst.width, dst.height);
    }

    /**
     * Strip any data URL prefix and return raw base64 JPEG payload.
     */
    extractRawBase64(dataUrlOrBase64: string): string {
        if (!dataUrlOrBase64) return "";
        return dataUrlOrBase64.replace(/^data:.*;base64,/, "");
    }

    /**
     * Package and PGP-encrypt the captured face base64 payload through a single pipeline entry point.
     */
    async encryptCapturePayload(dataUrlOrBase64: string): Promise<string> {
        const rawBase64 = this.extractRawBase64(dataUrlOrBase64);
        return this._httpWrapperService.encryptMessage(rawBase64);
    }

    /**
     * Check whether the dev biometrics bypass is active (non-prod only).
     */
    isDevBypassEnabled(): boolean {
        return isDevBiometricsBypassEnabled();
    }

    /**
     * Load the dev biometrics fixture as a data URL (`data:image/jpeg;base64,...`).
     */
    async loadDevBypassDataUrl(): Promise<{ rawBase64: string; dataUrl: string }> {
        const rawBase64 = await loadDevBiometricsFixtureBase64();
        return {
            rawBase64,
            dataUrl: `data:image/jpeg;base64,${rawBase64}`,
        };
    }

    /**
     * Stop camera tracks on a specific video element or stop all active media streams.
     */
    async stopCameraStream(videoElement?: HTMLVideoElement | null, stopAll = false): Promise<void> {
        try {
            if (videoElement?.srcObject instanceof MediaStream) {
                const stream = videoElement.srcObject as MediaStream;
                stream.getTracks().forEach((track) => track.stop());
                videoElement.srcObject = null;
            }
            if (stopAll) {
                await this._mediaStreamService.stopAllStreams();
            }
        } catch (error) {
            console.warn("Error stopping camera stream:", error);
        }
    }
}
