import { environment } from "environments/environment";

/** Bundled QA fixture — same image as API repo `Core/assets/selfie_girl.jpg`. */
const DEV_BIOMETRICS_FIXTURE_URL = "assets/dev/selfie_girl.jpg";

/** True only in non-production dev builds when the env flag is enabled. */
export function isDevBiometricsBypassEnabled(): boolean {
    return !environment.production && environment.devBiometricsBypass === true;
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
