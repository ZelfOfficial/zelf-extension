/* eslint-disable no-restricted-globals */
/**
 * Standalone PoW worker (bundled as extension asset). Algorithm matches
 * Repositories/Face/modules/face-pow.module.js (leading hex zeroes).
 */
(function () {
    const HEX = "0123456789abcdef";

    function hashMeetsDifficulty(hashHex, difficulty) {
        const d = Math.max(0, Math.floor(difficulty));
        if (d === 0) return true;
        return hashHex.toLowerCase().startsWith("0".repeat(d));
    }

    async function sha256Hex(input) {
        const data = new TextEncoder().encode(input);
        const digest = await crypto.subtle.digest("SHA-256", data);
        const bytes = new Uint8Array(digest);
        let hex = "";
        for (let i = 0; i < bytes.length; i++) {
            hex += HEX[bytes[i] >> 4];
            hex += HEX[bytes[i] & 0x0f];
        }
        return hex;
    }

    function deadlineMs(challenge) {
        if (challenge.expiresAt) {
            const t = Date.parse(challenge.expiresAt);
            if (Number.isFinite(t)) return t;
        }
        return Date.now() + 300000;
    }

    self.onmessage = async function (event) {
        const challenge = event.data && event.data.challenge;
        const startAt = (event.data && event.data.startAt) || 0;
        if (!challenge || !challenge.salt) {
            self.postMessage({ error: "face_pow_invalid_challenge" });
            return;
        }

        const salt = challenge.salt;
        const difficulty = challenge.difficulty || 0;
        const end = deadlineMs(challenge);
        let n = startAt;

        try {
            while (Date.now() < end) {
                for (let batch = 0; batch < 4000 && Date.now() < end; batch++, n++) {
                    const hash = await sha256Hex(`${salt}${n}`);
                    if (hashMeetsDifficulty(hash, difficulty)) {
                        self.postMessage({ solution: String(n) });
                        return;
                    }
                }
            }
            self.postMessage({ error: "face_pow_unsolved" });
        } catch (err) {
            self.postMessage({ error: err && err.message ? err.message : "face_pow_worker_error" });
        }
    };
})();
