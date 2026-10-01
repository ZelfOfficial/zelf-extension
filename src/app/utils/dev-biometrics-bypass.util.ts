import { Params } from "@angular/router";

import { environment } from "environments/environment";

/** Bundled QA fixture — same image as API repo `Core/assets/selfie_girl.jpg`. */
const DEV_BIOMETRICS_FIXTURE_URL = "assets/dev/selfie_girl.jpg";

/** URL query param to opt into the dev selfie bypass (Bot/QA automation). */
export const DEV_FACE_BYPASS_QUERY_PARAM = "devFaceBypass";

const DEV_FACE_BYPASS_SESSION_KEY = "devFaceBypass";

function isTruthyQueryValue(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }

    const normalized = String(value).trim().toLowerCase();

    return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** Persist opt-in from route query (or clear when explicitly disabled). */
export function syncDevFaceBypassFromQueryParams(params: Params | Record<string, unknown> | null | undefined): void {
    if (typeof sessionStorage === "undefined") {
        return;
    }

    const value = params?.[DEV_FACE_BYPASS_QUERY_PARAM];

    if (value === undefined) {
        return;
    }

    if (isTruthyQueryValue(value)) {
        sessionStorage.setItem(DEV_FACE_BYPASS_SESSION_KEY, "1");
        return;
    }

    sessionStorage.removeItem(DEV_FACE_BYPASS_SESSION_KEY);
}

function readDevFaceBypassFromCurrentUrl(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const hash = window.location.hash || "";
    const queryIndex = hash.indexOf("?");

    if (queryIndex === -1) {
        return false;
    }

    const params = new URLSearchParams(hash.slice(queryIndex + 1));
    const value = params.get(DEV_FACE_BYPASS_QUERY_PARAM);

    if (!isTruthyQueryValue(value)) {
        return false;
    }

    syncDevFaceBypassFromQueryParams({ [DEV_FACE_BYPASS_QUERY_PARAM]: value });

    return true;
}

function isDevFaceBypassOptedIn(): boolean {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(DEV_FACE_BYPASS_SESSION_KEY) === "1") {
        return true;
    }

    return readDevFaceBypassFromCurrentUrl();
}

/** True only in non-production dev builds when env flag is enabled and URL/session opt-in is present. */
export function isDevBiometricsBypassEnabled(): boolean {
    return !environment.production && environment.devBiometricsBypass === true && isDevFaceBypassOptedIn();
}

/** Loads the dev selfie fixture and returns raw JPEG base64 (no data-URL prefix). */
export async function loadDevBiometricsFixtureBase64(): Promise<string> {
    const response = await fetch(DEV_BIOMETRICS_FIXTURE_URL);

    if (!response.ok) {
        throw new Error(`Failed to load dev biometrics fixture (${response.status})`);
    }

    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.replace(/^data:.*;base64,/, ""));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read dev biometrics fixture"));
        reader.readAsDataURL(blob);
    });
}
