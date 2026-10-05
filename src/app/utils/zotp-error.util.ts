import { TranslocoService } from "@jsverse/transloco";

/** Translate an API error code (`errors.*`) when there is one; otherwise use the zOTP fallback key. */
export function translateZotpError(translocoService: TranslocoService, error: any, fallbackKey: string): string {
    const errorKeys = [error?.error?.error, error?.error?.message, error?.message].filter((key) => typeof key === "string" && key);

    for (const errorKey of errorKeys) {
        const translationKey = `errors.${errorKey}`;
        const translation = translocoService.translate(translationKey);

        if (translation !== translationKey) return translation;
    }

    return translocoService.translate(fallbackKey);
}
