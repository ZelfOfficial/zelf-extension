import { solveFacePow, type FacePowChallenge } from "./face-pow.util";

const WORKER_ASSET_PATH = "assets/workers/face-pow.worker.js";

export function getFacePowWorkerScriptUrl(): string {
    const chromeApi = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome;
    if (chromeApi?.runtime?.getURL) {
        return chromeApi.runtime.getURL(WORKER_ASSET_PATH);
    }

    const baseHref = typeof document !== "undefined" ? document.baseURI : "/";
    return new URL(WORKER_ASSET_PATH, baseHref).href;
}

export function createFacePowWorker(): Worker | null {
    if (typeof Worker === "undefined") {
        return null;
    }

    try {
        const url = getFacePowWorkerScriptUrl();
        if (!url || url.startsWith("file:")) {
            return null;
        }
        return new Worker(url, { type: "classic", name: "face-pow" });
    } catch {
        return null;
    }
}

export function solveFacePowInWorker(challenge: FacePowChallenge, startAt = 0): Promise<string> {
    const worker = createFacePowWorker();
    if (!worker) {
        return solveFacePow(challenge, startAt);
    }

    return new Promise<string>((resolve, reject) => {
        const expiresAtMs = challenge.expiresAt ? Date.parse(challenge.expiresAt) : NaN;
        const timeoutMs = Number.isFinite(expiresAtMs)
            ? Math.max(5000, expiresAtMs - Date.now() + 2000)
            : 320_000;

        const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error("face_pow_timeout"));
        }, timeoutMs);

        worker.onmessage = (event: MessageEvent<{ solution?: string; error?: string }>) => {
            clearTimeout(timeout);
            worker.terminate();
            if (event.data?.solution) {
                resolve(event.data.solution);
            } else {
                reject(new Error(event.data?.error ?? "face_pow_worker_error"));
            }
        };

        worker.onerror = () => {
            clearTimeout(timeout);
            worker.terminate();
            solveFacePow(challenge, startAt).then(resolve).catch(reject);
        };

        worker.postMessage({ challenge, startAt });
    });
}
