/**
 * "Card holder name" rule for Zelf Keys payment cards (#574). Same rule as the iOS/Android
 * CardHolderName helpers and the v4 backend: letters of any script (with their combining
 * marks and ZWNJ/ZWJ), spaces and ' ’ - . · ・, at least one letter, up to 50 characters.
 */
export const CARD_HOLDER_NAME_MAX_LENGTH = 50;

const SEPARATORS = new Set(["'", "\u2019", "-", ".", "\u00B7", "\u30FB"]);
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const WHITESPACE = /\s/u;

export interface CardHolderNameInput {
    /** Text left in the field. */
    value: string;
    /** A digit, symbol or emoji was removed (spaces that were collapsed don't count). */
    rejected: boolean;
}

const isVariationSelector = (cp: number): boolean => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

/** Cleans typed or pasted text: drops what doesn't belong in a name, no leading or double spaces. */
export function sanitizeCardHolderName(raw: string): CardHolderNameInput {
    let value = "";
    let rejected = false;
    let previousWasLetter = false;

    for (const ch of raw ?? "") {
        const cp = ch.codePointAt(0)!;

        if (WHITESPACE.test(ch)) {
            if (value.length && !value.endsWith(" ")) value += " ";
            previousWasLetter = false;
        } else if (LETTER.test(ch)) {
            value += ch;
            previousWasLetter = true;
        } else if (previousWasLetter && ((MARK.test(ch) && !isVariationSelector(cp)) || cp === 0x200c || cp === 0x200d)) {
            value += ch;
        } else if (SEPARATORS.has(ch)) {
            value += ch;
            previousWasLetter = false;
        } else {
            rejected = true;
            previousWasLetter = false;
        }
    }

    const chars = Array.from(value);
    if (chars.length > CARD_HOLDER_NAME_MAX_LENGTH) value = chars.slice(0, CARD_HOLDER_NAME_MAX_LENGTH).join("");

    return { value, rejected };
}

export function cardHolderNameHasLetter(value: string): boolean {
    return LETTER.test(value ?? "");
}

/** Can be saved: not empty, at least one letter, only allowed characters, max 50. */
export function isValidCardHolderName(value: string): boolean {
    const name = (value ?? "").trim();
    if (!name || Array.from(name).length > CARD_HOLDER_NAME_MAX_LENGTH || !cardHolderNameHasLetter(name)) return false;
    const clean = sanitizeCardHolderName(name);
    return !clean.rejected && clean.value === name;
}

/** Value that is sent to the backend: cleaned and without trailing spaces. */
export function normalizeCardHolderName(value: string): string {
    return sanitizeCardHolderName(value).value.trim();
}

/** Backend 409 for this field: `{ validationError: "\"cardName\" ..." }`. */
export function isCardHolderNameValidationError(error: any): boolean {
    const status = error?.status ?? error?.error?.status;
    const message = String(error?.error?.validationError ?? error?.validationError ?? "");
    return status === 409 && /cardName/i.test(message);
}
