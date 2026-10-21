import { AbstractControl, ValidationErrors, ValidatorFn } from "@angular/forms";

/** Minimum setup-key length (Google Authenticator migration baseline). */
export const ZOTP_SETUP_KEY_MIN_LENGTH = 16;

const BASE32_CHAR_PATTERN = /[A-Z2-7]/;

export function sanitizeSetupKey(raw: string): string {
    return String(raw ?? "")
        .toUpperCase()
        .replace(/[\s\-=]+/g, "");
}

/** Unique invalid characters from the raw input (before sanitization), preserving first-seen order. */
export function findInvalidSetupKeyCharacters(raw: string): string[] {
    const invalid: string[] = [];
    const seen = new Set<string>();

    for (const ch of String(raw ?? "")) {
        if (ch === " " || ch === "-" || ch === "=") {
            continue;
        }

        const upper = ch.toUpperCase();
        if (BASE32_CHAR_PATTERN.test(upper)) {
            continue;
        }

        if (!seen.has(ch)) {
            seen.add(ch);
            invalid.push(ch);
        }
    }

    return invalid;
}

export function formatInvalidSetupKeyCharactersList(chars: string[]): string {
    return chars.map((ch) => `"${ch}"`).join(", ");
}

export interface SetupKeyValidationState {
    sanitized: string;
    invalidChars: string[];
    tooShort: boolean;
    valid: boolean;
}

export function getSetupKeyValidationState(raw: string): SetupKeyValidationState {
    const invalidChars = findInvalidSetupKeyCharacters(raw);
    const sanitized = sanitizeSetupKey(raw);
    const tooShort = sanitized.length > 0 && sanitized.length < ZOTP_SETUP_KEY_MIN_LENGTH;
    const valid = sanitized.length >= ZOTP_SETUP_KEY_MIN_LENGTH && invalidChars.length === 0;

    return { sanitized, invalidChars, tooShort, valid };
}

export function setupKeyValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
        const raw = String(control.value ?? "");

        if (!raw.trim()) {
            return { required: true };
        }

        const state = getSetupKeyValidationState(raw);

        if (state.invalidChars.length > 0) {
            return { invalidChars: state.invalidChars };
        }

        if (state.tooShort) {
            return { tooShort: { length: state.sanitized.length } };
        }

        return null;
    };
}
