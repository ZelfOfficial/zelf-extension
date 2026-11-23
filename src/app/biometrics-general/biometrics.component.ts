import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import * as faceapi from "@vladmandic/face-api";
import { debounce, DebouncedFunc } from "lodash";
import { WebcamComponent, WebcamImage, WebcamInitError, WebcamModule } from "ngx-webcam";
import { Observable, Subject, takeUntil } from "rxjs";

import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, Renderer2, ViewChild } from "@angular/core";
import { FlexLayoutModule } from "@angular/flex-layout";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";

import { HttpWrapperService } from "app/http-wrapper.service";
import { CaptureSignalReport, VideoInputSummary } from "app/services/capture-signals.service";
import { FaceCaptureService } from "app/services/face-capture.service";
import { isCameraAbortError, MediaStreamService } from "app/services/media-stream.service";
import { isDevBiometricsBypassEnabled, loadDevBiometricsFixtureBase64 } from "app/utils/dev-biometrics-bypass.util";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { WalletService } from "../wallet.service";
import { CameraData, directionImage, ErrorFace, FaceData, FacingMode, Intervals, OvalData, ResponseData } from "./sdk.models";

@Component({
    imports: [
        CommonModule,
        FlexLayoutModule,
        MatButtonModule,
        MatDialogModule,
        MatProgressBarModule,
        MatProgressSpinnerModule,
        TranslocoModule,
        WebcamModule,
        ZelfLoaderComponent,
    ],
    selector: "biometrics-general",
    styleUrls: ["./biometrics.component.scss"],
    templateUrl: "./biometrics.component.html",
})
export class BiometricsGeneralComponent implements OnInit, OnDestroy {
    @ViewChild("maskResult", { static: false }) public maskResultCanvasRef: ElementRef | undefined;
    @ViewChild("toSend", { static: false }) public ToSendCanvasRef: ElementRef | undefined;
    @ViewChild("webcam", { static: false }) public webcamRef?: WebcamComponent;

    @Input() displayMode: "auto" | "portrait" = "auto";
    @Input() maxDisplayHeight = 600;
    @Input() maxDisplayWidth = 420;

    /** JPEG quality used by the other face flows (`canvas.toDataURL("image/jpeg")` default). */
    private static readonly CAPTURE_JPEG_QUALITY = 0.92;
    /** One SsdMobilenetv1 pass at a time, then wait this long before the next. */
    private static readonly DETECTION_INTERVAL_MS = 1000;
    private static readonly VIDEO_READY_POLL_MS = 250;

    @Output() canNavigate: EventEmitter<boolean> = new EventEmitter<boolean>();
    @Output() error: EventEmitter<any> = new EventEmitter<any>();
    @Output() imageCaptured: EventEmitter<string> = new EventEmitter<string>();

    private _resizeObserver?: ResizeObserver;
    private _resizeUnlisten: () => void = () => {};

    private _debounceWindowResize: DebouncedFunc<() => void>;
    private _intervals: Intervals = {};
    private _takePicture: Subject<void> = new Subject<void>();
    private unsubscriber$: Subject<void> = new Subject<void>();
    private _released = false;
    private _detecting = false;
    private _unbindPreview: () => void = () => undefined;

    /** Toggled to remount ngx-webcam after the camera was released and the screen is still open. */
    cameraAttached = true;

    //ACTIVE DEBUG GRAPHIC MODE
    debugIndex!: number;
    debugText: string = "debug";
    isActiveDebug!: Boolean;

    aspectRatio = 0.75;
    /** DOM oval so the guide stays visible when a dark color-scheme hides the canvas stroke. */
    ovalGuide: { left: number; top: number; width: number; height: number } | null = null;
    camera!: CameraData;
    deviceData: any;
    direction!: directionImage;
    errorFace!: ErrorFace | null;
    face!: FaceData;
    lastFace: any;
    marginX!: number;
    marginY!: number;
    response!: ResponseData;
    signalReport: CaptureSignalReport | null = null;
    videoInputs: VideoInputSummary[] = [];
    selectedDeviceId = "";

    constructor(
        private _changeDetectorRef: ChangeDetectorRef,
        private _httpWrapperService: HttpWrapperService,
        private _mediaStreamService: MediaStreamService,
        private _renderer: Renderer2,
        private _translocoService: TranslocoService,
        private _walletService: WalletService,
        private _host: ElementRef<HTMLElement>,
        private _faceCaptureService: FaceCaptureService
    ) {
        this.deviceData = this._walletService.getDeviceData();

        this._debounceWindowResize = debounce(async () => {
            if (this._released) return;

            this.canNavigate.emit(false);

            await this._setMaxVideoDimensions();

            this._startNgxVideoInterval();
        }, 300);
    }

    async ngOnInit(): Promise<void> {
        if (isDevBiometricsBypassEnabled()) {
            await this._runDevBiometricsBypass();
            return;
        }

        await this._startDefaultValues();

        this._unbindPreview = this._mediaStreamService.bindPreviewLifecycle({
            onHidden: () => this._pausePreview(),
            onResume: () => this._resumePreview(),
        });

        this._resizeUnlisten = this._renderer.listen("window", "resize", this._debounceWindowResize);

        if (this.displayMode === "portrait" && typeof ResizeObserver !== "undefined") {
            const parent = this._host.nativeElement.parentElement;

            if (parent) {
                this._resizeObserver = new ResizeObserver(() => this._debounceWindowResize());
                this._resizeObserver.observe(parent);
            }
        }

        this._walletService.faceapi$.pipe(takeUntil(this.unsubscriber$)).subscribe(async (isLoaded) => {
            if (this._released) return;

            this.canNavigate.emit(false);

            this.camera.isLoading = !isLoaded;

            if (!isLoaded) return;

            await this._setMaxVideoDimensions();

            this._startNgxVideoInterval();
        });
    }

    ngOnDestroy(): void {
        this._releaseCamera();

        this.canNavigate.emit(true);

        if (this.unsubscriber$.closed) return;

        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }

    public get takePicture$(): Observable<void> {
        return this._takePicture.asObservable();
    }

    private _calculateDisplayDimensions() {
        const isLandscape = window.innerHeight < window.innerWidth;

        if (this.displayMode === "portrait") {
            const host = this._host.nativeElement;
            const parent = host.parentElement;
            const availableWidth = Math.floor(parent?.clientWidth || host.clientWidth || window.innerWidth);
            const availableHeight = Math.floor(parent?.clientHeight || 0);
            const width = Math.max(160, Math.min(this.maxDisplayWidth, availableWidth || Math.ceil(window.innerWidth * 0.92)));
            const heightLimit = availableHeight > 0 ? availableHeight : Math.round(width * 1.25);
            const height = Math.max(200, Math.min(this.maxDisplayHeight, heightLimit));

            return {
                isLandscape: false,
                height,
                width,
            };
        }

        const maxAvailableHeight = Math.ceil(window.innerHeight * 0.7);
        const maxAvailableWidth = Math.ceil(window.innerWidth * 0.9);
        const targetAspectRatio = 16 / 9;

        if (isLandscape) {
            const maxHeight = Math.min(maxAvailableHeight, 1920);
            const calculatedWidth = Math.round(maxHeight * targetAspectRatio);
            const maxWidth = Math.min(maxAvailableWidth, 1920);

            return {
                isLandscape,
                height: maxHeight,
                width: Math.min(calculatedWidth, maxWidth),
            };
        } else {
            const maxHeight = Math.min(maxAvailableHeight, 1920);
            const calculatedWidth = Math.round(maxHeight * targetAspectRatio);
            const maxWidth = Math.min(maxAvailableWidth, 1080);

            return {
                isLandscape,
                height: maxHeight,
                width: Math.min(calculatedWidth, maxWidth),
            };
        }
    }

    private _checkVideoStreamReady = () => {
        if (this._released) return;

        const videoNgx = this.webcamRef?.nativeVideoElement;

        if (!videoNgx) return;

        clearInterval(this._intervals.checkNgxVideo);

        this._intervals.checkNgxVideo = null;

        if (videoNgx.readyState >= 2) {
            this._startFaceDetectionInterval();
            this.canNavigate.emit(true);
            void this._inspectActiveStream(videoNgx);
        } else {
            videoNgx.addEventListener(
                "loadeddata",
                () => {
                    this._startFaceDetectionInterval();
                    this.canNavigate.emit(true);
                    void this._inspectActiveStream(videoNgx);

                    this._setVideoDimensions(videoNgx);
                    this._drawOvalCenterAndMask();
                },
                { once: true }
            );
        }

        this._setVideoDimensions(videoNgx);
        this._drawOvalCenterAndMask();
    };

    private async _inspectActiveStream(videoElement: HTMLVideoElement): Promise<void> {
        const report = await this._faceCaptureService.inspectStream(videoElement);
        this.signalReport = report;
        this.videoInputs = report.videoInputs || [];
        if (report.deviceId && !this.selectedDeviceId) {
            this.selectedDeviceId = report.deviceId;
        }
        this._changeDetectorRef.markForCheck();
    }

    async onCameraChange(deviceId: string): Promise<void> {
        if (!deviceId || deviceId === this.selectedDeviceId) return;
        this.selectedDeviceId = deviceId;
        await this._setMaxVideoDimensions();
        this._startNgxVideoInterval();
    }

    private _scheduleNextDetection(): void {
        if (this._released || this.response?.base64Image || this._detecting) return;

        clearTimeout(this._intervals.detectFace);
        this._intervals.detectFace = setTimeout(() => {
            this._intervals.detectFace = null;
            void this._detectFace();
        }, BiometricsGeneralComponent.DETECTION_INTERVAL_MS);
    }

    private _detectFace = async (): Promise<void> => {
        if (this._released || this.response?.base64Image || this._detecting) return;

        const video = this.webcamRef?.nativeVideoElement;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
            this._scheduleNextDetection();
            return;
        }

        this._detecting = true;

        try {
            const detection = await this._faceCaptureService.detectFacesWithLandmarks(video, 0.2);

            if (this._released || this.response?.base64Image) return;

            if (detection.length > 0) {
                this.lastFace = detection[0];
                this.errorFace = null;

                this.camera.dimensions.real = { height: 0, width: 0, offsetX: 0, offsetY: 0 };
                this._setResultDimensions("real", video.videoHeight, video.videoWidth);
                this.face.real = this._getCenterAndRadius(video.videoHeight, video.videoWidth);

                this._drawOvalCenterAndMask();
                this._isFaceCentered(this.lastFace.landmarks.getNose()[3]);
                this._isFaceClose(this.lastFace.landmarks);

                const context = this.maskResultCanvasRef?.nativeElement?.getContext("2d", { willReadFrequently: true });
                if (context) this._drawStatusOval(context, !this.errorFace);

                if (!this.errorFace) {
                    this.face.successPosition += 1;
                } else {
                    this.face.successPosition = 0;
                }

                if (!this.errorFace && this.face.successPosition > 2) {
                    this.face.successPosition = 0;
                    this._captureCurrentFrame(video);
                    return;
                }
            }

            this._changeDetectorRef.markForCheck();
        } catch {
            console.error("Face detection failed");
        } finally {
            this._detecting = false;
            if (!this._released && !this.response?.base64Image) {
                this._scheduleNextDetection();
            }
        }
    };

    private _drawOvalCenterAndMask(): void {
        const videoDim = this.camera.dimensions.video;
        const maskResultCanvas = this.maskResultCanvasRef?.nativeElement;

        maskResultCanvas.height = videoDim.height;
        maskResultCanvas.width = videoDim.width;
        maskResultCanvas.style.colorScheme = "only light";

        const ctx: CanvasRenderingContext2D = maskResultCanvas.getContext("2d");

        ctx.clearRect(0, 0, videoDim.width || 0, videoDim.height || 0);

        const portrait = this.displayMode === "portrait";

        ctx.fillStyle = portrait ? "rgba(8, 8, 8, 0.55)" : "rgba(255, 255, 255, 0.75)";
        ctx.fillRect(0, 0, videoDim.width || 0, videoDim.height || 0);
        ctx.globalCompositeOperation = "destination-out";

        const { center, radius } = this.face.video || { center: { x: 0, y: 0 }, radius: { x: 0, y: 0 } };

        ctx.fillStyle = "rgba(255, 255, 255, 1)";
        ctx.beginPath();
        ctx.ellipse(center?.x, center?.y, radius.x, radius.y, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.closePath();
        ctx.globalCompositeOperation = "source-over";

        this._syncOvalGuide();
    }

    private _drawStatusOval(ctx: any, isOk?: any): void {
        const { center, radius } = this.face.video || { center: { x: 0, y: 0 }, radius: { x: 0, y: 0 } };

        ctx.beginPath();
        ctx.ellipse(center.x, center.y, radius.x, radius.y, 0, 0, 2 * Math.PI);
        ctx.lineWidth = 5;
        ctx.strokeStyle = isOk ? "green" : "red";
        ctx.stroke();
        ctx.closePath();

        if (!isOk) {
            if (this.errorFace?.canvas?.includes("↑")) {
                const startX = center.x - 20;
                const startY = center.y - radius.y + 10;

                ctx.drawImage(this.direction.up, startX, startY, 40, 40);
            }

            if (this.errorFace?.canvas?.includes("↓")) {
                const startX = center.x - 20;
                const startY = center.y + radius.y - 50;

                ctx.drawImage(this.direction.down, startX, startY, 40, 40);
            }

            if (this.errorFace?.canvas?.includes("→")) {
                const startX = center.x + radius.x - 50;
                const startY = center.y - 20;

                ctx.drawImage(this.direction.right, startX, startY, 40, 40);
            }

            if (this.errorFace?.canvas?.includes("←")) {
                const startX = center.x - radius.x + 10;
                const startY = center.y - 20;

                ctx.drawImage(this.direction.left, startX, startY, 40, 40);
            }
        }

        this._changeDetectorRef.markForCheck();
    }

    private async _emitBiometricCapture(): Promise<any> {
        if (this.response.isLoading) return;

        this._loading({ result: true });

        const encryptedImage = await this._faceCaptureService.encryptCapturePayload(this.response.base64Image || "");

        this.imageCaptured.emit(encryptedImage);
    }

    /** Local/dev QA only — skip camera and inject bundled selfie for headless QA boxes. */
    private async _runDevBiometricsBypass(): Promise<void> {
        this._setDefaultResponse();
        this.camera = {
            hasPermissions: true,
            isLoading: true,
            isLowQuality: false,
            configuration: this._faceCaptureService.buildCameraConfiguration({ isLandscape: true, displayMode: this.displayMode }),
            dimensions: {
                video: {
                    max: { height: 1, width: 1 },
                },
            },
        };

        try {
            const { dataUrl } = await this._faceCaptureService.loadDevBypassDataUrl();
            this.response.base64Image = dataUrl;
            this.canNavigate.emit(true);
            await this._emitBiometricCapture();
        } catch (error) {
            this.canNavigate.emit(true);
            this.error.emit(error);
        }
    }

    private _getCenterAndRadius = (height: number, width: number) => {
        return this._faceCaptureService.getCenterAndRadius(height, width, {
            aspectRatio: this.aspectRatio,
            radiusYRatio: 0.42,
        });
    };

    private _inRange(value: number, min: number, max: number) {
        return value >= min && value <= max;
    }

    private _isFaceCentered(nose: any): void {
        const faceCenterX = nose.x;
        const faceCenterY = nose.y;

        const { center, margin } = this.face.real || { center: { x: 0, y: 0 }, margin: { x: 0, y: 0 } };

        const inRangeX = this._inRange(faceCenterX, center.x - margin.x, center.x + margin.x);
        const inRangeY = this._inRange(faceCenterY, center.y, center.y + margin.y * 2.5);

        const isFaceCentered = inRangeX && inRangeY;

        if (isFaceCentered) return;

        let direction = "";

        if (!inRangeX) direction += `${faceCenterX < center.x - margin.x ? "←" : "→"}`;
        if (!inRangeY) direction += `${faceCenterY < center.y ? "↓" : "↑"}`;

        this.errorFace = {
            canvas: direction,
            icon: "center_focus_strong",
            subtitle: this._translocoService.translate("liveness.center_your_face_subtitle"),
            title: this._translocoService.translate("liveness.center_your_face"),
        };
    }

    private _isFaceClose(landmarks: faceapi.FaceLandmarks68, minPixels = this.face.minPixels): void {
        const realDim = this.camera.dimensions.real || { center: { x: 0, y: 0 }, margin: { x: 0, y: 0 }, height: 0, width: 0, offsetX: 0 };
        const totalFaceArea = landmarks.imageHeight * landmarks.imageWidth;
        const totalImageArea = Math.floor(realDim.height * (realDim.width - realDim.offsetX));
        const faceProportion = totalFaceArea / totalImageArea;

        if (faceProportion < this.face.threshold || landmarks.imageHeight < minPixels || landmarks.imageWidth < minPixels) {
            this.errorFace = {
                icon: "zoom_in",
                title: this._translocoService.translate("liveness.get_closer"),
                subtitle: this._translocoService.translate("liveness.get_closer_subtitle"),
            };
        }
    }

    private _killIntervals(): void {
        clearInterval(this._intervals.checkNgxVideo);
        clearTimeout(this._intervals.detectFace);
        clearInterval(this._intervals.detectFace);

        this._intervals = {};
    }

    private _loading(paramsLoading: any) {
        const { isLoading = true, start, result } = paramsLoading;
        const key: "camera" | "response" = (start && "camera") || (result && "response");

        if (!key || !this[key]) return;

        this[key].isLoading = isLoading;
    }

    private _startFaceDetectionInterval = (): void => {
        if (this._released || this._detecting || this._intervals.detectFace) return;

        void this._detectFace();
    };

    private _startNgxVideoInterval = (): void => {
        if (this._released) return;

        if (this._intervals.checkNgxVideo) {
            clearInterval(this._intervals.checkNgxVideo);

            this._intervals.checkNgxVideo = null;
        }

        this._intervals.checkNgxVideo = setInterval(this._checkVideoStreamReady, BiometricsGeneralComponent.VIDEO_READY_POLL_MS);
    };

    private _setDefaultCamera = () => {
        const displayDimensions = this._calculateDisplayDimensions();

        this.camera = {
            hasPermissions: true,
            isLoading: true,
            isLowQuality: false,
            configuration: this._cameraConfiguration(displayDimensions.isLandscape),
            dimensions: {
                video: {
                    max: displayDimensions,
                },
            },
        };

        this._changeDetectorRef.markForCheck();
    };

    private _setDefaultDirections = () => {
        this.direction = {
            down: new Image(),
            left: new Image(),
            right: new Image(),
            up: new Image(),
        };

        this.direction.down.crossOrigin = "anonymous";
        this.direction.left.crossOrigin = "anonymous";
        this.direction.right.crossOrigin = "anonymous";
        this.direction.up.crossOrigin = "anonymous";

        this.direction.down.src = "https://cdn.verifik.co/web-sdk/images/down.png";
        this.direction.left.src = "https://cdn.verifik.co/web-sdk/images/left.png";
        this.direction.right.src = "https://cdn.verifik.co/web-sdk/images/right.png";
        this.direction.up.src = "https://cdn.verifik.co/web-sdk/images/up.png";
    };

    private _setDefaultFace = () => {
        this.face = {
            minHeight: 240,
            minPixels: 240,
            successPosition: 0,
            threshold: 0.25,
        };
    };

    private _setDefaultResponse = () => {
        this.response = {
            isLoading: false,
            isFailed: false,
        };
    };

    private async _setMaxVideoDimensions(): Promise<void> {
        const displayDimensions = this._calculateDisplayDimensions();

        this.camera.isLoading = true;
        this._changeDetectorRef.markForCheck();

        return await new Promise((resolve) => {
            setTimeout(() => {
                this.camera.dimensions.video = {
                    max: displayDimensions,
                    ...(this.displayMode === "portrait"
                        ? { width: displayDimensions.width, height: displayDimensions.height }
                        : {}),
                };

                this.camera.configuration = this._cameraConfiguration(displayDimensions.isLandscape);

                this.camera.dimensions.result = undefined;
                this.camera.isLoading = false;

                this.webcamRef?.videoResize();

                this._changeDetectorRef.markForCheck();

                resolve();
            });
        });
    }

    private async _startDefaultValues() {
        this._setDefaultResponse();
        this._setDefaultCamera();
        this._setDefaultDirections();
        this._setDefaultFace();

        await this._setMaxVideoDimensions();
    }

    private _setResultDimensions(key: "real" | "result", height: number, width: number) {
        const { center, radius } = (this.face[key] = this._getCenterAndRadius(height, width));
        const dimensions = this.camera.dimensions[key];

        if (!dimensions) return;

        dimensions.height = height;
        dimensions.offsetY = 0;
        dimensions.width = Math.min(2.8 * radius.x, width);
        dimensions.offsetX = center.x - dimensions.width / 2;
    }

    private _syncOvalGuide(): void {
        if (this.displayMode !== "portrait") {
            this.ovalGuide = null;
            return;
        }

        const { width, height } = this.camera?.dimensions?.video || {};
        const { center, radius } = this.face?.video || {};

        if (!width || !height || !center || !radius?.x || !radius?.y) {
            this.ovalGuide = null;
            return;
        }

        this.ovalGuide = {
            left: ((center.x - radius.x) / width) * 100,
            top: ((center.y - radius.y) / height) * 100,
            width: ((radius.x * 2) / width) * 100,
            height: ((radius.y * 2) / height) * 100,
        };
    }

    /** 720p is enough for the still that is encrypted and sent. Framing runs on a smaller copy of the same frame. */
    private _cameraConfiguration(isLandscape: boolean): CameraData["configuration"] {
        return this._faceCaptureService.buildCameraConfiguration({
            isLandscape,
            displayMode: this.displayMode,
            deviceId: this.selectedDeviceId || undefined,
        });
    }

    private _setVideoDimensions(videoElement: HTMLVideoElement) {
        const frame = this.displayMode === "portrait" ? this.camera.dimensions.video.max : undefined;
        const actualWidth = frame?.width || videoElement.clientWidth;
        const actualHeight = frame?.height || videoElement.clientHeight;

        this.camera.dimensions.video.height = actualHeight;
        this.camera.dimensions.video.width = actualWidth;
        this.camera.dimensions.result = { height: 0, width: 0, offsetX: 0, offsetY: 0 };

        this._setResultDimensions("result", actualHeight, actualWidth);

        this.face.video = this._getCenterAndRadius(actualHeight, actualWidth);

        if (this.displayMode === "portrait" && this.face.video?.radius) {
            this.face.video.radius.x *= 0.82;
            this.face.video.radius.y *= 0.82;
        }

        this._syncOvalGuide();

        const maskResultCanvas = this.maskResultCanvasRef?.nativeElement;

        maskResultCanvas.style.marginLeft = `0px`;
        maskResultCanvas.style.marginTop = `0px`;

        this._changeDetectorRef.markForCheck();
    }

    private _captureCurrentFrame(video: HTMLVideoElement): void {
        if (this._released || this.response?.base64Image) return;

        const height = video.videoHeight || 0;
        const width = video.videoWidth || 0;
        if (!height || !width) return;

        if (height < this.face.minHeight) {
            this.camera.isLowQuality = true;
            this.canNavigate.emit(true);
            this.error.emit({ error: "low_quality" });
            this._releaseCamera();
            return;
        }

        this._killIntervals();
        this.camera.dimensions.real = { height: 0, width: 0, offsetX: 0, offsetY: 0 };
        this._setResultDimensions("real", height, width);
        this._takePictureLiveness(video);
        this._releaseCamera();
    }

    private _takePictureLiveness(img: CanvasImageSource) {
        const maskResultCanvas = this.maskResultCanvasRef?.nativeElement;
        const toSendCanvas = this.ToSendCanvasRef?.nativeElement;
        const real = this.camera?.dimensions?.real;

        if (!maskResultCanvas || !toSendCanvas || !real?.width || !real?.height) return;

        const src = { x: real.offsetX || 0, y: real.offsetY || 0, width: real.width, height: real.height };
        const preview = this.camera.dimensions.result;

        if (preview?.width && preview?.height) {
            this._faceCaptureService.drawCrop(maskResultCanvas, img, src, {
                width: preview.width,
                height: preview.height,
                offsetX: preview.offsetX,
                offsetY: preview.offsetY,
            });
        }

        const capped = this._faceCaptureService.capRect({ x: 0, y: 0, width: src.width, height: src.height }, 1080);
        this._faceCaptureService.drawCrop(toSendCanvas, img, src, { width: capped.width, height: capped.height });

        this.response.base64Image = toSendCanvas.toDataURL("image/jpeg", BiometricsGeneralComponent.CAPTURE_JPEG_QUALITY);

        this._releaseCamera();
        void this._emitBiometricCapture();
    }

    /**
     * Stop tracks, detach the video, and ignore any stream ngx-webcam attaches after this returns.
     * Safe to call on success, failure, cancel, and destroy.
     */
    private _pausePreview(): void {
        if (this._released) return;

        this._killIntervals();
    }

    private _resumePreview(): void {
        if (this._released || this.response?.base64Image) return;

        this._killIntervals();
        this.cameraAttached = false;
        this._changeDetectorRef.detectChanges();
        this.cameraAttached = true;
        this._changeDetectorRef.detectChanges();
        this._startNgxVideoInterval();
    }

    private _releaseCamera(): void {
        this._released = true;
        this._detecting = false;
        this._unbindPreview();
        this._unbindPreview = () => undefined;
        this._killIntervals();
        this._debounceWindowResize?.cancel();
        this._resizeObserver?.disconnect();
        this._resizeObserver = undefined;
        this._resizeUnlisten();
        this._resizeUnlisten = () => {};

        const videos = new Set<HTMLVideoElement>();

        try {
            const direct = this.webcamRef?.nativeVideoElement;
            if (direct) videos.add(direct);
        } catch {
            /* webcam view already torn down */
        }

        this._host?.nativeElement?.querySelectorAll("video").forEach((node) => {
            videos.add(node as HTMLVideoElement);
        });

        videos.forEach((video) => {
            this._faceCaptureService.releaseVideo(video);
            this._faceCaptureService.sealVideo(video);
        });

        this._mediaStreamService.releaseAll();
    }

    cameraError(error: WebcamInitError): void {
        if (isCameraAbortError(error)) return;

        this._releaseCamera();
        this.canNavigate.emit(true);
        this.error.emit(error);

        if (!this.camera) return;
        if (!error.mediaStreamError || error.mediaStreamError.name !== "NotAllowedError") return;

        this._loading({ isLoading: false, start: true });
        this.camera.hasPermissions = false;
    }

    processImage(webcamImage: WebcamImage): void {
        if (this._released || this.response?.base64Image || !webcamImage) return;
    }
}
