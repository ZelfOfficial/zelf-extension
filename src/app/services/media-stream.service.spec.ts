import { MediaStreamService } from "./media-stream.service";

describe("MediaStreamService camera release", () => {
    function canvasStream(): MediaStream {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 4;
        const context = canvas.getContext("2d");
        context?.fillRect(0, 0, 4, 4);
        return canvas.captureStream();
    }

    it("stops tracked streams and video elements without opening a new camera", async () => {
        const getUserMedia = spyOn(navigator.mediaDevices, "getUserMedia").and.callFake(() => Promise.reject(new Error("camera opened")));
        const service = new MediaStreamService();
        const stream = canvasStream();
        service.addStream(stream);

        const video = document.createElement("video");
        video.srcObject = stream;
        document.body.appendChild(video);

        await service.stopAllStreams();

        expect(getUserMedia).not.toHaveBeenCalled();
        expect(stream.getTracks().every((track) => track.readyState === "ended")).toBeTrue();
        expect(video.srcObject).toBeNull();

        video.remove();
    });
});
