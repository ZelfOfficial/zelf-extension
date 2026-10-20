/// <reference lib="webworker" />

import { hashMeetsDifficulty, sha256Hex, type FacePowChallenge } from "./face-pow.util";

interface WorkerInMessage {
    challenge: FacePowChallenge;
    startAt?: number;
}

addEventListener("message", async (event: MessageEvent<WorkerInMessage>) => {
    const { challenge, startAt = 0 } = event.data;
    const salt = challenge.salt ?? "";
    const difficulty = challenge.difficulty ?? 0;

    try {
        for (let n = startAt; n < Number.MAX_SAFE_INTEGER; n++) {
            const hash = await sha256Hex(`${salt}${n}`);
            if (hashMeetsDifficulty(hash, difficulty)) {
                postMessage({ solution: String(n) });
                return;
            }
        }
        postMessage({ error: "face_pow_unsolved" });
    } catch (err) {
        postMessage({ error: err instanceof Error ? err.message : "face_pow_worker_error" });
    }
});
