/* eslint-disable no-restricted-globals */
/**
 * Standalone PoW worker (bundled as extension asset). Matches
 * Repositories/Face/modules/face-pow.module.js (leading_zero_bits + legacy hex).
 */
(function () {
    const HEX = "0123456789abcdef";

    function resolvePowDifficultyMode(challenge) {
        const mode = challenge && challenge.difficultyMode;
        if (!mode || mode === "leading_hex_zeros") {
            return "leading_hex_zeros";
        }
        if (mode === "leading_zero_bits") {
            return "leading_zero_bits";
        }
        return "leading_zero_bits";
    }

    function leadingZeroBits(hashHex) {
        const normalized = hashHex.length % 2 === 0 ? hashHex : "0" + hashHex;
        const byteLen = normalized.length / 2;
        let bits = 0;
        for (let i = 0; i < byteLen; i++) {
            const byte = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
            if (byte === 0) {
                bits += 8;
                continue;
            }
            for (let j = 7; j >= 0; j--) {
                if (byte & (1 << j)) {
                    return bits + (7 - j);
                }
            }
            return bits;
        }
        return bits;
    }

    function hashMeetsDifficulty(hashHex, difficulty, mode) {
        const required = Math.max(0, Math.floor(difficulty));
        if (required === 0) return true;
        const lower = hashHex.toLowerCase();
        if (mode === "leading_zero_bits") {
            return leadingZeroBits(lower) >= required;
        }
        return lower.startsWith("0".repeat(required));
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
        const mode = resolvePowDifficultyMode(challenge);
        const end = deadlineMs(challenge);
        let n = startAt;

        try {
            while (Date.now() < end) {
                for (let batch = 0; batch < 4000 && Date.now() < end; batch++, n++) {
                    const hash = await sha256Hex(`${salt}${n}`);
                    if (hashMeetsDifficulty(hash, difficulty, mode)) {
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
