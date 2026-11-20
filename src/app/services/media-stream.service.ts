import { Injectable } from "@angular/core";

@Injectable({
    providedIn: "root",
})
export class MediaStreamService {
    private _activeStreams: MediaStream[] = [];

    async startStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        this._activeStreams.push(stream);

        return stream;
    }

    addStream(stream: MediaStream): void {
        this._activeStreams.push(stream);
    }

    stopStream(stream: MediaStream): void {
        stream.getTracks().forEach((track) => track.stop());

        this._activeStreams = this._activeStreams.filter((activeStream) => activeStream !== stream);
    }

    /**
     * Stop every camera we already have.
     * Do not call getUserMedia here: opening a new stream turns the camera back on,
     * and Chrome can leave the indicator lit if that stream is stopped without a video element.
     */
    async stopAllStreams(): Promise<void> {
        const streams = this._activeStreams.splice(0);

        streams.forEach((stream) => {
            stream?.getTracks().forEach((track) => {
                try {
                    track.stop();
                } catch {
                    /* already ended */
                }
            });
        });

        if (typeof document === "undefined") return;

        document.querySelectorAll("video").forEach((video) => {
            if (video.srcObject instanceof MediaStream) this._releaseVideoElement(video);
        });
    }

    private _releaseVideoElement(video: HTMLVideoElement): void {
        const stream = video.srcObject;

        try {
            video.pause();
        } catch {
            /* ignore */
        }

        if (stream instanceof MediaStream) {
            stream.getTracks().forEach((track) => {
                try {
                    track.stop();
                } catch {
                    /* already ended */
                }
            });
        }

        try {
            video.srcObject = null;
        } catch {
            /* ignore */
        }
    }
}
